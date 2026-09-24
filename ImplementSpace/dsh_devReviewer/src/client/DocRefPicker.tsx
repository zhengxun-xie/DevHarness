/**
 * Document reference picker — a file-browser style tree.
 *
 * Two-step inline panel triggered by the "引用文档" button in the comment
 * textarea area:
 *
 *   1. A tree of selectable markdown documents, combining:
 *      - the DevBuddy left-panel doc tree (DocTreeNode[], the registered
 *        design whitelist) — shown at the root with its curated title, and
 *      - every .md/.markdown under the project directory (GET /docs),
 *        grouped into collapsible directories like a file browser —
 *        so ANY project file can be referenced, not just the whitelist.
 *   2. After selecting a document, fetch its headings via GET /document and
 *      show them as clickable options. Clicking a heading inserts a Markdown
 *      link like `[📄 Title §Heading](devbuddy-ref://projectId/doc#L10-L20)`
 *      at the textarea cursor. A "whole document" option inserts a link
 *      without a line anchor.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api.ts'
import { formatDocRef, headingEndLine } from './doc-ref.ts'
import type { TranslateFunction } from './format.ts'
import type { DocTreeNode, DocumentHeading, DocFileEntry } from '../protocol.ts'

interface FileOption {
  document: string
  title: string
}

/** One node in the picker's directory tree (mirrors a file browser). */
interface TreeNode {
  name: string
  /** Directory prefix ('' at root); undefined => this node is a file. */
  dir: string | undefined
  /** Present for file nodes only: project-relative document path. */
  document?: string
  /** Present for file nodes only: display title (whitelist-curated or basename). */
  title?: string
  children?: TreeNode[]
}

export interface DocRefPickerProps {
  projectId: string
  docTree: DocTreeNode[] | null
  /** Called with the formatted Markdown link text; the caller inserts it at cursor. */
  onInsert: (markdown: string) => void
  onCancel: () => void
  t: TranslateFunction
}

export function DocRefPicker({ projectId, docTree, onInsert, onCancel, t }: DocRefPickerProps): ReactNode {
  const [selectedDoc, setSelectedDoc] = useState<FileOption | null>(null)
  const [headings, setHeadings] = useState<DocumentHeading[]>([])
  const [lineCount, setLineCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Project-directory scan; fetched once on mount.
  const [browseFiles, setBrowseFiles] = useState<DocFileEntry[] | null>(null)
  // Expanded directory paths ('' root is always expanded); default: expand
  // top-level directories so the tree opens with two visible levels.
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['',]))

  const nodes = docTree ?? []

  const loadHeadings = useCallback(async (document: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.getDocument(projectId, document)
      setHeadings(response.headings ?? [])
      setLineCount(response.content.split('\n').length)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadBrowseFiles = useCallback(async (): Promise<void> => {
    if (browseFiles !== null) return
    setLoading(true)
    setError(null)
    try {
      const response = await api.listDocuments(projectId)
      setBrowseFiles(response.documents)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [browseFiles, projectId])

  // Fetch headings whenever a document is selected.
  useEffect(() => {
    if (selectedDoc !== null) void loadHeadings(selectedDoc.document)
  }, [selectedDoc, loadHeadings])

  // Fetch the directory scan once on mount (single combined browser list).
  useEffect(() => {
    void loadBrowseFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadBrowseFiles])

  function emitRef(document: string, title: string, heading?: DocumentHeading): void {
    if (heading !== undefined) {
      const end = headingEndLine(headings, headings.indexOf(heading), lineCount)
      onInsert(formatDocRef(projectId, document, title, heading.text, heading.line, end))
    } else {
      onInsert(formatDocRef(projectId, document, title))
    }
  }

  // Build a directory tree from the combined file list: whitelist (docTree)
  // first at the root, then every project markdown grouped by its directory
  // segments. Files deeper than one level nest under intermediate dirs.
  const tree = useMemo<TreeNode[]>(() => {
    const byPath = new Map<string, TreeNode>()
    const ensureDir = (dir: string): TreeNode => {
      const existing = byPath.get(dir)
      if (existing !== undefined) return existing
      const segments = dir === '' ? [] : dir.split('/')
      const node: TreeNode = { name: segments[segments.length - 1] ?? dir, dir, children: [] }
      byPath.set(dir, node)
      if (segments.length > 0) {
        const parentDir = segments.slice(0, -1).join('/')
        ensureDir(parentDir).children!.push(node)
      }
      return node
    }
    // Files at the root.
    const root: TreeNode[] = []
    const addFile = (document: string, title: string): void => {
      const slash = document.lastIndexOf('/')
      if (slash < 0) {
        root.push({ name: title, dir: undefined, document, title })
        return
      }
      const dir = document.slice(0, slash)
      const dirNode = ensureDir(dir)
      dirNode.children!.push({
        name: document.slice(slash + 1),
        dir: document.slice(0, slash),
        document,
        title,
      })
    }
    const seen = new Set<string>()
    for (const node of nodes) {
      if (seen.has(node.document)) continue
      seen.add(node.document)
      addFile(node.document, node.title)
    }
    for (const file of browseFiles ?? []) {
      if (seen.has(file.path)) continue
      seen.add(file.path)
      addFile(file.path, file.title)
    }
    const sortChildren = (list: TreeNode[]): void => {
      for (const node of list) {
        if (node.children !== undefined) sortChildren(node.children)
      }
      list.sort((a, b) => {
        const aDir = a.children !== undefined ? 0 : 1
        const bDir = b.children !== undefined ? 0 : 1
        return aDir !== bDir ? aDir - bDir : a.name.localeCompare(b.name)
      })
    }
    const result = [...root]
    for (const node of byPath.values()) {
      // Only top-level directories belong at the root; deeper ones are
      // already attached as children by ensureDir during construction.
      if (node.dir === undefined || node.dir === '' || node.dir.includes('/')) continue
      result.push(node)
    }
    sortChildren(result)
    return result
  }, [nodes, browseFiles])

  // Render one level of the tree; files under a collapsed dir are hidden.
  function renderTreeNodes(level: TreeNode[]): ReactNode {
    return level.map(node => {
      if (node.children !== undefined) {
        const path = node.dir ?? ''
        const isOpen = expanded.has(path)
        return (
          <div key={`dir:${path}`}>
            <button
              type="button"
              className="dbr-refpicker-dir"
              onClick={() => {
                const next = new Set(expanded)
                if (isOpen) next.delete(path)
                else next.add(path)
                setExpanded(next)
              }}
            >
              <span className="dbr-refpicker-arrow">{isOpen ? '▾' : '▸'}</span>
              <span className="dbr-refpicker-icon">📁</span>
              <span className="dbr-refpicker-label">{node.name}</span>
            </button>
            {isOpen && (
              <div className="dbr-refpicker-children">
                {renderTreeNodes(node.children!)}
              </div>
            )}
          </div>
        )
      }
      return (
        <button
          key={`file:${node.document}`}
          type="button"
          className="dbr-refpicker-item"
          onClick={() => setSelectedDoc({ document: node.document!, title: node.title! })}
        >
          <span className="dbr-refpicker-icon">📄</span>
          <span className="dbr-refpicker-label">{node.title}</span>
          <span className="dbr-refpicker-path">{node.document}</span>
        </button>
      )
    })
  }

  const backToList = (): void => { setSelectedDoc(null); setHeadings([]) }

  return (
    <div className="dbr-refpicker">
      <div className="dbr-refpicker-head">
        <strong>{t('refDoc.title')}</strong>
        <button type="button" onClick={onCancel}>×</button>
      </div>

      {selectedDoc === null ? (
        <div className="dbr-refpicker-body">
          {loading && browseFiles === null && <div className="dbr-refpicker-hint">{t('refDoc.loading')}</div>}
          {error !== null && <div className="dbr-error">{error}</div>}
          {!loading && error === null && tree.length === 0 && (
            <div className="dbr-refpicker-hint">{t('refDoc.emptyBrowse')}</div>
          )}
          {tree.length > 0 && (
            <div className="dbr-refpicker-tree">
              {renderTreeNodes(tree)}
            </div>
          )}
        </div>
      ) : (
        <div className="dbr-refpicker-body">
          <button
            type="button"
            className="dbr-refpicker-back"
            onClick={backToList}
          >
            ← {selectedDoc.title}
          </button>
          {loading && <div className="dbr-refpicker-hint">{t('refDoc.loading')}</div>}
          {error !== null && <div className="dbr-error">{error}</div>}
          {!loading && error === null && (
            <div className="dbr-refpicker-list">
              <button
                type="button"
                className="dbr-refpicker-item"
                onClick={() => emitRef(selectedDoc.document, selectedDoc.title)}
              >
                <span className="dbr-refpicker-icon">📄</span>
                <span className="dbr-refpicker-label">{t('refDoc.wholeDocument')}</span>
              </button>
              {headings.length > 0 && (
                <>
                  <div className="dbr-refpicker-sep">{t('refDoc.headings')}</div>
                  {headings.map(heading => (
                    <button
                      key={heading.slug}
                      type="button"
                      className="dbr-refpicker-item"
                      style={{ paddingLeft: 12 + (heading.level - 1) * 14 }}
                      onClick={() => emitRef(selectedDoc.document, selectedDoc.title, heading)}
                    >
                      <span className="dbr-refpicker-icon">§</span>
                      <span className="dbr-refpicker-label">{heading.text}</span>
                      <span className="dbr-refpicker-path">L{heading.line}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}