import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DELIVERY_STAGE_KINDS, DELIVERY_STAGE_STATUSES, type DeliveryProjectRef, type DeliveryRun, type DeliveryStageKind } from '../protocol.ts'
import { api } from './api.ts'

export const DELIVERY_NS = 'devDelivery'
export const DELIVERY_TAB_KIND = 'devdelivery'

/** Cross-panel navigation payload accepted by DevTask and DevBuddy launchers. */
export interface DeliveryTabParams { project?: DeliveryProjectRef; runId?: string }
export type DeliveryPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof DELIVERY_NS>

const fallbackProject: DeliveryProjectRef = { id: 'unlinked', name: '未关联项目' }
function stageKey(kind: DeliveryStageKind): `stage.${DeliveryStageKind}` { return `stage.${kind}` }
function statusKey(status: string): `status.${string}` { return `status.${status}` }

export function DeliveryPanel({ t, useTabInfo }: DeliveryPanelProps): ReactNode {
  const tabInfo = useTabInfo()
  const params = (tabInfo.tab.navigation.params ?? {}) as DeliveryTabParams
  const project = params.project ?? fallbackProject
  const [state, setState] = useState<Awaited<ReturnType<typeof api.state>> | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(params.runId ?? null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [branch, setBranch] = useState('')
  const [commitSha, setCommitSha] = useState('')
  const [evidenceFor, setEvidenceFor] = useState<DeliveryStageKind | null>(null)
  const [evidenceTitle, setEvidenceTitle] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceNote, setEvidenceNote] = useState('')

  const load = useCallback(async () => {
    try {
      const next = await api.state(project.id === fallbackProject.id ? undefined : project.id)
      setState(next); setSelectedRunId(current => current && next.runs.some(run => run.id === current) ? current : (params.runId ?? next.activeRunId)); setError(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }, [params.runId, project.id])
  useEffect(() => { void load() }, [load, tabInfo.tab.navigation.revision])

  const active = useMemo(() => state?.runs.find(run => run.id === selectedRunId) ?? state?.runs[0] ?? null, [selectedRunId, state])
  const passed = active?.stages.filter(stage => stage.status === 'passed').length ?? 0

  const mutate = async (promise: Promise<Awaited<ReturnType<typeof api.state>>>) => {
    try { const next = await promise; setState(next); setError(null) } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  const createRun = async () => {
    await mutate(api.createRun({ project, version, branch, commitSha }))
    setVersion(''); setBranch(''); setCommitSha(''); setCreating(false)
  }
  const addEvidence = async () => {
    if (!active || !evidenceFor || evidenceTitle.trim() === '') return
    await mutate(api.addEvidence({ runId: active.id, kind: evidenceFor, title: evidenceTitle, url: evidenceUrl, note: evidenceNote }))
    setEvidenceFor(null); setEvidenceTitle(''); setEvidenceUrl(''); setEvidenceNote('')
  }

  return <section className="ddl-panel">
    <header className="ddl-header">
      <div><h2>{t('tab.title')}</h2><p>{project.name}</p></div>
      <button type="button" className="ddl-icon-btn" onClick={() => void load()} title={t('panel.refresh')}>↻</button>
    </header>
    {error && <p className="ddl-error">{t('error.load')}: {error}</p>}
    <div className="ddl-toolbar">
      <button type="button" className="ddl-btn ddl-primary" onClick={() => setCreating(value => !value)}>{t('panel.createRun')}</button>
      <button type="button" className="ddl-btn" onClick={() => window.dispatchEvent(new CustomEvent('dsh:devbuddy:open', { detail: { project } }))}>{t('action.openDevBuddy')}</button>
      <button type="button" className="ddl-btn" onClick={() => window.dispatchEvent(new CustomEvent('dsh:devtask:open', { detail: { project } }))}>{t('action.openDevTask')}</button>
    </div>
    {creating && <form className="ddl-form" onSubmit={event => { event.preventDefault(); void createRun() }}>
      <label>{t('run.version')}<input value={version} onChange={event => setVersion(event.target.value)} autoFocus /></label>
      <label>{t('run.branch')}<input value={branch} onChange={event => setBranch(event.target.value)} /></label>
      <label>{t('run.commit')}<input value={commitSha} onChange={event => setCommitSha(event.target.value)} /></label>
      <div className="ddl-actions"><button type="button" className="ddl-btn" onClick={() => setCreating(false)}>{t('run.cancel')}</button><button className="ddl-btn ddl-primary">{t('run.create')}</button></div>
    </form>}
    {state !== null && state.runs.length > 1 && <select className="ddl-run-select" value={active?.id ?? ''} onChange={event => { setSelectedRunId(event.target.value); void mutate(api.selectRun(event.target.value)) }}>{state.runs.map(run => <option value={run.id} key={run.id}>{run.version} · {run.project.name}</option>)}</select>}
    {active === null ? <div className="ddl-empty">{t('panel.empty')}</div> : <>
      <div className="ddl-summary"><span>{active.version}</span><strong data-status={active.status}>{t(statusKey(active.status) as never)}</strong><small>{passed} / {active.stages.length} {t('status.passed')}</small></div>
      <ol className="ddl-stages">{active.stages.map(stage => <li key={stage.kind} data-status={stage.status}>
        <div className="ddl-stage-head"><span className="ddl-dot" /><strong>{t(stageKey(stage.kind))}</strong><select value={stage.status} onChange={event => void mutate(api.updateStage({ runId: active.id, kind: stage.kind, status: event.target.value as typeof stage.status }))}>{DELIVERY_STAGE_STATUSES.map(status => <option key={status} value={status}>{t(statusKey(status) as never)}</option>)}</select></div>
        {stage.summary && <p>{stage.summary}</p>}
        {stage.evidence.length > 0 && <ul className="ddl-evidence">{stage.evidence.map(item => <li key={item.id}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}{item.note && <small> · {item.note}</small>}</li>)}</ul>}
        <button className="ddl-link" type="button" onClick={() => setEvidenceFor(stage.kind)}>+ {t('action.addEvidence')}</button>
      </li>)}</ol>
    </>}
    {evidenceFor && active && <form className="ddl-form ddl-evidence-form" onSubmit={event => { event.preventDefault(); void addEvidence() }}>
      <strong>{t('action.addEvidence')} · {t(stageKey(evidenceFor))}</strong><label>{t('evidence.title')}<input value={evidenceTitle} onChange={event => setEvidenceTitle(event.target.value)} autoFocus /></label><label>{t('evidence.url')}<input value={evidenceUrl} onChange={event => setEvidenceUrl(event.target.value)} /></label><label>{t('evidence.note')}<input value={evidenceNote} onChange={event => setEvidenceNote(event.target.value)} /></label><div className="ddl-actions"><button type="button" className="ddl-btn" onClick={() => setEvidenceFor(null)}>{t('run.cancel')}</button><button className="ddl-btn ddl-primary">{t('action.addEvidence')}</button></div>
    </form>}
  </section>
}
