/**
 * Inline unified diff shown IN PLACE of the editing surface (single column,
 * not a two-article comparison): context lines render normally, removed
 * lines red with a '-' gutter, added lines green with a '+' gutter — the
 * markings sit directly on the document flow, exactly like `git diff`.
 *
 * Read-only: toggling the header diff switch off returns to the editor.
 */
import { useMemo } from 'react'
import { diffRows, diffStats } from './diff.ts'

export interface DiffViewLabels {
  /** Shown when the two texts are identical. */
  noChanges: string
  /** Summary; {added}/{removed} are replaced at render time. */
  summary: string
}

export interface DiffViewProps {
  /** Last saved body. */
  savedText: string
  /** Current editing draft. */
  draftText: string
  labels: DiffViewLabels
}

export function DiffView({ savedText, draftText, labels }: DiffViewProps) {
  const rows = useMemo(() => diffRows(savedText, draftText), [savedText, draftText])
  const stats = useMemo(() => diffStats(rows), [rows])
  const summary = labels.summary
    .replace('{added}', String(stats.added))
    .replace('{removed}', String(stats.removed))

  return (
    <div className="dbl-diff-i" role="group" aria-label={labels.summary}>
      <div className="dbl-diff-i-head">
        <span className="dbl-diff-i-summary">{summary}</span>
      </div>
      {rows.length === 0 ? (
        <div className="dbl-diff-i-empty">{labels.noChanges}</div>
      ) : (
        <div className="dbl-diff-i-body">
          {rows.map((row, index) => (
            <div key={index} className="dbl-diff-i-row" data-kind={row.kind}>
              <span className="dbl-diff-i-gutter">
                <span className="dbl-diff-i-no">{row.kind === 'add' ? row.newLine : row.oldLine}</span>
                <span className="dbl-diff-i-sign" aria-hidden>
                  {row.kind === 'equal' ? '' : row.kind === 'del' ? '-' : '+'}
                </span>
              </span>
              <span className="dbl-diff-i-text">{row.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
