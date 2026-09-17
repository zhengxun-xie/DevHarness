/**
 * Modal collecting the extra fields certain transitions require
 * (design/06 §2): reject needs a reason, duplicate needs the original
 * review id, implemented→verifying carries evidence. Plain confirmations
 * (accept / needs_review / status back-edges) fire without this dialog.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ReviewStatus, ReviewSummary } from '../protocol.ts'
import type { TranslateFunction } from './format.ts'

export interface TransitionRequest {
  to: ReviewStatus
  reason?: string
  duplicatedOf?: string
  decisionSummary?: string
  evidence?: string
}

export interface TransitionDialogProps {
  to: ReviewStatus
  /**
   * Dialog kind. reject/duplicate carry a decision; verify collects
   * evidence; failVerify (verifying → implementing) requires a reason.
   */
  kind: 'reject' | 'duplicate' | 'verify' | 'failVerify'
  /** Sibling reviews for the duplicate picker (excludes the current one). */
  candidates: ReviewSummary[]
  onConfirm: (request: TransitionRequest) => Promise<void>
  onCancel: () => void
  t: TranslateFunction
}

export function TransitionDialog({ to, kind, candidates, onConfirm, onCancel, t }: TransitionDialogProps): ReactNode {
  const isReject = kind === 'reject'
  const isDuplicate = kind === 'duplicate'
  const isVerify = kind === 'verify'
  const isFail = kind === 'failVerify'

  const [reason, setReason] = useState('')
  const [duplicatedOf, setDuplicatedOf] = useState('')
  const [summary, setSummary] = useState('')
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm(): Promise<void> {
    if ((isReject || isFail) && reason.trim() === '') {
      setError(t('transition.reasonRequired'))
      return
    }
    if (isDuplicate && duplicatedOf === '') {
      setError(t('transition.duplicatedOfRequired'))
      return
    }
    setBusy(true)
    try {
      await onConfirm({
        to,
        reason: reason.trim() || undefined,
        duplicatedOf: isDuplicate ? duplicatedOf : undefined,
        decisionSummary: summary.trim() || undefined,
        evidence: isVerify ? evidence.trim() || undefined : undefined,
      })
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : String(confirmError))
      setBusy(false)
    }
  }

  const titleKey = kind === 'reject'
    ? 'transition.reject'
    : kind === 'duplicate'
      ? 'transition.duplicate'
      : kind === 'failVerify'
        ? 'transition.failVerification'
        : 'transition.submitVerification'
  const title = t(titleKey)

  return (
    <div className="dbr-dialog-bg" onClick={onCancel}>
      <div className="dbr-dialog" onClick={event => event.stopPropagation()}>
        <h3>{title}</h3>

        {(isReject || isFail) && (
          <div className="dbr-field">
            <label>{t('transition.reason')} *</label>
            <textarea value={reason} onChange={event => setReason(event.target.value)} autoFocus />
          </div>
        )}

        {isDuplicate && (
          <div className="dbr-field">
            <label>{t('transition.duplicatedOf')} *</label>
            <select value={duplicatedOf} onChange={event => setDuplicatedOf(event.target.value)}>
              <option value="">—</option>
              {candidates.map(review => (
                <option key={review.reviewId} value={review.reviewId}>
                  {review.reviewId}{review.title ? ` · ${review.title}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {isVerify && (
          <div className="dbr-field">
            <label>{t('transition.evidence')}</label>
            <textarea value={evidence} onChange={event => setEvidence(event.target.value)} autoFocus />
          </div>
        )}

        {(isReject || isDuplicate) && (
          <div className="dbr-field">
            <label>{t('transition.decisionSummary')}</label>
            <input value={summary} onChange={event => setSummary(event.target.value)} />
          </div>
        )}

        {error !== null && <div className="dbr-error">{error}</div>}

        <div className="dbr-dialog-row">
          <button type="button" onClick={onCancel} disabled={busy}>{t('transition.cancel')}</button>
          <button type="button" className="dbr-primary" onClick={confirm} disabled={busy}>
            {t('transition.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
