/**
 * Rendered-GFM ↔ Markdown-source alignment for review marks in the preview
 * surface (design/05 §2.2 / §5.1).
 *
 * The MarkdownText primitive strips syntax chars, decodes entities and folds
 * soft line breaks, so rendered character offsets never equal source
 * offsets. The alignment is word-based and deliberately fuzzy (the host
 * anchor resolver treats line/offset hints as estimates anyway):
 *
 *   1. the LF source is split into top-level blocks (paragraph / heading /
 *      list / quote / table / fence); each block's lines are stripped to a
 *      visible-text projection while word order is preserved;
 *   2. the rendered DOM contributes one block per top-level element,
 *      excluding .md-code-block / section.footnotes / .katex subtrees;
 *   3. source and rendered blocks are paired greedily by word overlap, then
 *      words inside a pair are aligned (ordered equal-word scan), yielding
 *      conversions in both directions:
 *        - source LF offset -> rendered offset (mark injection)
 *        - rendered selection Range -> source LF offsets (reverse mapping)
 *
 * Injection is idempotent: every injected node carries data-dbl-rv, and
 * unwindReviewMarks() unpacks them back to plain text before re-injection, so
 * React re-renders can replay safely.
 */

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

interface WordPair {
  s0: number
  s1: number
  d0: number
  d1: number
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
// Rendered DOM blocks
// ---------------------------------------------------------------------------

interface TextNodeInfo {
  node: Text
  start: number
  end: number
}

interface DomBlock {
  el: HTMLElement
  text: string
  nodes: TextNodeInfo[]
  /**
   * When the block element is an <li> that may contain a nested list, text
   * inside descendant <li> elements belongs to its own source blocks and must
   * not be counted here.
   */
  scopeLi: HTMLLIElement | null
}

const EXCLUDED_SELECTOR = '.md-code-block, section.footnotes, .katex'

function collectTextNodes(
  el: HTMLElement,
  scopeLi?: HTMLLIElement,
): { text: string; nodes: TextNodeInfo[] } {
  const nodes: TextNodeInfo[] = []
  const parts: string[] = []
  let total = 0
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent === null) return NodeFilter.FILTER_REJECT
      // Injected number chips carry their own "#N" text; never align on it.
      if (parent.closest('.katex') || parent.closest('[data-dbl-rv="nums"]')) {
        return NodeFilter.FILTER_REJECT
      }
      // Exclude text of nested list items (each is a separate source block).
      if (scopeLi !== undefined && parent.closest('li') !== scopeLi) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let current: Node | null
  while ((current = walker.nextNode()) !== null) {
    const textNode = current as Text
    const value = textNode.nodeValue ?? ''
    parts.push(value)
    nodes.push({ node: textNode, start: total, end: total + value.length })
    total += value.length
  }
  return { text: parts.join(''), nodes }
}

/**
 * Locate the MarkdownText render container inside our wrapper. The renderer
 * uses a CSS-module hashed class (e.g. `_markdown_xxx`), so match by a
 * `markdown` substring and fall back to the single non-UI content child.
 */
function findMarkdownContainer(root: HTMLElement): HTMLElement {
  const direct = Array.from(root.children).filter((el): el is HTMLElement =>
    el instanceof HTMLElement
    && !el.classList.contains('dbl-node-md-note')
    && !el.classList.contains('dbl-rv-fab'))
  const hashed = direct.find(el => /(^|[_\s-])markdown([_\s-]|$)/.test(el.className))
  if (hashed !== undefined) return hashed
  return direct.length === 1 ? direct[0] : root
}

/**
 * Top-level rendered elements that merely wrap real block content one level
 * down (`<blockquote><p>…`, GFM `<ul><li><p>…`). Marks must be injected on
 * the inner block, because Range.surroundContents cannot cross element
 * boundaries. Blockquotes contribute every inner paragraph/item; lists
 * contribute exactly their direct (top-level) <li> children — nested lists'
 * items are reached recursively through their own ancestor <ul>/<ol>.
 */
const BLOCK_WRAPPER_SELECTOR = 'blockquote, ul, ol'

function expandWrappedBlock(wrapper: HTMLElement): { el: HTMLElement; scopeLi: HTMLLIElement | null }[] {
  const selector = wrapper.tagName === 'BLOCKQUOTE'
    ? 'p,li,h1,h2,h3,h4,h5,h6'
    : 'li'
  // querySelectorAll returns descendants in document order, which also
  // reaches items of nested lists (parent item before its children).
  const candidates = Array.from(wrapper.querySelectorAll(selector))
    .filter(el => el instanceof HTMLElement
      && el.closest('.md-code-block, section.footnotes') === null) as HTMLElement[]
  const selectedLis = candidates.filter(el => el.tagName === 'LI')
  return candidates
    // A loose list item renders <li><p>…; collecting the <li> already covers
    // its <p>/<h> descendants, so drop those (nested <li> are kept).
    .filter(el => el.tagName === 'LI'
      || !selectedLis.some(li => li !== el && li.contains(el)))
    .map(el => ({ el, scopeLi: el.tagName === 'LI' ? el as HTMLLIElement : null }))
}

function collectDomBlocks(root: HTMLElement): DomBlock[] {
  const container = findMarkdownContainer(root)
  const blockEls: { el: HTMLElement; scopeLi: HTMLLIElement | null }[] = []
  for (const child of Array.from(container.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (child.matches('.md-code-block') || child.matches('section.footnotes')) continue
    if (child.matches(BLOCK_WRAPPER_SELECTOR)) {
      const inner = expandWrappedBlock(child)
      if (inner.length > 0) {
        blockEls.push(...inner)
        continue
      }
    }
    blockEls.push({ el: child, scopeLi: null })
  }
  const blocks: DomBlock[] = []
  for (const { el, scopeLi } of blockEls) {
    const collected = collectTextNodes(el, scopeLi ?? undefined)
    if (collected.text.trim() === '') continue
    blocks.push({ el, text: collected.text, nodes: collected.nodes, scopeLi })
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Alignment model + coordinate conversion
// ---------------------------------------------------------------------------

interface Pairing {
  src: SourceBlock
  dom: DomBlock
  pairs: WordPair[]
}

export interface AlignmentModel {
  source: string
  sourceBlocks: SourceBlock[]
  pairingsByDom: Map<HTMLElement, Pairing>
}

export function buildAlignmentModel(root: HTMLElement, source: string): AlignmentModel {
  const sourceBlocks = tokenizeSource(source)
  const domBlocks = collectDomBlocks(root)
  const pairingsByDom = new Map<HTMLElement, Pairing>()

  // Greedy ordered pairing with a small lookahead; a global best-match
  // fallback rescues reordered/merged blocks.
  let cursor = 0
  const usable = sourceBlocks.map((block, idx) => ({ block, idx }))
    .filter(entry => entry.block.kind === 'text' && entry.block.stripped.trim() !== '')
  for (const db of domBlocks) {
    const domWords = wordTokens(db.text)
    if (domWords.length === 0) continue
    const score = (sb: SourceBlock): { pairs: WordPair[]; score: number } => {
      const pairs = alignWords(sb.stripped, db.text)
      return { pairs, score: pairs.length / Math.max(wordTokens(sb.stripped).length, domWords.length) }
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
      pairingsByDom.set(db.el, { src: sb, dom: db, pairs: best.pairs })
      cursor = best.idx + 1
    }
  }
  return { source, sourceBlocks, pairingsByDom }
}

/** Source stripped coordinate -> rendered coordinate (interval start). */
function srcToDomStart(pairs: WordPair[], pos: number): number | null {
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
function srcToDomEnd(pairs: WordPair[], pos: number): number | null {
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
function domToSrc(pairs: WordPair[], pos: number): number | null {
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

// ---------------------------------------------------------------------------
// Selection reverse mapping (rendered Range -> LF source offsets)
// ---------------------------------------------------------------------------

/**
 * Offset of a Range boundary inside a rendered block. `nodes` are the block's
 * text nodes in document order (re-collected live, since mark injection splits
 * them), with cumulative [start, end) offsets in the block's concatenated
 * visible text.
 */
function textOffsetWithin(nodes: TextNodeInfo[], node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    let total = 0
    for (const info of nodes) {
      if (info.node === node) return total + Math.min(offset, (node.nodeValue ?? '').length)
      total = info.end
    }
    return null
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  // Boundary is at child index `offset` inside el. Walk block-global nodes in
  // document order, summing every text node that precedes the boundary.
  const target = offset < el.childNodes.length ? el.childNodes[offset] : null
  let total = 0
  for (const info of nodes) {
    const n = info.node
    if (target !== null && (n === target || target.contains(n))) break
    if (el.contains(n)) {
      // Inside el: stop once the node follows the boundary child.
      if (target !== null && n.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING) break
      total = info.end
    } else if (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      total = info.end
    } else {
      break
    }
  }
  return total
}

export function domRangeToSource(
  model: AlignmentModel,
  range: Range,
): { start: number; end: number } | null {
  const boundary = (container: Node, offset: number): { pairing: Pairing; dom: number } | null => {
    if (container.nodeType === Node.ELEMENT_NODE) {
      const el = container as Element
      if (el.closest(EXCLUDED_SELECTOR)) return null
    } else if (container.parentElement?.closest(EXCLUDED_SELECTOR)) {
      return null
    }
    for (const pairing of model.pairingsByDom.values()) {
      if (!pairing.dom.el.contains(container)) continue
      // Marks injected after model construction split text nodes; re-collect
      // the live text nodes so offsets match the current DOM.
      const live = collectTextNodes(pairing.dom.el, pairing.dom.scopeLi ?? undefined).nodes
      const local = textOffsetWithin(live, container, offset)
      if (local === null) return null
      const stripped = domToSrc(pairing.pairs, local)
      if (stripped === null) return null
      return { pairing, dom: stripped }
    }
    return null
  }
  const startPoint = boundary(range.startContainer, range.startOffset)
  const endPoint = boundary(range.endContainer, range.endOffset)
  if (startPoint === null || endPoint === null) return null
  const start = strippedToLf(startPoint.pairing.src, startPoint.dom)
  const end = strippedToLf(endPoint.pairing.src, endPoint.dom)
  if (end <= start) return null
  return { start, end }
}

// ---------------------------------------------------------------------------
// Idempotent mark injection
// ---------------------------------------------------------------------------

const INJECTED_ATTR = 'data-dbl-rv'

/** Unwrap every previously injected mark/point/chip back into plain text. */
export function unwindReviewMarks(root: HTMLElement): void {
  // Chips first (they live inside marks/points and carry no source text).
  root.querySelectorAll(`[${INJECTED_ATTR}="nums"]`).forEach(el => { el.remove() })
  // Points are empty markers: remove outright.
  root.querySelectorAll(`[${INJECTED_ATTR}="point"]`).forEach(el => { el.remove() })
  // Marks in reverse document order: nested marks (pending overlapping a
  // committed mark) are unwrapped before their ancestors.
  const marks = Array.from(root.querySelectorAll(`[${INJECTED_ATTR}="mark"]`))
  for (let k = marks.length - 1; k >= 0; k -= 1) {
    const el = marks[k]
    const fragment = document.createDocumentFragment()
    while (el.firstChild !== null) fragment.appendChild(el.firstChild)
    el.replaceWith(fragment)
  }
  root.normalize()
}

interface DomInterval {
  ds: number
  de: number
  spec: MarkSpec
  /** Zero-length point anchor (ds === de): a single 2px bar is inserted. */
  point: boolean
}

function intervalsForBlock(model: AlignmentModel, pairing: Pairing, specs: MarkSpec[]): DomInterval[] {
  const result: DomInterval[] = []
  const block = pairing.src
  for (const spec of specs) {
    if (spec.lineLevel || spec.start === null || spec.end === null) {
      const ls = spec.lineStart
      const le = spec.lineEnd ?? ls
      if (ls !== null && le !== null
        && le >= block.startLine
        && ls < block.startLine + block.lines.length) {
        // Highlight only the intersecting source lines within this block.
        const firstLine = Math.max(0, ls - block.startLine)
        const lastLine = Math.min(block.lines.length - 1, le - block.startLine)
        const ds = srcToDomStart(pairing.pairs, block.lineStrippedStart[firstLine] ?? 0)
        const endStrip = (block.lineStrippedStart[lastLine + 1] ?? block.stripped.length)
        const de = srcToDomEnd(pairing.pairs, endStrip)
        if (ds !== null && de !== null && de > ds) result.push({ ds, de, spec, point: false })
      }
      continue
    }
    if (spec.end < block.prefix || spec.start > block.endExclusive) continue
    const startLf = Math.max(spec.start, block.prefix)
    const endLf = Math.min(spec.end, block.endExclusive)
    const point = spec.start === spec.end
    const ds = srcToDomStart(pairing.pairs, lfToStripped(block, startLf))
    const de = point
      ? ds
      : srcToDomEnd(pairing.pairs, lfToStripped(block, endLf, true))
    // Point intervals may collapse to the same rendered coordinate (ds===de);
    // non-point intervals still require a positive rendered length.
    if (ds !== null && de !== null && (point || de > ds)) {
      result.push({ ds, de, spec, point })
    }
  }
  return result
}

interface MergedInterval {
  ds: number
  de: number
  specs: MarkSpec[]
  point: boolean
}

function mergeIntervals(intervals: DomInterval[]): MergedInterval[] {
  const sorted = [...intervals].sort((a, b) => a.ds - b.ds || Number(a.point) - Number(b.point))
  const merged: MergedInterval[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    // Point intervals never merge (even when sharing a coordinate); range
    // intervals never absorb a point: a zero-width "|" bar must survive.
    if (!interval.point && last !== undefined && !last.point && interval.ds <= last.de) {
      last.de = Math.max(last.de, interval.de)
      if (!last.specs.includes(interval.spec)) last.specs.push(interval.spec)
    } else {
      merged.push({ ds: interval.ds, de: interval.de, specs: [interval.spec], point: interval.point })
    }
  }
  return merged
}

function statusModifiers(specs: MarkSpec[], requireLineLevel: boolean): string[] {
  const statuses = specs.map(s => s.anchorStatus)
  const lineLevel = specs.every(s => s.lineLevel)
  if (requireLineLevel && lineLevel && statuses.every(status => LOST_STATUSES.has(status))) {
    return ['dbl-rv-anchor-lost']
  }
  if (statuses.some(status => status === 'modified')) return ['dbl-rv-anchor-modified']
  if (statuses.every(status => status === 'moved')) return ['dbl-rv-anchor-moved']
  return []
}

function markClassName(specs: MarkSpec[]): string {
  const reviews = specs.flatMap(s => s.reviews)
  const top = reviews.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc.severity] ? review : acc,
  reviews[0])
  return ['dbl-rv-anchor', `dbl-rv-sev-${top.severity}`, ...statusModifiers(specs, true)].join(' ')
}

/** Zero-length point anchor: a single 2px bar (no background tint). */
function pointClassName(specs: MarkSpec[]): string {
  const reviews = specs.flatMap(s => s.reviews)
  const top = reviews.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc.severity] ? review : acc,
  reviews[0])
  return ['dbl-rv-point', `dbl-rv-point-sev-${top.severity}`, ...statusModifiers(specs, true)].join(' ')
}

interface Segment {
  node: Text
  s0: number
  s1: number
  /** Visible-coordinate span of the owning text node within the block. */
  vStart: number
  vEnd: number
  order: number
}

function wrapSegment(
  block: DomBlock,
  ds: number,
  de: number,
  className: string,
  specs: MarkSpec[] | null,
  handlers: MarkHandlers | null,
  edgeStart = false,
  edgeEnd = false,
): void {
  // Earlier interval injections (surroundContents splits text nodes; the
  // appended nums chips add "#N" text) invalidate both the model-build-time
  // block.nodes and the plain concatenation of the live DOM: re-walk the
  // block skipping injected chip subtrees, accumulating the same visible
  // coordinates the model was built with.
  const segments: Segment[] = []
  let acc = 0
  let order = 0
  const walker = document.createTreeWalker(block.el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent === null) return NodeFilter.FILTER_REJECT
      if (parent.closest('[data-dbl-rv="nums"]')) return NodeFilter.FILTER_REJECT
      if (block.scopeLi !== null && parent.closest('li') !== block.scopeLi) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let current: Node | null
  while ((current = walker.nextNode()) !== null) {
    const textNode = current as Text
    const value = textNode.nodeValue ?? ''
    const start = acc
    const end = acc + value.length
    acc = end
    if (end <= ds || start >= de) {
      order += 1
      continue
    }
    const s0 = Math.max(start, ds) - start
    const s1 = Math.min(end, de) - start
    if (s1 > s0) segments.push({ node: textNode, s0, s1, vStart: start, vEnd: end, order })
    order += 1
  }
  if (segments.length === 0) return
  // Tail-first within the document order keeps earlier offsets valid after
  // surroundContents splits text nodes.
  segments.sort((a, b) => b.order - a.order || b.s0 - a.s0)
  let firstMark: HTMLElement | null = null
  let lastMark: HTMLElement | null = null
  for (const segment of segments) {
    const nodeLength = segment.node.nodeValue?.length ?? 0
    if (segment.s0 >= nodeLength) continue
    const range = document.createRange()
    range.setStart(segment.node, segment.s0)
    range.setEnd(segment.node, Math.min(segment.s1, nodeLength))
    const mark = document.createElement('mark')
    const segStart = Math.max(segment.vStart, ds)
    const segEnd = Math.min(segment.vEnd, de)
    mark.className = `${className}${edgeStart && segStart === ds ? ' dbl-rv-edge-start' : ''}${edgeEnd && segEnd === de ? ' dbl-rv-edge-end' : ''}`
    mark.setAttribute(INJECTED_ATTR, 'mark')
    if (specs !== null) {
      const reviewsForAttr = specs.flatMap(s => s.reviews)
      const ids = reviewsForAttr.map(r => r.reviewId)
        .filter((id, idx, all) => all.indexOf(id) === idx)
      const primaryStatus = specs[0]?.anchorStatus ?? 'valid'
      const primarySev = reviewsForAttr.reduce((acc, review) =>
        SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc] ? review.severity : acc,
        'info' as PreviewSeverity)
      mark.setAttribute('data-review-id', ids.join(' '))
      mark.setAttribute('data-anchor-status', primaryStatus)
      mark.setAttribute('data-severity', primarySev)
    }
    try {
      range.surroundContents(mark)
    } catch {
      continue
    }
    // Wrapping runs tail-first; the FIRST wrapped mark in document order is the
    // one processed last. Track both ends: chips anchor at the visual END of
    // the (possibly split) interval, the click target uses the start.
    firstMark = mark
    if (lastMark === null) lastMark = mark
  }
  if (firstMark === null || specs === null || handlers === null) return
  attachNums(lastMark ?? firstMark, specs, handlers, firstMark)
}

/** Append the "#N" chips to a mark/point host and bind the click target. */
function attachNums(
  chipHost: HTMLElement,
  specs: MarkSpec[],
  handlers: MarkHandlers,
  clickHost: HTMLElement,
): void {
  const reviews = specs.flatMap(s => s.reviews)
  const unique = reviews.filter((review, idx) =>
    reviews.findIndex(r => r.reviewId === review.reviewId) === idx)
  // Chips cannot legally nest inside the fileMention <button> primitive.
  if (chipHost.closest('button') !== null) return
  const nums = document.createElement('span')
  nums.className = 'dbl-rv-anchor-nums'
  nums.setAttribute(INJECTED_ATTR, 'nums')
  for (const review of unique) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = `dbl-rv-anchor-num dbl-rv-num-${review.severity}`
    chip.textContent = String(review.number)
    chip.title = handlers.titleFor(review)
    chip.addEventListener('mousedown', event => event.preventDefault())
    chip.addEventListener('click', event => {
      event.stopPropagation()
      event.preventDefault()
      handlers.openReview(review.reviewId)
    })
    nums.appendChild(chip)
  }
  chipHost.appendChild(nums)
  const primary = unique.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc.severity] ? review : acc,
  unique[0])
  if (primary !== undefined) {
    clickHost.addEventListener('click', () => handlers.openReview(primary.reviewId))
  }
}

/**
 * Insert a zero-width point marker ("|") at rendered coordinate `dp`.
 * surroundContents cannot wrap a collapsed range, so the point is an empty
 * inline element spliced between text nodes. Re-walk the block (skipping
 * injected subtrees) to locate the boundary, same as wrapSegment.
 */
function insertPoint(
  block: DomBlock,
  dp: number,
  className: string,
  specs: MarkSpec[],
  handlers: MarkHandlers | null,
): void {
  let candidate: { node: Text; local: number } | null = null
  let acc = 0
  const walker = document.createTreeWalker(block.el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent === null) return NodeFilter.FILTER_REJECT
      if (parent.closest(`[${INJECTED_ATTR}="nums"], [${INJECTED_ATTR}="point"]`)) {
        return NodeFilter.FILTER_REJECT
      }
      if (block.scopeLi !== null && parent.closest('li') !== block.scopeLi) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let current: Node | null
  while ((current = walker.nextNode()) !== null) {
    const textNode = current as Text
    const length = textNode.nodeValue?.length ?? 0
    const start = acc
    const end = acc + length
    acc = end
    if (dp > start && dp < end) {
      candidate = { node: textNode, local: dp - start }
      break
    }
    if (dp === end) candidate = { node: textNode, local: length }
    else if (candidate === null && dp === start && length > 0) {
      candidate = { node: textNode, local: 0 }
    }
  }
  if (candidate === null) return
  const { node, local } = candidate
  const point = document.createElement('span')
  point.className = className
  point.setAttribute(INJECTED_ATTR, 'point')
  const reviewsForAttr = specs.flatMap(s => s.reviews)
  const ids = reviewsForAttr.map(r => r.reviewId)
    .filter((id, idx, all) => all.indexOf(id) === idx)
  const primaryStatus = specs[0]?.anchorStatus ?? 'valid'
  const primarySev = reviewsForAttr.reduce((acc, review) =>
    SEVERITY_RANK[review.severity] > SEVERITY_RANK[acc] ? review.severity : acc,
  'info' as PreviewSeverity)
  point.setAttribute('data-review-id', ids.join(' '))
  point.setAttribute('data-anchor-status', primaryStatus)
  point.setAttribute('data-severity', primarySev)
  // Split so the boundary is a real node boundary, then splice the point in:
  //   local === 0        -> before this text node
  //   local === length   -> after this text node
  //   0 < local < length -> before the split-off suffix
  const length = node.nodeValue?.length ?? 0
  const parent = node.parentNode
  if (parent === null) return
  if (local <= 0) {
    parent.insertBefore(point, node)
  } else if (local >= length) {
    parent.insertBefore(point, node.nextSibling)
  } else {
    const after = node.splitText(local)
    parent.insertBefore(point, after)
  }
  if (handlers !== null) attachNums(point, specs, handlers, point)
}

/**
 * Inject committed marks only. The caller must run unwindReviewMarks() first
 * so the injection stays idempotent across replays.
 *
 * Pending (not-yet-submitted) selections are deliberately NOT marked: the
 * native browser selection is the sole selection-stage visual; reviewer
 * marks appear in the document only after a review is committed.
 */
export function injectReviewMarks(
  model: AlignmentModel,
  specs: MarkSpec[],
  handlers: MarkHandlers,
): void {
  for (const pairing of model.pairingsByDom.values()) {
    const merged = mergeIntervals(intervalsForBlock(model, pairing, specs))
    // Edge "|" bars only belong to precise (non-line-level) intervals: the
    // first rendered interval of a clipped multi-block span paints the start
    // bar, the last paints the end bar.
    const precise = merged.filter(i => !i.point && !i.specs.every(s => s.lineLevel))
    const minDs = precise.reduce((m, i) => Math.min(m, i.ds), Number.POSITIVE_INFINITY)
    const maxDe = precise.reduce((m, i) => Math.max(m, i.de), Number.NEGATIVE_INFINITY)
    for (const interval of merged) {
      if (interval.point) {
        insertPoint(pairing.dom, interval.ds,
          pointClassName(interval.specs), interval.specs, handlers)
        continue
      }
      const isPrecise = !interval.specs.every(s => s.lineLevel)
      wrapSegment(pairing.dom, interval.ds, interval.de,
        markClassName(interval.specs), interval.specs, handlers,
        isPrecise && interval.ds === minDs, isPrecise && interval.de === maxDe)
    }
  }
}
