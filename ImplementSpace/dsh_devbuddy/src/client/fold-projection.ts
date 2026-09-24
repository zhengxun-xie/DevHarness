/**
 * Display projection for the SOURCE surface: a textarea cannot hide lines, so
 * a folded section is made to actually collapse by removing its body lines
 * from the value the textarea displays. The draft (the plugin's source of
 * truth) is never touched; offsets are mapped at the boundaries:
 *
 *   draft  --buildProjection-->  display (what the textarea shows)
 *   display edits --mapDisplayEdit-->  draft edits
 *   display selection --toDraft-->  draft offsets (review anchors)
 *
 * Pure functions only, so the mapping is unit-testable without a DOM.
 */
import { collectHeadings, foldKey, sectionEndLine } from './section-folds.ts'

/** A hidden draft line range (0-based, inclusive) and the key that hides it. */
export interface FoldSpan {
  key: string
  startLine: number
  endLine: number
}

export interface Projection {
  /** What the textarea shows (folded bodies removed). */
  text: string
  /** `text.split('\n')`. */
  lines: string[]
  /** True when at least one body line is hidden. */
  folded: boolean
  /** Hidden draft line ranges (outermost only), in document order. */
  spans: FoldSpan[]
  /** Display offset → draft offset. */
  toDraft(offset: number): number
  /** Draft offset → display offset (hidden content clamps to its position). */
  toDisplay(offset: number): number
  /** Draft line index → display line index, or null when the line is hidden. */
  lineToDisplay(line: number): number | null
  /** Display line index → draft line index. */
  displayLineToDraft(line: number): number
  /** Whether the draft range [from, to) touches hidden content. */
  touchesHidden(from: number, to: number): boolean
}

const EMPTY_SET: ReadonlySet<string> = new Set()

/** Character offset of the first character of each line. */
function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = []
  let at = 0
  for (const line of lines) {
    starts.push(at)
    at += line.length + 1
  }
  return starts
}

/**
 * Outermost folded spans: a nested section inside a folded one is already
 * hidden, so keeping it would double-count. Spans are returned sorted.
 */
function outermostSpans(lines: readonly string[], foldedKeys: ReadonlySet<string>): FoldSpan[] {
  const headings = collectHeadings(lines)
  const candidates: FoldSpan[] = []
  for (const heading of headings) {
    if (!foldedKeys.has(foldKey(heading.level, heading.text))) continue
    const startLine = heading.index + 1
    const endLine = sectionEndLine(headings, heading.index, lines.length)
    if (startLine > endLine) continue // empty section: nothing to hide
    candidates.push({ key: foldKey(heading.level, heading.text), startLine, endLine })
  }
  const kept: FoldSpan[] = []
  for (const span of candidates) {
    const covered = kept.some(other => span.startLine >= other.startLine && span.endLine <= other.endLine)
    if (!covered) kept.push(span)
  }
  return kept
}

/** Build the display projection for a draft and the currently folded keys. */
export function buildProjection(draft: string, foldedKeys: ReadonlySet<string> = EMPTY_SET): Projection {
  const draftLines = draft.split('\n')
  const spans = foldedKeys.size === 0 ? [] : outermostSpans(draftLines, foldedKeys)
  const hidden = new Uint8Array(draftLines.length)
  for (const span of spans) {
    for (let line = span.startLine; line <= span.endLine; line += 1) hidden[line] = 1
  }

  const starts = lineStarts(draftLines)
  const lineMap: Array<number | null> = []
  const inverseMap: number[] = []
  const segPStart: number[] = []
  const segDStart: number[] = []
  const segLength: number[] = []
  const segLine: number[] = []
  let text = ''
  for (let line = 0; line < draftLines.length; line += 1) {
    if (hidden[line] === 1) {
      lineMap.push(null)
      continue
    }
    if (text.length > 0) text += '\n'
    lineMap.push(inverseMap.length)
    inverseMap.push(line)
    segPStart.push(text.length)
    segDStart.push(starts[line])
    segLength.push(draftLines[line].length)
    segLine.push(line)
    text += draftLines[line]
  }

  const toDraft = (offset: number): number => {
    if (segPStart.length === 0) return 0
    let lo = 0
    let hi = segPStart.length - 1
    let found = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (segPStart[mid] <= offset) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    const within = offset - segPStart[found]
    return segDStart[found] + Math.min(Math.max(within, 0), segLength[found])
  }

  const toDisplay = (offset: number): number => {
    if (segDStart.length === 0) return 0
    let lo = 0
    let hi = segDStart.length - 1
    let found = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (segDStart[mid] <= offset) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    const within = offset - segDStart[found]
    return segPStart[found] + Math.min(Math.max(within, 0), segLength[found])
  }

  const hiddenRanges = spans.map(span => ({
    from: starts[span.startLine],
    to: starts[span.endLine] + draftLines[span.endLine].length,
  }))

  return {
    text,
    lines: text.split('\n'),
    folded: spans.length > 0,
    spans,
    toDraft,
    toDisplay,
    lineToDisplay: line => lineMap[line] ?? null,
    displayLineToDraft: line => inverseMap[line] ?? 0,
    touchesHidden: (from, to) => hiddenRanges.some(range => range.from < to && range.to > from),
  }
}

/** A display edit translated into a draft edit. */
export interface MappedEdit {
  /** The new draft text. */
  draft: string
  /** Caret position in the new DRAFT (map back with a fresh projection). */
  caret: number
}

/**
 * Translate an edit made on the projected text back into the draft.
 *
 * The changed display range is found by common prefix/suffix, then mapped to
 * draft offsets. Returns null when the edit would consume hidden content (the
 * caller must unfold first instead of silently deleting a folded section).
 */
export function mapDisplayEdit(draft: string, projection: Projection, nextDisplay: string): MappedEdit | null {
  const before = projection.text
  const maxPrefix = Math.min(before.length, nextDisplay.length)
  let prefix = 0
  while (prefix < maxPrefix && before[prefix] === nextDisplay[prefix]) prefix += 1
  const maxSuffix = Math.min(before.length - prefix, nextDisplay.length - prefix)
  let suffix = 0
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === nextDisplay[nextDisplay.length - 1 - suffix]) {
    suffix += 1
  }
  const removedEnd = before.length - suffix
  const inserted = nextDisplay.slice(prefix, nextDisplay.length - suffix)
  const from = projection.toDraft(prefix)
  const to = projection.toDraft(removedEnd)
  if (projection.touchesHidden(from, to)) return null
  return {
    draft: draft.slice(0, from) + inserted + draft.slice(to),
    caret: from + inserted.length,
  }
}

/** Count CRLF pairs before a raw offset (the LF offset model). */
export function lfOffsetOf(raw: string, rawOffset: number): number {
  let count = 0
  const end = Math.min(rawOffset, raw.length)
  for (let i = 0; i < end - 1; i += 1) {
    if (raw.charCodeAt(i) === 13 && raw.charCodeAt(i + 1) === 10) count += 1
  }
  return rawOffset - count
}

/** Raw offset for an LF offset in `raw` (inverse of `lfOffsetOf`). */
export function rawOffsetOf(raw: string, lfOffset: number): number {
  let rawAt = 0
  let lfAt = 0
  while (rawAt < raw.length && lfAt < lfOffset) {
    if (raw.charCodeAt(rawAt) === 13 && raw.charCodeAt(rawAt + 1) === 10) rawAt += 2
    else rawAt += 1
    lfAt += 1
  }
  return rawAt
}
