/**
 * Reviewer right-Sidebar tab body (design/02 §4, design/04). Owns the
 * project choice, the four preset list views, and the list → detail /
 * inline-document / composer routing.
 *
 * Refresh model (M1): load on mount, on tab (re)navigation, on
 * document visibility regain, and on cross-barrier messages — no polling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { api } from './api.ts'
import { onDevBuddyMessage, postCaretRequest, postDocTreeRequest, postReviewChanged } from './messages.ts'
import type { TranslateFunction } from './format.ts'
import { ReviewList, statusesForView } from './ReviewList.tsx'
import type { ListViewKey } from './ReviewList.tsx'
import { ReviewDetail } from './ReviewDetail.tsx'
import { DocumentReviewView } from './DocumentReviewView.tsx'
import { ReviewComposer } from './ReviewComposer.tsx'
import type { ComposerDraft } from './ReviewComposer.tsx'
import type {
  DocTreeNode,
  ProjectsResponse,
  ReviewAnchorDraft,
  ReviewSummary,
} from '../protocol.ts'

export const REVIEWER_NS = 'devReviewer'
export const REVIEWER_TAB_KIND = 'devreviewer'

/** Navigation parameters merged into SidebarRightTabParamsMap in index.tsx. */
export interface ReviewerTabParams {
  view?: ListViewKey
  projectId?: string
  reviewId?: string
  document?: string
  /** Inline "add review" entry: open the composer with this anchor draft. */
  draftAnchor?: ReviewAnchorDraft
}

type Route =
  | { name: 'list' }
  | { name: 'detail'; reviewId: string }
  | { name: 'document'; document: string; reviewId: string | null; rebindFor?: string | null; focusLineStart?: number; focusLineEnd?: number }
  | { name: 'composer'; draft: ComposerDraft }

export type ReviewerPanelProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof REVIEWER_NS>

export function ReviewerPanel({ t, useTabInfo }: ReviewerPanelProps): ReactNode {
  const tabInfo = useTabInfo()
  const params = (tabInfo.tab.navigation.params ?? {}) as ReviewerTabParams
  const revision = tabInfo.tab.navigation.revision

  const [projects, setProjects] = useState<ProjectsResponse['projects']>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ListViewKey>(params.view ?? 'open')
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [refreshSignal, setRefreshSignal] = useState(0)
  /**
   * Ordered document tree broadcast by the left panel (request 14.6/14.7):
   * drives list grouping/ordering and hides collapsed documents' reviews.
   * Null until the first broadcast — the list then falls back to its own
   * document grouping without hiding anything.
   */
  const [docTree, setDocTree] = useState<DocTreeNode[] | null>(null)
  /** Transient hint while a CARET request finds no focused left editor. */
  const [caretHint, setCaretHint] = useState<string | null>(null)
  /** Bump so a second click after a failed lookup retries the hint timer. */
  const caretNonceRef = useRef(0)

  const loadProjects = useCallback(async (): Promise<void> => {
    const response = await api.listProjects()
    setProjects(response.projects)
    const active = response.projects.find(p => p.active) ?? response.projects[0]
    if (active) {
      if (!active.active) await api.activateProject(active.id)
      setActiveProjectId(active.id)
    } else {
      setActiveProjectId(null)
    }
  }, [])

  const loadReviews = useCallback(async (): Promise<void> => {
    if (!activeProjectId) {
      setReviews([])
      setLoading(false)
      return
    }
    try {
      const response = await api.listReviews({ projectId: activeProjectId })
      setReviews(response.reviews)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [activeProjectId])

  // Initial project bootstrap.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadProjects()
      .then(() => {
        if (cancelled) return
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [loadProjects])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews, refreshSignal])

  // Deep-link navigation arriving from other panels (e.g. the left gutter).
  useEffect(() => {
    const targetProject = params.projectId
    if (targetProject && targetProject !== activeProjectId) {
      void api.activateProject(targetProject).then(() => {
        setActiveProjectId(targetProject)
        setRefreshSignal(signal => signal + 1)
      })
    }
    if (params.view) setView(params.view)
    if (params.draftAnchor && params.projectId && params.document) {
      setRoute({
        name: 'composer',
        draft: {
          projectId: params.projectId,
          document: params.document,
          anchor: params.draftAnchor,
        },
      })
    } else if (params.reviewId && params.document) {
      setRoute({ name: 'document', document: params.document, reviewId: params.reviewId })
    } else if (params.reviewId) {
      setRoute({ name: 'detail', reviewId: params.reviewId })
    } else if (params.document) {
      setRoute({ name: 'document', document: params.document, reviewId: null })
    }
    // revision intentionally the only dependency: act on each navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  // Fetch the left panel's document tree on mount / project switch: the
  // request-reply handshake covers a Reviewer opening after the left's
  // best-effort broadcasts (the second request catches a left still loading).
  useEffect(() => {
    if (!activeProjectId) return
    setDocTree(null)
    postDocTreeRequest(activeProjectId)
    const timer = window.setTimeout(() => postDocTreeRequest(activeProjectId), 500)
    return () => window.clearTimeout(timer)
  }, [activeProjectId])

  // Cross-barrier: review-change notices refresh the list; a left-panel
  // project switch moves the Reviewer onto the same project; caret answers
  // open the composer. Inline selections arrive via openTab params; legacy
  // DEVBUDDY_SELECTION messages from an un-refreshed left panel are
  // deliberately ignored (design/05 §2.1).
  useEffect(() => {
    return onDevBuddyMessage(message => {
      if (message.type === 'DEVBUDDY_SELECTION') return
      // The left panel switched projects (browser-style tab strip): follow it
      // so both panels share one active project. Must run BEFORE the foreign
      // -project filter below — its projectId intentionally differs.
      if (message.type === 'DEVBUDDY_PROJECT_SWITCH') {
        if (message.projectId !== activeProjectId) void switchProject(message.projectId)
        return
      }
      if (activeProjectId && message.projectId !== activeProjectId) return
      if (message.type === 'DEVBUDDY_DOC_TREE') {
        setDocTree(message.nodes)
        return
      }
      if (message.type === 'DEVBUDDY_CARET') {
        // Focused left editor answered: open the composer with a point anchor.
        caretNonceRef.current += 1
        setCaretHint(null)
        setRoute({
          name: 'composer',
          draft: {
            projectId: message.projectId,
            document: message.document,
            anchor: message.anchor,
          },
        })
        return
      }
      setRefreshSignal(signal => signal + 1)
    })
  }, [activeProjectId])

  // Quick action: ask the left panel for a zero-length anchor at the focused
  // edit-mode caret. Two requests cover a left still loading; no answer means
  // no editor owns focus, so surface a short hint under the action module.
  const requestCaretComment = useCallback((): void => {
    if (!activeProjectId) return
    const nonce = caretNonceRef.current + 1
    caretNonceRef.current = nonce
    setCaretHint(null)
    postCaretRequest(activeProjectId)
    window.setTimeout(() => postCaretRequest(activeProjectId), 300)
    window.setTimeout(() => {
      if (caretNonceRef.current === nonce) setCaretHint(t('actions.addCommentHint'))
    }, 800)
    window.setTimeout(() => {
      if (caretNonceRef.current === nonce) setCaretHint(null)
    }, 5000)
  }, [activeProjectId, t])

  // Refresh when the user returns to the tab/window.
  useEffect(() => {
    function onVisible(): void {
      if (document.visibilityState === 'visible') setRefreshSignal(signal => signal + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const visibleReviews = useMemo(() => {
    const allowed = statusesForView(view)
    if (!allowed) return reviews
    const allowedSet = new Set(allowed)
    return reviews.filter(review => allowedSet.has(review.status))
  }, [reviews, view])

  const criticalOpen = useMemo(
    () => reviews.filter(r => r.severity === 'critical'
      && r.status !== 'resolved' && r.status !== 'rejected' && r.status !== 'duplicated').length,
    [reviews],
  )

  async function switchProject(id: string): Promise<void> {
    setLoading(true)
    await api.activateProject(id)
    setActiveProjectId(id)
    setRoute({ name: 'list' })
    setRefreshSignal(signal => signal + 1)
  }

  function notifyChanged(document: string, reviewIds: string[]): void {
    if (!activeProjectId) return
    postReviewChanged({ projectId: activeProjectId, document, reviewIds })
  }

  async function submitReview(input: {
    draft: ComposerDraft
    type: ReviewSummary['type']
    severity: ReviewSummary['severity']
    title: string
    comment: string
    proposal: string
    tags: string[]
    relatedParties: ReviewSummary['relatedParties']
  }): Promise<void> {
    const response = await api.createReview({
      projectId: input.draft.projectId,
      document: input.draft.document,
      target: input.draft.anchor,
      type: input.type,
      severity: input.severity,
      title: input.title.trim() || undefined,
      comment: input.comment,
      proposal: input.proposal.trim() || undefined,
      tags: input.tags,
      relatedParties: input.relatedParties,
      documentSha: null,
    })
    notifyChanged(input.draft.document, [response.review.reviewId])
    setRefreshSignal(signal => signal + 1)
    setRoute({ name: 'detail', reviewId: response.review.reviewId })
  }

  if (loading && activeProjectId === null && projects.length === 0) {
    return <div className="dbr-loading">{t('panel.loading')}</div>
  }
  if (projects.length === 0) {
    return (
      <div className="dbr-root">
        <Header t={t} />
        <div className="dbr-empty">{t('panel.noProjects')}</div>
        <div className="dbr-detail-meta">{t('panel.noProjectsHint')}</div>
      </div>
    )
  }

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  return (
    <div className="dbr-root">
      <Header t={t} />

      <div className="dbr-project-select">
        <select
          value={activeProjectId ?? ''}
          onChange={event => void switchProject(event.target.value)}
        >
          {projects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        {activeProject && (
          <span className="dbr-project-meta">
            {t('project.openCount', { count: activeProject.openCount })}
            {' · '}
            {activeProject.workspaceLinked ? t('project.workspaceLinked') : t('project.workspaceUnlinked')}
          </span>
        )}
      </div>

      <div className="dbr-quick-actions">
        <span className="dbr-quick-actions-title">{t('actions.title')}</span>
        <button
          type="button"
          className="dbr-quick-action-btn"
          // Same document as the left editor: the default mousedown would
          // move focus to this button and blur the textarea before the click
          // fires, so the CARET handshake would find no focused editor.
          onMouseDown={event => event.preventDefault()}
          onClick={requestCaretComment}
        >
          {t('actions.addComment')}
        </button>
        {caretHint !== null && <span className="dbr-quick-actions-hint">{caretHint}</span>}
      </div>

      {criticalOpen > 0 && (
        <div className="dbr-critical-banner">
          {t('panel.criticalWarning', { count: criticalOpen })}
        </div>
      )}

      {error !== null && route.name === 'list' && <div className="dbr-error">{error}</div>}

      {route.name === 'list' && activeProjectId && (
        <>
          <ReviewList
            reviews={visibleReviews}
            docTree={docTree}
            view={view}
            onViewChange={setView}
            onOpen={reviewId => setRoute({ name: 'detail', reviewId })}
            t={t}
          />
          <div className="dbr-actions">
            <button type="button" onClick={() => setRefreshSignal(s => s + 1)}>
              {t('panel.refresh')}
            </button>
          </div>
        </>
      )}

      {route.name === 'detail' && activeProjectId && (
        <ReviewDetail
          projectId={activeProjectId}
          reviewId={route.reviewId}
          siblings={reviews}
          docTree={docTree}
          refreshSignal={refreshSignal}
          onBack={() => setRoute({ name: 'list' })}
          onChanged={document => {
            notifyChanged(document, [route.reviewId])
            setRefreshSignal(signal => signal + 1)
          }}
          onOpenDocument={(document, reviewId, focusLineStart, focusLineEnd) =>
            setRoute({ name: 'document', document, reviewId, focusLineStart, focusLineEnd })}
          onRebind={(document, reviewId) =>
            setRoute({ name: 'document', document, reviewId: null, rebindFor: reviewId })}
          t={t}
        />
      )}

      {route.name === 'document' && activeProjectId && (
        <DocumentReviewView
          projectId={activeProjectId}
          document={route.document}
          initialReviewId={route.reviewId}
          refreshSignal={refreshSignal}
          rebindFor={route.rebindFor ?? null}
          focusLineStart={route.focusLineStart}
          focusLineEnd={route.focusLineEnd}
          onBack={() => setRoute({ name: 'list' })}
          onOpenReview={reviewId => setRoute({ name: 'detail', reviewId })}
          onCompose={draft => setRoute({ name: 'composer', draft })}
          onRebindDone={rebindId => {
            notifyChanged(route.document, [rebindId])
            setRefreshSignal(signal => signal + 1)
            setRoute({ name: 'detail', reviewId: rebindId })
          }}
          t={t}
        />
      )}

      {route.name === 'composer' && activeProjectId && (
        <ReviewComposer
          draft={route.draft}
          docTree={docTree}
          onSubmit={submitReview}
          onCancel={() => setRoute({ name: 'list' })}
          t={t}
        />
      )}
    </div>
  )
}

function Header({ t }: { t: TranslateFunction }): ReactNode {
  return <div className="dbr-header">{t('panel.title')}</div>
}
