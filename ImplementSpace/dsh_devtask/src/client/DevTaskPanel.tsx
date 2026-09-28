/**
 * DevTask LEFT-panel body: a full-width task board mounted as a DOM-level
 * takeover of the center column (see devtask-mount.tsx).
 *
 * Layout, mirroring the DevBuddy multi-tab view the requirement references:
 *   ┌ title header: DevTask / 团队任务看板 .. [＋ 新增视图] [右侧栏] ┐
 *   ├ browser-style view tab strip (软件组 team view by default) ┤
 *   └ task board for the active view: one column per status    ┘
 *
 * 新增视图 opens a dialog asking for a view name and an employee picked from
 * a dropdown (the placeholder 员工A/B/C roster the host supplies).
 *
 * The component is a plain React tree fed by the loopback API (./api.ts).
 * Authoritative state always lives on the host; the panel replaces its
 * snapshot with the state every mutation returns.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { api } from './api.ts'
import { RightbarToggle } from './RightbarToggle.tsx'
import { TaskCard } from './TaskCard.tsx'
import { OkrProjectView } from './OkrProjectView.tsx'
import { GanttView } from './GanttView.tsx'
import { ActivityView } from './ActivityView.tsx'
import { AgentView } from './AgentView.tsx'
import { TaskEditDialog } from './TaskEditDialog.tsx'
import { SubtaskCreateDialog } from './SubtaskCreateDialog.tsx'
import { TaskLogPanel } from './TaskLogPanel.tsx'
import type { TaskLogFeed, TaskLogSubject } from './TaskLogPanel.tsx'
import { ViewCreateForm } from './ViewCreateForm.tsx'
import { loadCachedState, saveCachedState } from './state-cache.ts'
import type { DevTaskState, TaskRecord, TaskStatus, TaskView } from '../protocol.ts'
import { TASK_STATUSES } from '../protocol.ts'

export interface DevTaskPanelProps {
  /** Bound DevTask translator. */
  t: TranslateNS<'devTaskLeft'>
  /** Session right-sidebar navigation face (expand/collapse). */
  sidebarRight: ISidebarRight
}

/** Status → locale key for column headings. */
const STATUS_KEY = {
  backlog: 'status.backlog',
  todo: 'status.todo',
  running: 'status.running',
  done: 'status.done',
  failed: 'status.failed',
} as const

/** 显示周期选项（顺序即渲染顺序）。 */
const PERIODS = ['all', 'week', 'month', 'quarter', 'custom'] as const

/** Period → locale key. */
const PERIOD_KEY = {
  all: 'period.all',
  week: 'period.week',
  month: 'period.month',
  quarter: 'period.quarter',
  custom: 'period.custom',
} as const

/** 图表类型选项（顺序即渲染顺序）。 */
const VIEW_TYPES = ['project', 'board', 'gantt', 'activity', 'agent'] as const

/** ViewType → locale key. */
const VIEWTYPE_KEY = {
  board: 'viewtype.board',
  project: 'viewtype.project',
  gantt: 'viewtype.gantt',
  activity: 'viewtype.activity',
  agent: 'viewtype.agent',
} as const

type ViewType = typeof VIEW_TYPES[number]
type Period = typeof PERIODS[number]

/**
 * 视图布局记忆（localStorage，按 origin 隔离）：每个视图 tab（view id）各自
 * 记住上次的布局——图表类型 + 显示周期 + 自定义起止。从「软件组」切到「王胡
 * 森」再切回，两边还是各自上次的样子，互不串扰。
 *
 *   `devtask.viewLayout.v1.<viewId>` → { viewType, period, customStart, customEnd }
 *
 * 为什么按 view id 而不是按图表类型：用户口中的「视图」是 tab（视图名称），
 * 图表类型只是布局的一个维度；view id 稳定（uuid，host registry 持久化），
 * 同一员工视角在新会话里仍能恢复。
 *
 * 写用读-改-写合并且只碰本视图的小 key：dsh 会以模块加载器与平台动态 chunk
 * 两条路径各装载一份组件实例，state 各自独立；单 key 整体覆写下后落笔的实例
 * 会用自己没有的陈旧字段盖掉新值。每次写只碰本视图的小 key，天然收敛。
 * 读取走 useState 惰性初始化——模块级常量会在 chunk 加载时固化，SPA 软刷新
 * 只重挂组件不重跑模块代码，恢复的会是陈旧布局。
 */
const VIEW_LAYOUT_PREFIX = 'devtask.viewLayout.v1'

/** 单个视图 tab 记住的布局（未存过时默认本周 + 项目）。 */
interface ViewLayout {
  viewType: ViewType
  period: Period
  customStart: string
  customEnd: string
}

const DEFAULT_LAYOUT: ViewLayout = { viewType: 'project', period: 'week', customStart: '', customEnd: '' }

const layoutKeyFor = (viewId: string): string => `${VIEW_LAYOUT_PREFIX}.${viewId}`

/** 读取某个视图 tab 的布局；非法/不可用回默认。 */
function readViewLayout(viewId: string): ViewLayout {
  try {
    const raw = localStorage.getItem(layoutKeyFor(viewId))
    if (raw === null) return { ...DEFAULT_LAYOUT }
    const e = JSON.parse(raw) as Record<string, unknown>
    return {
      viewType: VIEW_TYPES.includes(e.viewType as ViewType) ? e.viewType as ViewType : DEFAULT_LAYOUT.viewType,
      period: PERIODS.includes(e.period as Period) ? e.period as Period : DEFAULT_LAYOUT.period,
      customStart: typeof e.customStart === 'string' ? e.customStart : '',
      customEnd: typeof e.customEnd === 'string' ? e.customEnd : '',
    }
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

/** 读-改-写持久化某个视图 tab 的布局字段。 */
function saveViewLayout(viewId: string, patch: Partial<ViewLayout>): void {
  try {
    localStorage.setItem(layoutKeyFor(viewId), JSON.stringify({ ...readViewLayout(viewId), ...patch }))
  } catch {
    // ignored: layout is a convenience, not a correctness dependency
  }
}

export function DevTaskPanel({ t, sidebarRight }: DevTaskPanelProps) {
  // 秒开：挂载即渲染上次快照（模块级变量 → localStorage），后台刷新落地后
  // 原位替换；没有缓存时才走 loading 行。
  const [state, setState] = useState<DevTaskState | null>(loadCachedState)
  const [error, setError] = useState<string | null>(null)
  const [creatingView, setCreatingView] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null)
  /** 「添加子任务」弹窗的目标父任务（项目视图「＋」按钮设置；null = 关闭）。 */
  const [subtaskParent, setSubtaskParent] = useState<TaskRecord | null>(null)
  /**
   * 项目视图中需要展开的条目 id 集（新建子任务后的祖先链）。OkrProjectView
   * 的行组件各自维护折叠状态，创建成功后把新条目的祖先链写进来：命中即
   * setOpen(true)，保证新子任务落在可视区；否则父行收着，用户以为没创建。
   */
  const [expandIds, setExpandIds] = useState<ReadonlySet<string>>(new Set())
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null)
  /** 后台刷新进行中（快照已在屏幕上时显示刷新指示）。 */
  const [refreshing, setRefreshing] = useState(false)
  /** 任务日志板块当前主体（null = 关闭）。再次点击同一条目即 toggle 关闭。 */
  const [selectedSubject, setSelectedSubject] = useState<TaskLogSubject | null>(null)

  /**
   * 日志 feed 会话缓存（key: `${kind}:${id}`）：hover 预取与面板回写写入，
   * 同主体再次打开通过 initialFeed 零请求秒开（任务看板详情级体验）。
   */
  const logFeedCacheRef = useRef(new Map<string, TaskLogFeed>())
  /** hover 预取防抖定时器（全局单 timer：鼠标同一时刻只悬停一个条目）。 */
  const hoverTimerRef = useRef<number | null>(null)

  const feedKey = useCallback((subject: TaskLogSubject): string => `${subject.kind}:${subject.id}`, [])

  /** 已有缓存（或预取已写入）的主体直接返回，避免重复请求。 */
  const prefetchSubjectLog = useCallback((subject: TaskLogSubject): void => {
    const key = feedKey(subject)
    if (logFeedCacheRef.current.has(key)) return
    api.taskLogs(subject.id, subject.kind, subject.title, false)
      .then(feed => {
        logFeedCacheRef.current.set(key, {
          entries: feed.entries,
          history: feed.history,
          historyError: feed.historyError ?? null,
        })
      })
      .catch(() => {}) // 预取失败静默：点击时面板正式拉取并显示错误
  }, [feedKey])

  /**
   * 悬停日志主体：300ms 防抖后预取（扫过列表时不会连环触发 lark-cli）。
   * host 端单飞 + TTL 缓存保证预取与随后的点击合并为一次真实拉取。
   */
  const hoverSubjectLog = useCallback((subject: TaskLogSubject): void => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null
      prefetchSubjectLog(subject)
    }, 300)
  }, [prefetchSubjectLog])

  /** 悬停离开：取消尚未触发的预取（已经发起的不打断）。 */
  const hoverEnd = useCallback((): void => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  // 卸载清理预取定时器。
  useEffect(() => () => hoverEnd(), [hoverEnd])

  /** 任务/子任务 → 日志主体引用（kind 按 parentId 归类，同 openTaskLog）。 */
  const taskSubject = useCallback((task: TaskRecord): TaskLogSubject => ({
    kind: task.parentId === null ? 'task' : 'subtask',
    id: task.id,
    title: task.title,
  }), [])

  /** 悬停任务/子任务条目：预取其日志 feed。 */
  const hoverTaskLog = useCallback((task: TaskRecord): void => {
    hoverSubjectLog(taskSubject(task))
  }, [hoverSubjectLog, taskSubject])

  /**
   * 面板 feed 回写会话缓存。useCallback 保持引用稳定（TaskLogPanel 的
   * 加载 effect 依赖它，内联函数会导致 DevTaskPanel 每次重渲染都重拉）。
   */
  const handleFeed = useCallback((feed: TaskLogFeed): void => {
    if (selectedSubject === null) return
    logFeedCacheRef.current.set(feedKey(selectedSubject), feed)
  }, [selectedSubject, feedKey])

  /**
   * 打开/关闭任务日志板块（任务与子任务入口）：kind 按 parentId 归类——
   * parentId 为空是任务层，非空是模块子任务层。同一主体再点一次则关闭。
   */
  const openTaskLog = useCallback((task: TaskRecord) => {
    setSelectedSubject(prev => prev !== null && prev.id === task.id
      ? null
      : { kind: task.parentId === null ? 'task' : 'subtask', id: task.id, title: task.title })
  }, [])

  /** 打开/关闭任务日志板块（O/KR 入口：视图层已构造好主体引用）。 */
  const openSubjectLog = useCallback((subject: TaskLogSubject) => {
    setSelectedSubject(prev => prev !== null && prev.id === subject.id ? null : subject)
  }, [])

  /**
   * 当前日志主体是否已从 state 全集消失（design/06 §11：删除后面板保留，
   * 显示「已删除」徽章而非自动关闭——本地删除日志仍需可见）。被周期/视角
   * 过滤掉不在此列（那是 UI 过滤，state 里还在）。
   */
  const subjectDeleted = useMemo(() => {
    if (state === null || selectedSubject === null) return false
    if (selectedSubject.kind === 'objective') return !state.objectives.some(o => o.id === selectedSubject.id)
    if (selectedSubject.kind === 'kr') return !state.keyResults.some(k => k.id === selectedSubject.id)
    return !state.tasks.some(task => task.id === selectedSubject.id)
  }, [state, selectedSubject])

  const activeView = useMemo(() => {
    if (state === null) return null
    return state.views.find(view => view.id === state.activeViewId) ?? state.views[0] ?? null
  }, [state])

  // 团体视角看全部；个人视角看本人的任务 + 其可见祖先链（父任务/项目归
  // 本人即展示其下子任务，孙任务同理——子任务负责人可能是他人）。
  const activeTasks = useMemo(() => {
    if (state === null || activeView === null) return []
    if (activeView.scope === 'team') return state.tasks
    const byId = new Map(state.tasks.map(task => [task.id, task]))
    const own = new Set(
      state.tasks
        .filter(task => task.employeeId === activeView.employeeId)
        .map(task => task.id),
    )
    return state.tasks.filter(task => {
      // 沿父记录 2 向上找：任意一级祖先是本人可见的，该条目即可见。
      let cursor: TaskRecord | undefined = task
      while (cursor !== undefined) {
        if (own.has(cursor.id)) return true
        cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
      }
      return false
    })
  }, [state, activeView])

  // 布局初始来源：快照里当时激活的视图 tab（无快照时先按默认，host state
  // 首次落地后由下方 effect 按真实 activeViewId 纠正）。惰性初始化，不用
  // 模块级常量（见 VIEW_LAYOUT 注释）。
  const initialLayout: ViewLayout = (() => {
    if (state === null) return DEFAULT_LAYOUT
    const active = state.views.find(view => view.id === state.activeViewId) ?? state.views[0]
    return active === undefined ? DEFAULT_LAYOUT : readViewLayout(active.id)
  })()
  const [viewType, setViewType] = useState<ViewType>(initialLayout.viewType)
  const [period, setPeriod] = useState<Period>(initialLayout.period)
  // 自定义周期的起止日期（yyyy-mm-dd 字符串，由 <input type=date> 绑定）。
  const [customStart, setCustomStart] = useState(initialLayout.customStart)
  const [customEnd, setCustomEnd] = useState(initialLayout.customEnd)

  /**
   * 激活视图 tab 变化时，工具栏整体换绑成该 tab 上次的布局（图表类型 + 周期
   * + 自定义起止）。初始渲染不算切换：ref 以当次激活 id 起步，只有 id 真的
   * 变了（点 tab / 新建视图 / 删视图后重指 / host state 首次落地）才恢复。
   * 每个 setter 都已按当前视图 id 落盘，这里只负责「恢复」。
   */
  const prevViewIdRef = useRef<string | null>(activeView?.id ?? null)
  useEffect(() => {
    const id = activeView?.id ?? null
    if (id === null || id === prevViewIdRef.current) return
    prevViewIdRef.current = id
    const layout = readViewLayout(id)
    setViewType(layout.viewType)
    setPeriod(layout.period)
    setCustomStart(layout.customStart)
    setCustomEnd(layout.customEnd)
  }, [activeView?.id])

  /** 切换图表类型并记忆到当前视图 tab 的布局。 */
  const chooseViewType = useCallback((next: ViewType) => {
    setViewType(next)
    if (activeView !== null) saveViewLayout(activeView.id, { viewType: next })
  }, [activeView])

  /** 切换显示周期并记忆到当前视图 tab 的布局。 */
  const choosePeriod = useCallback((next: Period) => {
    setPeriod(next)
    if (activeView !== null) saveViewLayout(activeView.id, { period: next })
  }, [activeView])

  /**
   * 按选定的显示周期过滤任务。无截止日期的任务在任何周期下都保留
   * （它们尚未排期，不应因周期筛选而消失）。
   */
  const filteredTasks = useMemo(() => {
    if (period === 'all') return activeTasks
    if (period === 'custom') {
      // 自定义区间：未填日期时不筛选；只填一个端点时做单侧过滤。
      const s = customStart !== '' ? new Date(customStart + 'T00:00:00') : null
      const e = customEnd !== '' ? new Date(customEnd + 'T23:59:59') : null
      if (s === null && e === null) return activeTasks
      return activeTasks.filter(task => {
        if (task.dueDate === null) return true
        const d = new Date(task.dueDate)
        if (s !== null && d < s) return false
        if (e !== null && d > e) return false
        return true
      })
    }
    const now = new Date()
    let start: Date
    let end: Date
    if (period === 'week') {
      // 周一为一周起点。
      const day = (now.getDay() + 6) % 7
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day)
      end = new Date(start)
      end.setDate(start.getDate() + 6)
    } else if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    } else {
      // quarter：Q1=0..2, Q2=3..5 …
      const q = Math.floor(now.getMonth() / 3)
      start = new Date(now.getFullYear(), q * 3, 1)
      end = new Date(now.getFullYear(), q * 3 + 3, 0)
    }
    end.setHours(23, 59, 59, 999)
    return activeTasks.filter(task =>
      task.dueDate === null
        ? true
        : new Date(task.dueDate) >= start && new Date(task.dueDate) <= end,
    )
  }, [activeTasks, period, customStart, customEnd])

  /**
   * Status of each draggable task in the active view. A drop that would not
   * change anything is ignored, so the handler needs no access to the full
   * state (which is null-narrowed away at the board level).
   */
  const statusById = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of activeTasks) map.set(task.id, task.status)
    return map
  }, [activeTasks])

  /** 采纳一份权威 state：置入面板并更新秒开缓存。 */
  const applyState = useCallback((next: DevTaskState) => {
    setState(next)
    saveCachedState(next)
  }, [])

  /** Run a mutation, adopting the returned state; surface failures inline. */
  const run = useCallback(async (action: () => Promise<DevTaskState>): Promise<void> => {
    try {
      applyState(await action())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [applyState])

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      applyState(await api.state())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRefreshing(false)
    }
  }, [applyState])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const employeeName = useCallback((employeeId: string): string => {
    return state?.employees.find(employee => employee.id === employeeId)?.name ?? employeeId
  }, [state])

  /**
   * The secondary marker on a tab. The team perspective (the default 软件组
   * board) shows the bare view name — an explicit "团队视角" badge is noise on
   * the one tab that is always present. An individual perspective names its
   * owning employee; never an employee on the team view, which is what
   * previously mislabelled the default tab as 员工A's board.
   * @returns the marker text, or `null` to render no marker at all.
   */
  const viewMarker = useCallback((view: TaskView): string | null => {
    if (view.scope !== 'individual') return null
    if (view.employeeId === null) return t('view.scope.individual')
    // When the view name was auto-derived from the employee name, the marker
    // would duplicate it — skip the marker in that case.
    const name = employeeName(view.employeeId)
    return view.name === name ? null : name
  }, [employeeName, t])

  return (
    <div className="dtk-root">
      <div className="dtk-header">
        <div>
          <h1 className="dtk-header-title">{t('panel.title')}</h1>
          <p className="dtk-header-sub">{t('panel.subtitle')}</p>
        </div>
        <div className="dtk-header-actions">
          {refreshing && <span className="dtk-refreshing">{t('panel.refreshing')}</span>}
          <button
            type="button"
            className="dtk-btn dtk-btn-primary"
            disabled={activeView === null}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => setCreatingTask(true)}
          >
            ＋ {t('task.new')}
          </button>
          <button
            type="button"
            className="dtk-btn"
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => setCreatingView(true)}
          >
            ＋ {t('view.new')}
          </button>
          <RightbarToggle
            sidebarRight={sidebarRight}
            openLabel={t('panel.rightbarOpen')}
            closeLabel={t('panel.rightbarClose')}
          />
        </div>
      </div>

      {/* The create-view form lives in the panel's upper area, ABOVE the tab
          strip: it is chrome for adding a tab, so it reads as part of the
          header block rather than as content pushed into the board. */}
      {creatingView && state !== null && (
        <div className="dtk-form-area">
          <ViewCreateForm
            t={t}
            employees={state.employees}
            onCancel={() => setCreatingView(false)}
            // eslint-disable-next-line react/jsx-no-bind
            onSubmit={async employeeId => {
              try {
                applyState(await api.createView(employeeId))
                setError(null)
                setCreatingView(false)
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught))
                setCreatingView(false)
              }
            }}
          />
        </div>
      )}

      {state !== null && state.views.length > 0 && (
        <div className="dtk-tabbar" role="tablist" aria-label={t('panel.title')}>
          {state.views.map(view => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={activeView?.id === view.id}
              className="dtk-tab"
              data-active={activeView?.id === view.id}
              title={viewMarker(view) === null ? view.name : `${view.name} · ${viewMarker(view)}`}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => {
                if (view.id === activeView?.id) return
                // 客户端即时切换：本地更新 activeViewId，UI 无延迟。
                // 后台静默持久化到 registry.json，不阻塞渲染。
                setState(prev => prev === null ? prev : { ...prev, activeViewId: view.id })
                void api.selectView(view.id).then(applyState).catch(() => {})
              }}
            >
              <span className="dtk-tab-label">{view.name}</span>
              {viewMarker(view) !== null && (
                <span className="dtk-tab-employee" data-scope={view.scope}>{viewMarker(view)}</span>
              )}
              {state.views.length > 1 && (
                <span
                  className="dtk-tab-x"
                  role="button"
                  aria-label={t('view.remove')}
                  title={t('view.remove')}
                  // eslint-disable-next-line react/jsx-no-bind
                  onClick={event => {
                    event.stopPropagation()
                    if (window.confirm(t('view.removeConfirm'))) {
                      void run(() => api.removeView(view.id))
                    }
                  }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="dtk-tab-add"
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => setCreatingView(true)}
          >
            ＋ {t('view.new')}
          </button>
        </div>
      )}

      {error !== null && (
        <div className="dtk-status" data-kind="error">
          {t('error.prefix')}: {error}
          {' '}
          <button type="button" className="dtk-linkbtn" onClick={() => { void refresh() }}>
            {t('error.reload')}
          </button>
        </div>
      )}

      {state === null && error === null && <div className="dtk-status">{t('panel.loading')}</div>}

      {state !== null && activeView === null && (
        <div className="dtk-status">{t('view.empty')}</div>
      )}

      {activeView !== null && (
        <Fragment>
          {/* 图表配置栏：固定在看板上方，定义数据范围（显示周期）与
              展示格式（看板/项目/甘特），不随看板滚动。 */}
          <div className="dtk-toolbar">
            <div className="dtk-toolbar-group">
              <div className="dtk-seg-group" role="group">
                {PERIODS.map(p => (
                  <button
                    key={p}
                    type="button"
                    className="dtk-seg"
                    data-active={period === p}
                    aria-pressed={period === p}
                    // eslint-disable-next-line react/jsx-no-bind
                    onClick={() => choosePeriod(p)}
                  >
                    {t(PERIOD_KEY[p])}
                  </button>
                ))}
              </div>
              {period === 'custom' && (
                <div className="dtk-date-range">
                  <label className="dtk-date-field">
                    <span className="dtk-date-label">{t('period.customStart')}</span>
                    <input
                      type="date"
                      className="dtk-date-input"
                      value={customStart}
                      // eslint-disable-next-line react/jsx-no-bind
                      onChange={e => { setCustomStart(e.target.value); if (activeView !== null) saveViewLayout(activeView.id, { customStart: e.target.value }) }}
                    />
                  </label>
                  <span className="dtk-date-sep">—</span>
                  <label className="dtk-date-field">
                    <span className="dtk-date-label">{t('period.customEnd')}</span>
                    <input
                      type="date"
                      className="dtk-date-input"
                      value={customEnd}
                      // eslint-disable-next-line react/jsx-no-bind
                      onChange={e => { setCustomEnd(e.target.value); if (activeView !== null) saveViewLayout(activeView.id, { customEnd: e.target.value }) }}
                    />
                  </label>
                </div>
              )}
            </div>
            <div className="dtk-toolbar-group dtk-toolbar-right">
              <div className="dtk-seg-group" role="group">
                {VIEW_TYPES.map(v => (
                  <button
                    key={v}
                    type="button"
                    className="dtk-seg"
                    data-active={viewType === v}
                    aria-pressed={viewType === v}
                    // eslint-disable-next-line react/jsx-no-bind
                    onClick={() => chooseViewType(v)}
                  >
                    {t(VIEWTYPE_KEY[v])}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="dtk-scroll">
          {viewType === 'board' && (
            <div className="dtk-board">
              {TASK_STATUSES.map(status => {
                const tasks = filteredTasks.filter(task => task.status === status)
                return (
                  <section
                    key={status}
                    className="dtk-column"
                    data-status={status}
                    data-drop={dropTarget === status}
                    onDragOver={event => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      if (dropTarget !== status) setDropTarget(status)
                    }}
                    onDragLeave={() => {
                      setDropTarget(current => (current === status ? null : current))
                    }}
                    onDrop={event => {
                      event.preventDefault()
                      setDropTarget(null)
                      const taskId = event.dataTransfer.getData('text/plain')
                      const current = statusById.get(taskId)
                      if (current === undefined || current === status) return
                      void run(() => api.moveTask(taskId, status))
                    }}
                  >
                    <div className="dtk-column-head">
                      <span className="dtk-status-dot" data-status={status} aria-hidden />
                      <h3 className="dtk-column-title">{t(STATUS_KEY[status])}</h3>
                      <span className="dtk-column-count">{tasks.length}</span>
                    </div>
                    <div className="dtk-column-body">
                      {tasks.length === 0 && (
                        <div className="dtk-column-empty">{t('task.empty')}</div>
                      )}
                      {(() => {
                        const parents = tasks.filter(x => x.parentId === null)
                        const orphans = tasks.filter(x => x.parentId !== null && !parents.some(p => p.id === x.parentId))
                        return [...parents.map(task => (
                          <Fragment key={task.id}>
                            <TaskCard
                              task={task}
                              t={t}
                              employees={state!.employees}
                              onHover={() => hoverTaskLog(task)}
                              onHoverEnd={hoverEnd}
                              // eslint-disable-next-line react/jsx-no-bind
                              onClick={() => openTaskLog(task)}
                            />
                            {tasks.filter(sub => sub.parentId === task.id).map(sub => (
                              <div key={sub.id} className="dtk-subtask">
                                <TaskCard
                                  task={sub}
                                  t={t}
                                  employees={state!.employees}
                                  onHover={() => hoverTaskLog(sub)}
                                  onHoverEnd={hoverEnd}
                                  // eslint-disable-next-line react/jsx-no-bind
                                  onClick={() => openTaskLog(sub)}
                                />
                              </div>
                            ))}
                          </Fragment>
                        )), ...orphans.map(task => (
                          <div key={task.id} className="dtk-subtask">
                            <TaskCard
                              task={task}
                              t={t}
                              employees={state!.employees}
                              onHover={() => hoverTaskLog(task)}
                              onHoverEnd={hoverEnd}
                              // eslint-disable-next-line react/jsx-no-bind
                              onClick={() => openTaskLog(task)}
                            />
                          </div>
                        ))]
                      })()}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          {viewType === 'project' && (
            <OkrProjectView
              tasks={filteredTasks}
              objectives={state!.objectives}
              keyResults={state!.keyResults}
              t={t}
              employees={state!.employees}
              onOpenTaskLog={openTaskLog}
              onOpenSubjectLog={openSubjectLog}
              onHoverTaskLog={hoverTaskLog}
              onHoverSubjectLog={hoverSubjectLog}
              onHoverEnd={hoverEnd}
              onCreateSubtask={setSubtaskParent}
              expandIds={expandIds}
            />
          )}

          {viewType === 'gantt' && (
            <GanttView
              tasks={filteredTasks}
              t={t}
              employees={state!.employees}
              onOpenTaskLog={openTaskLog}
              onHoverTaskLog={hoverTaskLog}
              onHoverEnd={hoverEnd}
            />
          )}

          {/* 活动事件流按事件发生时间组织，不套用按截止日期的周期过滤；
              只做归属过滤（activeTasks 已含）。 */}
          {viewType === 'activity' && (
            <ActivityView
              tasks={activeTasks}
              t={t}
              onOpenTaskLog={openTaskLog}
              onHoverTaskLog={hoverTaskLog}
              onHoverEnd={hoverEnd}
            />
          )}

          {/* Agent 花名册是 registry 本地数据（非 Bitable），同样不消费周期；
              mutation 返回的权威 state 直接回写面板。 */}
          {viewType === 'agent' && (
            <AgentView
              agents={state!.agents}
              t={t}
              onState={applyState}
            />
          )}
          </div>

          {/* 任务日志板块：占界面下半部分（design/06 §3），.dtk-scroll 的
              兄弟节点；key 按主体 id 重挂载，草稿等内部状态卸载即弃。 */}
          {selectedSubject !== null && (
            <TaskLogPanel
              key={selectedSubject.id}
              subject={selectedSubject}
              deleted={subjectDeleted}
              employees={state?.employees ?? []}
              defaultAuthorId={activeView?.employeeId ?? null}
              t={t}
              initialFeed={logFeedCacheRef.current.get(feedKey(selectedSubject)) ?? null}
              onFeed={handleFeed}
              // eslint-disable-next-line react/jsx-no-bind
              onEdit={subject => {
                const task = state?.tasks.find(item => item.id === subject.id)
                if (task !== undefined) setEditingTask(task)
              }}
              // eslint-disable-next-line react/jsx-no-bind
              onDelivery={subject => {
                const task = state?.tasks.find(item => item.id === subject.id)
                if (task !== undefined) {
                  // Delivery is a concrete KR task, never its O/KR planning node.
                  void sidebarRight.openTab('devdelivery', {
                    params: { project: { id: task.id, name: task.title } },
                  })
                }
              }}
              // eslint-disable-next-line react/jsx-no-bind
              onOpenDoc={(projectId, document) => {
                void sidebarRight.openTab('devreviewer', {
                  params: { projectId, document },
                })
              }}
              onClose={() => setSelectedSubject(null)}
            />
          )}
        </Fragment>
      )}

      {creatingTask && activeView !== null && (
        <TaskEditDialog
          t={t}
          onCancel={() => setCreatingTask(false)}
          // eslint-disable-next-line react/jsx-no-bind
          onSubmit={async input => {
            setCreatingTask(false)
            await run(() => api.createTask({
              viewId: activeView.id,
              title: input.title,
              description: input.description,
              status: input.status,
              tags: input.tags,
            }))
          }}
        />
      )}

      {editingTask !== null && (
        <TaskEditDialog
          t={t}
          task={editingTask}
          onCancel={() => setEditingTask(null)}
          // eslint-disable-next-line react/jsx-no-bind
          onSubmit={async input => {
            const target = editingTask
            setEditingTask(null)
            await run(() => api.updateTask(target.id, {
              title: input.title,
              description: input.description,
              status: input.status,
              tags: input.tags,
            }))
          }}
          // eslint-disable-next-line react/jsx-no-bind
          onDelete={async () => {
            const target = editingTask
            if (!window.confirm(t('task.removeConfirm'))) return
            setEditingTask(null)
            await run(() => api.removeTask(target.id))
          }}
        />
      )}

      {/* 添加子任务（项目视图「＋」按钮）：host 解析父任务并继承 KR 归属，
          成功后按新旧差集定位新条目，展开其全部祖先链使其落在可视区。 */}
      {subtaskParent !== null && activeView !== null && (
        <SubtaskCreateDialog
          t={t}
          parent={subtaskParent}
          employees={state?.employees ?? []}
          onCancel={() => setSubtaskParent(null)}
          // eslint-disable-next-line react/jsx-no-bind
          onSubmit={async input => {
            const parent = subtaskParent
            setSubtaskParent(null)
            const prevIds = new Set((state?.tasks ?? []).map(task => task.id))
            try {
              const next = await api.createTask({
                viewId: activeView.id,
                parentId: parent.id,
                title: input.title,
                description: input.description,
                status: input.status,
                employeeId: input.employeeId,
                startDate: input.startDate,
                dueDate: input.dueDate,
                progress: input.progress,
              })
              applyState(next)
              setError(null)
              const fresh = next.tasks.find(task => !prevIds.has(task.id)) ?? null
              if (fresh !== null) {
                const byId = new Map(next.tasks.map(task => [task.id, task]))
                const chain = new Set<string>()
                let cursor: TaskRecord | undefined = fresh
                while (cursor !== undefined) {
                  chain.add(cursor.id)
                  cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
                }
                setExpandIds(chain)
              }
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : String(caught))
            }
          }}
        />
      )}
    </div>
  )
}