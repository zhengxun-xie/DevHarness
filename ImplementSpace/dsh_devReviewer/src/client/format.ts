/** Presentation helpers shared by reviewer panel components. */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnchorStatus, ReviewStatus, Severity } from '../protocol.ts'
import type { ReviewerKey } from './locales.ts'

export type TranslateFunction = Translate<ReviewerKey>

export function severityClass(severity: Severity): string {
  return `dbr-sev-${severity}`
}

export function severityLabel(t: TranslateFunction, severity: Severity): string {
  return t(`severity.${severity}`)
}

export function statusLabel(t: TranslateFunction, status: ReviewStatus): string {
  return t(`status.${status}`)
}

const ANCHOR_PREFIX: Record<AnchorStatus, string> = {
  valid: 'dbr-anchor-valid',
  moved: 'dbr-anchor-moved',
  modified: 'dbr-anchor-modified',
  outdated: 'dbr-anchor-outdated',
  orphaned: 'dbr-anchor-orphaned',
}

export function anchorNoteClass(status: AnchorStatus): string {
  return ANCHOR_PREFIX[status]
}

export function anchorLabel(t: TranslateFunction, status: AnchorStatus): string {
  return t(`anchor.${status}`)
}

export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
