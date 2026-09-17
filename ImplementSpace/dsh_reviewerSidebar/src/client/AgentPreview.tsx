/**
 * Send-to-Agent dialog (design/07): GET /agent/context dry-run preview of
 * all seven context sections, include toggles, then POST /agent/send. On
 * delivery failure the server's `fallback` reason is shown alongside a
 * Copy-context button so the prepared instruction can be pasted manually.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api.ts'
import type { AgentContextPayload } from '../protocol.ts'
import type { TranslateFunction } from './format.ts'

export interface AgentPreviewProps {
  projectId: string
  reviewId: string
  onClose: () => void
  t: TranslateFunction
}

interface IncludeFlags {
  relatedDocs: boolean
  decisions: boolean
  code: boolean
  tests: boolean
  gitHistory: boolean
}

export function AgentPreview({ projectId, reviewId, onClose, t }: AgentPreviewProps): ReactNode {
  const [context, setContext] = useState<AgentContextPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [include, setInclude] = useState<IncludeFlags>({
    relatedDocs: true,
    decisions: true,
    code: true,
    tests: true,
    gitHistory: true,
  })
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ delivered: boolean; sessionId: string | null; fallback?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedPayload, setCopiedPayload] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.agentContext(projectId, reviewId)
      .then(payload => { if (!cancelled) setContext(payload) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, reviewId])

  async function send(dryRun: boolean): Promise<void> {
    setSending(true)
    setError(null)
    try {
      const response = await api.sendToAgent({
        projectId,
        reviewId,
        sessionId: null,
        include,
        dryRun,
      })
      setResult({ delivered: response.delivered, sessionId: response.sessionId, fallback: response.fallback })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  async function copyContext(): Promise<void> {
    if (context === null) return
    try {
      await navigator.clipboard.writeText(context.instruction)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable over non-permissive origins.
    }
  }

  async function copyPayload(): Promise<void> {
    if (context === null) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(context.payload, null, 2))
      setCopiedPayload(true)
      window.setTimeout(() => setCopiedPayload(false), 1500)
    } catch {
      // Clipboard may be unavailable over non-permissive origins.
    }
  }

  return (
    <div className="dbr-dialog-bg" onClick={onClose}>
      <div className="dbr-dialog dbr-agent-preview" onClick={event => event.stopPropagation()}>
        <h3>{t('agent.send')}</h3>

        {loading && <div className="dbr-loading">{t('panel.loading')}</div>}
        {error !== null && <div className="dbr-error">{error}</div>}

        {context !== null && !result?.delivered && (
          <>
            {context.truncated && <div className="dbr-toast dbr-bad">{t('agent.truncated')}</div>}
            <div className="dbr-agent-ctx">
              <details open>
                <summary>Structured payload · Layer 2</summary>
                <pre>{JSON.stringify(context.payload, null, 2)}</pre>
                <button type="button" className="dbr-btn" onClick={() => { void copyPayload() }}>
                  {copiedPayload ? t('agent.copied') : t('agent.copyPayload')}
                </button>
              </details>
              <details open>
                <summary>Review</summary>
                <pre>{context.review.comment}</pre>
              </details>
              <details>
                <summary>Target · {context.targetDocument.path} <span className="dbr-detail-meta">referenced</span></summary>
                <div className="dbr-detail-meta">Read the current version from the worktree (path@sha in the structured payload). Not inlined.</div>
              </details>
              <details>
                <summary>Related docs ({context.relatedDocuments.length})</summary>
                {context.relatedDocuments.map(doc => (
                  <div key={doc.path}>
                    <b>{doc.path}</b> <span className="dbr-detail-meta">{doc.reason} · referenced</span>
                  </div>
                ))}
              </details>
              <details>
                <summary>Decisions ({context.decisions.length})</summary>
                {context.decisions.map(doc => <div key={doc.path}><b>{doc.path}</b><pre>{doc.content.slice(0, 1000)}</pre></div>)}
              </details>
              <details>
                <summary>Code ({context.code.length})</summary>
                {context.code.map(doc => <div key={doc.path}><b>{doc.path}</b>{doc.symbols ? ` · ${doc.symbols.join(', ')}` : ''}<pre>{doc.content.slice(0, 1500)}</pre></div>)}
              </details>
              <details>
                <summary>Tests ({context.tests.length})</summary>
                {context.tests.map(doc => <div key={doc.path}><b>{doc.path}</b><pre>{doc.content.slice(0, 1500)}</pre></div>)}
              </details>
              <details open>
                <summary>Git {!context.git.available && <span className="dbr-detail-meta">（{t('agent.gitUnavailable')}）</span>}</summary>
                {context.git.available && (
                  <pre>{context.git.log.slice(0, 10).map(entry => `${entry.hash.slice(0, 8)} ${entry.subject}`).join('\n')}</pre>
                )}
              </details>
            </div>

            <div className="dbr-agent-flags">
              {(Object.keys(include) as Array<keyof IncludeFlags>).map(key => (
                <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={include[key]}
                    onChange={event => setInclude(flags => ({ ...flags, [key]: event.target.checked }))}
                  />
                  {key}
                </label>
              ))}
            </div>
          </>
        )}

        {result !== null && result.delivered && (
          <div className="dbr-toast dbr-ok">{t('agent.delivered', { id: result.sessionId ?? '' })}</div>
        )}
        {result !== null && !result.delivered && (
          <div className="dbr-toast dbr-bad">
            {t('agent.fallback', { reason: result.fallback ?? 'unknown' })}
          </div>
        )}

        <div className="dbr-dialog-row">
          <button type="button" onClick={copyContext} disabled={context === null}>
            {copied ? t('agent.copied') : t('agent.copyContext')}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>{t('agent.close')}</button>
          {result?.delivered !== true && (
            <button type="button" className="dbr-primary" onClick={() => send(false)} disabled={sending || context === null}>
              {t('agent.confirmSend')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
