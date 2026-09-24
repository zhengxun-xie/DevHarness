/**
 * Line-level diff between two text snapshots (the last SAVED body and the
 * current editing draft). The output is a single-column UNIFIED row stream
 * rendered directly on the document (like `git diff` without side-by-side):
 *
 *   - 'equal' normal context line;
 *   - 'del'   removed line — shown in red, prefixed with '-';
 *   - 'add'   added line — shown in green, prefixed with '+'.
 *
 * A delete followed by an add comes out as two sequential rows (removed
 * line first, then added line), the same way a unified patch reads.
 *
 * Alignment comes from the classic LCS dynamic program over lines. Workflow
 * nodes are small markdown documents, so the O(N*M) table is fine; the
 * table is stored in a flat Int32Array.
 */

export type DiffRowKind = 'equal' | 'del' | 'add'

export interface DiffRow {
  kind: DiffRowKind
  /** 1-based saved-side line number; null on add rows. */
  oldLine: number | null
  /** 1-based draft-side line number; null on del rows. */
  newLine: number | null
  text: string
}

/**
 * Split text into comparable lines:
 *   - CRLF is normalized to LF (line-ending churn must not read as a diff);
 *   - an empty string is ZERO lines;
 *   - a single trailing newline is a line terminator, not an extra empty
 *     line ("a\n" is one line, not ["a", ""]).
 */
function toLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  if (normalized === '') return []
  const lines = normalized.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

type EditOp = 'equal' | 'del' | 'add'

/** LCS edit item with the source line index on its side. */
interface EditItem {
  op: EditOp
  oldIndex: number
  newIndex: number
}

function lcsScript(a: readonly string[], b: readonly string[]): EditItem[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:], filled bottom-up.
  const width = m + 1
  const dp = new Int32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const rowBase = i * width
    const nextBase = (i + 1) * width
    for (let j = m - 1; j >= 0; j--) {
      dp[rowBase + j] = a[i] === b[j]
        ? dp[nextBase + j + 1] + 1
        : Math.max(dp[nextBase + j], dp[rowBase + j + 1])
    }
  }

  const items: EditItem[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      items.push({ op: 'equal', oldIndex: i, newIndex: j })
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      items.push({ op: 'del', oldIndex: i, newIndex: j })
      i++
    } else {
      items.push({ op: 'add', oldIndex: i, newIndex: j })
      j++
    }
  }
  while (i < n) {
    items.push({ op: 'del', oldIndex: i, newIndex: j })
    i++
  }
  while (j < m) {
    items.push({ op: 'add', oldIndex: i, newIndex: j })
    j++
  }
  return items
}

/**
 * Diff two text snapshots into a unified single-column row stream with
 * per-side 1-based line numbers.
 */
export function diffRows(oldText: string, newText: string): DiffRow[] {
  const a = toLines(oldText)
  const b = toLines(newText)
  const script = lcsScript(a, b)
  const rows: DiffRow[] = []
  let oldLineNo = 0
  let newLineNo = 0
  for (const item of script) {
    if (item.op === 'equal') {
      oldLineNo++
      newLineNo++
      rows.push({ kind: 'equal', oldLine: oldLineNo, newLine: newLineNo, text: a[item.oldIndex] })
    } else if (item.op === 'del') {
      oldLineNo++
      rows.push({ kind: 'del', oldLine: oldLineNo, newLine: null, text: a[item.oldIndex] })
    } else {
      newLineNo++
      rows.push({ kind: 'add', oldLine: null, newLine: newLineNo, text: b[item.newIndex] })
    }
  }
  return rows
}

/** Count added / removed lines. */
export function diffStats(rows: readonly DiffRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.kind === 'add') added++
    else if (row.kind === 'del') removed++
  }
  return { added, removed }
}
