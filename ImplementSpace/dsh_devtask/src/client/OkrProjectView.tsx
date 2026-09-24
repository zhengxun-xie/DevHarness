/**
 * OKR 项目视图：「🎯目标(O) → 📈关键结果(KR) → 📋任务 → 模块子任务」四层树。
 *
 * 数据源是「系统软件组OKR管理」多维表格的三张表，经 host 聚合后一次到位：
 *   - objectives / keyResults 来自 🎯Objective 表与 📈KR 表
 *   - tasks 中的 krId 指向 KR 表记录；parentId 是任务表内的模块子任务层
 * 组件只消费 DevTaskPanel 传入的已过滤数据（归属视角 + 显示周期），
 * 过滤规则与看板完全一致；层级组装全部在客户端完成，无额外请求。
 *
 * 每个层级展示：
 *   O  ：标题、负责人、目标周期、任务计数、可见任务推导进度
 *   KR ：标题、负责人、任务计数、可见任务推导进度 + 表内自报进度（KR任务进度）
 *   任务   ：状态点、标题、负责人、截止、进度条（有「任务进度」字段时）
 *   子任务 ：状态点、标题、负责人、截止
 * 点击任务/子任务打开编辑对话框；O/KR 行只读展示，状态流转走看板或编辑弹窗。
 */
import { memo, useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DevTaskState, OkrKeyResultRecord, OkrObjectiveRecord, TaskRecord } from '../protocol.ts'

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
  /** 点击任务/子任务时打开编辑对话框。 */
  onEditTask(task: TaskRecord): void
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

/** 进度百分比 0–100：任务自身「任务进度」优先，否则按模块子任务完成比例推导。 */
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
  /** 父记录 2 级别的模块子任务。 */
  children: TaskRecord[]
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

/**
 * 将扁平任务列表组装为四层 OKR 树。
 * 可见性规则：KR 含 ≥1 条可见任务才渲染；O 含 ≥1 条可见 KR 才渲染；
 * 未归属 KR 的任务、未归属目标 的 KR 归入末尾独立区，不丢弃。
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
    const roots = list.filter(t => t.parentId === null)
    const byId = new Map(list.map(t => [t.id, t]))
    return roots.map(task => ({
      task,
      children: list.filter(t => t.parentId === task.id),
    })).concat(
      // 父任务不在列表（被过滤/删除）的散子任务，也作为独立节点展示
      list
        .filter(t => t.parentId !== null && !byId.has(t.parentId))
        .map(task => ({ task, children: [] as TaskRecord[] })),
    )
  }

  const krNodes = new Map<string, KrNode>()
  for (const kr of keyResults) {
    krNodes.set(kr.id, { kr, roots: makeNodes(tasksByKr.get(kr.id) ?? []) })
  }
  // 可见 KR：有 ≥1 条可见任务
  const visibleKrIds = new Set<string>()
  for (const [krId, node] of krNodes) {
    const count = node.roots.reduce((n, r) => n + 1 + r.children.length, 0)
    if (count > 0) visibleKrIds.add(krId)
  }

  // 归属 KR 检查散任务：krId 非空但 KR 不存在/不可见时并入孤儿区
  const orphanNodeTasks = orphanTasks.concat(
    tasks.filter(t => t.krId !== null && !visibleKrIds.has(t.krId)),
  )

  const objectiveNodes = objectives.map(objective => {
    const krs = keyResults
      .filter(kr => kr.objectiveId === objective.id && visibleKrIds.has(kr.id))
      .map(kr => krNodes.get(kr.id)!)
    const taskCount = krs.reduce((n, node) => n + node.roots.reduce((m, r) => m + 1 + r.children.length, 0), 0)
    const doneCount = krs.reduce((n, node) => n + node.roots.reduce(
      (m, r) => m + (r.task.status === 'done' ? 1 : 0) + r.children.filter(c => c.status === 'done').length, 0,
    ), 0)
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

/** 模块子任务行（第四层）。 */
const SubtaskRow = memo(function SubtaskRow({
  task, employees, t, onEditTask,
}: {
  task: TaskRecord
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onEditTask(task: TaskRecord): void
}) {
  const owner = task.employeeId === null ? null : ownerNames([task.employeeId], employees)[0]!
  return (
    <li className="dtk-okr-row dtk-okr-subtask" data-status={task.status}>
      <span className="dtk-status-dot" data-status={STATUS_DOT_STATUS[task.status] ?? 'todo'} aria-hidden />
      <button
        type="button"
        className="dtk-okr-row-title"
        title={task.description !== '' ? task.description : task.title}
        // eslint-disable-next-line react/jsx-no-bind
        onClick={() => onEditTask(task)}
      >
        {task.title}
      </button>
      <span className="dtk-okr-row-meta">
        {owner !== null && <span className="dtk-okr-owner">{owner}</span>}
        {task.dueDate !== null && <span className="dtk-okr-due" title={t('okr.due')}>{shortDate(task.dueDate)}</span>}
      </span>
    </li>
  )
})

/** 任务行（第三层）+ 其模块子任务列表。 */
const TaskRow = memo(function TaskRow({
  node, employees, t, onEditTask,
}: {
  node: TaskNode
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onEditTask(task: TaskRecord): void
}) {
  const { task, children } = node
  const owner = task.employeeId === null ? null : ownerNames([task.employeeId], employees)[0]!
  const progress = resolveTaskProgress(task, children)
  return (
    <li className="dtk-okr-task" data-status={task.status}>
      <div className="dtk-okr-row dtk-okr-taskrow">
        <span className="dtk-status-dot" data-status={STATUS_DOT_STATUS[task.status] ?? 'todo'} aria-hidden />
        <button
          type="button"
          className="dtk-okr-row-title"
          title={task.description !== '' ? task.description : task.title}
          // eslint-disable-next-line react/jsx-no-bind
          onClick={() => onEditTask(task)}
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
      {children.length > 0 && (
        <ul className="dtk-okr-children">
          {children.map(child => (
            <SubtaskRow
              key={child.id}
              task={child}
              employees={employees}
              t={t}
              onEditTask={onEditTask}
            />
          ))}
        </ul>
      )}
    </li>
  )
})

/** KR 节点（第二层）+ 其任务列表。 */
const KrNodeRow = memo(function KrNodeRow({
  node, employees, t, onEditTask,
}: {
  node: KrNode
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onEditTask(task: TaskRecord): void
}) {
  const [open, setOpen] = useState(true)
  const allTasks = node.roots.flatMap(r => [r.task, ...r.children])
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
        <span className="dtk-okr-row-title dtk-okr-static-title" title={node.kr.title}>{node.kr.title}</span>
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
              employees={employees}
              t={t}
              onEditTask={onEditTask}
            />
          ))}
        </ul>
      )}
    </section>
  )
})

/** O 节点（第一层）+ 其 KR 列表。 */
const ObjectiveNodeRow = memo(function ObjectiveNodeRow({
  objective, krs, taskCount, doneCount, employees, t, onEditTask,
}: {
  objective: OkrObjectiveRecord
  krs: KrNode[]
  taskCount: number
  doneCount: number
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onEditTask(task: TaskRecord): void
}) {
  const [open, setOpen] = useState(true)
  // O 层进度 = 其可见任务完成比例（无任务时隐藏）
  const krTasks = krs.flatMap(node => node.roots.flatMap(r => [r.task, ...r.children]))
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
        <span className="dtk-okr-row-title dtk-okr-static-title" title={objective.title}>{objective.title}</span>
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
              employees={employees}
              t={t}
              onEditTask={onEditTask}
            />
          ))}
        </div>
      )}
    </section>
  )
})

/** 单列散任务列表（孤儿区与未关联目标 KR 区共用）。 */
function TaskList({ tasks, employees, t, onEditTask }: {
  tasks: TaskNode[]
  employees: DevTaskState['employees']
  t: TranslateNS<'devTaskLeft'>
  onEditTask(task: TaskRecord): void
}) {
  return (
    <ul className="dtk-okr-children">
      {tasks.length === 0 && <li className="dtk-okr-empty">{t('okr.noChildren')}</li>}
      {tasks.map(node => (
        <TaskRow
          key={node.task.id}
          node={node}
          employees={employees}
          t={t}
          onEditTask={onEditTask}
        />
      ))}
    </ul>
  )
}

/** OKR 项目视图：O → KR → 任务 → 子任务 四层树。 */
export function OkrProjectView({ tasks, objectives, keyResults, t, employees, onEditTask }: OkrProjectViewProps) {
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
          employees={employees}
          t={t}
          onEditTask={onEditTask}
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
                  employees={employees}
                  t={t}
                  onEditTask={onEditTask}
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
              employees={employees}
              t={t}
              onEditTask={onEditTask}
            />
          )}
        </section>
      )}
    </div>
  )
}
