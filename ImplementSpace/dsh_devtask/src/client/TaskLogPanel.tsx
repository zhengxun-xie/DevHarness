/**
 * 任务日志板块：占插件界面下半部分的条件渲染面板（dsh-taskboard 详情面板模式）。
 *
 * 打开路径（全插件统一，见 design/06 §2）：点击 OKR 四层标题 / 看板卡片 /
 * 甘特任务行 / 活动流事件条目 → `selectedSubject` 置为目标主体；再次点击同
 * 一条目或右上角 ✕ 关闭。编辑弹窗与交付页跳转收进面板头部按钮。
 *
 * 数据流（design/06 §9）：
 *   - 挂载时 GET /logs 一次：`entries`（本地持久化条目，携带 sha 乐观锁
 *     令牌）+ `history`（record-history 物化的 system 条目，拉取失败降级为
 *     historyError 提示）；
 *   - 写操作（发布/编辑/删除）整体替换 `entries`（响应里的 sha 即刷新后的
 *     新令牌），`history` 会话内不变；
 *   - 两组合并按 createdAt 倒序渲染，最新在上（打开即停在最新，无需滚动）。
 *
 * 秒开路径：DevTaskPanel 持有会话缓存（hover 预取 / 同主体再次打开时通过
 * `initialFeed` 注入），命中则时间线即刻完整渲染、两阶段加载退化为一次
 * 静默后台刷新（host 端 60s TTL 缓存通常使其毫秒级返回）。
 *
 * composer（design/06 §4/§8.3，M9c）：默认收起为单行「写日志…」，点击展开
 * 多行 Markdown 编辑器 + 署名下拉 + 发布（body 空禁发布）。DevTask 没有登
 * 录身份，署名从员工名册选择（默认取激活视图绑定的员工），并以此充当「作
 * 者本人」判定——manual 条目只有署名人能编辑/删除（§11），system 条目一
 * 律只读。多端并发编辑由 sha256 乐观锁兜底，冲突提示刷新。
 *
 * 面板由 DevTaskPanel 以 `key={subject.id}` 重挂载，草稿等内部状态卸载即弃；
 * 主体从 state 全集消失时 DevTaskPanel 传 `deleted`，面板保留显示快照标题 +
 * 「已删除」徽章（时间线只剩本地条目，含删除事件）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  LogAuthorRef,
  LogSubjectKind,
  OkrEmployee,
  PersistedTaskLogEntry,
  TaskLogEntry,
} from '../protocol.ts'
import { api } from './api.ts'
import { DocRefPicker } from './DocRefPicker.tsx'
import { DOC_REF_SCHEME, parseDocRef } from './doc-ref.ts'

/** 日志主体引用：四层树的任意一层，title 为打开时的快照。 */
export interface TaskLogSubject {
  kind: LogSubjectKind
  id: string
  title: string
}

/** 日志面板的完整数据快照（DevTaskPanel 的会话缓存回写/秒开用）。 */
export interface TaskLogFeed {
  entries: PersistedTaskLogEntry[]
  history: TaskLogEntry[]
  historyError: string | null
}

export interface TaskLogPanelProps {
  subject: TaskLogSubject
  /** 主体已从 state 全集消失（被删）：头部显示徽章，编辑/交付/composer 隐藏。 */
  deleted: boolean
  /** 员工名册（三表负责人并集）：composer 署名下拉与「作者本人」判定来源。 */
  employees: OkrEmployee[]
  /** 默认署名（激活 individual 视图绑定的员工）；team 视图传 null，取名册第一个。 */
  defaultAuthorId: string | null
  t: TranslateNS<'devTaskLeft'>
  /**
   * 会话缓存命中时的初始数据（hover 预取或同主体再次打开）：时间线直接
   * 完整渲染、不显示 loading，完整请求转为静默后台刷新。
   */
  initialFeed: TaskLogFeed | null
  /** feed 数据落地时回写会话缓存（DevTaskPanel 持有，同主体再次打开秒开）。 */
  onFeed(feed: TaskLogFeed): void
  /** 头部「编辑」按钮：仅任务/子任务且未删除时出现，打开 TaskEditDialog。 */
  onEdit(subject: TaskLogSubject): void
  /** 头部「交付」按钮：仅任务级且未删除时出现，跳 DevDelivery。 */
  onDelivery(subject: TaskLogSubject): void
  /** 打开 devreviewer 文档深链（doc-ref 点击，design/06 §8.2）。 */
  onOpenDoc(projectId: string, document: string): void
  onClose(): void
}

const KIND_KEY: Record<LogSubjectKind, 'log.kind.objective' | 'log.kind.kr' | 'log.kind.task' | 'log.kind.subtask'> = {
  objective: 'log.kind.objective',
  kr: 'log.kind.kr',
  task: 'log.kind.task',
  subtask: 'log.kind.subtask',
}

/** MarkdownText 的 code 复制提示（沿 devreviewer ReviewDetail 惯例）。 */
const MARKDOWN_LABELS: MarkdownLabels = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
}

/** MM-dd HH:mm（本地时区，日志时间线的紧凑格式）。 */
function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 写操作错误文案：sha 冲突映射为可读提示，其余透传 host message。 */
function actionMessage(caught: unknown, t: TranslateNS<'devTaskLeft'>): string {
  const message = caught instanceof Error ? caught.message : String(caught)
  return message.includes('sha mismatch') ? t('log.conflict') : message
}

interface LogEntryRowProps {
  entry: PersistedTaskLogEntry | TaskLogEntry
  /** 当前署名（open_id）：manual 条目作者与之相同才显示编辑/删除（06 §4）。 */
  authorId: string | null
  /** 该条目处于编辑态（editingId 命中）。 */
  editing: boolean
  editDraft: string
  editError: string | null
  /** 该条目保存/删除请求进行中，按钮禁用防双击。 */
  busy: boolean
  t: TranslateNS<'devTaskLeft'>
  onStartEdit(entry: PersistedTaskLogEntry): void
  onEditDraftChange(value: string): void
  onSaveEdit(): void
  onCancelEdit(): void
  onRemove(entry: PersistedTaskLogEntry): void
}

/** 单条日志（时间线行）：manual 用 MarkdownText 渲染，system 纯文本。 */
function LogEntryRow({
  entry, authorId, editing, editDraft, editError, busy, t,
  onStartEdit, onEditDraftChange, onSaveEdit, onCancelEdit, onRemove,
}: LogEntryRowProps) {
  // `'sha' in entry` 把联合收窄到持久化条目（record-history 物化条目无 sha）。
  const persisted = 'sha' in entry ? entry : null
  const modifiable = persisted !== null && entry.kind === 'manual' && entry.author.id === authorId
  return (
    <li className="dtk-log-entry" data-kind={entry.kind}>
      <div className="dtk-log-entry-head">
        <span className="dtk-log-entry-dot" aria-hidden />
        <time className="dtk-log-entry-time" dateTime={entry.createdAt} title={entry.createdAt}>
          {stamp(entry.createdAt)}
        </time>
        <span className="dtk-log-entry-author">{entry.author.displayName}</span>
        {entry.updatedAt !== null && <span className="dtk-log-entry-edited" title={entry.updatedAt}>✎</span>}
        {modifiable && persisted !== null && !editing && (
          <span className="dtk-log-entry-actions">
            <button
              type="button"
              className="dtk-linkbtn"
              title={t('task.edit')}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => onStartEdit(persisted)}
            >
              ✎
            </button>
            <button
              type="button"
              className="dtk-linkbtn"
              title={t('log.removeEntry')}
              disabled={busy}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => onRemove(persisted)}
            >
              🗑
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="dtk-log-entry-editor">
          <textarea
            className="dtk-log-entry-editarea"
            value={editDraft}
            rows={Math.min(10, Math.max(3, editDraft.split('\n').length + 1))}
            autoFocus
            onChange={event => onEditDraftChange(event.target.value)}
          />
          {editError !== null && <p className="dtk-log-entry-error">{editError}</p>}
          <div className="dtk-log-entry-editor-actions">
            <button type="button" className="dtk-btn" onClick={onCancelEdit} disabled={busy}>
              {t('modal.cancel')}
            </button>
            <button
              type="button"
              className="dtk-btn"
              onClick={() => { void onSaveEdit() }}
              disabled={busy || editDraft.trim() === ''}
            >
              {t('task.save')}
            </button>
          </div>
        </div>
      ) : (
        <div className="dtk-log-entry-body">
          {entry.kind === 'manual'
            ? <MarkdownText text={entry.body} labels={MARKDOWN_LABELS} />
            : entry.body}
        </div>
      )}
    </li>
  )
}

/** 任务日志板块。 */
export function TaskLogPanel({
  subject, deleted, employees, defaultAuthorId, t, initialFeed, onFeed,
  onEdit, onDelivery, onOpenDoc, onClose,
}: TaskLogPanelProps) {
  // 本地持久化条目（manual + 本地 system 删除事件），写操作后整体替换。
  // 会话缓存命中时以缓存为初始值，时间线即刻完整渲染。
  const [entries, setEntries] = useState<PersistedTaskLogEntry[]>(() => initialFeed?.entries ?? [])
  // record-history 物化条目：只在挂载时拉一次，会话内不变（design/06 §9）。
  const [history, setHistory] = useState<TaskLogEntry[]>(() => initialFeed?.history ?? [])
  const [historyError, setHistoryError] = useState<string | null>(initialFeed?.historyError ?? null)
  // 缓存命中时数据已完整可见，后台刷新全程静默（不闪 loading 提示）。
  const [historyLoading, setHistoryLoading] = useState(initialFeed === null)
  const [loading, setLoading] = useState(initialFeed === null)
  const [error, setError] = useState<string | null>(null)

  // history 的 ref 镜像：写操作回写会话缓存时需要当前值（history 自完整
  // 拉取落地后不再变化，ref 与 state 同步维护）。
  const historyRef = useRef<TaskLogEntry[]>(initialFeed?.history ?? [])
  const historyErrRef = useRef<string | null>(initialFeed?.historyError ?? null)

  // composer（06 §4）：默认收起单行，点击展开；发布成功或取消后收起。
  const [draft, setDraft] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  // 署名（open_id）：默认取激活视图绑定的员工，不在名册或 team 视图时取第一个。
  const [authorId, setAuthorId] = useState<string | null>(() => {
    if (defaultAuthorId !== null && employees.some(e => e.id === defaultAuthorId)) return defaultAuthorId
    return employees[0]?.id ?? null
  })

  // manual 条目编辑/删除态（06 §4：作者本人可编辑/删除）。
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // 文档引用（06 §8.3）：composer 内嵌 DocRefPicker，光标暂存后插入链接。
  const [refPickerOpen, setRefPickerOpen] = useState(false)
  const draftRef = useRef<HTMLTextAreaElement | null>(null)
  const cursorRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })

  // Two-phase loading (06 §7): Phase 1 fetches local entries only (no
  // lark-cli, instant) so the timeline renders immediately; Phase 2 pulls
  // record-history in the background and merges when ready. With a session
  // cache hit the data is already fully on screen — Phase 1 is skipped and
  // Phase 2 becomes a silent refresh (host-side cache makes it instant when
  // fresh, or an in-place replacement when it had expired).
  const load = useCallback((): void => {
    // 缓存命中（数据已完整在屏）：刷新全程静默，不闪 loading 提示。
    const cached = initialFeed !== null
    if (!cached) {
      setLoading(true)
      setHistoryLoading(true)
    }
    setError(null)
    // Phase 1: local entries only — instant, no record-history lark-cli.
    // Skipped on cache hit: the full feed (entries + history) is on screen
    // and Phase 2's response already carries fresh local entries.
    if (!cached) {
      api.taskLogs(subject.id, subject.kind, subject.title, true)
        .then(feed => {
          setEntries(feed.entries)
          setLoading(false)
        })
        .catch(caught => {
          setError(caught instanceof Error ? caught.message : String(caught))
          setLoading(false)
          setHistoryLoading(false)
        })
    }
    // Phase 2: record-history — slow lark-cli, non-fatal on failure.
    api.taskLogs(subject.id, subject.kind, subject.title, false)
      .then(feed => {
        setEntries(feed.entries)
        setHistory(feed.history)
        setHistoryError(feed.historyError ?? null)
        historyRef.current = feed.history
        historyErrRef.current = feed.historyError ?? null
        setHistoryLoading(false)
        setLoading(false)
        onFeed({ entries: feed.entries, history: feed.history, historyError: feed.historyError ?? null })
      })
      .catch(caught => {
        const message = caught instanceof Error ? caught.message : String(caught)
        // 缓存数据已在屏：保留时间线只挂错误提示；否则清空（原行为）。
        if (!cached) setHistory([])
        setHistoryError(message)
        historyErrRef.current = message
        setHistoryLoading(false)
        setLoading(false)
      })
  }, [subject.id, subject.kind, subject.title, initialFeed, onFeed])

  // 面板按 subject.id 重挂载，挂载即拉取一次；无竞态窗口。
  useEffect(() => {
    void load()
  }, [load])

  /** 发布草稿（06 §9 POST /logs）：成功后清草稿收起，entries 整体替换。 */
  const publish = useCallback(async (): Promise<void> => {
    const body = draft.trim()
    if (body === '' || authorId === null || submitting) return
    const employee = employees.find(e => e.id === authorId)
    const author: LogAuthorRef = { type: 'user', id: authorId, displayName: employee?.name ?? authorId }
    setSubmitting(true)
    setComposerError(null)
    try {
      const feed = await api.createTaskLog({
        subjectId: subject.id,
        subjectKind: subject.kind,
        subjectTitle: subject.title,
        body,
        author,
      })
      setEntries(feed.entries)
      onFeed({ entries: feed.entries, history: historyRef.current, historyError: historyErrRef.current })
      setDraft('')
      setExpanded(false)
    } catch (caught) {
      setComposerError(actionMessage(caught, t))
    } finally {
      setSubmitting(false)
    }
  }, [draft, authorId, submitting, employees, subject.id, subject.kind, subject.title, onFeed, t])

  /** 打开文档引用选择器（onMouseDown preventDefault 防止 textarea 失焦，06 §8.3）。 */
  function openRefPicker(): void {
    const ta = draftRef.current
    if (ta !== null) cursorRef.current = { start: ta.selectionStart, end: ta.selectionEnd }
    setRefPickerOpen(true)
  }

  /** 在草稿光标处插入文档引用链接，requestAnimationFrame 恢复焦点（06 §8.3）。 */
  function insertDocRef(markdown: string): void {
    const { start, end } = cursorRef.current
    const next = draft.slice(0, start) + markdown + draft.slice(end)
    setDraft(next)
    setRefPickerOpen(false)
    requestAnimationFrame(() => {
      const ta = draftRef.current
      if (ta !== null) {
        ta.focus()
        const pos = start + markdown.length
        ta.setSelectionRange(pos, pos)
      }
    })
  }

  const startEdit = useCallback((entry: PersistedTaskLogEntry): void => {
    setEditingId(entry.id)
    setEditDraft(entry.body)
    setEditError(null)
  }, [])

  /** 保存编辑（sha 取当前 entries 快照，响应带回新 sha）。 */
  const saveEdit = useCallback(async (): Promise<void> => {
    const body = editDraft.trim()
    if (editingId === null || body === '' || busyId !== null) return
    const target = entries.find(e => e.id === editingId)
    if (target === undefined) return
    setBusyId(editingId)
    setEditError(null)
    try {
      const feed = await api.updateTaskLog({ id: editingId, body, sha: target.sha })
      setEntries(feed.entries)
      onFeed({ entries: feed.entries, history: historyRef.current, historyError: historyErrRef.current })
      setEditingId(null)
      setEditDraft('')
    } catch (caught) {
      setEditError(actionMessage(caught, t))
    } finally {
      setBusyId(null)
    }
  }, [editingId, editDraft, busyId, entries, onFeed, t])

  const cancelEdit = useCallback((): void => {
    if (busyId !== null) return
    setEditingId(null)
    setEditDraft('')
    setEditError(null)
  }, [busyId])

  const removeEntry = useCallback((entry: PersistedTaskLogEntry): void => {
    if (busyId !== null || !window.confirm(t('log.removeConfirm'))) return
    setBusyId(entry.id)
    setRemoveError(null)
    api.removeTaskLog({ id: entry.id, sha: entry.sha })
      .then(feed => {
        setEntries(feed.entries)
        onFeed({ entries: feed.entries, history: historyRef.current, historyError: historyErrRef.current })
        setBusyId(null)
      })
      .catch(caught => {
        setRemoveError(actionMessage(caught, t))
        setBusyId(null)
      })
  }, [busyId, onFeed, t])

  const timeline = [...entries, ...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const editable = !deleted && (subject.kind === 'task' || subject.kind === 'subtask')
  const deliverable = !deleted && subject.kind === 'task'

  return (
    <section className="dtk-logpanel" aria-label={t('log.close')}>
      <header className="dtk-logpanel-head">
        <span className="dtk-logpanel-kind" data-kind={subject.kind}>{t(KIND_KEY[subject.kind])}</span>
        <h2 className="dtk-logpanel-title" title={subject.title}>{subject.title}</h2>
        {deleted && <span className="dtk-logpanel-deleted">{t('log.deleted')}</span>}
        <span className="dtk-logpanel-meta">
          {t('log.count').replace('{n}', String(timeline.length))}
        </span>
        <div className="dtk-logpanel-actions">
          {editable && (
            <button
              type="button"
              className="dtk-btn"
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => onEdit(subject)}
            >
              {t('task.edit')}
            </button>
          )}
          {deliverable && (
            <button
              type="button"
              className="dtk-btn"
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => onDelivery(subject)}
            >
              {t('log.delivery')}
            </button>
          )}
          <button
            type="button"
            className="dtk-logpanel-close"
            aria-label={t('log.close')}
            title={t('log.close')}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </header>
      <div className="dtk-logpanel-body">
        {error !== null && (
          <p className="dtk-status" data-kind="error">
            {t('error.prefix')}: {error}
            {' '}
            <button type="button" className="dtk-linkbtn" onClick={() => { void load() }}>
              {t('error.reload')}
            </button>
          </p>
        )}
        {loading && timeline.length === 0 && <p className="dtk-logpanel-hint">{t('log.loading')}</p>}
        {!loading && error === null && timeline.length === 0 && (
          <p className="dtk-logpanel-hint">{t('log.empty')}</p>
        )}
        {historyError !== null && (
          <p className="dtk-logpanel-hint" data-kind="warn">{t('log.historyError')}</p>
        )}
        {historyLoading && (
          <p className="dtk-logpanel-hint">{t('log.historyLoading')}</p>
        )}
        {removeError !== null && (
          <p className="dtk-logpanel-hint" data-kind="warn">{removeError}</p>
        )}

        {!deleted && (
          <div className="dtk-log-composer">
            {!expanded ? (
              <button
                type="button"
                className="dtk-log-composer-collapsed"
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => { setExpanded(true); setComposerError(null) }}
              >
                ✍️ {t('log.write')}
              </button>
            ) : (
              <>
                <div className="dtk-log-composer-refrow">
                  <button
                    type="button"
                    className="dtk-linkbtn"
                    onMouseDown={event => event.preventDefault()}
                    onClick={openRefPicker}
                    disabled={submitting}
                  >
                    📎 {t('log.refDocButton')}
                  </button>
                </div>
                <textarea
                  ref={draftRef}
                  className="dtk-log-composer-area"
                  value={draft}
                  placeholder={t('log.write')}
                  rows={4}
                  autoFocus
                  onChange={event => setDraft(event.target.value)}
                />
                {refPickerOpen && (
                  <DocRefPicker
                    onInsert={insertDocRef}
                    onCancel={() => setRefPickerOpen(false)}
                    t={t}
                  />
                )}
                {composerError !== null && <p className="dtk-log-entry-error">{composerError}</p>}
                <div className="dtk-log-composer-actions">
                  <label className="dtk-log-composer-author">
                    {t('log.author')}
                    <select
                      value={authorId ?? ''}
                      onChange={event => setAuthorId(event.target.value)}
                      disabled={submitting}
                    >
                      {employees.map(employee => (
                        <option key={employee.id} value={employee.id}>{employee.name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="dtk-btn"
                    onClick={() => { setDraft(''); setComposerError(null); setExpanded(false) }}
                    disabled={submitting}
                  >
                    {t('modal.cancel')}
                  </button>
                  <button
                    type="button"
                    className="dtk-btn dtk-btn-primary"
                    onClick={() => { void publish() }}
                    disabled={submitting || draft.trim() === '' || authorId === null}
                  >
                    {t('log.publish')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <ul
          className="dtk-log-list"
          onClickCapture={event => {
            const anchor = (event.target as HTMLElement).closest('a')
            if (anchor === null) return
            const href = anchor.getAttribute('href') ?? ''
            if (!href.startsWith(DOC_REF_SCHEME)) return
            const target = parseDocRef(href)
            if (target === null) return
            event.preventDefault()
            onOpenDoc(target.projectId, target.document)
          }}
        >
          {timeline.map(entry => (
            <LogEntryRow
              key={entry.id}
              entry={entry}
              authorId={authorId}
              editing={editingId === entry.id}
              editDraft={editDraft}
              editError={editError}
              busy={busyId === entry.id}
              t={t}
              onStartEdit={startEdit}
              onEditDraftChange={setEditDraft}
              onSaveEdit={saveEdit}
              onCancelEdit={cancelEdit}
              onRemove={removeEntry}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}
