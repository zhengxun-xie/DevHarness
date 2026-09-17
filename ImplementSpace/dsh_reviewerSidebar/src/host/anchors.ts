/**
 * Anchor resolver (design/05-inline-review.md §4).
 *
 * Re-locates an immutable review anchor inside the CURRENT document text.
 * The result is computed on every read and never persisted: Review Status and
 * Anchor Status are independent dimensions.
 *
 * Resolution ladder:
 *   1. fingerprint equality on a prefix+selected+suffix window   -> valid
 *   2. unique exact(selectedText) hit                            -> valid
 *   3. multiple exact hits disambiguated by prefix/suffix        -> valid/moved
 *   4. exact hit inside the headingPath section                  -> moved
 *   5. normalized full-text Levenshtein fuzzy match              -> modified/outdated
 *   6. nothing                                                   -> orphaned
 */
import type {
  AnchorResolution,
  DocumentHeading,
  ReviewAnchor,
} from '../protocol.ts'

const FUZZY_MODIFIED = 0.95
const FUZZY_OUTDATED = 0.80
const FUZZY_ORPHAN = 0.50

export interface MatchResult {
  lineStart: number | null
  lineEnd: number | null
  /** Character offsets in the current LF document (0-based half-open); null for fuzzy/orphaned. */
  offsetStart: number | null
  offsetEnd: number | null
}

/** Compute the anchor fingerprint: sha256 is supplied by the caller (node). */
export function fingerprintMaterial(anchor: ReviewAnchor): string {
  return anchor.textual.prefix + anchor.textual.selectedText + anchor.textual.suffix
}

/** Normalize text for matching: CRLF->LF, trim each line, collapse spaces. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim()
}

/** 1-based line number of an offset in the ORIGINAL text. */
function lineOfOffset(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

interface ExactHit {
  index: number
  endIndex: number
  lineStart: number
  lineEnd: number
}

/** Every case-sensitive occurrence of needle in haystack. */
function findAll(haystack: string, needle: string): ExactHit[] {
  if (needle === '') return []
  const hits: ExactHit[] = []
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) break
    const endOffset = index + needle.length
    hits.push({
      index,
      endIndex: endOffset,
      lineStart: lineOfOffset(haystack, index),
      lineEnd: lineOfOffset(haystack, endOffset - 1),
    })
    from = index + Math.max(1, needle.length)
  }
  return hits
}

/** Levenshtein ratio in 0..1 (identical = 1), character based (CJK-safe). */
export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0
  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  const distance = prev[b.length]
  const longest = Math.max(a.length, b.length)
  return 1 - distance / longest
}

/**
 * Parse Markdown headings (ATX style, incl. fenced-code awareness).
 * Returns 1-based line numbers.
 */
export function parseHeadings(content: string): DocumentHeading[] {
  const headings: DocumentHeading[] = []
  let inFence = false
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match !== null) {
      const text = match[2].trim()
      headings.push({ slug: slugify(text), text, level: match[1].length, line: i + 1 })
    }
  }
  return headings
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Resolve a zero-length point anchor: no selected text to match, so the
 * persisted caret offset (LF-normalized) is the only signal. A caret at or
 * beyond the end of a shortened document clamps to the end; a different line
 * reads as 'moved'. Returns null when the anchor carries no usable offset.
 */
function resolvePointAnchor(anchor: ReviewAnchor, content: string): AnchorResolution | null {
  const offset = anchor.positional.offsetStart
  if (offset === undefined || anchor.positional.offsetEnd !== offset) return null
  if (!Number.isInteger(offset) || offset < 0) return null
  const clamped = Math.min(offset, content.length)
  const line = lineOfOffset(content, clamped)
  return {
    state: line === anchor.positional.lineStart ? 'valid' : 'moved',
    lineStart: line,
    lineEnd: line,
    matchOffsetStart: clamped,
    matchOffsetEnd: clamped,
    confidence: line === anchor.positional.lineStart ? 1 : 0.7,
    needsReviewCandidate: line !== anchor.positional.lineStart,
  }
}

/**
 * Resolve one anchor against current document content.
 *
 * @param content current document text ('' when the file is missing)
 */
export function resolveAnchor(
  anchor: ReviewAnchor,
  content: string,
): AnchorResolution {
  const missing: AnchorResolution = {
    state: 'orphaned',
    lineStart: null,
    lineEnd: null,
    matchOffsetStart: null,
    matchOffsetEnd: null,
    confidence: 0,
    needsReviewCandidate: true,
  }
  if (content === '') return missing
  if (anchor.textual.selectedText === '') {
    return resolvePointAnchor(anchor, content) ?? missing
  }

  // Ladder 1: fingerprint window present verbatim.
  const material = fingerprintMaterial(anchor)
  if (material.trim() !== '' && content.includes(material)) {
    const hits = findAll(content, anchor.textual.selectedText)
    const hit = pickByWindow(hits, content, anchor)
    if (hit !== null) {
      // The original context survives verbatim; only the line position may
      // differ. The documentSha change is captured separately by callers.
      const moved = hit.lineStart !== anchor.positional.lineStart
      return {
        state: moved ? 'moved' : 'valid',
        lineStart: hit.lineStart,
        lineEnd: hit.lineEnd,
        matchOffsetStart: hit.offsetStart,
        matchOffsetEnd: hit.offsetEnd,
        confidence: 1,
        needsReviewCandidate: false,
      }
    }
  }

  const exactHits = findAll(content, anchor.textual.selectedText)

  // Ladder 2: unique exact hit.
  if (exactHits.length === 1) {
    return {
      state: exactHits[0].lineStart === anchor.positional.lineStart ? 'valid' : 'moved',
      lineStart: exactHits[0].lineStart,
      lineEnd: exactHits[0].lineEnd,
      matchOffsetStart: exactHits[0].index,
      matchOffsetEnd: exactHits[0].endIndex,
      confidence: 1,
      needsReviewCandidate: false,
    }
  }

  // Ladder 3: multiple exact hits — disambiguate with prefix/suffix.
  if (exactHits.length > 1) {
    const hit = pickByWindow(exactHits, content, anchor)
    if (hit !== null) {
      return {
        state: hit.lineStart === anchor.positional.lineStart ? 'valid' : 'moved',
        lineStart: hit.lineStart,
        lineEnd: hit.lineEnd,
        matchOffsetStart: hit.offsetStart,
        matchOffsetEnd: hit.offsetEnd,
        confidence: 0.98,
        needsReviewCandidate: false,
      }
    }
    // Ladder 4: keep hits inside the anchor's heading section.
    const scoped = pickByHeading(exactHits, content, anchor)
    if (scoped !== null) {
      return {
        state: 'moved',
        lineStart: scoped.lineStart,
        lineEnd: scoped.lineEnd,
        matchOffsetStart: scoped.offsetStart,
        matchOffsetEnd: scoped.offsetEnd,
        confidence: 0.95,
        needsReviewCandidate: false,
      }
    }
  }

  // Ladder 5: normalized fuzzy over same-length windows.
  // Fuzzy windows are line-aligned, so exact character offsets are not
  // trustworthy — clients fall back to painting the line range.
  const fuzzy = fuzzyMatch(content, anchor.textual.selectedText)
  if (fuzzy !== null) {
    const { lineStart, lineEnd, ratio } = fuzzy
    if (ratio >= FUZZY_MODIFIED) {
      return { state: 'moved', lineStart, lineEnd, matchOffsetStart: null, matchOffsetEnd: null, confidence: ratio, needsReviewCandidate: false }
    }
    if (ratio >= FUZZY_OUTDATED) {
      return { state: 'modified', lineStart, lineEnd, matchOffsetStart: null, matchOffsetEnd: null, confidence: ratio, needsReviewCandidate: true }
    }
    if (ratio >= FUZZY_ORPHAN) {
      return { state: 'outdated', lineStart, lineEnd, matchOffsetStart: null, matchOffsetEnd: null, confidence: ratio, needsReviewCandidate: true }
    }
  }

  // Ladder 6.
  return missing
}

/** Choose the exact hit whose surrounding text best matches prefix/suffix. */
function pickByWindow(hits: ExactHit[], content: string, anchor: ReviewAnchor): MatchResult | null {
  if (hits.length === 0) return null
  let best: ExactHit | null = null
  let bestScore = -1
  for (const hit of hits) {
    let score = 0
    if (anchor.textual.prefix !== '') {
      const before = content.slice(Math.max(0, hit.index - anchor.textual.prefix.length - 8), hit.index)
      if (before.includes(anchor.textual.prefix.trim())) score += 2
      else if (normalizeText(before).includes(normalizeText(anchor.textual.prefix).slice(-20))) score += 1
    }
    if (anchor.textual.suffix !== '') {
      const after = content.slice(
        hit.index + anchor.textual.selectedText.length,
        hit.index + anchor.textual.selectedText.length + anchor.textual.suffix.length + 8,
      )
      if (after.includes(anchor.textual.suffix.trim())) score += 2
      else if (normalizeText(after).includes(normalizeText(anchor.textual.suffix).slice(0, 20))) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = hit
    }
  }
  // A unique best (or any hit when no context was provided) wins.
  if (best === null) return null
  if (bestScore === 0 && hits.length > 1) return null
  return { lineStart: best.lineStart, lineEnd: best.lineEnd, offsetStart: best.index, offsetEnd: best.endIndex }
}

/** Filter exact hits to the section identified by the anchor's heading path. */
function pickByHeading(hits: ExactHit[], content: string, anchor: ReviewAnchor): MatchResult | null {
  const path = anchor.structural.headingPath
  if (path.length === 0) return null
  const headings = parseHeadings(content)
  if (headings.length === 0) return null
  const headingText = path[path.length - 1].trim().toLowerCase()
  const heading = headings.find(h => h.text.trim().toLowerCase() === headingText)
  if (heading === undefined) return null
  const next = headings
    .filter(h => h.line > heading.line && h.level <= heading.level)
    .sort((a, b) => a.line - b.line)[0]
  const sectionEnd = next?.line ?? Number.POSITIVE_INFINITY
  const scoped = hits.filter(h => h.lineStart >= heading.line && h.lineStart < sectionEnd)
  if (scoped.length === 0) return null
  const hit = scoped.sort((a, b) => a.lineStart - b.lineStart)[0]
  return { lineStart: hit.lineStart, lineEnd: hit.lineEnd, offsetStart: hit.index, offsetEnd: hit.endIndex }
}

/**
 * Best normalized Levenshtein match over windows aligned to the selected
 * text's line span. Sliding by line keeps this O(lines * span) at most.
 */
function fuzzyMatch(
  content: string,
  selectedText: string,
): { lineStart: number; lineEnd: number; ratio: number } | null {
  const target = normalizeText(selectedText)
  if (target === '') return null
  const targetLines = target.split('\n')
  const sourceLines = content.replace(/\r\n/g, '\n').split('\n')
  const windowSize = targetLines.length
  if (windowSize === 0 || sourceLines.length < 1) return null

  let best: { lineStart: number; lineEnd: number; ratio: number } | null = null
  const maxStart = sourceLines.length - 1
  for (let start = 0; start <= maxStart; start++) {
    // Compare same line-span and spans one line shorter/longer to tolerate
    // inserted/removed lines.
    for (const span of [windowSize, windowSize + 1, Math.max(1, windowSize - 1)]) {
      const end = Math.min(sourceLines.length, start + span)
      const candidate = normalizeText(sourceLines.slice(start, end).join('\n'))
      if (candidate === '') continue
      const ratio = levenshteinRatio(target, candidate)
      if (best === null || ratio > best.ratio) {
        best = { lineStart: start + 1, lineEnd: end, ratio }
      }
    }
  }
  return best
}
