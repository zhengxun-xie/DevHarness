/**
 * OKR 项目视图：「🎯目标(O) → 📈关键结果(KR) → 📋任务 → 模块子任务」树。
 *
 * 数据源是「系统软件组OKR管理」多维表格的三张表，经 host 聚合后一次到位：
 *   - objectives / keyResults 来自 🎯Objective 表与 📈KR 表
 *   - tasks 中的 krId 指向 KR 表记录；parentId 是任务表内的父子层，
 *     支持任意深度递归嵌套（孙任务等，与 Bitable「父记录 2」一致）
 * 组件只消费 DevTaskPanel 传入的已过滤数据（归属视角 + 显示周期），
 * 过滤规则与看板完全一致；层级组装全部在客户端完成，无额外请求。
 *
 * 每个层级展示：
 *   O  ：标题、负责人、目标周期、任务计数、可见任务推导进度
 *   KR ：标题、负责人、任务计数、可见任务推导进度 + 表内自报进度（KR任务进度）
 *   任务   ：状态点、标题、负责人、截止、进度条（有「任务进度」字段时）
 *   子任务+：状态点、标题、负责人、截止（按深度逐级缩进）
 * 任务行与子任务行（含更深层级）尾部都有「＋ 添加子任务」按钮
 * （onCreateSubtask）：弹窗由 DevTaskPanel 承载，写入会同步回多维表格。
 * 四层标题点击均打开任务日志板块（design/06 §2）：任务/子任务走
 * onOpenTaskLog（DevTaskPanel 按 parentId 归类 kind），O/KR 走
 * onOpenSubjectLog 直接携带主体引用。编辑弹窗与交付跳转收进日志面板头部。
 */
import { memo, useEffect, useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DevTaskState, OkrKeyResultRecord, OkrObjectiveRecord, TaskRecord } from '../protocol.ts'
import type { TaskLogSubject } from './TaskLogPanel.tsx'

export interface OkrProjectViewProps {
  /** 已按归属视图和显示周期过滤的任务列表。 */
  tasks: TaskRecord[]
  /** 🎯Objective 表全量（未过滤：OKR 骨架与任务列表的解耦点）。 */
  objectives: OkrObjectiveRecord[]
  /** 📈KR 表全量。 */
  keyResults: OkrKeyResultRecord[]
  t: TranslateNS<'devTaskLeft'>
  /** 员工名册，用于展示负责人姓名。 */
  employees: DevTaskState['employees']
  /** 点击任务/子任务标题时打开任务日志板块。 */
  onOpenTaskLog(task: TaskRecord): void
  /** 点击 O/KR 标题时打开任务日志板块（直接携带主体引用）。 */
  onOpenSubjectLog(subject: TaskLogSubject): void
  /** 悬停任务/子任务标题：预取其日志 feed（DevTaskPanel 防抖 300ms）。 */
  onHoverTaskLog(task: TaskRecord): void
  /** 悬停 O/KR 标题：预取其日志 feed。 */
  onHoverSubjectLog(subject: TaskLogSubject): void
  /** 悬停离开：取消尚未触发的预取。 */
  onHoverEnd(): void
  /** 点击任务/子任务行尾部「＋」：为该条目打开「添加子任务」弹窗。 */
  onCreateSubtask(task: TaskRecord): void
  /** 需要保持展开状态的条目 id（新建子任务后的祖先链；DevTaskPanel 维护）。 */
  expandIds: ReadonlySet<string>
}

/** 状态 → 面板状态点属性值（与看板 dtk-status-dot 共用色板）。 */
const STATUS_DOT_STATUS: Record<string, string> = {
  backlog: 'backlog',
  todo: 'todo',
  running: 'running',
  done: 'done',
  failed: 'failed',
}

/** yyyy-mm-dd 短日期。 */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 进度百分比 0–100：任务自身「任务进度」优先，否则按可见子任务完成比例推导。 */
function resolveTaskProgress(task: TaskRecord, children: TaskRecord[]): number | null {
  if (task.progress !== null && Number.isFinite(task.progress)) {
    return task.progress <= 1 ? Math.round(task.progress * 100) : Math.round(task.progress)
  }
  if (children.length === 0) return null
  return Math.round(children.filter(c => c.status === 'done').length / children.length * 100)
}

/** 按任务自身状态 + 可见子任务完成比例推导 0–100。 */
function resolveDerivedProgress(tasks: TaskRecord[]): number | null {
  if (tasks.length === 0) return null
  return Math.round(tasks.filter(t => t.status === 'done').length / tasks.length * 100)
}

/** 负责人 id → 姓名 resolve；空名单返回 null（不渲染）。 */
function ownerNames(ids: readonly string[], employees: DevTaskState['employees']): string[] {
  return ids.map(id => employees.find(e => e.id === id)?.name ?? id)
}

/** 负责人展示：最多 3 个名字，超出折叠为 +N。 */
function OwnerChips({ ids, employees }: { ids: readonly string[]; employees: DevTaskState['employees'] }) {
  if (ids.length === 0) return null
  const names = ownerNames(ids, employees)
  const shown = names.slice(0, 3)
  const rest = names.length - shown.length
  return <span className="dtk-okr-owners">{shown.join('、')}{rest > 0 ? ` +${rest}` : ''}</span>
}

/* ------------------------- 树组装 ------------------------- */

interface TaskNode {
  task: TaskRecord
  /** 表内下级（父记录 2）：模块子任务，可继续嵌套（任意深度）。 */
  children: TaskNode[]
}

interface KrNode {
  kr: OkrKeyResultRecord
  /** 直接拆解到该 KR 的任务（parentId === null）。 */
  roots: TaskNode[]
  /** krId 指向已不存在 KR 的散任务不计入这里。 */
}

interface OkrTree {
  /** 每棵可见 O 节点（含其 KR）。 */
  objectives: Array<{ objective: OkrObjectiveRecord; krs: KrNode[]; taskCount: number; doneCount: number }>
  /** 无 KR 归属的任务（krId 为 null，或 KR 已被删除）。 */
  orphanTasks: TaskNode[]
  /** 无目标归属的 KR（objectiveId 为 null）。 */
  orphanKrs: KrNode[]
  /** 有可见任务的 KR id 集合（仅这些 KR 渲染）。 */
  visibleKrIds: Set<string>
  /** 有可见 KR 的 O id 集合（仅这些 O 渲染）。 */
  visibleObjectiveIds: Set<string>
}

/** 子树任务扁平列表（含各根，深度优先）。 */
function subtreeTasks(nodes: readonly TaskNode[]): TaskRecord[] {
  return nodes.flatMap(node => [node.task, ...subtreeTasks(node.children)])
}

/** 子树内完成任务数（含各根）。 */
function subtreeDoneCount(nodes: readonly TaskNode[]): number {
  return nodes.reduce(
    (n, node) => n + (node.task.status === 'done' ? 1 : 0) + subtreeDoneCount(node.children),
    0,
  )
}

/**
 * 将扁平任务列表组装为 OKR 树（任务层内任意深度递归）。
 * 可见性规则：KR 含 ≥1 条可见任务才渲染；O 含 ≥1 条可见 KR 才渲染；
 * 未归属 KR 的任务、未归属目标 的 KR 归入末尾独立区，不丢弃。
 * claimed 集合防止「父记录 2」互指（环）时无限递归——成环的记录会被
 * 整体跳过（数据已损坏，宁可不可见也不挂死界面）。
 */
function buildTree(tasks: TaskRecord[], objectives: OkrObjectiveRecord[], keyResults: OkrKeyResultRecord[]): OkrTree {
  // 任务 → KR 分组；任务表内的父子关系只在同一 KR 内生效
  const tasksByKr = new Map<string, TaskRecord[]>()
  const orphanTasks: TaskRecord[] = []
  for (const task of tasks) {
    if (task.krId === null) {
      orphanTasks.push(task)
      continue
    }
    const list = tasksByKr.get(task.krId)
    if (list === undefined) tasksByKr.set(task.krId, [task])
    else list.push(task)
  }

  const makeNodes = (list: TaskRecord[]): TaskNode[] => {
    const byId = new Map(list.map(t => [t.id, t]))
    const claimed = new Set<string>()
    const build = (task: TaskRecord): TaskNode => {
      claimed.add(task.id)
      const children: TaskNode[] = []
      for (const candidate of list) {
        if (candidate.parentId === task.id && !claimed.has(candidate.id)) children.push(build(candidate))
      }
      return { task, children }
    }
    const nodes: TaskNode[] = []
    for (const task of list) {
      // 顶层：无父记录，或父记录不在可见列表（散子任务独立成行）。
      if (task.parentId === null || !byId.has(task.parentId)) nodes.push(build(task))
    }
    return nodes
  }

  const krNodes = new Map<string, KrNode>()
  for (const kr of keyResults) {
    krNodes.set(kr.id, { kr, roots: makeNodes(tasksByKr.get(kr.id) ?? []) })
  }
  // 可见 KR：有 ≥1 条可见任务
  const visibleKrIds = new Set<string>()
  for (const [krId, node] of krNodes) {
    if (subtreeTasks(node.roots).length > 0) visibleKrIds.add(krId)
  }

  // 归属 KR 检查散任务：krId 非空但 KR 不存在/不可见时并入孤儿区
  const orphanNodeTasks = orphanTasks.concat(
    tasks.filter(t => t.krId !== null && !visibleKrIds.has(t.krId)),
  )

  const objectiveNodes = objectives.map(objective => {
    const krs = keyResults
      .filter(kr => kr.objectiveId === objective.id && visibleKrIds.has(kr.id))
      .map(kr => krNodes.get(kr.id)!)
    const taskCount = krs.reduce((n, node) => n + subtreeTasks(node.roots).length, 0)
    const doneCount = krs.reduce((n, node) => n + subtreeDoneCount(node.roots), 0)
    return { objective, krs, taskCount, doneCount }
  })
  const visibleObjectiveIds = new Set(objectiveNodes.filter(n => n.krs.length > 0).map(n => n.objective.id))

  const orphanKrs = keyResults
    .filter(kr => kr.objectiveId === null && visibleKrIds.has(kr.id))
    .map(kr => krNodes.get(kr.id)!)

  return {
    objectives: objectiveNodes.filter(n => visibleObjectiveIds.has(n.objective.id)),
    orphanTasks: makeNodes(orphanNodeTasks),
    orphanKrs,
    visibleKrIds,
    visibleObjectiveIds,
  }
}

/* ------------------------- 节点组件 ------------------------- */

/** 任务行（第三层）+ 递归的模块子任务子树（任意深度）。
 * 子任务默认收起：点击折叠箭头才展开（分级展开，避免 KR 展开时一次性铺满
 * 全树）。depth 0 是 KR 直挂任务（原任务层），≥1 是各级模块子任务——样式
 * 逐级缩进，字段一致，深度 ≥1 行尾同样带「＋ 添加子任务」。
 */
const TaskRow = memo(function TaskRow({
  node, depth, expandIds, employees, t, onOpenTaskLog, onHoverTaskLog, onHoverEnd, onCreateSubtask,
}: {
  node: TaskNode
  /** 0 = KR 直挂任务；≥1 = 各级模块子任务。 */
  depth: number
  expandIds: ReadonlySet<string>
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onOpenTaskLog(task: TaskRecord): void
  onHoverTaskLog(task: TaskRecord): void
  onHoverEnd(): void
  onCreateSubtask(task: TaskRecord): void
}) {
  const { task, children } = node
  const [open, setOpen] = useState(false)
  // 新建子任务后 DevTaskPanel 把祖先链写进 expandIds；命中即展开，
  // 保证新条目落在可视区（否则父行收着，新子任务看不见）。
  useEffect(() => {
    if (expandIds.has(task.id)) setOpen(true)
  }, [expandIds, task.id])
  const expandable = children.length > 0
  const owner = task.employeeId === null ? null : ownerNames([task.employeeId], employees)[0]!
  const progress = resolveTaskProgress(task, subtreeTasks(children))
  const subtask = depth > 0
  const rowClass = subtask ? 'dtk-okr-row dtk-okr-taskrow dtk-okr-subtask' : 'dtk-okr-row dtk-okr-taskrow'
  // 子任务行逐级缩进：基准 96px（原固定缩进），每深一级 +20px。
  const indentStyle = subtask ? { paddingLeft: `${96 + (depth - 1) * 20}px` } : undefined
  return (
    <li className="dtk-okr-task" data-status={task.status}>
      <div
        className={rowClass}
        style={indentStyle}
        data-expandable={expandable || undefined}
        // 整行空白处点击即可展开/收起；标题点击单独处理（打开日志板块）。
        // eslint-disable-next-line react/jsx-no-bind
        onClick={expandable ? () => setOpen(v => !v) : undefined}
      >
        {/* ＋ 添加子任务：CSS 绝对定位钉在树最左列，与 O 行折叠箭头（▸）
            对齐（见 .dtk-okr-add）；脱离文档流不占行内空间，
            stopPropagation 不触发整行展开/收起。 */}
        <button
          type="button"
          className="dtk-okr-add"
          aria-label={t('subtask.new')}
          title={t('subtask.new')}
          // eslint-disable-next-line react/jsx-no-bind
          onClick={e => { e.stopPropagation(); onCreateSubtask(task) }}
        >
          ＋
        </button>
        {expandable ? (
          <button
            type="button"
            className="dtk-okr-toggle"
            aria-expanded={open}
            aria-label={open ? t('okr.collapse') : t('okr.expand')}
            title={open ? t('okr.collapse') : t('okr.expand')}
            // 阻止冒泡到行容器，避免与整行 onClick 双重 toggle 相互抵消。
            // eslint-disable-next-line react/jsx-no-bind
            onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          >
            <span className="dtk-okr-caret" data-open={open} aria-hidden>{open ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="dtk-okr-caret-spacer" aria-hidden />
        )}
        <span className="dtk-status-dot" data-status={STATUS_DOT_STATUS[task.status] ?? 'todo'} aria-hidden />
        <button
          type="button"
          className="dtk-okr-row-title"
          title={task.description !== '' ? task.description : task.title}
          onPointerEnter={() => onHoverTaskLog(task)}
          onPointerLeave={onHoverEnd}
          // 标题点击打开任务日志板块，不触发整行展开/收起。
          // eslint-disable-next-line react/jsx-no-bind
          onClick={e => { e.stopPropagation(); onOpenTaskLog(task) }}
        >
          {task.title}
        </button>
        <span className="dtk-okr-row-meta">
          {owner !== null && <span className="dtk-okr-owner">{owner}</span>}
          {task.dueDate !== null && <span className="dtk-okr-due" title={t('okr.due')}>{shortDate(task.dueDate)}</span>}
          {progress !== null && (
            <span className="dtk-okr-badge" title={`${t('okr.progress')}: ${progress}%`}>{progress}%</span>
          )}
        </span>
      </div>
      {open && children.length > 0 && (
        <ul className="dtk-okr-children">
          {children.map(child => (
            <TaskRow
              key={child.task.id}
              node={child}
              depth={depth + 1}
              expandIds={expandIds}
              employees={employees}
              t={t}
              onOpenTaskLog={onOpenTaskLog}
              onHoverTaskLog={onHoverTaskLog}
              onHoverEnd={onHoverEnd}
              onCreateSubtask={onCreateSubtask}
            />
          ))}
        </ul>
      )}
    </li>
  )
})

/** KR 节点（第二层）+ 其任务列表。 */
const KrNodeRow = memo(function KrNodeRow({
  node, expandIds, employees, t, onOpenTaskLog, onOpenSubjectLog, onHoverTaskLog, onHoverSubjectLog, onHoverEnd, onCreateSubtask,
}: {
  node: KrNode
  expandIds: ReadonlySet<string>
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onOpenTaskLog(task: TaskRecord): void
  onOpenSubjectLog(subject: TaskLogSubject): void
  onHoverTaskLog(task: TaskRecord): void
  onHoverSubjectLog(subject: TaskLogSubject): void
  onHoverEnd(): void
  onCreateSubtask(task: TaskRecord): void
}) {
  const [open, setOpen] = useState(true)
  const allTasks = useMemo(() => subtreeTasks(node.roots), [node])
  const doneCount = allTasks.filter(task => task.status === 'done').length
  const derived = resolveDerivedProgress(allTasks)
  const reported = node.kr.progress
  return (
    <section className="dtk-okr-node dtk-okr-kr">
      <div className="dtk-okr-row dtk-okr-krrow">
        <button
          type="button"
          className="dtk-okr-toggle"
          aria-expanded={open}
          aria-label={open ? t('okr.collapse') : t('okr.expand')}
          title={open ? t('okr.collapse') : t('okr.expand')}
          // eslint-disable-next-line react/jsx-no-bind
          onClick={() => setOpen(v => !v)}
        >
          <span className="dtk-okr-caret" data-open={open} aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
        <button
          type="button"
          className="dtk-okr-row-title dtk-okr-static-title"
          title={node.kr.title}
          onPointerEnter={() => onHoverSubjectLog({ kind: 'kr', id: node.kr.id, title: node.kr.title })}
          onPointerLeave={onHoverEnd}
          // KR 标题点击打开日志板块；行本身无折叠语义，无需 stopPropagation。
          // eslint-disable-next-line react/jsx-no-bind
          onClick={() => onOpenSubjectLog({ kind: 'kr', id: node.kr.id, title: node.kr.title })}
        >
          {node.kr.title}
        </button>
        <span className="dtk-okr-row-meta">
          <OwnerChips ids={node.kr.ownerIds} employees={employees} />
          <span className="dtk-okr-count">{doneCount} / {allTasks.length}</span>
          {reported !== null && (
            <span className="dtk-okr-badge" title={`${t('okr.selfReported')}: ${reported}%`}>{reported}%</span>
          )}
          {derived !== null && (
            <span className="dtk-okr-progress" title={`${t('okr.progress')}: ${derived}%`}>
              <span className="dtk-okr-progress-track">
                <span className="dtk-okr-progress-fill" data-done={derived === 100} style={{ width: `${derived}%` }} />
              </span>
              <span className="dtk-okr-progress-text">{derived}%</span>
            </span>
          )}
        </span>
      </div>
      {open && (
        <ul className="dtk-okr-children">
          {node.roots.length === 0 && <li className="dtk-okr-empty">{t('okr.noChildren')}</li>}
          {node.roots.map(root => (
            <TaskRow
              key={root.task.id}
              node={root}
              depth={0}
              expandIds={expandIds}
              employees={employees}
              t={t}
              onOpenTaskLog={onOpenTaskLog}
              onHoverTaskLog={onHoverTaskLog}
              onHoverEnd={onHoverEnd}
              onCreateSubtask={onCreateSubtask}
            />
          ))}
        </ul>
      )}
    </section>
  )
})

/** O 节点（第一层）+ 其 KR 列表。 */
const ObjectiveNodeRow = memo(function ObjectiveNodeRow({
  objective, krs, taskCount, doneCount, expandIds, employees, t, onOpenTaskLog, onOpenSubjectLog, onHoverTaskLog, onHoverSubjectLog, onHoverEnd, onCreateSubtask,
}: {
  objective: OkrObjectiveRecord
  krs: KrNode[]
  taskCount: number
  doneCount: number
  expandIds: ReadonlySet<string>
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onOpenTaskLog(task: TaskRecord): void
  onOpenSubjectLog(subject: TaskLogSubject): void
  onHoverTaskLog(task: TaskRecord): void
  onHoverSubjectLog(subject: TaskLogSubject): void
  onHoverEnd(): void
  onCreateSubtask(task: TaskRecord): void
}) {
  const [open, setOpen] = useState(true)
  // O 层进度 = 其可见任务完成比例（无任务时隐藏）
  const krTasks = useMemo(() => krs.flatMap(node => subtreeTasks(node.roots)), [krs])
  const derived = resolveDerivedProgress(krTasks)
  return (
    <section className="dtk-okr-node dtk-okr-objective">
      <div className="dtk-okr-row dtk-okr-objrow">
        <button
          type="button"
          className="dtk-okr-toggle"
          aria-expanded={open}
          aria-label={open ? t('okr.collapse') : t('okr.expand')}
          title={open ? t('okr.collapse') : t('okr.expand')}
          // eslint-disable-next-line react/jsx-no-bind
          onClick={() => setOpen(v => !v)}
        >
          <span className="dtk-okr-caret" data-open={open} aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
        <button
          type="button"
          className="dtk-okr-row-title dtk-okr-static-title"
          title={objective.title}
          onPointerEnter={() => onHoverSubjectLog({ kind: 'objective', id: objective.id, title: objective.title })}
          onPointerLeave={onHoverEnd}
          // O 标题点击打开日志板块；行本身无折叠语义，无需 stopPropagation。
          // eslint-disable-next-line react/jsx-no-bind
          onClick={() => onOpenSubjectLog({ kind: 'objective', id: objective.id, title: objective.title })}
        >
          {objective.title}
        </button>
        <span className="dtk-okr-row-meta">
          <OwnerChips ids={objective.ownerIds} employees={employees} />
          {objective.period !== '' && <span className="dtk-okr-badge">{objective.period}</span>}
          <span className="dtk-okr-count">{doneCount} / {taskCount}</span>
          {derived !== null && (
            <span className="dtk-okr-progress" title={`${t('okr.progress')}: ${derived}%`}>
              <span className="dtk-okr-progress-track">
                <span className="dtk-okr-progress-fill" data-done={derived === 100} style={{ width: `${derived}%` }} />
              </span>
              <span className="dtk-okr-progress-text">{derived}%</span>
            </span>
          )}
        </span>
      </div>
      {open && (
        <div className="dtk-okr-children">
          {krs.map(node => (
            <KrNodeRow
              key={node.kr.id}
              node={node}
              expandIds={expandIds}
              employees={employees}
              t={t}
              onOpenTaskLog={onOpenTaskLog}
              onOpenSubjectLog={onOpenSubjectLog}
              onHoverTaskLog={onHoverTaskLog}
              onHoverSubjectLog={onHoverSubjectLog}
              onHoverEnd={onHoverEnd}
              onCreateSubtask={onCreateSubtask}
            />
          ))}
        </div>
      )}
    </section>
  )
})

/** 单列散任务列表（孤儿区与未关联目标 KR 区共用）。 */
function TaskList({ tasks, expandIds, employees, t, onOpenTaskLog, onHoverTaskLog, onHoverEnd, onCreateSubtask }: {
  tasks: TaskNode[]
  expandIds: ReadonlySet<string>
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onOpenTaskLog(task: TaskRecord): void
  onHoverTaskLog(task: TaskRecord): void
  onHoverEnd(): void
  onCreateSubtask(task: TaskRecord): void
}) {
  return (
    <ul className="dtk-okr-children">
      {tasks.length === 0 && <li className="dtk-okr-empty">{t('okr.noChildren')}</li>}
      {tasks.map(node => (
        <TaskRow
          key={node.task.id}
          node={node}
          depth={0}
          expandIds={expandIds}
          employees={employees}
          t={t}
          onOpenTaskLog={onOpenTaskLog}
          onHoverTaskLog={onHoverTaskLog}
          onHoverEnd={onHoverEnd}
          onCreateSubtask={onCreateSubtask}
        />
      ))}
    </ul>
  )
}

/** OKR 项目视图：O → KR → 任务 → 子任务（递归）树。 */
export function OkrProjectView({ tasks, objectives, keyResults, t, employees, onOpenTaskLog, onOpenSubjectLog, onHoverTaskLog, onHoverSubjectLog, onHoverEnd, onCreateSubtask, expandIds }: OkrProjectViewProps) {
  const [orphansOpen, setOrphansOpen] = useState(true)
  const [orphanKrOpen, setOrphanKrOpen] = useState(true)
  const tree = useMemo(() => buildTree(tasks, objectives, keyResults), [tasks, objectives, keyResults])
  const isEmpty = tree.objectives.length === 0 && tree.orphanTasks.length === 0 && tree.orphanKrs.length === 0

  return (
    <div className="dtk-okr-view">
      {isEmpty && (
        <div className="dtk-view-placeholder">
          <span className="dtk-view-placeholder-icon" aria-hidden>◎</span>
          <span>{t('okr.empty')}</span>
        </div>
      )}
      {tree.objectives.map(node => (
        <ObjectiveNodeRow
          key={node.objective.id}
          objective={node.objective}
          krs={node.krs}
          taskCount={node.taskCount}
          doneCount={node.doneCount}
          expandIds={expandIds}
          employees={employees}
          t={t}
          onOpenTaskLog={onOpenTaskLog}
          onOpenSubjectLog={onOpenSubjectLog}
          onHoverTaskLog={onHoverTaskLog}
          onHoverSubjectLog={onHoverSubjectLog}
          onHoverEnd={onHoverEnd}
          onCreateSubtask={onCreateSubtask}
        />
      ))}
      {tree.orphanKrs.length > 0 && (
        <section className="dtk-okr-node dtk-okr-kr">
          <div className="dtk-okr-row dtk-okr-krrow">
            <button
              type="button"
              className="dtk-okr-toggle"
              aria-expanded={orphanKrOpen}
              aria-label={orphanKrOpen ? t('okr.collapse') : t('okr.expand')}
              title={orphanKrOpen ? t('okr.collapse') : t('okr.expand')}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => setOrphanKrOpen(v => !v)}
            >
              <span className="dtk-okr-caret" data-open={orphanKrOpen} aria-hidden>{orphanKrOpen ? '▾' : '▸'}</span>
            </button>
            <span className="dtk-okr-row-title dtk-okr-static-title">{t('okr.orphanKrs')}</span>
            <span className="dtk-okr-row-meta">
              <span className="dtk-okr-count">{tree.orphanKrs.length}</span>
            </span>
          </div>
          {orphanKrOpen && (
            <div className="dtk-okr-children">
              {tree.orphanKrs.map(node => (
                <KrNodeRow
                  key={node.kr.id}
                  node={node}
                  expandIds={expandIds}
                  employees={employees}
                  t={t}
                  onOpenTaskLog={onOpenTaskLog}
                  onOpenSubjectLog={onOpenSubjectLog}
                  onHoverTaskLog={onHoverTaskLog}
                  onHoverSubjectLog={onHoverSubjectLog}
                  onHoverEnd={onHoverEnd}
                  onCreateSubtask={onCreateSubtask}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {tree.orphanTasks.length > 0 && (
        <section className="dtk-okr-node dtk-okr-kr">
          <div className="dtk-okr-row dtk-okr-krrow">
            <button
              type="button"
              className="dtk-okr-toggle"
              aria-expanded={orphansOpen}
              aria-label={orphansOpen ? t('okr.collapse') : t('okr.expand')}
              title={orphansOpen ? t('okr.collapse') : t('okr.expand')}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => setOrphansOpen(v => !v)}
            >
              <span className="dtk-okr-caret" data-open={orphansOpen} aria-hidden>{orphansOpen ? '▾' : '▸'}</span>
            </button>
            <span className="dtk-okr-row-title dtk-okr-static-title">{t('okr.orphans')}</span>
            <span className="dtk-okr-row-meta">
              <span className="dtk-okr-count">{tree.orphanTasks.length}</span>
            </span>
          </div>
          {orphansOpen && (
            <TaskList
              tasks={tree.orphanTasks}
              expandIds={expandIds}
              employees={employees}
              t={t}
              onOpenTaskLog={onOpenTaskLog}
              onHoverTaskLog={onHoverTaskLog}
              onHoverEnd={onHoverEnd}
              onCreateSubtask={onCreateSubtask}
            />
          )}
        </section>
      )}
    </div>
  )
}
