/**
 * Inline review composer (design/05 §1): type / severity / optional title,
 * required comment, optional proposal and tags, over a selection anchor
 * draft. Selection validity (empty / whitespace / >4000) gates submission;
 * the host re-validates and computes the fingerprint.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { REVIEW_TYPES, SEVERITIES, isPointAnchor } from '../protocol.ts'
import type { ReviewAnchorDraft, ReviewType, Severity } from '../protocol.ts'
import type { TranslateFunction } from './format.ts'
import { validateSelection, type SelectionError } from './selection.ts'

export interface ComposerDraft {
  projectId: string
  document: string
  anchor: ReviewAnchorDraft
}

export interface ReviewComposerProps {
  draft: ComposerDraft
  onSubmit: (input: {
    draft: ComposerDraft
    type: ReviewType
    severity: Severity
    title: string
    comment: string
    proposal: string
    tags: string[]
  }) => Promise<void>
  onCancel: () => void
  t: TranslateFunction
}

export function ReviewComposer({ draft, onSubmit, onCancel, t }: ReviewComposerProps): ReactNode {
  const [type, setType] = useState<ReviewType>('suggestion')
  const [severity, setSeverity] = useState<Severity>('minor')
  // 默认标题：取选区文本（连续空白折叠）前 15 个字，超出追加 ...。
  // 按显示宽度计字：英文字母每个 0.5 个字，其余字符（含中文/数字/标点/空格）每个 1 个字。
  const [title, setTitle] = useState(() => {
    const text = draft.anchor.textual.selectedText.replace(/\s+/g, ' ').trim()
    const chars = Array.from(text)
    const TITLE_WIDTH = 15
    let width = 0
    let count = 0
    for (const ch of chars) {
      const charWidth = /[A-Za-z]/.test(ch) ? 0.5 : 1
      if (width + charWidth > TITLE_WIDTH) break
      width += charWidth
      count += 1
    }
    return count < chars.length ? `${chars.slice(0, count).join('')}...` : text
  })
  const [comment, setComment] = useState('')
  const [proposal, setProposal] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Zero-length (point) anchors bypass the non-empty selection gate: they
  // are anchored at a caret position via the quick-action CARET handshake.
  const isPoint = useMemo(() => isPointAnchor(draft.anchor), [draft.anchor])

  const selectionError = useMemo(
    () => (isPoint ? null : validateSelection(draft.anchor.textual.selectedText)),
    [isPoint, draft.anchor.textual.selectedText],
  )

  const SELECTION_ERROR_KEYS: Record<
    SelectionError,
    'composer.error.emptySelection' | 'composer.error.whitespace' | 'composer.error.tooLong'
  > = {
    empty: 'composer.error.emptySelection',
    whitespace: 'composer.error.whitespace',
    tooLong: 'composer.error.tooLong',
  }

  async function handleSubmit(): Promise<void> {
    if (selectionError !== null) {
      setError(t(SELECTION_ERROR_KEYS[selectionError]))
      return
    }
    if (comment.trim() === '') {
      setError(t('composer.error.emptyComment'))
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({
        draft,
        type,
        severity,
        title: title.trim(),
        comment: comment.trim(),
        proposal: proposal.trim(),
        tags: tagsText.split(',').map(tag => tag.trim()).filter(tag => tag !== ''),
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
      setSubmitting(false)
    }
  }

  const path = draft.anchor.structural.headingPath.join(' / ')
  const { lineStart, lineEnd } = draft.anchor.positional

  return (
    <div className="dbr-composer">
      <div className="dbr-composer-head">
        <strong>{t('composer.addReview')}</strong>
        <button type="button" onClick={onCancel} disabled={submitting}>×</button>
      </div>

      <div className="dbr-field">
        <label>{t('composer.selection')} · {draft.document}{path ? ` · ${path}` : ''} · {lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`}</label>
        {isPoint
          ? <div className="dbr-quote dbr-quote-point">{t('composer.pointAnchor')}</div>
          : <div className="dbr-quote">{draft.anchor.textual.selectedText}</div>}
      </div>

      <div className="dbr-field-row">
        <div className="dbr-field">
          <label>{t('composer.type')}</label>
          <select value={type} onChange={event => setType(event.target.value as ReviewType)}>
            {REVIEW_TYPES.map(value => (
              <option key={value} value={value}>{t(`type.${value}`)}</option>
            ))}
          </select>
        </div>
        <div className="dbr-field">
          <label>{t('composer.severity')}</label>
          <select value={severity} onChange={event => setSeverity(event.target.value as Severity)}>
            {SEVERITIES.map(value => (
              <option key={value} value={value}>{t(`severity.${value}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="dbr-field">
        <label>{t('composer.title')}</label>
        <input value={title} placeholder={t('composer.titlePlaceholder')}
          onChange={event => setTitle(event.target.value)} />
      </div>

      <div className="dbr-field">
        <label>{t('composer.comment')}</label>
        <textarea value={comment} placeholder={t('composer.commentPlaceholder')}
          onChange={event => setComment(event.target.value)} autoFocus />
      </div>

      <div className="dbr-field">
        <label>{t('composer.proposal')}</label>
        <textarea value={proposal} placeholder={t('composer.proposalPlaceholder')}
          onChange={event => setProposal(event.target.value)} />
      </div>

      <div className="dbr-field">
        <label>{t('composer.tags')}（{t('composer.tagsHint')}）</label>
        <input value={tagsText} onChange={event => setTagsText(event.target.value)} />
      </div>

      {error !== null && <div className="dbr-error">{error}</div>}

      <div className="dbr-dialog-row">
        <button type="button" onClick={onCancel} disabled={submitting}>{t('composer.cancel')}</button>
        <button type="button" className="dbr-primary" onClick={handleSubmit} disabled={submitting}>
          {t('composer.submit')}
        </button>
      </div>
    </div>
  )
}
