/**
 * Review list: four preset views (Open / In progress / Verify / Closed),
 * client-side type+severity filtering. Reviews are GROUPED BY DOCUMENT in the
 * order broadcast by the left panel's document tree (request 14.6/14.7):
 * each group carries a file-name header (basename of the document path) plus
 * a count badge and a manual expand/collapse chevron. The left panel's
 * collapsed state is mirrored into the list, but the header always stays so
 * collapsed groups can be re-expanded from the review panel itself.
 * Documents absent from the tree trail at the end; before the first tree
 * broadcast the list falls back to per-document groups.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DocTreeNode, ReviewSummary } from '../protocol.ts'
import type { TranslateFunction } from './format.ts'
import { formatTime, severityClass, severityLabel, statusLabel } from './format.ts'

export type ListViewKey = 'open' | 'inProgress' | 'verify' | 'closed' | 'all'

const VIEW_STATUS: Record<Exclude<ListViewKey, 'all'>, string[]> = {
  open: ['open', 'discussing', 'needs_review'],
  inProgress: ['accepted', 'implementing'],
  verify: ['implemented', 'verifying'],
  closed: ['resolved', 'rejected', 'duplicated'],
}

export const VIEW_TAB_KEYS: Record<ListViewKey, 'list.view.open' | 'list.view.inProgress' | 'list.view.verify' | 'list.view.closed' | 'list.view.all'> = {
  open: 'list.view.open',
  inProgress: 'list.view.inProgress',
  verify: 'list.view.verify',
  closed: 'list.view.closed',
  all: 'list.view.all',
}

export function statusesForView(view: ListViewKey): string[] | undefined {
  return view === 'all' ? undefined : VIEW_STATUS[view]
}

/** Within one document: document order (line, then document-scoped number). */
function compareInDocument(a: ReviewSummary, b: ReviewSummary): number {
  if (a.lineStart !== b.lineStart) return a.lineStart - b.lineStart
  return a.number - b.number
}

function baseName(documentPath: string): string {
  const slash = Math.max(documentPath.lastIndexOf('/'), documentPath.lastIndexOf('\\'))
  return slash >= 0 ? documentPath.slice(slash + 1) : documentPath
}

interface ReviewGroup {
  /** File path; used as the React key and for document-view navigation. */
  document: string
  /** Header label: basename of the document path (e.g. ProjectInfo.md). */
  title: string
  /** Tree node marked collapsed in the left panel (never true pre-broadcast). */
  collapsed: boolean
  reviews: ReviewSummary[]
}

export interface ReviewListProps {
  reviews: ReviewSummary[]
  /** Ordered document tree from the left panel; null before first broadcast. */
  docTree: DocTreeNode[] | null
  view: ListViewKey
  onViewChange: (view: ListViewKey) => void
  onOpen: (reviewId: string) => void
  t: TranslateFunction
}

export function ReviewList({ reviews, docTree, view, onViewChange, onOpen, t }: ReviewListProps): ReactNode {
  const groups = useMemo((): ReviewGroup[] => {
    // Bucket every visible review by its document.
    const byDocument = new Map<string, ReviewSummary[]>()
    for (const review of reviews) {
      const bucket = byDocument.get(review.document)
      if (bucket) bucket.push(review)
      else byDocument.set(review.document, [review])
    }

    const result: ReviewGroup[] = []
    const seen = new Set<string>()

    const pushGroup = (document: string, collapsed: boolean): void => {
      const bucket = byDocument.get(document)
      if (!bucket) return
      seen.add(document)
      result.push({
        document,
        title: baseName(document),
        collapsed,
        reviews: [...bucket].sort(compareInDocument),
      })
    }

    if (docTree !== null) {
      // Authoritative left-panel order; collapsed groups are still emitted so
      // their header (with count + chevron) stays visible in the panel.
      for (const node of docTree) {
        pushGroup(node.document, node.collapsed)
      }
      // Documents with reviews but no tree node (e.g. node registry changed):
      // preserve first-seen order under their own file names.
      for (const review of reviews) {
        if (!seen.has(review.document)) {
          pushGroup(review.document, false)
        }
      }
    } else {
      // Pre-broadcast fallback: group by first-seen document.
      for (const review of reviews) {
        if (!seen.has(review.document)) {
          pushGroup(review.document, false)
        }
      }
    }
    return result
  }, [reviews, docTree])

  // Manual overrides of the tree-collapsed state, keyed by document path.
  const [manualCollapsed, setManualCollapsed] = useState<Record<string, boolean>>({})
  // External collapsed value last observed per document; a transition (the
  // user collapsing/expanding the node in the left panel) drops that
  // document's local override so the two panels re-sync.
  const externalCollapsedRef = useRef<Map<string, boolean> | null>(null)

  useEffect(() => {
    const prev = externalCollapsedRef.current
    const current = new Map(groups.map(group => [group.document, group.collapsed]))
    externalCollapsedRef.current = current
    if (prev === null) return
    setManualCollapsed((overrides) => {
      let changed = false
      const next: Record<string, boolean> = { ...overrides }
      for (const key of Object.keys(next)) {
        if (prev.has(key) && prev.get(key) !== current.get(key)) {
          delete next[key]
          changed = true
        }
      }
      // Unchanged: return the same object identity so React skips the re-render.
      return changed ? next : overrides
    })
  }, [groups])

  const isCollapsed = (group: ReviewGroup): boolean =>
    Object.prototype.hasOwnProperty.call(manualCollapsed, group.document)
      ? manualCollapsed[group.document]
      : group.collapsed

  const toggleGroup = (group: ReviewGroup): void => {
    setManualCollapsed(prev => ({ ...prev, [group.document]: !isCollapsed(group) }))
  }

  return (
    <div>
      <div className="dbr-tabs" role="tablist">
        {(Object.keys(VIEW_TAB_KEYS) as ListViewKey[]).map(key => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={view === key ? 'dbr-active' : undefined}
            onClick={() => onViewChange(key)}
          >
            {t(VIEW_TAB_KEYS[key])}
          </button>
        ))}
      </div>

      {reviews.length === 0
        ? (
            <div className="dbr-empty">
              <div>{t('list.empty')}</div>
              <div className="dbr-empty-hint">{t('list.emptyHint')}</div>
            </div>
          )
        : (
            <div className="dbr-list">
              {groups.map(group => {
                const collapsed = isCollapsed(group)
                return (
                  <div key={group.document} className="dbr-doc-group">
                    {/* Whole header toggles expand/collapse, mirroring the left
                        panel's node rows; the chevron is a visual indicator. */}
                    <div
                      className="dbr-doc-group-head"
                      role="button"
                      tabIndex={0}
                      aria-expanded={!collapsed}
                      title={collapsed ? t('list.groupExpand') : t('list.groupCollapse')}
                      // eslint-disable-next-line react/jsx-no-bind
                      onClick={() => toggleGroup(group)}
                      // eslint-disable-next-line react/jsx-no-bind
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggleGroup(group)
                        }
                      }}
                    >
                      <span
                        className={`dbr-doc-group-toggle${collapsed ? ' dbr-collapsed' : ''}`}
                        aria-hidden
                      >
                        <svg viewBox="0 0 10 10" width="9" height="9">
                          <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="dbr-doc-group-name" title={group.document}>{group.title}</span>
                      <span className="dbr-doc-group-count">{group.reviews.length}</span>
                    </div>
                    {!collapsed && group.reviews.map(review => (
                      <ReviewCard
                        key={review.reviewId}
                        review={review}
                        onOpen={() => onOpen(review.reviewId)}
                        t={t}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}

interface ReviewCardProps {
  review: ReviewSummary
  onOpen: () => void
  t: TranslateFunction
}

function ReviewCard({ review, onOpen, t }: ReviewCardProps): ReactNode {
  return (
    <div
      className={`dbr-card dbr-card-sev-${review.severity}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }}
    >
      <div className="dbr-card-title">
        <b className={`dbr-title-num dbr-num-sev-${review.severity}`}>{review.number}</b>
        {' '}{review.title ?? t('list.untitled')}
      </div>
      <div className="dbr-card-row">
        <span className={`dbr-pill ${severityClass(review.severity)}`}>{severityLabel(t, review.severity)}</span>
        <span className="dbr-pill dbr-status">{statusLabel(t, review.status)}</span>
        <span className="dbr-pill dbr-status">{t(`type.${review.type}`)}</span>
        <span style={{ flex: 1 }} />
        <span className="dbr-card-loc">{formatTime(review.updatedAt)}</span>
      </div>
    </div>
  )
}
