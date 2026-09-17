/**
 * Minimal open-state controller for the DOM-takeover DevBuddy panel.
 *
 * The DOM mount cores (family/panel-mount-core.ts) bind visibility to
 * `getSnapshot().open` + subscribe; the injected sidebar row toggles it.
 * No framework dependency — a listener set, mirroring the BoardController
 * shape the task-board wrappers consume.
 */
export interface PanelSnapshot {
  open: boolean
}

export interface PanelController {
  getSnapshot(): PanelSnapshot
  subscribe(listener: () => void): () => void
  openPanel(): void
  closePanel(): void
  togglePanel(): void
  isOpen(): boolean
}

export function createPanelController(): PanelController {
  let open = false
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => ({ open }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    openPanel() {
      if (open) return
      open = true
      emit()
    },
    closePanel() {
      if (!open) return
      open = false
      emit()
    },
    togglePanel() {
      open = !open
      emit()
    },
    isOpen: () => open,
  }
}
