/**
 * Agent 视图：本地 registry 花名册的创建 + 状态流转。
 *
 * 与其余视图的气质刻意不同：看板/项目/甘特/活动都是「读飞书 + 只读渲染」，
 * agent 名册是 DevTask 自己的本地数据（registry.json），所以这里是面板里
 * 第一个完整 CRUD 界面——新建（默认 provisioning）、状态下拉流转、删除。
 * 状态色板与甘特图/泳道的 task 状态不共用：agent 五态是 Reviewer
 * TeamMemberSummary 的同款语义（design/08 §3.2），自成一套颜色。
 */
import { useCallback, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { AGENT_STATUSES, type AgentRecord, type AgentStatus, type DevTaskState } from '../protocol.ts'
import { api } from './api.ts'
import type { DevTaskKey } from './locales.ts'

/** 状态徽标底色（与状态枚举同序，dtk-agent-pill[data-status] 取）。 */
const AGENT_STATUS_COLORS: Record<AgentStatus, string> = {
  provisioning: '#8a8a92',
  running: '#38b26a',
  idle: '#4c8dff',
  inactive: '#b6b6bd',
  failed: '#e5544b',
}

/** AgentStatus → locale key（Tr 只收字面量 union，模板串要窄化）。 */
const AGENT_STATUS_KEY: Record<AgentStatus, DevTaskKey> = {
  provisioning: 'agent.status.provisioning',
  running: 'agent.status.running',
  idle: 'agent.status.idle',
  inactive: 'agent.status.inactive',
  failed: 'agent.status.failed',
}

/** yyyy-MM-dd（本地时区）；空/非法时间回落 '—'。 */
function fmtDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function AgentView({
  agents,
  t,
  onState,
}: {
  agents: AgentRecord[]
  t: TranslateNS<'devTaskLeft'>
  /** 用 mutation 返回的权威 state 直接更新面板（省一次全量刷新）。 */
  onState: (state: DevTaskState) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (action: () => Promise<DevTaskState>) => {
    setError('')
    setBusy(true)
    try {
      onState(await action())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [onState])

  const submitCreate = useCallback(async () => {
    await run(async () => api.createAgent({ name, description }))
    // 成功后无论错误与否都收起表单；失败时错误行在工具栏下方提示。
    setCreating(false)
    setName('')
    setDescription('')
  }, [run, name, description])

  return (
    <div className="dtk-agent">
      <div className="dtk-agent-toolbar">
        <span className="dtk-agent-count">{t('agent.count').replace('{n}', String(agents.length))}</span>
        <button
          type="button"
          className="dtk-btn dtk-btn-primary"
          disabled={busy}
          onClick={() => { setCreating(c => !c); setError('') }}
        >
          {creating ? t('modal.cancel') : t('agent.create')}
        </button>
      </div>

      {creating && (
        <form
          className="dtk-agent-form"
          onSubmit={e => { e.preventDefault(); void submitCreate() }}
        >
          <input
            className="dtk-input"
            placeholder={t('agent.namePh')}
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={120}
          />
          <textarea
            className="dtk-input dtk-agent-desc"
            placeholder={t('agent.descPh')}
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <div className="dtk-agent-form-actions">
            <button type="submit" className="dtk-btn dtk-btn-primary" disabled={busy || name.trim() === ''}>
              {t('modal.confirm')}
            </button>
          </div>
        </form>
      )}

      {error !== '' && <div className="dtk-error">{error}</div>}

      {agents.length === 0 ? (
        <div className="dtk-view-placeholder">
          <p>{t('agent.empty')}</p>
          <p className="dtk-view-placeholder-hint">{t('agent.emptyHint')}</p>
        </div>
      ) : (
        <div className="dtk-agent-grid">
          {agents.map(agent => (
            <article className="dtk-agent-card" key={agent.id} data-status={agent.status}>
              <header className="dtk-agent-card-head">
                <h3 className="dtk-agent-name" title={agent.name}>{agent.name}</h3>
                <span
                  className="dtk-agent-pill"
                  data-status={agent.status}
                  style={{ background: AGENT_STATUS_COLORS[agent.status] }}
                >
                  {t(AGENT_STATUS_KEY[agent.status])}
                </span>
              </header>
              <p className="dtk-agent-card-desc">
                {agent.description === '' ? '—' : agent.description}
              </p>
              <footer className="dtk-agent-card-foot">
                <span className="dtk-agent-created">{t('agent.created')} {fmtDay(agent.createdAt)}</span>
                <select
                  className="dtk-agent-status-select"
                  value={agent.status}
                  disabled={busy}
                  onChange={e => void run(async () => api.updateAgent(agent.id, { status: e.target.value }))}
                >
                  {AGENT_STATUSES.map(s => (
                    <option value={s} key={s}>{t(AGENT_STATUS_KEY[s])}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="dtk-linkbtn dtk-agent-delete"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t('agent.deleteConfirm').replace('{name}', agent.name))) {
                      void run(async () => api.removeAgent(agent.id))
                    }
                  }}
                >
                  {t('agent.delete')}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
