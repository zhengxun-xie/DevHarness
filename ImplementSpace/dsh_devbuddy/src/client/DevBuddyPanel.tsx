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
import { WorkspaceBar, type UiWorkspaceNav } from './WorkspaceBar.tsx'
import type { PanelController } from './panelController.ts'
import type { DevBuddyState, WorkspaceLink } from '../protocol.ts'

export interface DevBuddyPanelProps {
  /**
   * Bound DevBuddy translator; the key domain also covers the shared
   * `common` vocabulary (copy / footnotes chrome for Markdown fences).
   */
  t: TranslateNS<'devBuddyLeft'>
  /** Session right-sidebar navigation face (expand/collapse/open tab). */
  sidebarRight: ISidebarRight
  /**
   * Client ui-workspace navigation service; on project switch it re-points
   * the DSH active workspace/session (and thus the session right sidebar)
   * at the newly selected project. Null only when the service is absent.
   */
  uiWorkspace: UiWorkspaceNav | null
  /** Panel takeover controller, used to reveal the freshly opened session. */
  panelController: PanelController
}

/** Static node subtitles; mirrors the host NODE_REGISTRY descriptions. */
const NODE_DESCRIPTIONS: Record<string, string> = {
  project_info: '项目名称、工作目录、项目信息等（ProjectInfo.md）',
  intend_init: '项目整体意图与初步设计思路（Intent.md）',
}

/**
 * Switch DSH's main view to a specific session, tolerating the short window
 * where the session created moments ago is not yet present in the client
 * snapshot (sessions.retain throws then). openSession is synchronous; each
 * attempt is swallowed — a navigation miss must never break creation.
 */
async function openSessionBestEffort(uiWorkspace: UiWorkspaceNav, sessionId: string): Promise<void> {
  for (const delay of [0, 200, 500, 1000]) {
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
    try {
      uiWorkspace.openSession(sessionId)
      return
    } catch {
      // retry — freshly created session may not be retained yet
    }
  }
}

export function DevBuddyPanel({ t, sidebarRight, uiWorkspace, panelController }: DevBuddyPanelProps) {
  const [state, setState] = useState<DevBuddyState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  /** projectId -> (nodeId -> card face); absent means the default 'closed'. */
  const [modes, setModes] = useState<Record<string, Record<string, NodeMode>>>({})

  const active = state?.projects.find(p => p.id === state.activeProjectId) ?? state?.projects[0] ?? null

  const docTreeNodes = useMemo<DocTreeNode[]>(() => {
    if (active === null) return []
    return active.nodes.map(meta => ({
      document: meta.file,
      title: meta.title,
      collapsed: (modes[active.id]?.[meta.id] ?? 'closed') === 'closed',
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
  // focused editor (document.activeElement) answers a CARET request. Keyed
  // first by project (all projects' cards stay mounted) then nodeId, so a
  // hidden project's card can never shadow the active project's resolver.
  const caretProvidersRef = useRef(new Map<string, Map<string, CaretProvider>>())
  const registerCaretProvider = useCallback((projectId: string, nodeId: string, provider: CaretProvider | null): void => {
    let perProject = caretProvidersRef.current.get(projectId)
    if (perProject === undefined) {
      perProject = new Map()
      caretProvidersRef.current.set(projectId, perProject)
    }
    if (provider === null) {
      perProject.delete(nodeId)
    } else {
      perProject.set(nodeId, provider)
    }
  }, [])

  useEffect(() => {
    if (active === null) return
    return onCaretRequest(projectId => {
      if (projectId !== active.id) return null
      for (const provider of caretProvidersRef.current.get(active.id)?.values() ?? []) {
        const snapshot = provider()
        if (snapshot !== null) return snapshot
      }
      return null
    })
  }, [active?.id])

  const handleModeChange = useCallback((projectId: string, nodeId: string, mode: NodeMode): void => {
    setModes(prev => {
      const perProject = prev[projectId] ?? {}
      if (perProject[nodeId] === mode) return prev
      return { ...prev, [projectId]: { ...perProject, [nodeId]: mode } }
    })
  }, [])

  // Cards stay mounted across project switches (hidden via CSS), so their
  // open/closed faces and drafts are preserved; no mode reset on switch.

  // NodeCards register an auto-save handle here, keyed by project then
  // node. switchProject awaits the outgoing project's handles before the
  // active project changes, so unsaved edits reach disk automatically.
  const saveHandlesRef = useRef(new Map<string, Map<string, () => Promise<void>>>())
  const registerSaveHandle = useCallback((projectId: string, nodeId: string, handle: (() => Promise<void>) | null): void => {
    let perProject = saveHandlesRef.current.get(projectId)
    if (perProject === undefined) {
      perProject = new Map()
      saveHandlesRef.current.set(projectId, perProject)
    }
    if (handle === null) {
      perProject.delete(nodeId)
    } else {
      perProject.set(nodeId, handle)
    }
  }, [])

  /**
   * The single shared `.dbl-scroll` scroller carries every project layer.
   * Its scrollTop would otherwise travel with the switch (and get clamped by
   * the incoming project's shorter height), so each project's position is
   * remembered here and restored after the layer swap.
   */
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollMemoryRef = useRef(new Map<string, number>())

  /** True only during the auto-save + openProject window of a switch. */
  const [switching, setSwitching] = useState(false)

  const switchProject = useCallback(async (project: DevBuddyState['projects'][number]): Promise<void> => {
    const currentId = active?.id ?? null
    if (currentId === project.id) return
    let freshLink: WorkspaceLink | null | undefined = project.workspace
    setSwitching(true)
    try {
      // Auto-save every dirty card of the outgoing project first. A failing
      // save does not block the switch: the card stays mounted, keeps the
      // draft, and surfaces the error when the user switches back.
      const perProject = currentId === null ? undefined : saveHandlesRef.current.get(currentId)
      if (perProject !== undefined) {
        for (const handle of Array.from(perProject.values())) {
          try {
            await handle()
          } catch {
            // best-effort; continue with the remaining cards
          }
        }
      }
      // Remember the outgoing project's scroll position before its layer is
      // hidden — the shared scroller keeps only one scrollTop.
      if (currentId !== null && scrollRef.current !== null) {
        scrollMemoryRef.current.set(currentId, scrollRef.current.scrollTop)
      }
      const next = await api.openProject(project.id)
      setState(next)
      // Restore after the incoming layer paints: two frames let its content
      // height settle before assigning the saved offset.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (scrollRef.current !== null) {
          scrollRef.current.scrollTop = scrollMemoryRef.current.get(project.id) ?? 0
        }
      }))
      // Navigate from the link we just fetched, not the tab's own copy: a
      // panel that has been open a while holds a /state snapshot that can
      // predate sessions created since, and a stale null would make the
      // switch create a session instead of reusing the existing one.
      freshLink = next.projects.find(candidate => candidate.id === project.id)?.workspace
        ?? project.workspace
    } finally {
      setSwitching(false)
    }
    // Re-point DSH's active workspace/session at the new project so the
    // session right sidebar follows the switch. When the workspace already
    // has a session, bind to its most recent one instead of creating a new
    // session; openWorkspace is used only when it has none. Best-effort.
    if (uiWorkspace !== null) {
      const latestSessionId = freshLink?.latestSessionId ?? null
      if (latestSessionId !== null) {
        void openSessionBestEffort(uiWorkspace, latestSessionId)
      } else if (freshLink?.workspaceId !== undefined) {
        void uiWorkspace.openWorkspace(freshLink.workspaceId).catch(() => {
          // Navigation failure must not disturb the project switch.
        })
      }
    }
  }, [active?.id, uiWorkspace])

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
    diff: t('node.diff'),
    diffView: {
      noChanges: t('diff.noChanges'),
      summary: t('diff.summary'),
    },
    unsaved: t('node.unsaved'),
    notFound: t('node.notFound'),
    empty: t('node.empty'),
    updated: t('node.updated'),
    reviewBadgeTitle: t('node.reviewBadgeTitle'),
    reviewBadgeDrifted: t('node.reviewBadgeDrifted'),
    addReview: t('node.addReview'),
    closeReview: t('node.closeReview'),
    foldSection: t('node.foldSection'),
    unfoldSection: t('node.unfoldSection'),
    foldedLines: t('node.foldedLines'),
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

      {/* The create-project form lives in the panel's upper area, ABOVE the
          tab strip: it is the chrome that adds a tab, so it belongs with the
          header block rather than as content pushed into the scroll body. */}
      {creating && (
        <div className="dbl-form-area">
          <NewProjectForm
            uiWorkspace={uiWorkspace}
            labels={{
              name: t('project.name'),
              path: t('project.path'),
              browse: t('project.browse'),
              initGit: t('project.initGit'),
              createSession: t('project.createSession'),
              create: t('project.create'),
              cancel: t('project.cancel'),
            }}
            pickerLabels={{
              title: t('picker.title'),
              select: t('picker.select'),
              newFolder: t('picker.newFolder'),
              createFolder: t('picker.createFolder'),
              cancel: t('picker.cancel'),
              empty: t('picker.empty'),
              loading: t('picker.loading'),
            }}
            onCancel={() => setCreating(false)}
            // eslint-disable-next-line react/jsx-no-bind
            onSubmit={async ({ name, path, initGit, createSession }) => {
              // The welcome prompt makes the host create the session with a
              // committed turn (non-blank → persisted); it returns the id.
              const result = await api.createProject({
                name,
                path,
                initGit,
                welcome: createSession ? t('project.sessionWelcome') : undefined,
              })
              setState(await api.state())
              setCreating(false)
              // Navigate DSH to that SPECIFIC session. openWorkspace would
              // instead open/create a blank session (the one that gets
              // dropped), so it must not be used here. Best-effort.
              if (result.initialSessionId !== null && uiWorkspace !== null) {
                void openSessionBestEffort(uiWorkspace, result.initialSessionId)
              }
            }}
          />
        </div>
      )}

      {state !== null && state.projects.length > 0 && (
        <div className="dbl-tabbar" role="tablist" aria-label={t('panel.title')} data-switching={switching}>
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
              onClick={() => {
                void switchProject(project)
              }}
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

      <div ref={scrollRef} className="dbl-scroll">
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
                uiWorkspace={uiWorkspace}
                onClosePanel={panelController.closePanel}
                onRefresh={refresh}
              />
              {active.nodes.length === 0 && (
                <div className="dbl-status" data-kind="error">{t('node.notFound')}</div>
              )}
            </>
          )}

          {/* Every project's cards stay mounted; inactive layers are hidden
              instead of unmounted, so open docs and unsaved drafts survive a
              project switch (switchProject auto-saves dirty cards first). */}
          {state !== null && state.projects.map(project => (
            <div
              key={project.id}
              className="dbl-project-layer"
              hidden={project.id !== active?.id}
            >
              {project.nodes.map(meta => (
                <NodeCard
                  key={meta.id}
                  projectId={project.id}
                  meta={meta}
                  description={NODE_DESCRIPTIONS[String(meta.id)]}
                  labels={nodeLabels}
                  sidebarRight={sidebarRight}
                  onModeChange={handleModeChange}
                  registerCaretProvider={registerCaretProvider}
                  registerSaveHandle={registerSaveHandle}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
