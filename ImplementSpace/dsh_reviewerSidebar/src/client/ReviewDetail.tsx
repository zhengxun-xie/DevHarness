/**
 * Review detail: anchor snapshot + live anchor resolution, original
 * comment/proposal, append-only discussion thread, status-machine actions,
 * delete, and Send-to-Agent entry (design/03, 05 §4, 06, 07).
 *
 * Optimistic locking: GET /review carries no sha; the first write omits
 * expectedSha and every append/transition response returns the fresh sha,
 * which subsequent writes echo back. 409 surfaces the mandated
 * "content changed, refresh and retry" message.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { api } from './api.ts'
import type { TranslateFunction } from './format.ts'
import {
  anchorLabel,
  anchorNoteClass,
  formatTime,
  severityClass,
  severityLabel,
  statusLabel,
} from './format.ts'
import { TransitionDialog } from './TransitionDialog.tsx'
import type { TransitionRequest } from './TransitionDialog.tsx'
import { AgentPreview } from './AgentPreview.tsx'
import { REVIEW_TYPES, SEVERITIES } from '../protocol.ts'
import type {
  AnchorResolution,
  ReviewRecord,
  ReviewStatus,
  ReviewSummary,
  ReviewType,
  Severity,
  ThreadEntry,
} from '../protocol.ts'

type PlainActionKey =
  | 'transition.accept'
  | 'transition.needsReview'
  | 'transition.backToOpen'
  | 'transition.backToDiscussing'
  | 'transition.startImplementing'
  | 'transition.markImplemented'
  | 'transition.failVerification'
  | 'transition.resolve'

/** Statuses reachable without extra input (plain transition buttons). */
const PLAIN_ACTIONS: Partial<Record<ReviewStatus, Array<{ to: ReviewStatus; key: PlainActionKey }>>> = {
  open: [
    { to: 'accepted', key: 'transition.accept' },
    { to: 'needs_review', key: 'transition.needsReview' },
  ],
  discussing: [
    { to: 'open', key: 'transition.backToOpen' },
    { to: 'needs_review', key: 'transition.needsReview' },
    { to: 'accepted', key: 'transition.accept' },
  ],
  needs_review: [
    { to: 'discussing', key: 'transition.backToDiscussing' },
  ],
  accepted: [
    { to: 'implementing', key: 'transition.startImplementing' },
    { to: 'discussing', key: 'transition.backToDiscussing' },
  ],
  implementing: [
    { to: 'implemented', key: 'transition.markImplemented' },
    { to: 'discussing', key: 'transition.backToDiscussing' },
  ],
  implemented: [
    { to: 'implementing', key: 'transition.failVerification' },
  ],
  verifying: [
    { to: 'resolved', key: 'transition.resolve' },
    { to: 'implementing', key: 'transition.failVerification' },
    { to: 'needs_review', key: 'transition.needsReview' },
  ],
}

const REMOVABLE: ReadonlySet<ReviewStatus> = new Set(['open', 'rejected', 'duplicated'])
const TERMINAL: ReadonlySet<ReviewStatus> = new Set(['resolved', 'rejected', 'duplicated'])

export interface ReviewDetailProps {
  projectId: string
  reviewId: string
  /** All current-project summaries, used to populate the duplicate picker. */
  siblings: ReviewSummary[]
  refreshSignal: number
  onBack: () => void
  onChanged: (document: string) => void
  onOpenDocument: (document: string, reviewId: string | null) => void
  t: TranslateFunction
}

interface DialogState {
  to: ReviewStatus
  kind: 'reject' | 'duplicate' | 'verify' | 'failVerify'
}

export function ReviewDetail({
  projectId,
  reviewId,
  siblings,
  refreshSignal,
  onBack,
  onChanged,
  onOpenDocument,
  t,
}: ReviewDetailProps): ReactNode {
  const [review, setReview] = useState<ReviewRecord | null>(null)
  const [resolution, setResolution] = useState<AnchorResolution | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sha, setSha] = useState<string | undefined>(undefined)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [editingComment, setEditingComment] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [proposalDraft, setProposalDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [severityDraft, setSeverityDraft] = useState<Severity>('minor')
  const [typeDraft, setTypeDraft] = useState<ReviewType>('suggestion')
  const [tagsDraft, setTagsDraft] = useState('')

  const markdownLabels: MarkdownLabels = {
    code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
    footnotes: 'Footnotes',
  }

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.getReview(projectId, reviewId)
      setReview(response.review)
      setResolution(response.anchorResolution)
      setSha(undefined)
      setConflict(false)
      setEditingComment(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId, reviewId])

  useEffect(() => {
    void load()
  }, [load, refreshSignal])

  async function runTransition(request: TransitionRequest): Promise<void> {
    if (review === null) return
    setBusy(true)
    setError(null)
    try {
      const response = await api.transitionReview({
        projectId,
        reviewId,
        to: request.to,
        reason: request.reason,
        duplicatedOf: request.duplicatedOf,
        decisionSummary: request.decisionSummary,
        evidence: request.evidence,
        expectedSha: sha ?? null,
      })
      setReview(response.review)
      setSha(response.sha)
      setDialog(null)
    } catch (err) {
      if (err instanceof Error && /409|conflict|updated/i.test(err.message)) setConflict(true)
      throw err
    } finally {
      setBusy(false)
    }
  }

  async function appendReply(): Promise<void> {
    if (review === null || reply.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const response = await api.appendReview({
        projectId,
        reviewId,
        body: reply.trim(),
        expectedSha: sha ?? null,
      })
      setReview(response.review)
      setSha(response.sha)
      setReply('')
    } catch (err) {
      if (err instanceof Error && /409|conflict|updated/i.test(err.message)) setConflict(true)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Save the full edit form (meta + wording); keeps the editor open on failure. */
  async function saveCommentEdit(): Promise<void> {
    if (review === null) return
    const comment = commentDraft.trim()
    if (comment === '') return
    setBusy(true)
    setError(null)
    try {
      const response = await api.editReview({
        projectId,
        reviewId,
        comment,
        proposal: proposalDraft.trim(),
        title: titleDraft.trim(),
        severity: severityDraft,
        type: typeDraft,
        tags: tagsDraft.split(',').map(tag => tag.trim()).filter(tag => tag !== ''),
        expectedSha: sha ?? null,
      })
      setReview(response.review)
      setSha(response.sha)
      setEditingComment(false)
      // Severity/type/title changes affect list pills and left-panel marks.
      onChanged(review.document)
    } catch (err) {
      if (err instanceof Error && /409|conflict|updated/i.test(err.message)) setConflict(true)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Save one thread entry edit; returns success so the item can close its editor. */
  async function saveEntryEdit(entryId: string, body: string): Promise<boolean> {
    if (review === null || body.trim() === '') return false
    setBusy(true)
    setError(null)
    try {
      const response = await api.editThreadEntry({
        projectId,
        reviewId,
        entryId,
        body: body.trim(),
        expectedSha: sha ?? null,
      })
      setReview(response.review)
      setSha(response.sha)
      return true
    } catch (err) {
      if (err instanceof Error && /409|conflict|updated/i.test(err.message)) setConflict(true)
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (review === null) return
    if (!window.confirm(t('detail.removeConfirm'))) return
    setBusy(true)
    try {
      await api.removeReview({ projectId, reviewId })
      onChanged(review.document)
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  if (loading) return <div className="dbr-loading">{t('panel.loading')}</div>
  if (review === null) {
    return (
      <div>
        <button type="button" onClick={onBack}>← {t('detail.back')}</button>
        <div className="dbr-error">{error}</div>
      </div>
    )
  }

  const terminal = TERMINAL.has(review.status)
  const actions = PLAIN_ACTIONS[review.status] ?? []
  const canSendAgent = review.status === 'accepted' || review.status === 'open'
  const canRemove = REMOVABLE.has(review.status)
  const duplicates = siblings.filter(item => item.reviewId !== reviewId)
  const anchor = review.target

  return (
    <div>
      <div className="dbr-crumbs">
        <button type="button" onClick={onBack}>← {t('detail.back')}</button>
        <span className="dbr-detail-id">
          <b className={`dbr-title-num dbr-num-sev-${review.severity}`}>{review.number}</b>
          {' '}{review.reviewId}
        </span>
      </div>

      {conflict && <div className="dbr-toast dbr-bad">{t('detail.error.conflict')} <a onClick={() => void load()}>{t('panel.refresh')}</a></div>}
      {error !== null && !conflict && <div className="dbr-error">{error}</div>}

      <div className="dbr-detail-head">
        <div className="dbr-detail-title">{review.title ?? t('list.untitled')}</div>
        <div className="dbr-card-row">
          <span className={`dbr-pill ${severityClass(review.severity)}`}>{severityLabel(t, review.severity)}</span>
          <span className="dbr-pill dbr-status">{statusLabel(t, review.status)}</span>
          <span className="dbr-pill dbr-status">{t(`type.${review.type}`)}</span>
          {review.tags.map(tag => <span key={tag} className="dbr-pill dbr-tag">#{tag}</span>)}
        </div>
        <div className="dbr-detail-meta">
          {t('detail.author')}: {review.author} · {formatTime(review.createdAt)}
        </div>
        {review.assignee !== null && (
          <div className="dbr-detail-meta">
            {t('detail.agentSession')}: <b>{review.assignee}</b>
          </div>
        )}
        <div className="dbr-detail-meta">
          <a
            className="dbr-detail-doc"
            onClick={() => onOpenDocument(review.document, review.reviewId)}
          >{review.document}</a>
          {anchor.structural.headingPath.length > 0 ? ` · ${anchor.structural.headingPath.join(' / ')}` : ''}
          {' · '}{anchor.positional.lineStart === anchor.positional.lineEnd
            ? `L${anchor.positional.lineStart}`
            : `L${anchor.positional.lineStart}–${anchor.positional.lineEnd}`}
        </div>
      </div>

      {resolution !== null && <AnchorNote resolution={resolution} t={t} />}

      <div className="dbr-section-label">{t('anchor.snapshot')}</div>
      <div className="dbr-quote">{anchor.textual.selectedText}</div>

      <div className="dbr-section-label">
        {t('detail.comment')}
        {review.commentEditedAt !== undefined && (
          <span className="dbr-edited-mark">{t('detail.edited')}</span>
        )}
        {!terminal && !editingComment && (
          <button
            type="button"
            className="dbr-edit-btn"
            disabled={busy}
            onClick={() => {
              setTitleDraft(review.title ?? '')
              setSeverityDraft(review.severity)
              setTypeDraft(review.type)
              setTagsDraft(review.tags.join(', '))
              setCommentDraft(review.comment)
              setProposalDraft(review.proposal)
              setEditingComment(true)
            }}
          >{t('detail.edit')}</button>
        )}
      </div>
      {editingComment ? (
        <div className="dbr-edit-form">
          <div className="dbr-field-row">
            <div className="dbr-field">
              <label>{t('composer.type')}</label>
              <select value={typeDraft} onChange={event => setTypeDraft(event.target.value as ReviewType)}>
                {REVIEW_TYPES.map(value => (
                  <option key={value} value={value}>{t(`type.${value}`)}</option>
                ))}
              </select>
            </div>
            <div className="dbr-field">
              <label>{t('composer.severity')}</label>
              <select value={severityDraft} onChange={event => setSeverityDraft(event.target.value as Severity)}>
                {SEVERITIES.map(value => (
                  <option key={value} value={value}>{t(`severity.${value}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="dbr-field">
            <label>{t('composer.title')}</label>
            <input
              value={titleDraft}
              placeholder={t('composer.titlePlaceholder')}
              onChange={event => setTitleDraft(event.target.value)}
            />
          </div>
          <div className="dbr-field">
            <label>{t('composer.tags')}（{t('composer.tagsHint')}）</label>
            <input value={tagsDraft} onChange={event => setTagsDraft(event.target.value)} />
          </div>
          <div className="dbr-field">
            <label>{t('detail.comment')}</label>
            <textarea
              rows={6}
              value={commentDraft}
              onChange={event => setCommentDraft(event.target.value)}
            />
          </div>
          <div className="dbr-field">
            <label>{t('detail.proposal')}</label>
            <textarea
              rows={3}
              value={proposalDraft}
              onChange={event => setProposalDraft(event.target.value)}
            />
          </div>
          <div className="dbr-edit-actions">
            <button
              type="button"
              className="dbr-primary"
              disabled={busy || commentDraft.trim() === ''}
              onClick={() => void saveCommentEdit()}
            >{t('detail.saveEdit')}</button>
            <button type="button" disabled={busy} onClick={() => setEditingComment(false)}>
              {t('detail.cancelEdit')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="dbr-md">
            <MarkdownText text={review.comment} labels={markdownLabels} />
          </div>
          {review.proposal !== '' && (
            <>
              <div className="dbr-section-label">{t('detail.proposal')}</div>
              <div className="dbr-md">
                <MarkdownText text={review.proposal} labels={markdownLabels} />
              </div>
            </>
          )}
        </>
      )}

      {review.duplicatedOf !== null && (
        <div className="dbr-detail-meta">
          {t('detail.duplicatedOf')}: <a onClick={() => onOpenDocument(review.document, review.duplicatedOf)}>
            {review.duplicatedOf}
          </a>
        </div>
      )}

      <div className="dbr-section-label">{t('detail.thread')}</div>
      <div className="dbr-thread">
        {review.thread.entries.map(entry => (
          <ThreadItem
            key={entry.id}
            entry={entry}
            canEdit={!terminal}
            busy={busy}
            onSaveEdit={saveEntryEdit}
            t={t}
          />
        ))}
      </div>

      {terminal
        ? <div className="dbr-detail-meta" style={{ marginTop: 8 }}>{t('detail.terminalReadonly')}</div>
        : (
            <div className="dbr-reply-row">
              <textarea
                value={reply}
                placeholder={t('detail.replyPlaceholder')}
                onChange={event => setReply(event.target.value)}
              />
              <button type="button" className="dbr-primary" disabled={busy || reply.trim() === ''}
                onClick={() => void appendReply()}>{t('detail.reply')}</button>
            </div>
          )}

      <div className="dbr-actions">
        {actions.map(action => (
          <button
            key={action.to}
            type="button"
            disabled={busy}
            onClick={() => {
              if (action.to === 'resolved') void runTransition({ to: 'resolved' })
              else void runTransition({ to: action.to })
            }}
          >{t(action.key)}</button>
        ))}
        {(review.status === 'open' || review.status === 'discussing' || review.status === 'needs_review') && (
          <>
            <button type="button" disabled={busy}
              onClick={() => setDialog({ to: 'rejected', kind: 'reject' })}>
              {t('transition.reject')}
            </button>
            <button type="button" disabled={busy || duplicates.length === 0}
              onClick={() => setDialog({ to: 'duplicated', kind: 'duplicate' })}>
              {t('transition.duplicate')}
            </button>
          </>
        )}
        {review.status === 'implemented' && (
          <button type="button" className="dbr-primary" disabled={busy}
            onClick={() => setDialog({ to: 'verifying', kind: 'verify' })}>
            {t('transition.submitVerification')}
          </button>
        )}
        {review.status === 'verifying' && (
          <button type="button" disabled={busy}
            onClick={() => setDialog({ to: 'implementing', kind: 'failVerify' })}>
            {t('transition.failVerification')}
          </button>
        )}
        {canSendAgent && (
          <button type="button" className="dbr-primary" disabled={busy}
            onClick={() => setAgentOpen(true)}>
            {t('agent.send')}
          </button>
        )}
        {canRemove && (
          <button type="button" className="dbr-remove" disabled={busy} onClick={() => void remove()}>
            {t('detail.remove')}
          </button>
        )}
      </div>

      {dialog !== null && (
        <TransitionDialog
          to={dialog.to}
          kind={dialog.kind}
          candidates={duplicates}
          onCancel={() => setDialog(null)}
          onConfirm={runTransition}
          t={t}
        />
      )}
      {agentOpen && (
        <AgentPreview
          projectId={projectId}
          reviewId={reviewId}
          onClose={() => {
            setAgentOpen(false)
            void load()
          }}
          t={t}
        />
      )}
    </div>
  )
}

function AnchorNote({ resolution, t }: { resolution: AnchorResolution; t: TranslateFunction }): ReactNode {
  const movedLine = resolution.state === 'moved' && resolution.lineStart !== null
  const showNeedsReview = resolution.needsReviewCandidate
    && (resolution.state === 'modified' || resolution.state === 'outdated' || resolution.state === 'orphaned')
  return (
    <div className={`dbr-anchor-note ${anchorNoteClass(resolution.state)}`}>
      <div>
        {anchorLabel(t, resolution.state)}
        {movedLine ? `（${t('anchor.movedTo', { line: resolution.lineStart ?? '' })}）` : ''}
        {showNeedsReview ? ` · ${t('anchor.needsReview')}` : ''}
      </div>
    </div>
  )
}

function statusText(entry: ThreadEntry, t: TranslateFunction): string {
  const parts: string[] = []
  if (entry.fromStatus) parts.push(statusLabel(t, entry.fromStatus))
  parts.push('→')
  if (entry.toStatus) parts.push(statusLabel(t, entry.toStatus))
  return parts.join(' ')
}

function ThreadItem({ entry, canEdit, busy, onSaveEdit, t }: {
  entry: ThreadEntry
  canEdit: boolean
  busy: boolean
  onSaveEdit: (entryId: string, body: string) => Promise<boolean>
  t: TranslateFunction
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const className = entry.kind === 'status'
    ? 'dbr-entry dbr-entry-status'
    : entry.kind === 'decision'
      ? 'dbr-entry dbr-entry-decision'
      : 'dbr-entry'

  const authorLabel = entry.author.type === 'agent'
    ? `Agent · ${entry.author.displayName ?? entry.author.id}${
      entry.author.agentRunId ? ` (${entry.author.agentRunId.slice(0, 8)})` : ''
    }`
    : (entry.author.displayName ?? entry.author.id)

  // Machine-written entries (status/decision/system) stay immutable; only
  // human discussion comments can be reworded after publication.
  const editable = canEdit && entry.kind === 'comment'

  return (
    <div className={className}>
      <div className="dbr-entry-head">
        <span>{authorLabel}</span>
        <span>·</span>
        <span>{formatTime(entry.at)}</span>
        {entry.editedAt !== undefined && (
          <span className="dbr-edited-mark">{t('detail.edited')}</span>
        )}
        {entry.kind === 'decision' && entry.decisionType && <span>· {entry.decisionType}</span>}
        {editable && !editing && (
          <button
            type="button"
            className="dbr-entry-edit-btn"
            disabled={busy}
            onClick={() => {
              setDraft(entry.body)
              setEditing(true)
            }}
          >{t('detail.edit')}</button>
        )}
      </div>
      {editing ? (
        <div className="dbr-edit-form">
          <textarea
            rows={4}
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
          <div className="dbr-edit-actions">
            <button
              type="button"
              className="dbr-primary"
              disabled={busy || draft.trim() === ''}
              onClick={() => {
                void onSaveEdit(entry.id, draft).then(ok => { if (ok) setEditing(false) })
              }}
            >{t('detail.saveEdit')}</button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              {t('detail.cancelEdit')}
            </button>
          </div>
        </div>
      ) : entry.kind === 'status'
        ? <div>{statusText(entry, t)}{entry.body ? ` · ${entry.body}` : ''}</div>
        : <div className="dbr-entry-body">{entry.body}</div>}
    </div>
  )
}
