/**
 * Collapsible multi-select for the 关联方 (related parties) attribute.
 *
 * The value is a list of manual parties (`employee_a` / `agent_a`); an EMPTY
 * list means 自动 (auto-detect) and is rendered as a checked "自动" row inside
 * the dropdown. The trigger summarizes the current state: 自动 when empty,
 * otherwise the selected labels joined by 、.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RELATED_PARTIES } from '../protocol.ts'
import type { RelatedParty } from '../protocol.ts'
import type { TranslateFunction } from './format.ts'

export interface RelatedPartySelectProps {
  value: readonly RelatedParty[]
  onChange: (next: RelatedParty[]) => void
  t: TranslateFunction
  disabled?: boolean
}

export function RelatedPartySelect({
  value,
  onChange,
  t,
  disabled = false,
}: RelatedPartySelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside pointer / Escape while the menu is open.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const auto = value.length === 0

  function toggle(party: RelatedParty): void {
    if (value.includes(party)) onChange(value.filter(item => item !== party))
    else onChange([...value, party])
  }

  const summary = auto
    ? t('relatedParty.auto')
    : value.map(party => t(`relatedParty.${party}`)).join('、')

  return (
    <div className="dbr-ms" ref={rootRef}>
      <button
        type="button"
        className="dbr-ms-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(next => !next)}
      >
        <span className={`dbr-ms-value${auto ? ' is-empty' : ''}`}>{summary}</span>
        <span className="dbr-ms-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="dbr-ms-menu" role="listbox">
          <label className={`dbr-ms-option${auto ? ' is-auto' : ''}`}>
            <input
              type="checkbox"
              checked={auto}
              onChange={() => onChange([])}
            />
            <span>{t('relatedParty.auto')}</span>
          </label>
          {RELATED_PARTIES.map(party => (
            <label key={party} className="dbr-ms-option">
              <input
                type="checkbox"
                checked={value.includes(party)}
                onChange={() => toggle(party)}
              />
              <span>{t(`relatedParty.${party}`)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
