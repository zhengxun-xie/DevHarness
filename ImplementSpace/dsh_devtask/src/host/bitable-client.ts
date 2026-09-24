/**
 * 飞书多维表格（Bitable）数据源客户端。
 *
 * 通过 lark-cli 子进程调用飞书 Bitable OpenAPI，以 bot 身份读写
 * 「系统软件组OKR管理」多维表格。OKR 层级跨三张表：
 *   🎯Objective（目标）tblXtvkNiyPEvNef   —— O 层，3 条
 *   📈KR（关键结果）    tbl4NfvZx6Txxtc7   —— KR 层，链接到 O
 *   📋OKR 任务拆解       tblKMr0kmSVq7Ibn   —— 任务层，链接到 KR；
 *                                              表内「父记录 2」再拆出模块子任务
 * bot 凭证由 lark-cli 管理（`lark-cli auth status` 查看就绪状态）。
 *
 * 字段映射（多维表格字段 → DevTask 模型）：
 *   任务(text)      → task.title
 *   任务状态(select) → task.status（未开始→todo / 进行中→running / 已完成→done）
 *   负责人(user)    → task.employeeId + employee.name
 *   进展描述(text)  → task.description
 *   任务进度(number)→ task.progress（0–1）
 *   开始日期(datetime) → task.startDate
 *   预计完成日期(datetime) → task.dueDate
 *   父记录 2(link)   → task.parentId（表内：任务 → 模块子任务）
 *   KR（关键结果）(link) → task.krId（跨表：任务 → 📈KR 表记录）
 */
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import type { ActivityEvent } from '../protocol.ts'

/** 多维表格 app token（系统软件组OKR管理） */
const BITABLE_APP_TOKEN = 'CoFgbBbduamIMwsu8CccyU50nnf'

/** O 层表 ID（🎯Objective（目标）） */
const TABLE_OBJECTIVE = 'tblXtvkNiyPEvNef'

/** KR 层表 ID（📈KR（关键结果）） */
const TABLE_KR = 'tbl4NfvZx6Txxtc7'

/** 任务表 ID（📋OKR 任务拆解） */
const TABLE_TASK = 'tblKMr0kmSVq7Ibn'

/** lark-cli 身份 */
const IDENTITY = 'bot'

/** record-list 单页上限（飞书 OpenAPI 限制 1–200） */
const PAGE_SIZE = 200

/** 多维表格字段名 → DevTask 字段 的映射键（按表分组，同名字段在不同表查询） */
const FIELD = {
  /* 📋OKR 任务拆解 */
  title: '任务',
  status: '任务状态',
  owner: '负责人',
  note: '进展描述',
  progress: '任务进度',
  startDate: '开始日期',
  dueDate: '预计完成日期',
  parent: '父记录 2',
  kr: 'KR（关键结果）',
  /* 🎯Objective（目标） */
  objTitle: 'Objective（目标）',
  objOwner: '负责人',
  objPeriod: '目标周期',
  /* 📈KR（关键结果） */
  krTitle: 'KR（关键结果）',
  krObjective: 'Objective（目标）',
  krOwner: '负责人',
  krProgress: 'KR任务进度',
} as const

/** 多维表格 select 选项 → DevTask status（读取方向） */
const STATUS_TO_DEV: Record<string, string> = {
  未开始: 'todo',
  进行中: 'running',
  已完成: 'done',
}

/** DevTask status → 多维表格 select 选项（写入方向，backlog/failed 归入未开始） */
const STATUS_TO_BITABLE: Record<string, string> = {
  backlog: '未开始',
  todo: '未开始',
  running: '进行中',
  done: '已完成',
  failed: '未开始',
}

/** lark-cli 可执行路径候选：先走 PATH，再 fallback 到已知的插件安装路径 */
const LARK_CLI_FALLBACK = '/home/l-xiezhenxun/.trae-cn/plugins/trae-remote-official/lark/1.0.5/bin/lark-cli'

/** record-list 返回的一条记录（字段名→值） */
export interface BitableRecord {
  recordId: string
  fields: Record<string, unknown>
}

/** 从负责人字段提取的员工信息 */
export interface BitableEmployee {
  id: string
  name: string
}

/** DevTask 任务记录（从多维表格映射后的结构） */
export interface BitableTask {
  id: string
  title: string
  description: string
  status: string
  priority: string
  tags: string[]
  employeeId: string | null
  employeeName: string | null
  /** 表内父任务（父记录 2）：任务 → 模块子任务。 */
  parentId: string | null
  /** 跨表 KR 链接（KR（关键结果））：任务 → 📈KR 表记录；未关联时为 null。 */
  krId: string | null
  progress: number | null
  startDate: string | null
  dueDate: string | null
  updatedAt: string
  createdAt: string
}

/** DevTask OKR 目标记录（🎯Objective 表映射） */
export interface BitableObjective {
  id: string
  title: string
  ownerIds: string[]
  period: string
}

/** DevTask OKR 关键结果记录（📈KR 表映射） */
export interface BitableKeyResult {
  id: string
  title: string
  /** 链接到 🎯Objective 表的记录 id；未关联为 null。 */
  objectiveId: string | null
  ownerIds: string[]
  /** KR任务进度 "59.0%" → 59；无法解析或空为 null。 */
  progress: number | null
}

/* ------------------------- lark-cli 子进程封装 ------------------------- */

/**
 * 执行 lark-cli 命令并解析 JSON 输出；失败时抛出带 stderr 的 Error。
 *
 * timeout 到期用 SIGKILL 而不是默认 SIGTERM：lark-cli 内部对限流
 *（99991400，retryable）会长退避重试，SIGTERM 被它挂着不处理，节点能活
 * 二十多分钟，execFile 回调永远不来——上层 Promise 永不 settle，UI 一直
 * 转圈。SIGKILL 必死，回调必触发，失败按错误路径走。
 */
function runCli(args: string[], timeoutMs = 30_000): Promise<unknown> {
  return new Promise((resolveP, rejectP) => {
    execFile('lark-cli', args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err !== null) {
        const tail = stderr.trim().slice(-500)
        rejectP(new Error(`lark-cli 退出码 ${err.code ?? '?'}: ${tail || err.message}`))
        return
      }
      const text = stdout.trim()
      if (text === '') {
        rejectP(new Error('lark-cli 无输出'))
        return
      }
      try {
        resolveP(JSON.parse(text))
      } catch {
        // JSON 解析失败 → 尝试 fallback 路径
        rejectP(new Error(`lark-cli 输出非 JSON: ${text.slice(0, 200)}`))
      }
    })
  })
}

/** 若 PATH 中找不到 lark-cli，用绝对路径 fallback 再试一次。 */
async function runCliWithFallback(args: string[], timeoutMs?: number): Promise<unknown> {
  try {
    return await runCli(args, timeoutMs)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 仅在「找不到可执行文件」时 fallback
    if (!/ENOENT|not found/i.test(msg)) throw err
    return new Promise((resolveP, rejectP) => {
      execFile(LARK_CLI_FALLBACK, args, { timeout: timeoutMs ?? 30_000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err !== null) {
          const tail = stderr.trim().slice(-500)
          rejectP(new Error(`lark-cli(fallback) 退出码 ${err.code ?? '?'}: ${tail || err.message}`))
          return
        }
        const text = stdout.trim()
        if (text === '') {
          rejectP(new Error('lark-cli(fallback) 无输出'))
          return
        }
        try {
          resolveP(JSON.parse(text))
        } catch {
          rejectP(new Error(`lark-cli(fallback) 输出非 JSON: ${text.slice(0, 200)}`))
        }
      })
    })
  }
}

/* ------------------------- 值解析工具 ------------------------- */

/** 将任意值转为字符串文本（text/select/lookup 等字段通用）。 */
function asText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    return v
      .map(x => (x != null && typeof x === 'object' ? String((x as Record<string, unknown>).text ?? (x as Record<string, unknown>).name ?? '') : String(x)))
      .join('')
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return String(o.text ?? o.name ?? '')
  }
  return ''
}

/** 从「负责人」(user) 字段提取第一个员工的 id 和 name。 */
function asUser(v: unknown): BitableEmployee | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const first = v[0]
  if (first == null || typeof first !== 'object') return null
  const o = first as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  const name = typeof o.name === 'string' ? o.name : ''
  if (id === '' && name === '') return null
  return { id, name: name || id }
}

/** 从「负责人」(user) 字段提取全部员工（O/KR 表常为多负责人）。 */
function asUsers(v: unknown): BitableEmployee[] {
  if (!Array.isArray(v)) return []
  const out: BitableEmployee[] = []
  for (const item of v) {
    if (item == null || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const name = typeof o.name === 'string' ? o.name : ''
    if (id === '' && name === '') continue
    out.push({ id, name: name || id })
  }
  return out
}

/**
 * 从 datetime 字段转为 ISO 字符串。lark-cli 对该字段可能返回：
 *   - 毫秒时间戳（number，飞书原生格式）
 *   - ISO 字符串（如 2026-09-01T00:00:00.000+08:00，lark-cli 已做格式化）
 * 两种都规范化为标准 ISO；无法解析时返回 null。
 */
function asDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(v).toISOString()
  }
  if (typeof v === 'string' && v !== '') {
    const parsed = new Date(v)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return null
}

/** 从 link 字段提取第一个关联记录的 id（父记录 / KR 链接通用）。 */
function asLinkFirstId(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const first = v[0]
  if (first == null || typeof first !== 'object') return null
  const id = (first as Record<string, unknown>).id
  return typeof id === 'string' ? id : null
}

/** 从 "59.0%" 或 59 或 0.59 解析出 0–100 的百分数；无法解析返回 null。 */
function asPercent(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // 0–1 视为比例，其余视为已是百分数
    return v <= 1 ? Math.round(v * 100) : Math.round(v)
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const m = v.trim().match(/^([\d.]+)%?$/)
    if (m !== null) {
      const n = Number(m[1])
      if (Number.isFinite(n)) return Math.round(n)
    }
  }
  return null
}

/* ------------------------- 通用记录拉取 ------------------------- */

interface RawTableRows {
  /** 每行的 字段名 → 值。 */
  rows: Array<Record<string, unknown>>
  /** 每行对应的 record id。 */
  recordIds: string[]
}

/** 分页拉取指定表按给定字段投影的全部记录（领域无关，供三张表共用）。 */
async function fetchTableRows(tableId: string, fieldNames: readonly string[]): Promise<RawTableRows> {
  const allRows: RawTableRows['rows'] = []
  const allRecordIds: string[] = []
  let offset = 0

  // record-list 用 offset 分页，单页 limit 最大 200
  for (;;) {
    const args = [
      'base', '+record-list',
      '--base-token', BITABLE_APP_TOKEN,
      '--table-id', tableId,
      '--as', IDENTITY,
      '--format', 'json',
      '--limit', String(PAGE_SIZE),
      '--offset', String(offset),
      ...fieldNames.flatMap(f => ['--field-id', f]),
    ]
    const raw = await runCliWithFallback(args) as {
      ok: boolean
      data?: {
        data: unknown[][]
        fields: string[]
        record_id_list: string[]
        has_more: boolean
      }
      error?: unknown
    }
    if (!raw.ok || !raw.data) throw new Error(`fetchTableRows(${tableId}): lark-cli 返回失败: ${JSON.stringify(raw.error ?? raw).slice(0, 300)}`)
    const { data: rows, fields, record_id_list: recordIds, has_more } = raw.data

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!
      const fieldsMap: Record<string, unknown> = {}
      fields.forEach((name, i) => { fieldsMap[name] = row[i] })
      allRows.push(fieldsMap)
      allRecordIds.push(recordIds[r] ?? '')
    }

    if (!has_more || rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return { rows: allRows, recordIds: allRecordIds }
}

/* ------------------------- 对外 API ------------------------- */

/** 分页拉取任务表全部记录，映射为 BitableTask 列表。 */
export async function listTasks(): Promise<{ tasks: BitableTask[]; employees: BitableEmployee[] }> {
  const fieldNames = [FIELD.title, FIELD.status, FIELD.owner, FIELD.note, FIELD.progress, FIELD.startDate, FIELD.dueDate, FIELD.parent, FIELD.kr]
  const { rows, recordIds } = await fetchTableRows(TABLE_TASK, fieldNames)

  // 映射为 BitableTask，同时收集员工去重
  const tasks: BitableTask[] = []
  const employeeMap = new Map<string, BitableEmployee>()
  const now = new Date().toISOString()

  for (let i = 0; i < rows.length; i++) {
    const fieldsMap = rows[i]!
    const recordId = recordIds[i] ?? ''
    const title = asText(fieldsMap[FIELD.title]).trim()
    if (title === '') continue // 空标题行跳过
    const statusRaw = asText(fieldsMap[FIELD.status]).trim()
    const status = STATUS_TO_DEV[statusRaw] ?? 'todo'
    const owner = asUser(fieldsMap[FIELD.owner])
    const progress = typeof fieldsMap[FIELD.progress] === 'number'
      ? fieldsMap[FIELD.progress] as number
      : null

    if (owner !== null && !employeeMap.has(owner.id)) {
      employeeMap.set(owner.id, owner)
    }

    tasks.push({
      id: recordId,
      title,
      description: asText(fieldsMap[FIELD.note]).trim(),
      status,
      priority: 'p2',
      tags: [],
      employeeId: owner?.id ?? null,
      employeeName: owner?.name ?? null,
      parentId: asLinkFirstId(fieldsMap[FIELD.parent]),
      krId: asLinkFirstId(fieldsMap[FIELD.kr]),
      progress,
      startDate: asDate(fieldsMap[FIELD.startDate]),
      dueDate: asDate(fieldsMap[FIELD.dueDate]),
      updatedAt: now,
      createdAt: now,
    })
  }

  const employees = [...employeeMap.values()]
  return { tasks, employees }
}

/** 拉取 🎯Objective（目标）表全部记录。 */
export async function listObjectives(): Promise<{ objectives: BitableObjective[]; employees: BitableEmployee[] }> {
  const { rows, recordIds } = await fetchTableRows(TABLE_OBJECTIVE, [FIELD.objTitle, FIELD.objOwner, FIELD.objPeriod])

  const objectives: BitableObjective[] = []
  const employeeMap = new Map<string, BitableEmployee>()

  for (let i = 0; i < rows.length; i++) {
    const fieldsMap = rows[i]!
    const title = asText(fieldsMap[FIELD.objTitle]).trim()
    if (title === '') continue // 空标题行跳过
    const owners = asUsers(fieldsMap[FIELD.objOwner])
    for (const o of owners) if (!employeeMap.has(o.id)) employeeMap.set(o.id, o)
    objectives.push({
      id: recordIds[i] ?? '',
      title,
      ownerIds: owners.map(o => o.id),
      period: asText(fieldsMap[FIELD.objPeriod]).trim(),
    })
  }
  return { objectives, employees: [...employeeMap.values()] }
}

/** 拉取 📈KR（关键结果）表全部记录。 */
export async function listKeyResults(): Promise<{ keyResults: BitableKeyResult[]; employees: BitableEmployee[] }> {
  const { rows, recordIds } = await fetchTableRows(TABLE_KR, [FIELD.krTitle, FIELD.krObjective, FIELD.krOwner, FIELD.krProgress])

  const keyResults: BitableKeyResult[] = []
  const employeeMap = new Map<string, BitableEmployee>()

  for (let i = 0; i < rows.length; i++) {
    const fieldsMap = rows[i]!
    const title = asText(fieldsMap[FIELD.krTitle]).trim()
    if (title === '') continue // 空标题行跳过
    const owners = asUsers(fieldsMap[FIELD.krOwner])
    for (const o of owners) if (!employeeMap.has(o.id)) employeeMap.set(o.id, o)
    keyResults.push({
      id: recordIds[i] ?? '',
      title,
      objectiveId: asLinkFirstId(fieldsMap[FIELD.krObjective]),
      ownerIds: owners.map(o => o.id),
      progress: asPercent(fieldsMap[FIELD.krProgress]),
    })
  }
  return { keyResults, employees: [...employeeMap.values()] }
}

/* ------------------------- 活动事件（记录历史聚合） ------------------------- */

/**
 * 参与活动事件的字段白名单。派生字段（formula「预计完成时段」、lookup
 * 「Objective（目标）」等）的变更是噪音，直接过滤。
 */
const ACTIVITY_FIELDS: Set<string> = new Set([
  FIELD.title,
  FIELD.status,
  FIELD.owner,
  FIELD.note,
  FIELD.progress,
  FIELD.startDate,
  FIELD.dueDate,
  FIELD.parent,
  FIELD.kr,
])

/** 单条记录历史的原始返回（lark-cli base +record-history-list）。 */
interface RawHistoryItem {
  activity_type?: string
  create_time?: number
  operator?: string
  rev?: number
  field_changes?: Array<{
    field_name?: string
    before?: unknown
    after?: unknown
  }>
}

/** 历史值规整为可读文本：时间戳/日期字符串 → ISO，其余 String()。 */
function historyValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' && Number.isFinite(v) && v > 1e11) {
    return new Date(v).toISOString()
  }
  if (Array.isArray(v)) {
    return v.map(x => (x != null && typeof x === 'object' ? String((x as Record<string, unknown>).name ?? '') : String(x))).join('、')
  }
  if (typeof v === 'object') {
    return String((v as Record<string, unknown>).name ?? '')
  }
  return String(v)
}

/** Feishu 限流错误（99991400 / subtype rate_limit，retryable）。 */
class RateLimitError extends Error {
  constructor() {
    super('飞书接口限流（99991400），请稍后重试')
    this.name = 'RateLimitError'
  }
}

/** 判断 lark-cli 的 ok:false 信封是否是限流。 */
function isRateLimitEnvelope(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false
  const err = (raw as { error?: { subtype?: unknown; code?: unknown; message?: unknown } }).error
  if (err === undefined || err === null) return false
  if (err.subtype === 'rate_limit' || err.code === 99991400) return true
  return typeof err.message === 'string' && /rate.?limit|frequency limit/i.test(err.message)
}

/**
 * 拉取单条任务记录的变更历史。
 * 限流抛 RateLimitError（调用方退避后整批重试）；其余失败返回空数组，
 * 不拖垮整体聚合。
 */
async function listRecordHistory(recordId: string): Promise<RawHistoryItem[]> {
  const args = [
    'base', '+record-history-list',
    '--base-token', BITABLE_APP_TOKEN,
    '--table-id', TABLE_TASK,
    '--record-id', recordId,
    '--as', IDENTITY,
    '--format', 'json',
  ]
  try {
    const raw = await runCliWithFallback(args, 15_000) as {
      ok: boolean
      error?: unknown
      data?: { items?: RawHistoryItem[] }
    }
    if (!raw.ok) {
      if (isRateLimitEnvelope(raw)) throw new RateLimitError()
      return []
    }
    if (!Array.isArray(raw.data?.items)) return []
    return raw.data!.items!
  } catch (caught) {
    if (caught instanceof RateLimitError) throw caught
    return []
  }
}

/** 聚合活动事件的内存缓存（record-history-list 逐条调用成本高，60s TTL）。 */
let activityCache: { at: number; events: ActivityEvent[] } | null = null
const ACTIVITY_TTL_MS = 60_000

/** 进行中的聚合（dsh 双实例会同时挂两份面板，各点一次活动视图 → 合并成一次真实拉取）。 */
let activityInflight: Promise<ActivityEvent[]> | null = null

/** 作废活动事件缓存（任务发生写操作后调用，保证动态立即可见）。 */
export function invalidateActivityCache(): void {
  activityCache = null
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * 聚合任务表的变更历史为活动事件流（新→旧）。
 *
 * 先 listTasks() 拿 record id 与标题，再分批并发逐条拉 record-history-list，
 * 扁平化、过滤派生字段、按时间倒序取前 limit 条。
 *
 * 限流治理（飞书对 record-history 有频控，突发打满会 99991400）：
 *   - 每批并发从 8 降到 4，双实例合并为一次真实拉取（activityInflight）；
 *   - 被限流的记录整批退避后重试（1s / 3s 两级，最多 3 轮），仍失败的记录
 *     本次放弃（部分数据好过整体失败）；
 *   - 若一条都没拉到且撞限流，抛 RateLimitError 让界面显示可重试的错误，
 *     而不是渲染空列表或永远转圈。
 * 单条非限流失败跳过；整体结果缓存 60s（`force` 可绕过，供手动刷新）。
 */
export async function listRecentActivity(limit = 100, force = false): Promise<ActivityEvent[]> {
  const now = Date.now()
  if (!force && activityCache !== null && now - activityCache.at < ACTIVITY_TTL_MS) {
    return activityCache.events.slice(0, limit)
  }
  if (!force && activityInflight !== null) return activityInflight.then(events => events.slice(0, limit))
  const aggregation = aggregateActivity()
  activityInflight = aggregation
  try {
    const events = await aggregation
    activityCache = { at: now, events }
    return events.slice(0, limit)
  } finally {
    if (activityInflight === aggregation) activityInflight = null
  }
}

/** 真实聚合流程（listRecentActivity 的去重/缓存外壳之内）。 */
async function aggregateActivity(): Promise<ActivityEvent[]> {
  const { tasks } = await listTasks()
  const titleById = new Map(tasks.map(t => [t.id, t.title]))

  const histories = new Map<string, RawHistoryItem[]>()
  let rateLimited = false
  const BATCH = 4
  const BACKOFF_MS = [1000, 3000]

  let pending = tasks.map(t => t.id)
  for (let round = 0; pending.length > 0 && round <= BACKOFF_MS.length; round++) {
    if (round > 0) await sleep(BACKOFF_MS[round - 1]!)
    const retryNext: string[] = []
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH)
      const results = await Promise.all(batch.map(async id => {
        try {
          return { id, items: await listRecordHistory(id), limited: false }
        } catch (caught) {
          return { id, items: null as RawHistoryItem[] | null, limited: caught instanceof RateLimitError }
        }
      }))
      for (const r of results) {
        if (r.items !== null) histories.set(r.id, r.items)
        else if (r.limited) { rateLimited = true; retryNext.push(r.id) }
        // 其余失败（超时/无输出）本轮放弃，不重试
      }
    }
    pending = retryNext
  }

  if (histories.size === 0) {
    if (rateLimited) throw new RateLimitError()
    return []
  }

  const events: ActivityEvent[] = []
  for (const task of tasks) {
    const items = histories.get(task.id)
    if (items === undefined) continue
    for (const item of items) {
      const at = item.create_time === undefined ? null : new Date(item.create_time * 1000).toISOString()
      if (at === null) continue
      const changes = (item.field_changes ?? [])
        .filter(c => c.field_name !== undefined && ACTIVITY_FIELDS.has(c.field_name))
        .map(c => ({ field: c.field_name!, before: historyValue(c.before), after: historyValue(c.after) }))
      const type = item.activity_type === 'create' ? 'create' : 'update'
      // create 事件无 changes；update 事件若只剩派生字段变更则跳过（纯噪音）
      if (type === 'update' && changes.length === 0) continue
      events.push({
        id: `${task.id}:${item.rev ?? at}`,
        recordId: task.id,
        taskTitle: titleById.get(task.id) ?? task.id,
        operator: item.operator ?? '',
        at,
        type,
        changes,
      })
    }
  }
  events.sort((a, b) => b.at.localeCompare(a.at))
  return events
}

/** 在多维表格中创建一条任务记录，返回新 record id。 */
export async function createTask(input: {
  title: string
  description?: string
  status?: string
  employeeId?: string | null
}): Promise<string> {
  const fields: Record<string, unknown> = {
    [FIELD.title]: input.title,
  }
  if (input.status !== undefined && STATUS_TO_BITABLE[input.status] !== undefined) {
    fields[FIELD.status] = [STATUS_TO_BITABLE[input.status]!]
  }
  if (input.description !== undefined && input.description !== '') {
    fields[FIELD.note] = input.description
  }
  if (input.employeeId) {
    fields[FIELD.owner] = [{ id: input.employeeId }]
  }

  const json = JSON.stringify({ create_records: [fields] })
  const args = [
    'base', '+record-batch-create',
    '--base-token', BITABLE_APP_TOKEN,
    '--table-id', TABLE_TASK,
    '--as', IDENTITY,
    '--format', 'json',
    '--json', json,
  ]
  const raw = await runCliWithFallback(args) as {
    ok: boolean
    data?: { records?: Array<{ record_id?: string; record?: Record<string, unknown> }> }
    error?: unknown
  }
  if (!raw.ok || !raw.data?.records?.[0]) {
    throw new Error(`createTask: ${JSON.stringify(raw.error ?? raw).slice(0, 300)}`)
  }
  const newId = raw.data.records[0]!.record_id
  if (!newId) throw new Error('createTask: 返回的记录缺少 record_id')
  return newId
}

/** 可更新的任务字段子集（缺省字段不修改）。 */
export interface BitablePatch {
  title?: string
  description?: string
  status?: string
  employeeId?: string | null
}

/** 更新多维表格中的任务记录字段。 */
export async function updateTask(recordId: string, patch: BitablePatch): Promise<void> {
  const fields: Record<string, unknown> = {}
  if (patch.title !== undefined) fields[FIELD.title] = patch.title
  if (patch.description !== undefined) fields[FIELD.note] = patch.description === '' ? null : patch.description
  if (patch.status !== undefined && STATUS_TO_BITABLE[patch.status] !== undefined) {
    fields[FIELD.status] = [STATUS_TO_BITABLE[patch.status]!]
  }
  if (patch.employeeId !== undefined) {
    fields[FIELD.owner] = patch.employeeId === null || patch.employeeId === '' ? [] : [{ id: patch.employeeId }]
  }
  if (Object.keys(fields).length === 0) return

  const json = JSON.stringify({ update_records: { [recordId]: fields } })
  const args = [
    'base', '+record-batch-update',
    '--base-token', BITABLE_APP_TOKEN,
    '--table-id', TABLE_TASK,
    '--as', IDENTITY,
    '--format', 'json',
    '--json', json,
  ]
  const raw = await runCliWithFallback(args) as { ok: boolean; error?: unknown }
  if (!raw.ok) throw new Error(`updateTask: ${JSON.stringify(raw.error ?? raw).slice(0, 300)}`)
}

/** 删除多维表格中的一条任务记录。 */
export async function deleteTask(recordId: string): Promise<void> {
  const args = [
    'base', '+record-delete',
    '--base-token', BITABLE_APP_TOKEN,
    '--table-id', TABLE_TASK,
    '--as', IDENTITY,
    '--format', 'json',
    '--record-id', recordId,
    '--yes',
  ]
  const raw = await runCliWithFallback(args) as { ok: boolean; error?: unknown }
  if (!raw.ok) throw new Error(`deleteTask: ${JSON.stringify(raw.error ?? raw).slice(0, 300)}`)
}
