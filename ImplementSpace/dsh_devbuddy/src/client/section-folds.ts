/**
 * Section-folding model shared by the two editing surfaces
 * (LineNumberTextarea / RichTextEditor).
 *
 * A foldable section is a Markdown ATX heading (`#` … `######`) together
 * with every line below it up to — but not including — the next heading of
 * the same or higher level. Both surfaces identify a folded section by the
 * same key (`<level>:<normalized text>`), so folding in one view stays
 * folded after switching to the other.
 */

/** One detected Markdown heading. */
export interface MarkdownHeading {
  /** 0-based line index. */
  index: number
  /** Heading level 1-6. */
  level: number
  /** Heading text without leading hashes / trailing closing hashes. */
  text: string
  /** Stable fold identity, shared with the rich-text surface. */
  key: string
}

/**
 * Fold identity for a heading. The text is normalized the same way on both
 * surfaces: trimmed and lower-cased so whitespace/case differences do not
 * fork the state. Two distinct headings with identical normalized text
 * share one key (rare; acceptable).
 */
export function foldKey(level: number, text: string): string {
  return `${level}:${text.trim().toLowerCase()}`
}

/**
 * Whether a raw Markdown line is an ATX heading. Indented headings (1-3
 * leading spaces) are accepted per CommonMark; code-block fences are not
 * tracked here (the editor surfaces do not parse fenced regions).
 */
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/

/** Detect every heading line in the document, in order. */
export function collectHeadings(lines: readonly string[]): MarkdownHeading[] {
  const result: MarkdownHeading[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = HEADING_RE.exec(lines[index])
    if (match === null) continue
    const level = match[1].length
    const text = (match[2] ?? '').trim()
    result.push({ index, level, text, key: foldKey(level, text) })
  }
  return result
}

/**
 * Last 0-based body line index of a heading's section: the line before the
 * next heading whose level is ≤ this one. A following lower-level heading
 * (deeper) starts a nested section and stays inside. Returns the document's
 * last line when the section runs to the end.
 */
export function sectionEndLine(headings: readonly MarkdownHeading[], headingIndex: number, docLineCount: number): number {
  const current = headings.find(h => h.index === headingIndex)
  if (current === undefined) return headingIndex
  for (const next of headings) {
    if (next.index <= headingIndex) continue
    if (next.level <= current.level) return next.index - 1
  }
  return docLineCount - 1
}
