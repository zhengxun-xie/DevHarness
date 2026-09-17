/**
 * Build a ReviewAnchorDraft from a document's raw Markdown source and a
 * character-offset selection. The host computes the fingerprint; the client
 * only collects the four anchor layers (design/03 §3.1):
 *
 *   structural  — section + headingPath (ATX headings, fence-aware)
 *   textual     — selectedText + one-line prefix/suffix disambiguation
 *   positional  — 1-based lineStart/lineEnd against the raw source
 *
 * Mirrors host anchors.ts parseHeadings rules (lowercase slug, non
 * alphanumerics → '-') so client and host agree on section names.
 */
import type { DocumentHeading, ReviewAnchorDraft } from '../protocol.ts'

export const MAX_SELECTION_CHARS = 4000

/** Reason a selection cannot anchor a review (design/05 §6). */
export type SelectionError = 'empty' | 'whitespace' | 'tooLong'

export function validateSelection(selectedText: string): SelectionError | null {
  if (selectedText.length === 0) return 'empty'
  if (selectedText.trim().length === 0) return 'whitespace'
  if (selectedText.length > MAX_SELECTION_CHARS) return 'tooLong'
  return null
}

/** 1-based line number of a character offset in `content` (offset 0 → line 1). */
export function lineAtOffset(content: string, offset: number): number {
  let line = 1
  const end = Math.min(offset, content.length)
  for (let i = 0; i < end; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

/** Heading path (outermost first) active at a 1-based line. */
export function headingPathAt(headings: readonly DocumentHeading[], line: number): {
  section: string | null
  headingPath: string[]
} {
  const stack: DocumentHeading[] = []
  for (const heading of headings) {
    if (heading.line > line) break
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop()
    stack.push(heading)
  }
  if (stack.length === 0) return { section: null, headingPath: [] }
  return { section: stack[0].text, headingPath: stack.map(h => h.text) }
}

/** One raw source line (no trailing newline). */
function sourceLine(content: string, line1: number): string {
  const lines = content.split('\n')
  return (lines[line1 - 1] ?? '').trim()
}

/**
 * Build an anchor draft. `selStart`/`selEnd` are LF-normalized character
 * offsets against the source; selection validity must be checked with
 * validateSelection first (or both offsets may be equal for a point anchor).
 */
export function buildAnchorDraft(
  content: string,
  headings: readonly DocumentHeading[],
  selStart: number,
  selEnd: number,
): ReviewAnchorDraft {
  const selectedText = content.slice(selStart, selEnd)
  const lineStart = lineAtOffset(content, selStart)
  const lineEnd = lineAtOffset(content, Math.max(selStart, selEnd - 1))
  const { section, headingPath } = headingPathAt(headings, lineStart)
  const prefix = lineStart > 1 ? sourceLine(content, lineStart - 1) : ''
  const totalLines = content.split('\n').length
  const suffix = lineEnd < totalLines ? sourceLine(content, lineEnd + 1) : ''
  return {
    structural: { section, headingPath },
    textual: { selectedText, prefix, suffix },
    positional: { lineStart, lineEnd, offsetStart: selStart, offsetEnd: selEnd },
  }
}
