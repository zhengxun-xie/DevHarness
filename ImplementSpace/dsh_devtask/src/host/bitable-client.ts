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
import type { ActivityEvent, LogSubjectKind, TaskLogEntry } from '../protocol.ts'

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
 * 拉取单条记录的变更历史。
 * 限流抛 RateLimitError（调用方退避后整批重试）；其余失败返回空数组，
 * 不拖垮整体聚合。
 *
 * @param tableId 06 §7：去掉了任务表硬编码——O/KR/任务/子任务按各自
 *                表 id 查询（子任务与任务同表）。
 * @param strict  单主体日志查询用：任何失败都上抛（让响应带 historyError），
 *                而不是静默返回空数组——空数组与「拉取失败」在那里必须可分。
 */
async function listRecordHistory(recordId: string, tableId: string = TABLE_TASK, strict = false): Promise<RawHistoryItem[]> {
  const args = [
    'base', '+record-history-list',
    '--base-token', BITABLE_APP_TOKEN,
    '--table-id', tableId,
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
      if (strict) throw new Error(`record-history-list 失败: ${JSON.stringify(raw.error ?? raw).slice(0, 200)}`)
      return []
    }
    if (!Array.isArray(raw.data?.items)) {
      if (strict) throw new Error('record-history-list 返回缺少 items')
      return []
    }
    return raw.data!.items!
  } catch (caught) {
    if (caught instanceof RateLimitError) throw caught
    if (strict) throw caught
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
  subjectHistoryCache.clear()
  subjectHistoryGen++
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

/* ---------------------- 任务日志：单主体 record-history 物化（06 §7） ---------------------- */

/** 主体层级 → 表 id（子任务与任务同表）。 */
const TABLE_BY_SUBJECT_KIND: Record<LogSubjectKind, string> = {
  objective: TABLE_OBJECTIVE,
  kr: TABLE_KR,
  task: TABLE_TASK,
  subtask: TABLE_TASK,
}

/**
 * 各表参与日志摘要的字段白名单（对应任务表的 ACTIVITY_FIELDS；O/KR 表
 * 各自的可编辑字段，派生/公式字段同样过滤）。
 */
const LOG_FIELDS_BY_KIND: Record<LogSubjectKind, Set<string>> = {
  objective: new Set([FIELD.objTitle, FIELD.objOwner, FIELD.objPeriod]),
  kr: new Set([FIELD.krTitle, FIELD.krObjective, FIELD.krOwner, FIELD.krProgress]),
  task: ACTIVITY_FIELDS,
  subtask: ACTIVITY_FIELDS,
}

/**
 * 单主体 history 的内存缓存（hover 预取与点击合并为一次 lark-cli；
 * 重复打开同一主体 60s 内零等待，与活动流缓存同 TTL）。失败结果不缓存。
 */
const SUBJECT_HISTORY_TTL_MS = 60_000
const subjectHistoryCache = new Map<string, { at: number; entries: TaskLogEntry[] }>()

/** 进行中的单主体拉取（key: `${kind}:${id}`；双实例面板合并为一次真实调用）。 */
const subjectHistoryInflight = new Map<string, Promise<{ entries: TaskLogEntry[]; error?: string }>>()

/**
 * 缓存代数：写操作作废缓存时自增。拉取期间若发生写操作（代数变了），
 * 落地的是陈旧数据——不写入缓存（返回值照常给调用方，60s TTL 兜底纠偏）。
 */
let subjectHistoryGen = 0

/**
 * 活动流事件 → 单主体 system 日志条目（新→旧）。活动流缓存新鲜且覆盖该
 * 主体时，`listSubjectHistory` 直接走这里物化，省掉一次 lark-cli。
 * ActivityEvent.id（`${recordId}:${rev ?? at}`）与直接拉取生成的条目 id
 * 同构，去重/React key 天然一致。
 */
function materializeHistoryFromActivity(
  events: ActivityEvent[],
  subjectId: string,
  subjectKind: LogSubjectKind,
  subjectTitle: string,
): TaskLogEntry[] {
  const entries: TaskLogEntry[] = []
  for (const event of events) {
    if (event.recordId !== subjectId) continue
    entries.push({
      id: event.id,
      subjectId,
      subjectKind,
      subjectTitle,
      kind: 'system',
      author: { type: 'user', id: '', displayName: event.operator },
      body: event.type === 'create'
        ? '创建'
        : event.changes.map(c => `「${c.field}」${c.before || '空'} → ${c.after || '空'}`).join('\n'),
      createdAt: event.at,
      updatedAt: null,
    })
  }
  return entries
}

/**
 * 单主体的 record-history 物化为 system 日志条目（新→旧），供日志面板
 * 读取路径调用（06 §7）。带缓存外壳：60s TTL 命中或复用进行中的拉取时
 * 零 lark-cli；task/subtask 且活动流缓存新鲜时直接物化复用（零调用）。
 *
 * 与 aggregateActivity 不同：真实拉取是 1 次 lark-cli 调用，失败**不吞**
 * ——返回 `error` 让调用方在响应里带 historyError 标记，面板提示
 * 「修改历史暂不可用」而不是静默显示不全。失败结果不写缓存。
 *
 * @param subjectTitle 物化条目的标题快照（调用方从自己 state 里带来；
 *                     已删除的主体传空串，头部仍可显示本地条目的快照）。
 */
export async function listSubjectHistory(
  subjectId: string,
  subjectKind: LogSubjectKind,
  subjectTitle: string,
): Promise<{ entries: TaskLogEntry[]; error?: string }> {
  const key = `${subjectKind}:${subjectId}`
  const now = Date.now()
  const cached = subjectHistoryCache.get(key)
  if (cached !== undefined && now - cached.at < SUBJECT_HISTORY_TTL_MS) {
    return { entries: cached.entries }
  }
  const inflight = subjectHistoryInflight.get(key)
  if (inflight !== undefined) return inflight
  // 活动流复用（仅任务表主体）：聚合时已拉过全部任务的 record-history，
  // 缓存新鲜且覆盖该主体时直接物化，零 lark-cli。已删除的任务不在活动流
  // 里（recordId 无匹配），照常走真实拉取让 lark-cli 判定真实状态。
  if ((subjectKind === 'task' || subjectKind === 'subtask')
    && activityCache !== null
    && Date.now() - activityCache.at < ACTIVITY_TTL_MS
    && activityCache.events.some(e => e.recordId === subjectId)) {
    const entries = materializeHistoryFromActivity(activityCache.events, subjectId, subjectKind, subjectTitle)
    subjectHistoryCache.set(key, { at: Date.now(), entries })
    return { entries }
  }
  const gen = subjectHistoryGen
  const fetching = fetchSubjectHistory(subjectId, subjectKind, subjectTitle).then(result => {
    if (result.error === undefined && gen === subjectHistoryGen) {
      subjectHistoryCache.set(key, { at: Date.now(), entries: result.entries })
    }
    return result
  })
  subjectHistoryInflight.set(key, fetching)
  try {
    return await fetching
  } finally {
    if (subjectHistoryInflight.get(key) === fetching) subjectHistoryInflight.delete(key)
  }
}

/** 真实拉取流程（listSubjectHistory 的缓存/单飞外壳之内）。 */
async function fetchSubjectHistory(
  subjectId: string,
  subjectKind: LogSubjectKind,
  subjectTitle: string,
): Promise<{ entries: TaskLogEntry[]; error?: string }> {
  const tableId = TABLE_BY_SUBJECT_KIND[subjectKind]
  const fields = LOG_FIELDS_BY_KIND[subjectKind]
  try {
    const items = await listRecordHistory(subjectId, tableId, true)
    const entries: TaskLogEntry[] = []
    for (const item of items) {
      if (item.create_time === undefined) continue
      const createdAt = new Date(item.create_time * 1000).toISOString()
      const type = item.activity_type === 'create' ? 'create' : 'update'
      const changes = (item.field_changes ?? [])
        .filter(c => c.field_name !== undefined && fields.has(c.field_name))
        .map(c => `「${c.field_name}」${historyValue(c.before) || '空'} → ${historyValue(c.after) || '空'}`)
      if (type === 'update' && changes.length === 0) continue // 只剩派生字段变更，纯噪音
      entries.push({
        id: `${subjectId}:${item.rev ?? createdAt}`,
        subjectId,
        subjectKind,
        subjectTitle,
        kind: 'system',
        author: { type: 'user', id: '', displayName: item.operator ?? '' },
        body: type === 'create' ? '创建' : changes.join('\n'),
        createdAt,
        updatedAt: null,
      })
    }
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { entries }
  } catch (caught) {
    // 限流是最常见的可恢复失败（活动流聚合可能正占着配额）；其余失败
    //（超时、凭证）同样降级为 historyError，本地日志照常返回。
    const message = caught instanceof Error ? caught.message : String(caught)
    return { entries: [], error: `修改历史拉取失败：${message}` }
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

/**
 * yyyy-mm-dd 或 ISO 字符串 → lark-cli datetime 写入格式 "YYYY-MM-DD HH:mm"。
 * 纯日期直接补 00:00（不经 Date 往返，避免时区偏移）；无法解析返回 null。
 */
function toBitableDate(value: string): string | null {
  const v = value.trim()
  if (v === '') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v} 00:00`
  const parsed = new Date(v)
  if (Number.isNaN(parsed.getTime())) return null
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/**
 * 在多维表格中创建一条任务记录，返回新 record id。
 *
 * 字段写入格式（lark-cli +record-batch-create CellValue happy path）：
 * text → 字符串；select → ["选项"]；user/link → [{ id }]
 * datetime → "YYYY-MM-DD HH:mm"；number → 数值（任务进度为 0–1 量纲）。
 * 子任务必须同写「父记录 2」与「KR（关键结果）」（与父任务同 KR），
 * 缺 KR 链接的子任务会在项目视图掉进「未关联 KR 的任务」孤儿区。
 */
export async function createTask(input: {
  title: string
  description?: string
  status?: string
  employeeId?: string | null
  /** 父记录 id（表内「父记录 2」link）；null/undefined = 顶层任务。 */
  parentId?: string | null
  /** KR 记录 id（「KR（关键结果）」link）；子任务须与父任务同 KR。 */
  krId?: string | null
  /** 开始日期 yyyy-mm-dd（写入时转 "YYYY-MM-DD HH:mm"）。 */
  startDate?: string
  /** 预计完成日期 yyyy-mm-dd。 */
  dueDate?: string
  /** 任务进度 0–1（与表内存量数据同量纲；undefined 不写）。 */
  progress?: number
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
  if (input.parentId !== undefined && input.parentId !== null && input.parentId !== '') {
    fields[FIELD.parent] = [{ id: input.parentId }]
  }
  if (input.krId !== undefined && input.krId !== null && input.krId !== '') {
    fields[FIELD.kr] = [{ id: input.krId }]
  }
  if (input.startDate !== undefined) {
    const start = toBitableDate(input.startDate)
    if (start !== null) fields[FIELD.startDate] = start
  }
  if (input.dueDate !== undefined) {
    const due = toBitableDate(input.dueDate)
    if (due !== null) fields[FIELD.dueDate] = due
  }
  if (input.progress !== undefined && Number.isFinite(input.progress)) {
    fields[FIELD.progress] = input.progress
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
