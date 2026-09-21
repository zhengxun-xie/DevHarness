/**
 * DevBuddy LEFT-panel body: a full-width workflow surface mounted as a
 * DOM-level takeover of the center column (see devbuddy-mount.tsx), covering
 * the conversation while leaving it — and the standard right sidebar —
 * mounted underneath.
 *
 * Layout (wide, unlike the narrow right-sidebar variant):
 *   ┌ title header: DevBuddy / 多项目开发工作流 .. [＋ 新建项目] [右侧栏] ┐
 *   ├ browser-style project tab strip (only while projects exist)  ┤
 *   └ centered reading column: new-project wizard and the active
 *     project's stacked workflow nodes ┘
 *
 * The component is a plain React tree fed by the loopback API (./api.ts).
 * Authoritative state always lives on the host; the panel refetches after
 * every mutation instead of patching locally.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { api } from './api.ts'
import { NewProjectForm } from './NewProjectForm.tsx'
import { NodeCard } from './NodeCard.tsx'
import type { NodeMode } from './NodeCard.tsx'
import { postDocTree, onDocTreeRequest, onCaretRequest } from './reviewer-bridge.ts'
import type { CaretProvider, DocTreeNode } from './reviewer-bridge.ts'
import { RightbarToggle } from './RightbarToggle.tsx'
import { WorkspaceBar, type SessionsNav } from './WorkspaceBar.tsx'
import type { PanelController } from './panelController.ts'
import type { DevBuddyState } from '../protocol.ts'

export interface DevBuddyPanelProps {
  /**
   * Bound DevBuddy translator; the key domain also covers the shared
   * `common` vocabulary (copy / footnotes chrome for Markdown fences).
   */
  t: TranslateNS<'devBuddyLeft'>
  /** Session right-sidebar navigation face (expand/collapse/open tab). */
  sidebarRight: ISidebarRight
  /** Client sessions service (create/open) for "new session in project". */
  sessions: SessionsNav | null
  /** Panel takeover controller, used to reveal the freshly opened session. */
  panelController: PanelController
}

/** Static node subtitles; mirrors the host NODE_REGISTRY descriptions. */
const NODE_DESCRIPTIONS: Record<string, string> = {
  project_info: '项目名称、工作目录、项目信息等（ProjectInfo.md）',
  intend_init: '项目整体意图与初步设计思路（CoreRequirements.md）',
}

export function DevBuddyPanel({ t, sidebarRight, sessions, panelController }: DevBuddyPanelProps) {
  const [state, setState] = useState<DevBuddyState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  /** nodeId -> card face; absent means the default 'closed'. */
  const [modes, setModes] = useState<Record<string, NodeMode>>({})

  const active = state?.projects.find(p => p.id === state.activeProjectId) ?? state?.projects[0] ?? null

  const docTreeNodes = useMemo<DocTreeNode[]>(() => {
    if (active === null) return []
    return active.nodes.map(meta => ({
      document: meta.file,
      title: meta.title,
      collapsed: (modes[meta.id] ?? 'closed') === 'closed',
    }))
  }, [active, modes])

  // Broadcast the active project's ordered document tree with each card's
  // collapse state: on mount, when the project/tree changes, and whenever a
  // card toggles. A short timeout also re-sends for a Reviewer tab that opens
  // slightly later (same-origin postMessage has no handshake).
  useEffect(() => {
    if (active === null) return
    postDocTree(active.id, docTreeNodes)
    const timer = window.setTimeout(() => postDocTree(active.id, docTreeNodes), 400)
    return () => window.clearTimeout(timer)
  }, [active?.id, docTreeNodes])

  // On-demand reply for a Reviewer that opens after the broadcasts (the
  // 400ms catch-up is best-effort; this handshake covers any later open).
  useEffect(() => {
    if (active === null) return
    return onDocTreeRequest(projectId => (
      projectId === active.id
        ? { projectId: active.id, nodes: docTreeNodes }
        : null
    ))
  }, [active?.id, docTreeNodes])

  // Edit-mode NodeCards register their imperative caret resolvers here; the
  // focused editor (document.activeElement) answers a CARET request. Keyed by
  // nodeId so a stale closure cannot overwrite a fresh registration.
  const caretProvidersRef = useRef(new Map<string, CaretProvider>())
  const registerCaretProvider = useCallback((nodeId: string, provider: CaretProvider | null): void => {
    const table = caretProvidersRef.current
    if (provider === null) {
      table.delete(nodeId)
    } else {
      table.set(nodeId, provider)
    }
  }, [])

  useEffect(() => {
    if (active === null) return
    return onCaretRequest(projectId => {
      if (projectId !== active.id) return null
      for (const provider of caretProvidersRef.current.values()) {
        const snapshot = provider()
        if (snapshot !== null) return snapshot
      }
      return null
    })
  }, [active?.id])

  const handleModeChange = useCallback((nodeId: string, mode: NodeMode): void => {
    setModes(prev => (prev[nodeId] === mode ? prev : { ...prev, [nodeId]: mode }))
  }, [])

  // Cards remount (and default to closed) on project switch; reset the table.
  useEffect(() => {
    setModes({})
  }, [active?.id])

  const refresh = useCallback(async () => {
    try {
      setState(await api.state())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const nodeLabels = {
    richtext: t('node.richtext'),
    collapse: t('node.collapse'),
    source: t('node.source'),
    save: t('node.save'),
    saved: t('node.saved'),
    discard: t('node.discard'),
    unsaved: t('node.unsaved'),
    notFound: t('node.notFound'),
    empty: t('node.empty'),
    updated: t('node.updated'),
    reviewBadgeTitle: t('node.reviewBadgeTitle'),
    reviewBadgeDrifted: t('node.reviewBadgeDrifted'),
    addReview: t('node.addReview'),
    closeReview: t('node.closeReview'),
    toolbar: {
      paragraph: t('toolbar.paragraph'),
      bold: t('toolbar.bold'),
      italic: t('toolbar.italic'),
      strike: t('toolbar.strike'),
      code: t('toolbar.code'),
      bulletList: t('toolbar.bulletList'),
      orderedList: t('toolbar.orderedList'),
      taskList: t('toolbar.taskList'),
      blockquote: t('toolbar.blockquote'),
      codeBlock: t('toolbar.codeBlock'),
      link: t('toolbar.link'),
      unlink: t('toolbar.unlink'),
      linkPrompt: t('toolbar.linkPrompt'),
      table: t('toolbar.table'),
      drawing: t('toolbar.drawing'),
      undo: t('toolbar.undo'),
      redo: t('toolbar.redo'),
      ai: t('toolbar.ai'),
      aiPolish: t('ai.polish'),
      aiTranslate: t('ai.translate'),
      aiSummarize: t('ai.summarize'),
      aiContinue: t('ai.continue'),
      aiExplain: t('ai.explain'),
      aiLoading: t('ai.loading'),
      aiNoSelection: t('ai.noSelection'),
      aiPlaceholder: t('ai.placeholder'),
      aiUnavailable: t('ai.unavailable'),
      aiRevise: t('ai.revise'),
      aiRevisePlaceholder: t('ai.revisePlaceholder'),
      aiDialogOriginal: t('ai.dialogOriginal'),
      aiDialogSuggestion: t('ai.dialogSuggestion'),
      aiCancel: t('ai.cancel'),
      aiApply: t('ai.apply'),
      aiFollowUp: t('ai.followUp'),
      aiFollowUpPlaceholder: t('ai.followUpPlaceholder'),
      aiFollowUpSend: t('ai.followUpSend'),
      aiRegenerating: t('ai.regenerating'),
      drawTitle: t('draw.title'),
      drawClose: t('draw.close'),
      drawSaving: t('draw.saving'),
      drawLoadError: t('draw.loadError'),
      drawSaveError: t('draw.saveError'),
      drawEdit: t('draw.edit'),
      drawEmpty: t('draw.empty'),
      drawMissing: t('draw.missing'),
      drawError: t('draw.error'),
    },
  }

  return (
    <div className="dbl-root">
      <div className="dbl-header">
        <div className="dbl-header-titles">
          <h1 className="dbl-header-title">{t('panel.title')}</h1>
        </div>
        <div className="dbl-header-actions">
          <button
            type="button"
            className="dbl-btn dbl-btn-primary"
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => setCreating(value => !value)}
          >
            ＋ {t('project.new')}
          </button>
          <RightbarToggle
            sidebarRight={sidebarRight}
            openLabel={t('panel.rightbarOpen')}
            closeLabel={t('panel.rightbarClose')}
          />
        </div>
      </div>

      {state !== null && state.projects.length > 0 && (
        <div className="dbl-tabbar" role="tablist" aria-label={t('panel.title')}>
          {state.projects.map(project => (
            <button
              key={project.id}
              type="button"
              role="tab"
              aria-selected={active?.id === project.id}
              className="dbl-tab"
              data-active={active?.id === project.id}
              title={`${project.name}\n${project.path}`}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => { void api.openProject(project.id).then(setState) }}
            >
              <span className="dbl-tab-label">{project.name}</span>
              <span
                className="dbl-tab-x"
                role="button"
                aria-label={t('project.remove')}
                title={t('project.remove')}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={event => {
                  event.stopPropagation()
                  if (window.confirm(t('project.removeConfirm'))) {
                    void api.removeProject(project.id).then(setState)
                  }
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="dbl-scroll">
        <div className="dbl-content">
          {error !== null && (
            <div className="dbl-status" data-kind="error">
              {t('error.prefix')}: {error}
              {' '}
              <button type="button" className="dbl-linkbtn" onClick={() => { void refresh() }}>
                {t('error.reload')}
              </button>
            </div>
          )}

          {state === null && error === null && <div className="dbl-loading">{t('loading')}</div>}

          {creating && (
            <NewProjectForm
              labels={{
                name: t('project.name'),
                path: t('project.path'),
                create: t('project.create'),
                cancel: t('project.cancel'),
              }}
              onCancel={() => setCreating(false)}
              // eslint-disable-next-line react/jsx-no-bind
              onSubmit={async input => {
                await api.createProject(input)
                setState(await api.state())
                setCreating(false)
              }}
            />
          )}

          {state !== null && active === null && !creating && (
            <div className="dbl-empty">
              <div>{t('panel.empty')}</div>
              <div className="dbl-node-desc">{t('panel.emptyHint')}</div>
              <button
                type="button"
                className="dbl-btn dbl-btn-primary"
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => setCreating(true)}
              >
                ＋ {t('project.new')}
              </button>
            </div>
          )}

          {active !== null && (
            <>
              <div className="dbl-head">
                <h2 className="dbl-title">{active.name}</h2>
              </div>
              <div className="dbl-path" title={active.path}>{active.path}</div>
              <WorkspaceBar
                projectId={active.id}
                link={active.workspace}
                t={t}
                sessions={sessions}
                onClosePanel={panelController.closePanel}
                onRefresh={refresh}
              />
              {active.nodes.length === 0 && (
                <div className="dbl-status" data-kind="error">{t('node.notFound')}</div>
              )}
              {active.nodes.map(meta => (
                <NodeCard
                  key={`${active.id}:${meta.id}`}
                  projectId={active.id}
                  meta={meta}
                  description={NODE_DESCRIPTIONS[String(meta.id)]}
                  labels={nodeLabels}
                  sidebarRight={sidebarRight}
                  onModeChange={handleModeChange}
                  registerCaretProvider={registerCaretProvider}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
