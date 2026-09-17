/**
 * Minimal YAML subset parser/serializer for Review frontmatter.
 *
 * Zero runtime npm dependencies by design (design/02 §7). The subset covers
 * exactly what review files use:
 *   - nested mappings (2-space indentation), block/flow sequences,
 *   - scalars: null/bool/number, plain/single/double-quoted strings,
 *   - literal block scalars (`|`, `|-`, `|+`, with or without explicit
 *     indent), folded block scalars (`>`),
 *   - `#` comments and blank lines.
 *
 * Unknown keys round-trip: parse() keeps them in the generic document and
 * serialize() re-emits them, so older/newer plugin versions do not lose data.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }
export type YamlObject = { [key: string]: YamlValue }

export function isYamlObject(value: YamlValue | undefined): value is YamlObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface Line {
  indent: number
  text: string // content after indentation, '' for blank
  raw: string
}

function tokenize(source: string): Line[] {
  return source.replace(/\r\n/g, '\n').split('\n').map((raw) => {
    if (raw.trim() === '') return { indent: -1, text: '', raw: '' }
    const spaces = /^[ ]*/.exec(raw)?.[0].length ?? 0
    return { indent: spaces, text: raw.slice(spaces), raw }
  })
}

/** Strip a line/inline comment that is not inside quotes. */
function stripComment(text: string): string {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === quote && quote === '"' && text[i - 1] === '\\') { /* escaped */ }
    } else if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'"
    } else if (ch === '#') {
      // A comment marker must be preceded by whitespace or line start.
      if (i === 0 || /\s/.test(text[i - 1])) return text.slice(0, i)
    }
  }
  return text
}

function parseScalar(raw: string): YamlValue {
  const text = stripComment(raw).trim()
  if (text === '' || text === '~' || text === 'null') return null
  if (text === 'true' || text === 'True') return true
  if (text === 'false' || text === 'False') return false
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^-?\d+\.\d+$/.test(text)) return Number(text)
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    return JSON.parse(text.replace(/\n/g, '\\n'))
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'")
  }
  return text
}

/** Parse a flow collection on a single line: [a, b] or {a: 1, b: 2}. */
function parseFlow(raw: string): YamlValue {
  const text = stripComment(raw).trim()
  if (text.startsWith('[')) {
    const inner = text.slice(1, text.endsWith(']') ? -1 : undefined)
    if (inner.trim() === '') return []
    return splitFlow(inner).map(item => parseScalar(item))
  }
  if (text.startsWith('{')) {
    const inner = text.slice(1, text.endsWith('}') ? -1 : undefined)
    const obj: YamlObject = {}
    if (inner.trim() !== '') {
      for (const pair of splitFlow(inner)) {
        const idx = pair.indexOf(':')
        if (idx === -1) continue
        obj[pair.slice(0, idx).trim()] = parseScalar(pair.slice(idx + 1))
      }
    }
    return obj
  }
  return parseScalar(text)
}

/** Split a flow body on top-level commas (respecting quotes/nesting). */
function splitFlow(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: '"' | "'" | null = null
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch as '"' | "'"
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  const last = text.slice(start).trim()
  if (last !== '') parts.push(last)
  return parts
}

/** Consume a block scalar starting at `start` (the key line index + 1). */
function readBlockScalar(lines: Line[], start: number, parentIndent: number, indicator: string): { value: string; next: number } {
  const chomp = indicator.includes('+') ? 'keep' : indicator.includes('-') ? 'strip' : 'clip'
  const bodyLines: Array<string | null> = []
  let i = start
  let blockIndent = -1
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.indent === -1) {
      bodyLines.push(null)
      continue
    }
    if (blockIndent === -1) blockIndent = line.indent
    if (line.indent < blockIndent) break
    bodyLines.push(line.raw.slice(blockIndent))
  }
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === null) bodyLines.pop()
  let joined: string
  if (indicator[0] === '|') {
    joined = bodyLines.map(l => (l === null ? '' : l)).join('\n')
  } else {
    // Folded: join non-blank lines with spaces, blank lines -> newlines.
    const parts: string[] = []
    let paragraph = ''
    for (const l of bodyLines) {
      if (l === null) {
        if (paragraph !== '') parts.push(paragraph)
        paragraph = ''
        parts.push('')
      } else if (l.startsWith(' ') || l.startsWith('-')) {
        if (paragraph !== '') { parts.push(paragraph); paragraph = '' }
        parts.push(l)
      } else {
        paragraph = paragraph === '' ? l : `${paragraph} ${l}`
      }
    }
    if (paragraph !== '') parts.push(paragraph)
    joined = parts.join('\n')
  }
  void parentIndent
  if (chomp === 'clip') joined = `${joined}\n`
  if (chomp === 'keep') joined = `${joined}\n`
  // strip: no trailing newline
  return { value: joined, next: i }
}

/** Parse the YAML document body (lines after `---`). */
export function parseYaml(source: string): YamlObject {
  const lines = tokenize(source)
  const result = parseBlock(lines, 0, -1).value
  return isYamlObject(result) ? result : {}
}

/** Parse a block mapping/value at indent >= minIndent; returns next index. */
function parseBlock(lines: Line[], start: number, parentIndent: number): { value: YamlValue; next: number } {
  let i = start
  while (i < lines.length && (lines[i].indent === -1 || lines[i].indent <= parentIndent)) i++
  if (i >= lines.length) return { value: null, next: i }
  const indent = lines[i].indent

  // Block sequence dispatch.
  if (lines[i].text.startsWith('- ') || lines[i].text === '-') {
    return parseSequenceLines(lines, i, indent)
  }
  return parseMappingLines(lines, i, indent)
}

function parseSequenceLines(lines: Line[], i: number, indent: number): { value: YamlValue; next: number } {
  const items: YamlValue[] = []
  while (i < lines.length && lines[i].indent !== -1 && lines[i].indent === indent) {
    if (!(lines[i].text.startsWith('- ') || lines[i].text === '-')) break
    const rest = lines[i].text === '-' ? '' : lines[i].text.slice(2)
    if (rest.trim() === '') {
      const child = parseBlock(lines, i + 1, indent)
      items.push(child.value)
      i = child.next
    } else if (findColon(rest) !== -1 && !rest.trimStart().startsWith('[')) {
      // "- key: value" list item that begins a mapping. The mapping's
      // effective indent is `indent + 2`; rewrite this single line in place
      // (replace "- " with two spaces) and parse the mapping over the tail
      // of the shared line array.
      const keyIndent = indent + 2
      const rewritten: Line = {
        indent: keyIndent,
        text: rest,
        raw: `${' '.repeat(keyIndent)}${rest}`,
      }
      const tail = [rewritten, ...lines.slice(i + 1)]
      const child = parseMappingLines(tail, 0, keyIndent)
      items.push(child.value)
      i = i + child.next
    } else {
      items.push(parseFlow(rest))
      i++
    }
  }
  return { value: items, next: i }
}

function parseMappingLines(lines: Line[], i: number, indent: number): { value: YamlValue; next: number } {
  const obj: YamlObject = {}
  while (i < lines.length) {
    const line = lines[i]
    if (line.indent === -1) { i++; continue }
    if (line.indent < indent) break
    if (line.indent > indent) { i++; continue } // tolerate stray indentation
    const colon = findColon(line.text)
    if (colon === -1) { i++; continue }
    const key = line.text.slice(0, colon).trim().replace(/^['"]|['"]$/g, '')
    const rest = line.text.slice(colon + 1).trim()
    if (rest === '') {
      // Nested block, block scalar, or null.
      let j = i + 1
      while (j < lines.length && lines[j].indent === -1) j++
      if (j < lines.length && lines[j].indent > indent) {
        if (lines[j].text.startsWith('|') || lines[j].text.startsWith('>')) {
          const scalar = readBlockScalar(lines, j + 1, lines[j].indent, lines[j].text)
          obj[key] = scalar.value
          i = scalar.next
          continue
        }
        const child = parseBlock(lines, j, indent)
        obj[key] = child.value
        i = child.next
      } else if (
        j < lines.length
        && lines[j].indent === indent
        && (lines[j].text.startsWith('- ') || lines[j].text === '-')
      ) {
        // Standard YAML allows a block sequence value to share its key's
        // indentation:
        //   entries:
        //   - id: a
        //   - id: b
        const child = parseSequenceLines(lines, j, indent)
        obj[key] = child.value
        i = child.next
      } else {
        obj[key] = null
        i++
      }
    } else if (rest.startsWith('|') || rest.startsWith('>')) {
      const scalar = readBlockScalar(lines, i + 1, line.indent, rest)
      obj[key] = scalar.value
      i = scalar.next
    } else if (rest.startsWith('[') || rest.startsWith('{')) {
      obj[key] = parseFlow(rest)
      i++
    } else {
      obj[key] = parseScalar(rest)
      i++
    }
  }
  return { value: obj, next: i }
}

/** Find the ':' separator (followed by space/EOL), outside quotes. */
function findColon(text: string): number {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote && !(quote === '"' && text[i - 1] === '\\')) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch as '"' | "'"
    else if (ch === ':' && (i + 1 === text.length || text[i + 1] === ' ')) return i
  }
  return -1
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

const PLAIN_STRING = /^[A-Za-z0-9_\-./ ,()[\]{}@+]+$/u

/** Decide whether a string can render unquoted on one line. */
function isPlainScalar(text: string): boolean {
  if (text === '') return false
  if (/^(~|null|true|false|-?\d)/.test(text)) return false
  if (text.includes(': ') || text.startsWith('- ') || text.startsWith('#')) return false
  if (text.includes('\n')) return false
  return PLAIN_STRING.test(text)
}

function emitScalarLine(text: string): string {
  if (text === 'null' || text === '') return "''"
  if (isPlainScalar(text)) return text
  return `'${text.replace(/'/g, "''")}'`
}

function emitString(key: string, text: string, indent: number, lines: string[]): void {
  const pad = ' '.repeat(indent)
  if (text.includes('\n')) {
    // Pick a chomping indicator so the value round-trips exactly:
    //   |- strip  -> no trailing newline (the common case for bodies)
    //   |  clip   -> exactly one trailing newline
    //   |+ keep   -> preserve all trailing blank lines
    const trailingNewlines = /\n+$/.exec(text)?.[0].length ?? 0
    const indicator = trailingNewlines === 0 ? '|-' : trailingNewlines === 1 ? '|' : '|+'
    lines.push(`${pad}${key}: ${indicator}`)
    const body = trailingNewlines > 0 ? text.slice(0, -trailingNewlines) : text
    for (const bodyLine of body.split('\n')) {
      lines.push(bodyLine === '' ? '' : `${pad}  ${bodyLine}`)
    }
  } else {
    lines.push(`${pad}${key}: ${emitScalarLine(text)}`)
  }
}

function emitValue(key: string, value: YamlValue, indent: number, lines: string[]): void {
  const pad = ' '.repeat(indent)
  if (value === null || value === undefined) {
    lines.push(`${pad}${key}: null`)
  } else if (typeof value === 'boolean' || typeof value === 'number') {
    lines.push(`${pad}${key}: ${String(value)}`)
  } else if (typeof value === 'string') {
    emitString(key, value, indent, lines)
  } else if (Array.isArray(value)) {
    if (value.every(item => item === null || typeof item !== 'object')) {
      const flow = value.map((item) => {
        if (item === null) return 'null'
        if (typeof item === 'string') return emitScalarLine(item)
        return String(item)
      })
      lines.push(`${pad}${key}: [${flow.join(', ')}]`)
    } else {
      lines.push(`${pad}${key}:`)
      emitSequence(value, indent, lines)
    }
  } else {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      lines.push(`${pad}${key}: {}`)
    } else {
      lines.push(`${pad}${key}:`)
      emitMapping(value as YamlObject, indent + 2, lines)
    }
  }
}

function emitMapping(obj: YamlObject, indent: number, lines: string[]): void {
  for (const [key, value] of Object.entries(obj)) {
    emitValue(key, value, indent, lines)
  }
}

function emitSequence(items: YamlValue[], indent: number, lines: string[]): void {
  const pad = ' '.repeat(indent)
  for (const item of items) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const entries = Object.entries(item as YamlObject)
      if (entries.length === 0) {
        lines.push(`${pad}- {}`)
        continue
      }
      entries.forEach(([key, value], index) => {
        if (index === 0) emitValue(`- ${key}`, value, indent, lines)
        else emitValue(key, value, indent + 2, lines)
      })
    } else if (typeof item === 'string') {
      lines.push(`${pad}- ${emitScalarLine(item)}`)
    } else {
      lines.push(`${pad}- ${String(item)}`)
    }
  }
}

/** Serialize an object to YAML text (no trailing fence). */
export function serializeYaml(obj: YamlObject): string {
  const lines: string[] = []
  emitMapping(obj, 0, lines)
  return `${lines.join('\n')}\n`
}
