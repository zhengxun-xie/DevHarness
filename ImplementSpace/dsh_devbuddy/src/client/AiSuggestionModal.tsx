/**
 * AI 建议预览弹窗（review-driven workflow）。
 *
 * 取代此前"AI 一键直接改写文档"的行为：AI 结果先在弹窗里预览，
 * 用户可编辑建议、追问让 AI 重新生成、取消（不落地）或应用（写回文档）。
 * 弹窗本身不触碰编辑器 —— 它只持有建议文本，把「应用 / 追问」通过回调
 * 交还给宿主（RichTextToolbar），由宿主决定如何写回 ProseMirror 选区。
 *
 * - 原文栏只读，展示被操作的选区（续写动作下可能为空）。
 * - 建议栏是可编辑 textarea，应用时以用户最终编辑的文本为准。
 * - 追问：输入自然语言指令 → 回车 / 发送 → onFollowUp 返回新的建议文本。
 * - Esc / 点击遮罩 = 取消（不落地）。
 */
import { useEffect, useRef, useState } from 'react'

export interface AiSuggestionModalLabels {
  original: string
  suggestion: string
  cancel: string
  apply: string
  followUp: string
  followUpPlaceholder: string
  followUpSend: string
  regenerating: string
  /** 追问失败时的错误文案。 */
  error: string
}

export interface AiSuggestionModalProps {
  /** 操作名（如「润色 / Polish」），用于弹窗标题。 */
  actionLabel: string
  /** 被操作的原始选区文本（可为空，如「续写」）。 */
  original: string
  /** AI 初次返回的建议文本。 */
  initialSuggestion: string
  labels: AiSuggestionModalLabels
  /** 追问：用一条指令让 AI 重新生成，返回新的建议文本。 */
  onFollowUp: (instruction: string) => Promise<string>
  /** 应用：把用户最终编辑的建议文本写回文档。 */
  onApply: (finalText: string) => void
  /** 取消：关闭弹窗，不做任何改动。 */
  onCancel: () => void
}

export function AiSuggestionModal({
  actionLabel,
  original,
  initialSuggestion,
  labels,
  onFollowUp,
  onApply,
  onCancel,
}: AiSuggestionModalProps): JSX.Element {
  const [suggestion, setSuggestion] = useState(initialSuggestion)
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // Focus the suggestion textarea so the user can start editing immediately.
  useEffect(() => {
    taRef.current?.focus()
  }, [])

  // Escape → cancel (capture phase so it wins over editor key handling).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const sendFollowUp = async (): Promise<void> => {
    const instruction = followUp.trim()
    if (instruction === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await onFollowUp(instruction)
      setSuggestion(next)
      setFollowUp('')
    } catch {
      setError(labels.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="dbl-ai-modal-backdrop"
      role="presentation"
      // eslint-disable-next-line react/jsx-no-bind
      onClick={onCancel}
    >
      <div
        className="dbl-ai-modal"
        role="dialog"
        aria-modal="true"
        aria-label={actionLabel}
        // eslint-disable-next-line react/jsx-no-bind
        onClick={event => event.stopPropagation()}
      >
        <div className="dbl-ai-modal-head">
          <span className="dbl-ai-modal-title">✨ {actionLabel}</span>
        </div>

        <div className="dbl-ai-modal-body">
          <div className="dbl-ai-modal-pane">
            <div className="dbl-ai-modal-label">{labels.original}</div>
            <div className="dbl-ai-modal-original">{original === '' ? '∅' : original}</div>
          </div>

          <div className="dbl-ai-modal-pane">
            <div className="dbl-ai-modal-label">{labels.suggestion}</div>
            <textarea
              ref={taRef}
              className="dbl-ai-modal-textarea"
              value={suggestion}
              spellCheck={false}
              // eslint-disable-next-line react/jsx-no-bind
              onChange={event => setSuggestion(event.target.value)}
            />
          </div>

          <div className="dbl-ai-modal-followup">
            <input
              className="dbl-ai-modal-followup-input"
              value={followUp}
              placeholder={labels.followUpPlaceholder}
              disabled={busy}
              // eslint-disable-next-line react/jsx-no-bind
              onChange={event => setFollowUp(event.target.value)}
              // eslint-disable-next-line react/jsx-no-bind
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendFollowUp()
                }
              }}
            />
            <button
              type="button"
              className="dbl-ai-modal-followup-btn"
              disabled={busy || followUp.trim() === ''}
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => { void sendFollowUp() }}
            >
              {busy ? labels.regenerating : labels.followUpSend}
            </button>
          </div>
          {error !== null && <div className="dbl-ai-modal-err">{error}</div>}
        </div>

        <div className="dbl-ai-modal-foot">
          <button
            type="button"
            className="dbl-ai-modal-btn"
            // eslint-disable-next-line react/jsx-no-bind
            onClick={onCancel}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className="dbl-ai-modal-btn dbl-ai-modal-apply"
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => onApply(suggestion)}
          >
            {labels.apply}
          </button>
        </div>
      </div>
    </div>
  )
}
