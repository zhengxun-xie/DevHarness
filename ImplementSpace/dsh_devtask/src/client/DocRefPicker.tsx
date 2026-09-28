/**
 * Document reference picker for DevTask logs (design/06 §8.2).
 *
 * Reuses the DevReviewer loopback API for document browsing — DevTask has no
 * project concept of its own. Two-step inline panel:
 *   1. File tree of every .md under the DevReviewer active project directory.
 *   2. After selecting a document, its heading list; clicking a heading (or
 *      "whole document") inserts a `devtask-ref://` Markdown link at the
 *      composer textarea cursor.
 *
 * If the DevReviewer plugin is not running or no project is active, the
 * picker degrades to a "引用文档不可用" hint (design/06 §11 边界).
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatDocRef, headingEndLine } from './doc-ref.ts'

interface DocumentHeading {
  slug: string
  text: string
  level: number
  line: number
}

interface DocFileEntry {
  path: string
  title: string
}

interface ProjectInfo {
  id: string
  name: string
  active: boolean
}

interface TreeNode {
  name: string
  dir: string | undefined
  document?: string
  title?: string
  children?: TreeNode[]
}

const DEVREVIEWER_API = '/api/devreviewer'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'content-type': 'application/json' } })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

export interface DocRefPickerProps {
  /** Called with the formatted Markdown link text; the caller inserts it at cursor. */
  onInsert: (markdown: string) => void
  onCancel: () => void
  t: TranslateNS<'devTaskLeft'>
}

export function DocRefPicker({ onInsert, onCancel, t }: DocRefPickerProps): ReactNode {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [browseFiles, setBrowseFiles] = useState<DocFileEntry[] | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<{ document: string; title: string } | null>(null)
  const [headings, setHeadings] = useState<DocumentHeading[]>([])
  const [lineCount, setLineCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))

  // Step 0: resolve the DevReviewer active project.
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const resp = await fetchJson<{ projects: ProjectInfo[] }>(`${DEVREVIEWER_API}/projects`)
        const active = resp.projects.find(p => p.active) ?? resp.projects[0]
        if (active === undefined) {
          setError(t('log.refDocUnavailable'))
          setLoading(false)
          return
        }
        setProjectId(active.id)
      } catch {
        setError(t('log.refDocUnavailable'))
        setLoading(false)
      }
    })()
  }, [t])

  // Step 1: once projectId is known, fetch the document list.
  useEffect(() => {
    if (projectId === null) return
    void (async (): Promise<void> => {
      try {
        const resp = await fetchJson<{ documents: DocFileEntry[] }>(
          `${DEVREVIEWER_API}/docs?projectId=${encodeURIComponent(projectId)}`,
        )
        setBrowseFiles(resp.documents)
        setLoading(false)
      } catch {
        setError(t('log.refDocUnavailable'))
        setLoading(false)
      }
    })()
  }, [projectId, t])

  // Step 2: when a document is selected, fetch its headings.
  const loadHeadings = useCallback(async (document: string): Promise<void> => {
    if (projectId === null) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetchJson<{
        content: string
        headings: DocumentHeading[]
      }>(`${DEVREVIEWER_API}/document?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(document)}`)
      setHeadings(resp.headings ?? [])
      setLineCount(resp.content.split('\n').length)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (selectedDoc !== null) void loadHeadings(selectedDoc.document)
  }, [selectedDoc, loadHeadings])

  function emitRef(document: string, title: string, heading?: DocumentHeading): void {
    if (projectId === null) return
    if (heading !== undefined) {
      const end = headingEndLine(headings, headings.indexOf(heading), lineCount)
      onInsert(formatDocRef(projectId, document, title, heading.text, heading.line, end))
    } else {
      onInsert(formatDocRef(projectId, document, title))
    }
  }

  // Build a directory tree from the browse file list.
  const tree: TreeNode[] = (() => {
    if (browseFiles === null) return []
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
    const root: TreeNode[] = []
    for (const file of browseFiles) {
      const slash = file.path.lastIndexOf('/')
      if (slash < 0) {
        root.push({ name: file.title, dir: undefined, document: file.path, title: file.title })
        continue
      }
      const dir = file.path.slice(0, slash)
      const dirNode = ensureDir(dir)
      dirNode.children!.push({
        name: file.path.slice(slash + 1),
        dir,
        document: file.path,
        title: file.title,
      })
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
      if (node.dir === undefined || node.dir === '' || node.dir.includes('/')) continue
      result.push(node)
    }
    sortChildren(result)
    return result
  })()

  function renderTreeNodes(level: TreeNode[]): ReactNode {
    return level.map(node => {
      if (node.children !== undefined) {
        const path = node.dir ?? ''
        const isOpen = expanded.has(path)
        return (
          <div key={`dir:${path}`}>
            <button
              type="button"
              className="dtk-refpicker-dir"
              onClick={() => {
                const next = new Set(expanded)
                if (isOpen) next.delete(path)
                else next.add(path)
                setExpanded(next)
              }}
            >
              <span className="dtk-refpicker-arrow">{isOpen ? '▾' : '▸'}</span>
              <span className="dtk-refpicker-icon">📁</span>
              <span className="dtk-refpicker-label">{node.name}</span>
            </button>
            {isOpen && (
              <div className="dtk-refpicker-children">
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
          className="dtk-refpicker-item"
          onClick={() => setSelectedDoc({ document: node.document!, title: node.title! })}
        >
          <span className="dtk-refpicker-icon">📄</span>
          <span className="dtk-refpicker-label">{node.title}</span>
          <span className="dtk-refpicker-path">{node.document}</span>
        </button>
      )
    })
  }

  const backToList = (): void => { setSelectedDoc(null); setHeadings([]) }

  return (
    <div className="dtk-refpicker">
      <div className="dtk-refpicker-head">
        <strong>{t('log.refDocTitle')}</strong>
        <button type="button" onClick={onCancel}>×</button>
      </div>

      {selectedDoc === null ? (
        <div className="dtk-refpicker-body">
          {loading && browseFiles === null && <div className="dtk-refpicker-hint">{t('log.refDocLoading')}</div>}
          {error !== null && <div className="dtk-log-entry-error">{error}</div>}
          {!loading && error === null && tree.length === 0 && (
            <div className="dtk-refpicker-hint">{t('log.refDocEmpty')}</div>
          )}
          {tree.length > 0 && (
            <div className="dtk-refpicker-tree">
              {renderTreeNodes(tree)}
            </div>
          )}
        </div>
      ) : (
        <div className="dtk-refpicker-body">
          <button
            type="button"
            className="dtk-refpicker-back"
            onClick={backToList}
          >
            ← {selectedDoc.title}
          </button>
          {loading && <div className="dtk-refpicker-hint">{t('log.refDocLoading')}</div>}
          {error !== null && <div className="dtk-log-entry-error">{error}</div>}
          {!loading && error === null && (
            <div className="dtk-refpicker-list">
              <button
                type="button"
                className="dtk-refpicker-item"
                onClick={() => emitRef(selectedDoc.document, selectedDoc.title)}
              >
                <span className="dtk-refpicker-icon">📄</span>
                <span className="dtk-refpicker-label">{t('log.refDocWhole')}</span>
              </button>
              {headings.length > 0 && (
                <>
                  <div className="dtk-refpicker-sep">{t('log.refDocHeadings')}</div>
                  {headings.map(heading => (
                    <button
                      key={heading.slug}
                      type="button"
                      className="dtk-refpicker-item"
                      style={{ paddingLeft: 12 + (heading.level - 1) * 14 }}
                      onClick={() => emitRef(selectedDoc.document, selectedDoc.title, heading)}
                    >
                      <span className="dtk-refpicker-icon">§</span>
                      <span className="dtk-refpicker-label">{heading.text}</span>
                      <span className="dtk-refpicker-path">L{heading.line}</span>
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
