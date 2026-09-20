/**
 * Markdown-source ↔ ProseMirror-doc alignment for review marks in the
 * rich-text (WYSIWYG) surface.
 *
 * This is the ProseMirror-doc retarget of the legacy preview-marks.ts DOM
 * alignment. The pure alignment primitives (word tokenize / strip / pair /
 * coordinate convert) are preserved verbatim — only the DOM block collector
 * (`collectDomBlocks` over HTMLElement + TreeWalker) is replaced by a
 * ProseMirror doc collector (`collectDocBlocks` over the PM node tree).
 *
 * ProseMirror doc nodes already carry stripped visible text (Tiptap parses
 * `**` into a bold mark, `#` into a heading node, etc.), so a PM textblock's
 * `textContent` aligns word-for-word with `SourceBlock.stripped` — zero new
 * syntax-stripping logic is needed.
 *
 * Two-way API:
 *   - `lfToPmPos(model, lf)`      : source LF offset -> ProseMirror position
 *   - `pmPosToLf(model, pmPos)`   : ProseMirror position -> source LF offset
 *   - `lfLineToPmRange(...)`      : 1-based source lines -> PM range (lineLevel)
 */
import type { Node as PMNode } from '@tiptap/pm/model'

export type PreviewSeverity = 'info' | 'minor' | 'major' | 'critical'

export interface MarkReviewLite {
  reviewId: string
  number: number
  severity: PreviewSeverity
}

/** A committed review's desired mark, in LF source coordinates. */
export interface MarkSpec {
  /** Precise 0-based half-open LF offsets (null -> lineLevel degradation). */
  start: number | null
  end: number | null
  /** Whole-block degraded highlight when precise offsets are unavailable. */
  lineLevel: boolean
  /** 1-based source lines, used by the line-level fallback. */
  lineStart: number | null
  lineEnd: number | null
  anchorStatus: string
  reviews: MarkReviewLite[]
}

export interface MarkHandlers {
  openReview: (reviewId: string) => void
  titleFor: (review: MarkReviewLite) => string
}

const SEVERITY_RANK: Record<PreviewSeverity, number> = {
  info: 0,
  minor: 1,
  major: 2,
  critical: 3,
}
const LOST_STATUSES = new Set(['outdated', 'orphaned'])

// ---------------------------------------------------------------------------
// Word tokenizer (Latin runs and CJK runs both count as words)
// ---------------------------------------------------------------------------

interface WordTok {
  text: string
  start: number
  end: number
}

const WORD_RE = /[\p{L}\p{N}]+/gu

function wordTokens(text: string): WordTok[] {
  const tokens: WordTok[] = []
  WORD_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WORD_RE.exec(text)) !== null) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  }
  return tokens
}

interface WordPair {
  /** Source stripped coordinate. */
  s0: number
  s1: number
  /** Rendered (PM textblock) visible-text coordinate. */
  d0: number
  d1: number
}

/** Ordered equal-word alignment (bounded lookahead, greedy). */
function alignWords(src: string, dom: string): WordPair[] {
  const sw = wordTokens(src)
  const dw = wordTokens(dom)
  const pairs: WordPair[] = []
  let cursor = 0
  const LOOKAHEAD = 400
  for (const a of sw) {
    const upper = Math.min(dw.length, cursor + LOOKAHEAD)
    for (let k = cursor; k < upper; k += 1) {
      if (dw[k].text === a.text) {
        pairs.push({ s0: a.start, s1: a.end, d0: dw[k].start, d1: dw[k].end })
        cursor = k + 1
        break
      }
    }
  }
  return pairs
}

// ---------------------------------------------------------------------------
// Source projection: strip markdown to visible text per block
// ---------------------------------------------------------------------------

interface StrippedLine {
  raw: string
  text: string
  /** Stripped index -> raw index. */
  toRaw: number[]
}

interface SourceBlock {
  kind: 'text' | 'opaque'
  /** LF offset of the block's first line. */
  prefix: number
  /** LF offset just past the block (exclusive). */
  endExclusive: number
  startLine: number
  lines: StrippedLine[]
  /** Cumulative stripped offsets of each line's start. */
  lineStrippedStart: number[]
  stripped: string
}

const LIST_MARKER_RE = /^\s{0,3}([-*+]|\d{1,9}[.)])(\s+|\t+)(\[[ xX]\]\s+)?/
const HEADING_RE = /^\s{0,3}#{1,6}(\s+|$)/
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const TABLE_SEP_RE = /^\s{0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/

/**
 * Strip inline markdown over `raw[from..to)`; every rendered char is pushed
 * with its ABSOLUTE index inside the full raw line. `skip` marks block-level
 * syntax positions (heading `#`, list markers, quote `>`, table pipes) that
 * never render, so callers must not pre-remove the block head before calling.
 */
function stripInlineRange(
  raw: string,
  from: number,
  to: number,
  skip: readonly boolean[],
  out: string[],
  map: number[],
): void {
  const push = (ch: string, idx: number): void => {
    out.push(ch)
    map.push(idx)
  }
  let i = from
  while (i < to) {
    if (skip[i]) {
      i += 1
      continue
    }
    const ch = raw[i]
    // Backslash escape: the next char renders literally.
    if (ch === '\\' && i + 1 < to) {
      if (!skip[i + 1]) push(raw[i + 1], i + 1)
      i += 2
      continue
    }
    // Inline code: backticks themselves never render.
    if (ch === '`') {
      i += 1
      continue
    }
    // Emphasis / strikethrough markers.
    if (ch === '*' || ch === '_' || ch === '~') {
      i += 1
      continue
    }
    // Link / image / footnote ref: render only the label inside [...].
    if (ch === '[' || (ch === '!' && raw[i + 1] === '[')) {
      const open = ch === '[' ? i : i + 1
      let depth = 0
      let close = -1
      for (let k = open; k < to; k += 1) {
        if (raw[k] === '[') {
          depth += 1
        } else if (raw[k] === ']') {
          depth -= 1
          if (depth === 0) {
            close = k
            break
          }
        }
      }
      if (close > open) {
        stripInlineRange(raw, open + 1, close, skip, out, map)
        // Skip a following (url|title) target when present.
        let p = close + 1
        while (p < to && /\s/.test(raw[p])) p += 1
        if (raw[p] === '(') {
          let pd = 1
          p += 1
          while (p < to && pd > 0) {
            if (raw[p] === '(') pd += 1
            else if (raw[p] === ')') pd -= 1
            p += 1
          }
        }
        i = p
        continue
      }
    }
    // Common HTML entities (the primitive escapes raw HTML, but decodes these).
    if (ch === '&') {
      const ent = /^&(?:amp|lt|gt|quot|apos|#39|#x27);/i.exec(raw.slice(i, i + 24))
      if (ent !== null && i + ent[0].length <= to) {
        const decoded = ent[0].toLowerCase() === '&amp;' ? '&'
          : ent[0].toLowerCase() === '&lt;' ? '<'
            : ent[0].toLowerCase() === '&gt;' ? '>'
              : "'"
        push(decoded, i)
        i += ent[0].length
        continue
      }
    }
    push(ch, i)
    i += 1
  }
}

function stripLine(raw: string, context: 'plain' | 'heading' | 'list' | 'quote' | 'table'): StrippedLine {
  if (context === 'table' && TABLE_SEP_RE.test(raw)) {
    return { raw, text: '', toRaw: [] }
  }
  // Block-level syntax ranges in absolute raw-line coordinates.
  const skip: boolean[] = new Array(raw.length).fill(false)
  const skipRange = (a: number, b: number): void => {
    for (let k = Math.max(0, a); k < Math.min(raw.length, b); k += 1) skip[k] = true
  }
  if (context === 'heading') {
    const head = /^\s{0,3}#{1,6}(?:\s+|$)/.exec(raw)
    if (head !== null) skipRange(0, head[0].length)
    const tail = /\s+#+\s*$/.exec(raw)
    if (tail !== null) skipRange(tail.index, raw.length)
  }
  if (context === 'list') {
    const marker = LIST_MARKER_RE.exec(raw)
    if (marker !== null) skipRange(0, marker[0].length)
  }
  if (context === 'quote') {
    // Up to 3 leading spaces, then a chain of `>` markers (nested quotes),
    // each followed by at most one optional space.
    let k = 0
    while (k < 3 && raw[k] === ' ') k += 1
    while (raw[k] === '>') {
      k += 1
      if (raw[k] === ' ' || raw[k] === '\t') k += 1
    }
    skipRange(0, k)
  }
  if (context === 'table') {
    const left = /^\s*\|/.exec(raw)
    if (left !== null) skipRange(0, left[0].length)
    const right = /\|\s*$/.exec(raw)
    if (right !== null) skipRange(right.index, raw.length)
  }
  const out: string[] = []
  const map: number[] = []
  stripInlineRange(raw, 0, raw.length, skip, out, map)
  return { raw, text: out.join(''), toRaw: map }
}

function isBlockStart(line: string, next: string | undefined): boolean {
  if (FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line)) return true
  if (LIST_MARKER_RE.test(line)) return true
  if (/^\s{0,3}>/.test(line)) return true
  if (line.includes('|') && next !== undefined && TABLE_SEP_RE.test(next)) return true
  return false
}

function tokenizeSource(source: string): SourceBlock[] {
  const lines = source.split('\n')
  const blocks: SourceBlock[] = []
  let i = 0
  let inFence: string | null = null

  // Global LF offset of each line's first char.
  const linePrefix: number[] = []
  let acc = 0
  for (const line of lines) {
    linePrefix.push(acc)
    acc += line.length + 1
  }

  const build = (
    kind: 'text' | 'opaque',
    start: number,
    endExclusiveLine: number,
    context: 'plain' | 'heading' | 'list' | 'quote' | 'table',
  ): void => {
    const strippedLines: StrippedLine[] = []
    const starts: number[] = []
    let stripped = ''
    for (let k = start; k < endExclusiveLine; k += 1) {
      starts.push(stripped.length)
      const sl = kind === 'opaque'
        ? { raw: lines[k], text: '', toRaw: [] }
        : stripLine(lines[k], context)
      strippedLines.push(sl)
      stripped += sl.text
    }
    const prefix = linePrefix[start]
    const endExclusive = linePrefix[endExclusiveLine - 1] + lines[endExclusiveLine - 1].length + 1
    blocks.push({
      kind,
      prefix,
      endExclusive,
      startLine: start + 1,
      lines: strippedLines,
      lineStrippedStart: starts,
      stripped,
    })
  }

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }
    const fenceMatch = FENCE_RE.exec(line)
    if (inFence !== null || fenceMatch !== null) {
      if (inFence === null) {
        inFence = fenceMatch?.[1][0].repeat(3) ?? '```'
      }
      const start = i
      i += 1
      let closed = false
      while (i < lines.length) {
        if (lines[i].trim().startsWith(inFence)) {
          i += 1
          closed = true
          break
        }
        i += 1
      }
      build('opaque', start, i, 'plain')
      if (closed) inFence = null
      continue
    }
    if (HR_RE.test(line)) {
      build('opaque', i, i + 1, 'plain')
      i += 1
      continue
    }
    if (HEADING_RE.test(line)) {
      build('text', i, i + 1, 'heading')
      i += 1
      continue
    }
    const isTable = line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])
    const isList = LIST_MARKER_RE.test(line)
    const isQuote = /^\s{0,3}>/.test(line)
    const context: 'list' | 'quote' | 'table' | 'plain' =
      isTable ? 'table' : isList ? 'list' : isQuote ? 'quote' : 'plain'
    const start = i
    i += 1
    while (i < lines.length) {
      if (lines[i].trim() === '') break
      if (context !== 'table' && isBlockStart(lines[i], lines[i + 1])) break
      if (context === 'table' && !lines[i].includes('|')) break
      i += 1
    }
    build('text', start, i, context)
  }
  return blocks
}

// ---------------------------------------------------------------------------
// ProseMirror doc blocks
// ---------------------------------------------------------------------------

export interface DocBlock {
  /** The PM textblock node (paragraph/heading/code_block/table cell text). */
  node: PMNode
  /** PM position of the first inline content char (just inside the node). */
  from: number
  /** PM position just past the last inline content char. */
  to: number
  /** `node.textContent` — visible text already stripped of MD syntax. */
  text: string
}

/**
 * Collect top-level textblocks from a ProseMirror doc. Walks the node tree,
 * unwrapping blockquote/list/table wrappers down to their textblock leaves
 * (paragraph/heading/code_block). Empty textblocks are skipped to match
 * `collectDomBlocks` semantics.
 */
export function collectDocBlocks(doc: PMNode): DocBlock[] {
  const blocks: DocBlock[] = []
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.isTextblock) {
      const text = node.textContent
      if (text.trim() !== '') {
        blocks.push({ node, from: pos + 1, to: pos + 1 + text.length, text })
      }
      return false // do not descend into the textblock
    }
    return true
  })
  return blocks
}

// ---------------------------------------------------------------------------
// Alignment model + coordinate conversion
// ---------------------------------------------------------------------------

interface Pairing {
  src: SourceBlock
  doc: DocBlock
  pairs: WordPair[]
}

export interface DocAlignmentModel {
  source: string
  sourceBlocks: SourceBlock[]
  /** All pairings in document order (for stable iteration / lookup). */
  pairings: Pairing[]
  pairingsByDoc: Map<PMNode, Pairing>
}

export function buildDocAlignmentModel(doc: PMNode, source: string): DocAlignmentModel {
  const sourceBlocks = tokenizeSource(source)
  const docBlocks = collectDocBlocks(doc)
  const pairings: Pairing[] = []
  const pairingsByDoc = new Map<PMNode, Pairing>()

  // Greedy ordered pairing with a small lookahead; a global best-match
  // fallback rescues reordered/merged blocks.
  let cursor = 0
  const usable = sourceBlocks.map((block, idx) => ({ block, idx }))
    .filter(entry => entry.block.kind === 'text' && entry.block.stripped.trim() !== '')
  for (const db of docBlocks) {
    const docWords = wordTokens(db.text)
    if (docWords.length === 0) continue
    const score = (sb: SourceBlock): { pairs: WordPair[]; score: number } => {
      const pairs = alignWords(sb.stripped, db.text)
      return { pairs, score: pairs.length / Math.max(wordTokens(sb.stripped).length, docWords.length) }
    }
    let best: { idx: number; pairs: WordPair[]; score: number } | null = null
    const upper = Math.min(usable.length, cursor + 6)
    for (let k = cursor; k < upper; k += 1) {
      const candidate = score(usable[k].block)
      if (best === null || candidate.score > best.score) {
        best = { idx: k, pairs: candidate.pairs, score: candidate.score }
      }
    }
    if ((best === null || best.score < 0.5)) {
      for (let k = 0; k < usable.length; k += 1) {
        if (best !== null && k >= cursor && k < cursor + 6) continue
        const candidate = score(usable[k].block)
        if (candidate.score >= 0.7 && (best === null || candidate.score > best.score)) {
          best = { idx: k, pairs: candidate.pairs, score: candidate.score }
        }
      }
    }
    if (best !== null && best.score >= 0.5) {
      const sb = usable[best.idx].block
      const pairing: Pairing = { src: sb, doc: db, pairs: best.pairs }
      pairings.push(pairing)
      pairingsByDoc.set(db.node, pairing)
      cursor = best.idx + 1
    }
  }
  return { source, sourceBlocks, pairings, pairingsByDoc }
}

/** Source stripped coordinate -> rendered coordinate (interval start). */
function srcToVisibleStart(pairs: WordPair[], pos: number): number | null {
  if (pairs.length === 0) return null
  if (pos <= pairs[0].s0) return pairs[0].d0
  for (let k = 0; k < pairs.length; k += 1) {
    const p = pairs[k]
    if (pos >= p.s0 && pos <= p.s1) return p.d0 + (pos - p.s0)
    const next = pairs[k + 1]
    if (next !== undefined && pos > p.s1 && pos < next.s0) return p.d1
  }
  return pairs[pairs.length - 1].d1
}

/** Source stripped coordinate -> rendered coordinate (interval end). */
function srcToVisibleEnd(pairs: WordPair[], pos: number): number | null {
  if (pairs.length === 0) return null
  if (pos >= pairs[pairs.length - 1].s1) return pairs[pairs.length - 1].d1
  for (let k = 0; k < pairs.length; k += 1) {
    const p = pairs[k]
    if (pos >= p.s0 && pos <= p.s1) return p.d0 + (pos - p.s0)
    if (pos < p.s0) return p.d0
  }
  return pairs[pairs.length - 1].d1
}

/** Rendered coordinate -> nearest source stripped coordinate. */
function visibleToSrc(pairs: WordPair[], pos: number): number | null {
  if (pairs.length === 0) return null
  if (pos <= pairs[0].d0) return pairs[0].s0
  const last = pairs[pairs.length - 1]
  if (pos >= last.d1) return last.s1
  for (let k = 0; k < pairs.length; k += 1) {
    const p = pairs[k]
    if (pos >= p.d0 && pos <= p.d1) return p.s0 + (pos - p.d0)
    const next = pairs[k + 1]
    if (next !== undefined && pos > p.d1 && pos < next.d0) {
      return pos - p.d1 <= next.d0 - pos ? p.s1 : next.s0
    }
  }
  return last.s1
}

/**
 * Convert a raw-line local offset to a stripped-text local offset using the
 * line's `toRaw` map (toRaw[strippedIdx] = rawIdx). The raw offset is a
 * half-open boundary, so the result is the count of visible chars whose raw
 * position is STRICTLY before it — this is the exact inverse of strippedToLf
 * at visible-char boundaries. Positions inside block/inline syntax resolve to
 * the enclosing visible boundary.
 */
function rawLocalToStripped(sl: StrippedLine, localRaw: number): number {
  if (sl.toRaw.length === 0 || localRaw <= sl.toRaw[0]) return 0
  if (localRaw >= sl.raw.length) return sl.text.length
  let result = 0
  for (let s = 0; s < sl.toRaw.length; s += 1) {
    if (sl.toRaw[s] < localRaw) result = s + 1
    else break
  }
  return Math.min(result, sl.text.length)
}

/**
 * End-boundary variant: the interval end is a half-open LF boundary, but the
 * rendered interval must COVER the last selected visible char. Count a visible
 * char whose raw position equals the boundary (i.e. an immediately following
 * inline syntax char was skipped), resolving `[start, end)` to its enclosing
 * visible-char end.
 */
function rawLocalToStrippedEnd(sl: StrippedLine, localRaw: number): number {
  if (sl.toRaw.length === 0 || localRaw <= sl.toRaw[0]) return 0
  if (localRaw >= sl.raw.length) return sl.text.length
  let result = 0
  for (let s = 0; s < sl.toRaw.length; s += 1) {
    if (sl.toRaw[s] <= localRaw) result = s + 1
    else break
  }
  return Math.min(result, sl.text.length)
}

/** Global LF offset -> stripped coordinate within its source block. */
function lfToStripped(block: SourceBlock, lf: number, end = false): number {
  let lineRawPrefix = 0
  for (let k = 0; k < block.lines.length; k += 1) {
    const lineLength = block.lines[k].raw.length
    const nextPrefix = lineRawPrefix + lineLength + 1
    if (k === block.lines.length - 1 || lf - block.prefix < nextPrefix) {
      const localRaw = Math.max(0, Math.min(lineLength, lf - block.prefix - lineRawPrefix))
      const resolve = end ? rawLocalToStrippedEnd : rawLocalToStripped
      return block.lineStrippedStart[k] + resolve(block.lines[k], localRaw)
    }
    lineRawPrefix = nextPrefix
  }
  return block.stripped.length
}

/** Stripped coordinate within a block -> global LF offset. */
function strippedToLf(block: SourceBlock, sp: number): number {
  for (let k = 0; k < block.lines.length; k += 1) {
    const lineStart = block.lineStrippedStart[k]
    const lineEnd = lineStart + block.lines[k].text.length
    if (sp >= lineStart && (k === block.lines.length - 1 || sp < block.lineStrippedStart[k + 1])) {
      let lineRawPrefix = 0
      for (let j = 0; j < k; j += 1) lineRawPrefix += block.lines[j].raw.length + 1
      const localStripped = Math.max(0, Math.min(block.lines[k].text.length, sp - lineStart))
      const localRaw = localStripped === block.lines[k].text.length
        ? block.lines[k].raw.length
        : block.lines[k].toRaw[localStripped] ?? block.lines[k].raw.length
      return block.prefix + lineRawPrefix + localRaw
    }
    void lineEnd
  }
  return block.prefix
}

/** Locate the source block containing LF offset `lf` (or the nearest before). */
function findPairingForLf(model: DocAlignmentModel, lf: number): Pairing | null {
  for (const pairing of model.pairings) {
    if (lf >= pairing.src.prefix && lf < pairing.src.endExclusive) return pairing
  }
  // Fallback: last pairing whose src prefix is before lf (for end-of-doc).
  let fallback: Pairing | null = null
  for (const pairing of model.pairings) {
    if (pairing.src.prefix <= lf) fallback = pairing
  }
  return fallback
}

/**
 * Source LF offset -> ProseMirror position. `end` selects the end-boundary
 * resolution (so `[start, end)` maps to an inclusive rendered end). Returns
 * null when no pairing covers the offset.
 */
export function lfToPmPos(model: DocAlignmentModel, lf: number, end = false): number | null {
  const pairing = findPairingForLf(model, lf)
  if (pairing === null) return null
  const stripped = lfToStripped(pairing.src, lf, end)
  const visible = end
    ? srcToVisibleEnd(pairing.pairs, stripped)
    : srcToVisibleStart(pairing.pairs, stripped)
  if (visible === null) return null
  return pairing.doc.from + visible
}

/** ProseMirror position -> source LF offset. Returns null when out of range. */
export function pmPosToLf(model: DocAlignmentModel, pmPos: number): number | null {
  for (const pairing of model.pairings) {
    if (pmPos < pairing.doc.from || pmPos > pairing.doc.to) continue
    const visible = pmPos - pairing.doc.from
    const stripped = visibleToSrc(pairing.pairs, visible)
    if (stripped === null) return null
    return strippedToLf(pairing.src, stripped)
  }
  return null
}

/**
 * 1-based source lines -> PM range for line-level fallback. Walks every
 * pairing and returns the union of PM intervals covering the requested lines'
 * intersection with each block. Use this when precise offsets are unavailable
 * (outdated/orphaned anchors).
 */
export function lfLineToPmRange(
  model: DocAlignmentModel,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  let from: number | null = null
  let to: number | null = null
  for (const pairing of model.pairings) {
    const block = pairing.src
    const blockEndLine = block.startLine + block.lines.length - 1
    if (lineEnd < block.startLine || lineStart > blockEndLine) continue
    const firstLine = Math.max(0, lineStart - block.startLine)
    const lastLine = Math.min(block.lines.length - 1, lineEnd - block.startLine)
    const startStrip = block.lineStrippedStart[firstLine] ?? 0
    const endStrip = block.lineStrippedStart[lastLine + 1] ?? block.stripped.length
    const ds = srcToVisibleStart(pairing.pairs, startStrip)
    const de = srcToVisibleEnd(pairing.pairs, endStrip)
    if (ds === null || de === null || de <= ds) continue
    const pmFrom = pairing.doc.from + ds
    const pmTo = pairing.doc.from + de
    if (from === null || pmFrom < from) from = pmFrom
    if (to === null || pmTo > to) to = pmTo
  }
  if (from === null || to === null) return null
  return { from, to }
}

// ---------------------------------------------------------------------------
// Interval computation (shared with ReviewMarksExtension)
// ---------------------------------------------------------------------------

export interface DocInterval {
  /** PM position start. */
  from: number
  /** PM position end. */
  to: number
  spec: MarkSpec
  /** Zero-length point anchor (from === to): a single 2px bar is inserted. */
  point: boolean
}

export interface MergedInterval {
  from: number
  to: number
  specs: MarkSpec[]
  point: boolean
}

/**
 * For each pairing, compute the PM intervals for every spec that intersects
 * the pairing's source block. Precise offsets map via `lfToPmPos`; lineLevel
 * specs fall back to whole-line PM ranges (via the pairing's line strip map).
 */
export function intervalsForPairing(pairing: Pairing, specs: MarkSpec[]): DocInterval[] {
  const result: DocInterval[] = []
  const block = pairing.src
  for (const spec of specs) {
    if (spec.lineLevel || spec.start === null || spec.end === null) {
      const ls = spec.lineStart
      if (ls === null) continue
      const le = spec.lineEnd ?? ls
      const blockEndLine = block.startLine + block.lines.length - 1
      if (le < block.startLine || ls > blockEndLine) continue
      const firstLine = Math.max(0, ls - block.startLine)
      const lastLine = Math.min(block.lines.length - 1, le - block.startLine)
      const startStrip = block.lineStrippedStart[firstLine] ?? 0
      const endStrip = block.lineStrippedStart[lastLine + 1] ?? block.stripped.length
      const ds = srcToVisibleStart(pairing.pairs, startStrip)
      const de = srcToVisibleEnd(pairing.pairs, endStrip)
      if (ds !== null && de !== null && de > ds) {
        result.push({ from: pairing.doc.from + ds, to: pairing.doc.from + de, spec, point: false })
      }
      continue
    }
    if (spec.end < block.prefix || spec.start > block.endExclusive) continue
    const startLf = Math.max(spec.start, block.prefix)
    const endLf = Math.min(spec.end, block.endExclusive)
    const point = spec.start === spec.end
    const startStrip = lfToStripped(block, startLf)
    const ds = srcToVisibleStart(pairing.pairs, startStrip)
    const de = point
      ? ds
      : srcToVisibleEnd(pairing.pairs, lfToStripped(block, endLf, true))
    if (ds !== null && de !== null && (point || de > ds)) {
      result.push({ from: pairing.doc.from + ds, to: pairing.doc.from + de, spec, point })
    }
  }
  return result
}

export function mergeIntervals(intervals: DocInterval[]): MergedInterval[] {
  const sorted = [...intervals].sort((a, b) => a.from - b.from || Number(a.point) - Number(b.point))
  const merged: MergedInterval[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    // Point intervals never merge (even when sharing a coordinate); range
    // intervals never absorb a point: a zero-width "|" bar must survive.
    if (!interval.point && last !== undefined && !last.point && interval.from <= last.to) {
      last.to = Math.max(last.to, interval.to)
      if (!last.specs.includes(interval.spec)) last.specs.push(interval.spec)
    } else {
      merged.push({ from: interval.from, to: interval.to, specs: [interval.spec], point: interval.point })
    }
  }
  return merged
}

export function statusModifiers(specs: MarkSpec[], requireLineLevel: boolean): string[] {
  const statuses = specs.map(s => s.anchorStatus)
  const lineLevel = specs.every(s => s.lineLevel)
  if (requireLineLevel && lineLevel && statuses.every(status => LOST_STATUSES.has(status))) {
    return ['dbl-rv-anchor-lost']
  }
  if (statuses.some(status => status === 'modified')) return ['dbl-rv-anchor-modified']
  if (statuses.every(status => status === 'moved')) return ['dbl-rv-anchor-moved']
  return []
}

export function markClassName(specs: MarkSpec[]): string {
  const reviews = specs.flatMap(s => s.reviews)
  if (reviews.length === 0) return 'dbl-rv-anchor'
  const top = reviews.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc.severity] ? review : acc,
  reviews[0])
  return ['dbl-rv-anchor', `dbl-rv-sev-${top.severity}`, ...statusModifiers(specs, true)].join(' ')
}

/** Zero-length point anchor: a single 2px bar (no background tint). */
export function pointClassName(specs: MarkSpec[]): string {
  const reviews = specs.flatMap(s => s.reviews)
  if (reviews.length === 0) return 'dbl-rv-point'
  const top = reviews.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc.severity] ? review : acc,
  reviews[0])
  return ['dbl-rv-point', `dbl-rv-point-sev-${top.severity}`, ...statusModifiers(specs, true)].join(' ')
}

/**
 * Line-level fallback class (whole-line tint when precise offsets are
 * unavailable). Same severity + status modifier logic as `markClassName`,
 * but the base is `dbl-rv-hl dbl-rv-line-level` so CSS can scope a softer
 * full-line background.
 */
export function lineLevelClassName(specs: MarkSpec[]): string {
  const reviews = specs.flatMap(s => s.reviews)
  if (reviews.length === 0) return 'dbl-rv-hl dbl-rv-line-level'
  const top = reviews.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc.severity] ? review : acc,
  reviews[0])
  return ['dbl-rv-hl', 'dbl-rv-line-level', `dbl-rv-sev-${top.severity}`, ...statusModifiers(specs, true)].join(' ')
}

/** Top severity among a spec bundle's reviews (for chip button class + attrs). */
export function topSeverity(specs: MarkSpec[]): MarkReviewLite | null {
  const reviews = specs.flatMap(s => s.reviews)
  if (reviews.length === 0) return null
  return reviews.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc.severity] ? review : acc,
  reviews[0])
}

/**
 * Build MarkSpec list from raw review rows. Mirrors NodeCard's
 * `previewMarkSpecs` projection: precise matchOffset* for valid/moved anchors,
 * lineLevel degradation for outdated/orphaned or missing offsets.
 */
export interface ReviewRowLike {
  reviewId: string
  number: number
  severity: string
  status: string
  anchorStatus: string
  lineStart: number | null
  lineEnd: number | null
  matchOffsetStart: number | null
  matchOffsetEnd: number | null
}

export const ACTIVE_REVIEW_STATUSES = new Set([
  'open',
  'discussing',
  'needs_review',
  'accepted',
  'implementing',
  'implemented',
  'verifying',
])

export const DRIFTED_ANCHOR_STATUSES = new Set(['moved', 'modified', 'outdated', 'orphaned'])

export function buildMarkSpecs(rows: readonly ReviewRowLike[]): MarkSpec[] {
  const specs: MarkSpec[] = []
  for (const row of rows) {
    if (!ACTIVE_REVIEW_STATUSES.has(row.status)) continue
    if (row.lineStart === null) continue
    const severity = (['info', 'minor', 'major', 'critical'] as const).includes(row.severity as PreviewSeverity)
      ? (row.severity as PreviewSeverity)
      : 'info'
    const review: MarkReviewLite = {
      reviewId: row.reviewId,
      number: row.number,
      severity,
    }
    const precise = row.matchOffsetStart !== null && row.matchOffsetEnd !== null
      && row.anchorStatus !== 'outdated' && row.anchorStatus !== 'orphaned'
    specs.push({
      start: precise ? row.matchOffsetStart : null,
      end: precise ? row.matchOffsetEnd : null,
      lineLevel: !precise,
      lineStart: row.lineStart,
      lineEnd: row.lineEnd ?? row.lineStart,
      anchorStatus: row.anchorStatus,
      reviews: [review],
    })
  }
  return specs
}
