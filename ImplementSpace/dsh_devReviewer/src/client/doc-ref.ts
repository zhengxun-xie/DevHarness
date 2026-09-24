/**
 * Document reference link utilities (Approach A).
 *
 * Link format — a standard Markdown inline link whose URL uses the
 * `devbuddy-ref://` scheme:
 *
 *   [📄 Title §Heading](devbuddy-ref://projectId/document.md#L10-L20)
 *
 * The MarkdownText component renders it as a normal <a> tag. A click handler
 * on the comment container intercepts `devbuddy-ref://` hrefs and dispatches
 * a document-open navigation instead of letting the browser follow the URL.
 */

export const DOC_REF_SCHEME = 'devbuddy-ref://'

export interface DocRefTarget {
  projectId: string
  document: string
  lineStart?: number
  lineEnd?: number
}

/**
 * Build the Markdown inline link text for a document reference.
 *
 * @param projectId   target project id
 * @param document    document path relative to the project directory
 * @param title       display title for the document (DocTreeNode.title or basename)
 * @param heading     optional heading text (appended as §heading)
 * @param lineStart   optional 1-based start line
 * @param lineEnd     optional 1-based end line (defaults to lineStart when omitted)
 */
export function formatDocRef(
  projectId: string,
  document: string,
  title: string,
  heading?: string,
  lineStart?: number,
  lineEnd?: number,
): string {
  let url = `${DOC_REF_SCHEME}${projectId}/${document}`
  if (lineStart !== undefined && lineStart > 0) {
    url += lineEnd !== undefined && lineEnd !== lineStart
      ? `#L${lineStart}-L${lineEnd}`
      : `#L${lineStart}`
  }
  const label = heading !== undefined && heading !== ''
    ? `📄 ${title} §${heading}`
    : `📄 ${title}`
  return `[${label}](${url})`
}

/**
 * Parse a `devbuddy-ref://` href into its components.
 * Returns null when the href is not a doc-ref link or is malformed.
 */
export function parseDocRef(href: string): DocRefTarget | null {
  if (!href.startsWith(DOC_REF_SCHEME)) return null
  // Use the URL API for robust parsing of non-standard schemes.
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const projectId = url.hostname
  if (projectId === '') return null
  // pathname starts with '/'; strip the leading slash to get the document path.
  const document = decodeURIComponent(url.pathname.slice(1))
  if (document === '') return null
  const hash = url.hash.slice(1) // remove '#'
  const target: DocRefTarget = { projectId, document }
  // Accept #L10 or #L10-L20
  const match = /^L(\d+)(?:-L(\d+))?$/.exec(hash)
  if (match !== null) {
    target.lineStart = parseInt(match[1], 10)
    if (match[2] !== undefined) target.lineEnd = parseInt(match[2], 10)
  }
  return target
}

/**
 * Compute the end line of a heading: the line before the next heading at the
 * same or higher level (i.e. the section's extent). Falls back to the last
 * line of the document.
 */
export function headingEndLine(
  headings: readonly { level: number; line: number }[],
  index: number,
  totalLines: number,
): number {
  const current = headings[index]
  for (let i = index + 1; i < headings.length; i += 1) {
    if (headings[i].level <= current.level) {
      return headings[i].line - 1
    }
  }
  return totalLines
}
