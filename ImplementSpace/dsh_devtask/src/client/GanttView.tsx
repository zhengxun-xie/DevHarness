/**
 * 甘特图视图：按「开始日期 → 预计完成日期」渲染任务时间条。
 *
 * 与看板/项目视图共用 DevTaskPanel 传入的 filteredTasks（归属视角 + 显示周期
 * 过滤已应用），无额外请求；层级沿用任务表内父子（父任务行 + 缩进的子任务行）。
 *
 * 时间轴设计：
 *   - 自适应刻度：跨度 ≤ 60 天按日、≤ 400 天按周、更长按月；刻度数控制在 ~10 个
 *   - 时间条按百分比定位（left/width %），整图不产生横向滚动
 *   - 两个日期都缺失的任务进「未排期」区，只占列表行不画条；
 *     只有一个日期时画当日单点条
 *   - 状态色与看板 dtk-status-dot 共用色板；条内叠加进度填充
 *   - 时间域强制包含今天，渲染「今天」参考线
 */
import { memo, useMemo } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DevTaskState, TaskRecord } from '../protocol.ts'

export interface GanttViewProps {
  /** 已按归属视图和显示周期过滤的任务列表。 */
  tasks: TaskRecord[]
  t: TranslateNS<'devTaskLeft'>
  /** 员工名册，用于展示负责人姓名。 */
  employees: DevTaskState['employees']
  /** 点击任务/子任务时打开编辑对话框。 */
  onEditTask(task: TaskRecord): void
}

const DAY_MS = 86_400_000

/** 状态 → 时间条属性值（与看板 dtk-status-dot 共用色板）。 */
const STATUS_DOT_STATUS: Record<string, string> = {
  backlog: 'backlog',
  todo: 'todo',
  running: 'running',
  done: 'done',
  failed: 'failed',
}

type Granularity = 'day' | 'week' | 'month'

interface Scale {
  /** 时间域起点（ms）。 */
  start: number
  /** 时间域终点（ms）。 */
  end: number
  granularity: Granularity
  /** 刻度标签及在时间轨上的百分比位置。 */
  ticks: Array<{ label: string; pct: number }>
}

interface GanttRow {
  task: TaskRecord
  /** 父记录 2 级别的模块子任务。 */
  children: TaskRecord[]
}

/** 本地当天零点（ms）。 */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** M/d 短日期。 */
function md(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** yyyy-mm-dd 短日期。 */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 解析任务时间窗；两个日期都缺失返回 null，只有一个时退化为当日单点。 */
function taskWindow(task: TaskRecord): { start: number; end: number } | null {
  const s = task.startDate === null ? null : new Date(task.startDate).getTime()
  const d = task.dueDate === null ? null : new Date(task.dueDate).getTime()
  if (s === null && d === null) return null
  return { start: s ?? d!, end: d ?? s! }
}

/**
 * 由已排期任务的时间窗构建时间轴。规则：
 *   - 时间域取所有任务窗 + 今天的并集，保证「今天」线可见
 *   - 跨度自适应选择日/周/月粒度，两端各留 padding，并设最小跨度避免条过宽
 *   - 刻度标签数量控制在 ~10 个：日/周模式按固定步长，月模式按真实月初
 */
function buildScale(windows: Array<{ start: number; end: number }>): Scale | null {
  if (windows.length === 0) return null
  const today = startOfLocalDay(Date.now())
  let min = Math.min(...windows.flatMap(w => [w.start, w.end]), today)
  let max = Math.max(...windows.flatMap(w => [w.start, w.end]), today)
  const spanDays = (max - min) / DAY_MS
  const granularity: Granularity = spanDays <= 60 ? 'day' : spanDays <= 400 ? 'week' : 'month'
  const padDays = granularity === 'day' ? 3 : granularity === 'week' ? 7 : 30
  min -= padDays * DAY_MS
  max += padDays * DAY_MS
  const minSpanDays = granularity === 'day' ? 14 : granularity === 'week' ? 56 : 180
  if (max - min < minSpanDays * DAY_MS) {
    const mid = (min + max) / 2
    min = mid - (minSpanDays * DAY_MS) / 2
    max = mid + (minSpanDays * DAY_MS) / 2
  }
  const pct = (ms: number): number => (ms - min) / (max - min) * 100
  const ticks: Scale['ticks'] = []

  if (granularity === 'month') {
    const cursor = new Date(min)
    cursor.setDate(1)
    cursor.setHours(0, 0, 0, 0)
    const months: number[] = []
    while (cursor.getTime() <= max) {
      months.push(cursor.getTime())
      cursor.setMonth(cursor.getMonth() + 1)
    }
    const step = Math.max(1, Math.ceil(months.length / 10))
    months.forEach((ms, i) => {
      if (i % step !== 0) return
      const d = new Date(ms)
      // 1 月或跨年时带年份，避免 26/09 与 27/01 混淆
      ticks.push({ label: d.getMonth() === 0 ? `${d.getFullYear() % 100}年1月` : `${d.getMonth() + 1}月`, pct: pct(ms) })
    })
  } else {
    const unitDays = granularity === 'day' ? 1 : 7
    const total = Math.ceil((max - min) / (unitDays * DAY_MS))
    const step = Math.max(1, Math.ceil(total / 10))
    const first = startOfLocalDay(min)
    for (let i = 0; i <= total; i++) {
      const ms = first + i * unitDays * DAY_MS
      if (ms > max) break
      if (i % step !== 0) continue
      ticks.push({ label: md(new Date(ms).toISOString()), pct: pct(ms) })
    }
  }
  return { start: min, end: max, granularity, ticks }
}

/** 任务进度归一化到 0–1：自身「任务进度」优先（0–1 或 0–100 都兼容），否则按子任务完成比例。 */
function progressRatio(task: TaskRecord, children: TaskRecord[]): number {
  if (task.progress !== null && Number.isFinite(task.progress)) {
    const p = task.progress
    return Math.min(1, Math.max(0, p <= 1 ? p : p / 100))
  }
  if (children.length > 0) {
    return children.filter(c => c.status === 'done').length / children.length
  }
  return 1
}

/** 扁平任务列表 → 父子行；父任务缺失的散子任务作为独立根行。 */
function makeRows(tasks: TaskRecord[]): GanttRow[] {
  const parents = tasks.filter(t => t.parentId === null)
  const byId = new Map(tasks.map(t => [t.id, t]))
  const roots: GanttRow[] = parents.map(task => ({
    task,
    children: tasks.filter(t => t.parentId === task.id),
  }))
  const orphans = tasks
    .filter(t => t.parentId !== null && !byId.has(t.parentId))
    .map(task => ({ task, children: [] as TaskRecord[] }))
  const key = (row: GanttRow): number => {
    const w = taskWindow(row.task)
    return w === null ? Number.POSITIVE_INFINITY : w.start
  }
  return [...roots, ...orphans].sort((a, b) => key(a) - key(b))
}

/** 时间窗 → 时间条样式（left/width %）；无排期或无时间轴时返回 null。 */
function barStyleFor(task: TaskRecord, scale: Scale | null): { left: string; width: string } | null {
  if (scale === null) return null
  const window = taskWindow(task)
  if (window === null) return null
  const span = scale.end - scale.start
  const left = (window.start - scale.start) / span * 100
  const width = Math.max((window.end - window.start) / span * 100, 0.4)
  return { left: `${left}%`, width: `${width}%` }
}

/** 单行任务（父行或缩进的子任务行）。 */
const GanttLine = memo(function GanttLine({
  task, children, scale, employees, onEditTask, depth,
}: {
  task: TaskRecord
  /** 模块子任务，仅用于父行进度推导；子任务行传空数组。 */
  children: TaskRecord[]
  scale: Scale | null
  employees: DevTaskState['employees']
  onEditTask(task: TaskRecord): void
  depth: number
}) {
  const owner = task.employeeId === null
    ? null
    : employees.find(e => e.id === task.employeeId)?.name ?? task.employeeId
  const window = taskWindow(task)
  const barStyle = barStyleFor(task, scale)
  return (
    <div className="dtk-gantt-row" data-depth={depth} data-status={task.status}>
      <div className="dtk-gantt-labelcell">
        <span className="dtk-status-dot" data-status={STATUS_DOT_STATUS[task.status] ?? 'todo'} aria-hidden />
        <button
          type="button"
          className="dtk-gantt-title"
          title={task.description !== '' ? task.description : task.title}
          // eslint-disable-next-line react/jsx-no-bind
          onClick={() => onEditTask(task)}
        >
          {task.title}
        </button>
        <span className="dtk-gantt-rowmeta">
          {owner !== null && <span className="dtk-gantt-owner">{owner}</span>}
          {window !== null && (
            <span className="dtk-gantt-dates">
              {window.start === window.end
                ? md(task.startDate ?? task.dueDate!)
                : `${md(task.startDate!)} – ${md(task.dueDate!)}`}
            </span>
          )}
        </span>
      </div>
      <div className="dtk-gantt-trackcell">
        {barStyle !== null ? (
          <span
            className="dtk-gantt-bar"
            data-status={STATUS_DOT_STATUS[task.status] ?? 'todo'}
            style={barStyle}
            title={`${task.title} · ${window!.start === window!.end
              ? shortDate(task.startDate ?? task.dueDate!)
              : `${shortDate(task.startDate!)} → ${shortDate(task.dueDate!)}`}`}
          >
            <span className="dtk-gantt-barfill" style={{ width: `${Math.round(progressRatio(task, children) * 100)}%` }} />
          </span>
        ) : (
          <span className="dtk-gantt-nobar">—</span>
        )}
      </div>
    </div>
  )
})

/** 一行父任务 + 其缩进的子任务行。 */
const GanttRowView = memo(function GanttRowView({
  row, scale, employees, onEditTask,
}: {
  row: GanttRow
  scale: Scale | null
  employees: DevTaskState['employees']
  onEditTask(task: TaskRecord): void
}) {
  const { task, children } = row
  return (
    <>
      <GanttLine
        task={task}
        children={children}
        scale={scale}
        employees={employees}
        onEditTask={onEditTask}
        depth={0}
      />
      {children.map(child => (
        <GanttLine
          key={child.id}
          task={child}
          children={[]}
          scale={scale}
          employees={employees}
          onEditTask={onEditTask}
          depth={1}
        />
      ))}
    </>
  )
})

/** 甘特图视图。 */
export function GanttView({ tasks, t, employees, onEditTask }: GanttViewProps) {
  const scale = useMemo(() => buildScale(
    tasks.map(taskWindow).filter((w): w is { start: number; end: number } => w !== null),
  ), [tasks])

  const { scheduled, unscheduled } = useMemo(() => {
    const rows = makeRows(tasks)
    return {
      scheduled: rows.filter(r => taskWindow(r.task) !== null),
      unscheduled: rows.filter(r => taskWindow(r.task) === null),
    }
  }, [tasks])

  const todayPct = scale === null
    ? 0
    : (startOfLocalDay(Date.now()) - scale.start) / (scale.end - scale.start) * 100

  if (tasks.length === 0) {
    return (
      <div className="dtk-view-placeholder">
        <span className="dtk-view-placeholder-icon" aria-hidden>◫</span>
        <span>{t('gantt.empty')}</span>
      </div>
    )
  }

  return (
    <div className="dtk-gantt">
      {scale !== null && (
        <div className="dtk-gantt-overlay" aria-hidden>
          {scale.ticks.map((tick, i) => (
            <div
              key={`${tick.label}-${i}`}
              className="dtk-gantt-tick"
              data-edge={i === 0 ? 'first' : i === scale.ticks.length - 1 ? 'last' : undefined}
              style={{ left: `${tick.pct}%` }}
            >
              <span className="dtk-gantt-ticklabel">{tick.label}</span>
            </div>
          ))}
          <div className="dtk-gantt-today" style={{ left: `${todayPct}%` }}>
            <span className="dtk-gantt-todaylabel">{t('gantt.today')}</span>
          </div>
        </div>
      )}
      <div className="dtk-gantt-headrow">
        <div className="dtk-gantt-labelcell dtk-gantt-headlabel">{t('gantt.task')}</div>
        <div className="dtk-gantt-trackcell" />
      </div>
      <div className="dtk-gantt-rows">
        {scheduled.map(row => (
          <GanttRowView
            key={row.task.id}
            row={row}
            scale={scale}
            employees={employees}
            onEditTask={onEditTask}
          />
        ))}
        {unscheduled.length > 0 && (
          <>
            <div className="dtk-gantt-sectionrow">{t('gantt.unscheduled')}</div>
            {unscheduled.map(row => (
              <GanttRowView
                key={row.task.id}
                row={row}
                scale={scale}
                employees={employees}
                onEditTask={onEditTask}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
