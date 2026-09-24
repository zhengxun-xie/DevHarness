/**
 * 活动事件视图：任务表的团队变更流（新 → 旧）。
 *
 * 数据来自 host 聚合的 Bitable record-history（GET /api/devtask/activity），
 * 懒加载：只有切到本视图才请求。归属过滤在浏览器侧完成（individual 视角
 * 只显示其任务的事件），与看板/项目/甘特一致。
 *
 * 数据流三层（上层未命中才打下一层）：localStorage 快照挂载即渲染秒开 →
 * host 内存 60s TTL → 云端 record-history 全量聚合（30–70s）。第三层只在
 * 没有本地快照且 host 未命中时发生；成功后原位替换并写回本地快照，失败
 * 保留本地内容、顶部挂可重试提示行。「刷新」按钮 fresh=1 强制打云端。
 *
 * 展示约定：
 *   - 按本地日期分组（今天 / 昨天 / 日期），组内按时间倒序
 *   - 每个日期分组可折叠（点组头），折叠后只留组头与当天条数
 *   - 单字段变更渲染为「将 X 从 A 改为 B」；多字段变更列出全部 diff
 *   - 任务标题可点（任务仍在当前视图时打开编辑弹窗，已删除则纯文本）
 *   - 「加载更多」以 +50 累加 limit；「刷新」带 fresh=1 绕过宿主缓存
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActivityEvent, DevTaskState, TaskRecord } from '../protocol.ts'
import { api } from './api.ts'
import { loadCachedActivity, saveCachedActivity } from './activity-cache.ts'

export interface ActivityViewProps {
  /** 归属过滤后的任务（individual 视角只显示其任务的事件）。 */
  tasks: TaskRecord[]
  t: TranslateNS<'devTaskLeft'>
  /** 点击任务标题时打开编辑对话框。 */
  onEditTask(task: TaskRecord): void
}

/** 每次「加载更多」的增量。 */
const PAGE_STEP = 50

/** 本地日期键 yyyy-mm-dd。 */
function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** HH:mm。 */
function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 今天 HH:mm / 昨天 HH:mm / M/d HH:mm。 */
function relativeTime(iso: string, t: TranslateNS<'devTaskLeft'>): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('activity.time.justNow')
  if (minutes < 60) return `${minutes} ${t('activity.time.minutes')}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24 && dayKey(iso) === dayKey(new Date().toISOString())) {
    return `${hours} ${t('activity.time.hours')}`
  }
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const prefix = dayKey(iso) === dayKey(new Date().toISOString())
    ? t('activity.time.today')
    : dayKey(iso) === dayKey(yesterday.toISOString())
      ? t('activity.time.yesterday')
      : dayKey(iso).slice(5).replace('-', '/')
  return `${prefix} ${hhmm(iso)}`
}

/** 变更值展示：ISO 日期压缩为 M/d，空值显示占位。 */
function fmtChangeValue(value: string, t: TranslateNS<'devTaskLeft'>): string {
  if (value === '') return t('activity.emptyValue')
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  return value
}

/** 日分组。 */
interface DayGroup {
  key: string
  label: string
  events: ActivityEvent[]
}

function groupByDay(events: ActivityEvent[], t: TranslateNS<'devTaskLeft'>): DayGroup[] {
  const today = dayKey(new Date().toISOString())
  const yesterday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return dayKey(d.toISOString())
  })()
  const groups: DayGroup[] = []
  for (const event of events) {
    const key = dayKey(event.at)
    const label = key === today ? t('activity.today') : key === yesterday ? t('activity.time.yesterday') : key.slice(5).replace('-', '/')
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === key) last.events.push(event)
    else groups.push({ key, label, events: [event] })
  }
  return groups
}

/** 单条事件（memo：时间线重渲染时未变事件不重绘）。 */
const ActivityEventRow = memo(function ActivityEventRow({
  event, task, t, onEditTask,
}: {
  event: ActivityEvent
  /** 事件对应任务仍在当前视图时为该任务，否则 null（已删除/被过滤）。 */
  task: TaskRecord | null
  t: TranslateNS<'devTaskLeft'>
  onEditTask(task: TaskRecord): void
}) {
  const title = event.taskTitle
  const openable = task !== null
  return (
    <li className="dtk-activity-event" data-type={event.type}>
      <span className="dtk-activity-glyph" aria-hidden>{event.type === 'create' ? '＋' : '✎'}</span>
      <div className="dtk-activity-body">
        <div className="dtk-activity-line">
          {event.operator !== '' && <span className="dtk-activity-operator">{event.operator}</span>}
          {event.type === 'create'
            ? <span className="dtk-activity-action">{t('activity.created')}</span>
            : event.changes.length === 1
              ? (
                <span className="dtk-activity-action">
                  {t('activity.changedOne')
                    .replace('{field}', event.changes[0]!.field)
                    .replace('{before}', fmtChangeValue(event.changes[0]!.before, t))
                    .replace('{after}', fmtChangeValue(event.changes[0]!.after, t))}
                </span>
              )
              : (
                <span className="dtk-activity-action">
                  {t('activity.changedMany').replace('{n}', String(event.changes.length))}
                </span>
              )}
          {openable
            ? (
              <button
                type="button"
                className="dtk-activity-task"
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => onEditTask(task)}
              >
                《{title}》
              </button>
            )
            : <span className="dtk-activity-task dtk-activity-task-dead">《{title}》</span>}
          <time className="dtk-activity-time" dateTime={event.at} title={event.at}>
            {relativeTime(event.at, t)}
          </time>
        </div>
        {event.type === 'update' && event.changes.length > 1 && (
          <ul className="dtk-activity-diffs">
            {event.changes.map((change, i) => (
              <li key={`${change.field}-${i}`} className="dtk-activity-diff">
                <span className="dtk-activity-difffield">{change.field}</span>
                <span className="dtk-activity-diffold">{fmtChangeValue(change.before, t)}</span>
                <span className="dtk-activity-diffarrow" aria-hidden>→</span>
                <span className="dtk-activity-diffnew">{fmtChangeValue(change.after, t)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
})

/** 活动事件视图。 */
export function ActivityView({ tasks, t, onEditTask }: ActivityViewProps) {
  // 秒开：有本地快照就先渲染它（非空数组即无 spinner），后台刷新落地后替换；
  // 完全没有缓存时才走 loading 态。
  const [events, setEvents] = useState<ActivityEvent[]>(() => loadCachedActivity() ?? [])
  const [limit, setLimit] = useState(PAGE_STEP)
  const [loading, setLoading] = useState(() => loadCachedActivity() === null)
  const [error, setError] = useState<string | null>(null)
  /** 已折叠的日期分组（day key 集合；当天事件多时可先折起来）。 */
  const [collapsedDays, setCollapsedDays] = useState<ReadonlySet<string>>(() => new Set())

  /**
   * 拉取事件流。`fresh=false`（默认）走 host TTL 层，mount / 加载更多用它；
   * `fresh=true` 仅「刷新」按钮用，绕过 host 缓存真正打云端。成功后写入
   * 本地快照；失败保持当前内容（本地缓存不清空），把错误挂到提示行。
   */
  const load = useCallback(async (nextLimit: number, fresh = false): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const feed = await api.activity(nextLimit, fresh)
      setEvents(feed.events)
      setLimit(nextLimit)
      setLoading(false)
      saveCachedActivity(feed.events)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setLoading(false)
    }
  }, [])

  // 进入视图即加载（组件仅在 activity tab 激活时挂载）。
  useEffect(() => {
    void load(PAGE_STEP, false)
  }, [load])

  // 归属过滤：individual 视角只显示其任务的事件（record id 维度）。
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const visible = useMemo(
    () => events.filter(event => taskById.has(event.recordId)),
    [events, taskById],
  )
  const groups = useMemo(() => groupByDay(visible, t), [visible, t])

  /** 折叠 / 展开一个日期分组（新的 Set 引用，保证 memo 生效）。 */
  const toggleDay = useCallback((key: string) => {
    setCollapsedDays(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (loading && events.length === 0) {
    return <div className="dtk-status">{t('activity.loading')}</div>
  }
  if (error !== null && events.length === 0) {
    return (
      <div className="dtk-status" data-kind="error">
        {t('error.prefix')}: {error}
        {' '}
        <button type="button" className="dtk-linkbtn" onClick={() => { void load(PAGE_STEP, true) }}>
          {t('activity.retry')}
        </button>
      </div>
    )
  }
  if (visible.length === 0) {
    return (
      <div className="dtk-view-placeholder">
        <span className="dtk-view-placeholder-icon" aria-hidden>◴</span>
        <span>{t('activity.empty')}</span>
      </div>
    )
  }

  // 有本地快照在屏幕上时，后台刷新失败不擦内容：顶部错误行 + 重试，列表保留。
  const errorBanner = error === null ? null : (
    <p className="dtk-status" data-kind="error">
      {t('error.prefix')}: {error}
      {' '}
      <button type="button" className="dtk-linkbtn" onClick={() => { void load(limit, true) }}>
        {t('activity.retry')}
      </button>
    </p>
  )

  return (
    <div className="dtk-activity">
      {errorBanner}
      <div className="dtk-activity-toolbar">
        <span className="dtk-activity-count">
          {t('activity.count').replace('{n}', String(visible.length))}
        </span>
        <button
          type="button"
          className="dtk-btn"
          disabled={loading}
          // eslint-disable-next-line react/jsx-no-bind
          onClick={() => void load(limit, true)}
        >
          {t('activity.refresh')}
        </button>
      </div>
      {loading && visible.length > 0 && (
        <p className="dtk-activity-hint" role="status">{t('activity.staleHint')}</p>
      )}
      {groups.map(group => {
        const isCollapsed = collapsedDays.has(group.key)
        return (
          <section key={group.key} className="dtk-activity-day" data-collapsed={isCollapsed ? 'true' : undefined}>
            <h3 className="dtk-activity-daylabel">
              <button
                type="button"
                className="dtk-activity-daytoggle"
                aria-expanded={!isCollapsed}
                title={t('activity.toggleDay')}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => toggleDay(group.key)}
              >
                <span className="dtk-activity-caret" aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
                <span className="dtk-activity-daytext">{group.label}</span>
                <span className="dtk-activity-daycount">
                  {t('activity.count').replace('{n}', String(group.events.length))}
                </span>
              </button>
            </h3>
            {!isCollapsed && (
              <ul className="dtk-activity-list">
                {group.events.map(event => (
                  <ActivityEventRow
                    key={event.id}
                    event={event}
                    task={taskById.get(event.recordId) ?? null}
                    t={t}
                    onEditTask={onEditTask}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}
      <div className="dtk-activity-more">
        {loading
          ? <span className="dtk-activity-moretext">{t('activity.loading')}</span>
          : visible.length >= limit
            ? (
              <button
                type="button"
                className="dtk-btn"
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => void load(limit + PAGE_STEP, false)}
              >
                {t('activity.loadMore')}
              </button>
            )
            : <span className="dtk-activity-moretext">{t('activity.allLoaded')}</span>}
      </div>
    </div>
  )
}
