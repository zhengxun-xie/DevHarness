/**
 * Cross-barrier window.postMessage bridge (design/05 §2.1).
 *
 * Left sidebar -> Reviewer: a SelectionMessage carrying only the anchor
 * draft (no comment text). Reviewer -> left: ReviewChangedMessage after
 * reviews are created or removed. Both barriers must verify
 * `event.origin === window.location.origin` and the `source` field;
 * malformed messages are dropped silently.
 */
import type {
  CaretMessage,
  CaretRequestMessage,
  DevBuddyMessage,
  DocTreeMessage,
  DocTreeRequestMessage,
  DocTreeNode,
  ProjectSwitchMessage,
  ReviewChangedMessage,
  ReviewAnchorDraft,
  SelectionMessage,
} from '../protocol.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAnchorDraft(value: unknown): value is ReviewAnchorDraft {
  if (!isRecord(value)) return false
  const structural = value.structural
  const textual = value.textual
  const positional = value.positional
  return isRecord(structural)
    && Array.isArray(structural.headingPath)
    && (structural.section === null || typeof structural.section === 'string')
    && isRecord(textual)
    && typeof textual.selectedText === 'string'
    && typeof textual.prefix === 'string'
    && typeof textual.suffix === 'string'
    && isRecord(positional)
    && typeof positional.lineStart === 'number'
    && typeof positional.lineEnd === 'number'
    && (positional.offsetStart === undefined || typeof positional.offsetStart === 'number')
    && (positional.offsetEnd === undefined || typeof positional.offsetEnd === 'number')
}

/** Validate an inbound SelectionMessage; returns null when malformed or foreign. */
export function parseSelectionEvent(event: MessageEvent): SelectionMessage | null {
  if (event.origin !== window.location.origin) return null
  const data = event.data
  if (!isRecord(data) || data.source !== 'devbuddy-left' || data.type !== 'DEVBUDDY_SELECTION') {
    return null
  }
  if (typeof data.projectId !== 'string' || typeof data.document !== 'string') return null
  if (!isAnchorDraft(data.anchor)) return null
  return {
    source: 'devbuddy-left',
    type: 'DEVBUDDY_SELECTION',
    projectId: data.projectId,
    document: data.document,
    anchor: data.anchor,
  }
}

/** Broadcast review changes to the left sidebar. */
export function postReviewChanged(message: Omit<ReviewChangedMessage, 'source' | 'type'>): void {
  const payload: ReviewChangedMessage = {
    source: 'devreviewer',
    type: 'DEVBUDDY_REVIEW_CHANGED',
    ...message,
  }
  window.postMessage(payload, window.location.origin)
}

/** Ask the left sidebar for the active project's ordered document tree. */
export function postDocTreeRequest(projectId: string): void {
  const payload: DocTreeRequestMessage = {
    source: 'devreviewer',
    type: 'DEVBUDDY_DOC_TREE_REQUEST',
    projectId,
  }
  window.postMessage(payload, window.location.origin)
}

/** Ask the left sidebar for a zero-length anchor at the focused editor caret. */
export function postCaretRequest(projectId: string): void {
  const payload: CaretRequestMessage = {
    source: 'devreviewer',
    type: 'DEVBUDDY_CARET_REQUEST',
    projectId,
  }
  window.postMessage(payload, window.location.origin)
}

/** Validate an inbound DocTreeMessage; returns null when malformed or foreign. */
function parseDocTreeEvent(event: MessageEvent): DocTreeMessage | null {
  if (event.origin !== window.location.origin) return null
  const data = event.data
  if (!isRecord(data) || data.source !== 'devbuddy-left' || data.type !== 'DEVBUDDY_DOC_TREE') {
    return null
  }
  if (typeof data.projectId !== 'string' || !Array.isArray(data.nodes)) return null
  const nodes: DocTreeNode[] = []
  for (const raw of data.nodes) {
    if (!isRecord(raw)
      || typeof raw.document !== 'string'
      || typeof raw.title !== 'string'
      || typeof raw.collapsed !== 'boolean') {
      return null
    }
    nodes.push({ document: raw.document, title: raw.title, collapsed: raw.collapsed })
  }
  return { source: 'devbuddy-left', type: 'DEVBUDDY_DOC_TREE', projectId: data.projectId, nodes }
}

/** Validate an inbound ProjectSwitchMessage; returns null when malformed or foreign. */
function parseProjectSwitchEvent(event: MessageEvent): ProjectSwitchMessage | null {
  if (event.origin !== window.location.origin) return null
  const data = event.data
  if (!isRecord(data)
    || data.source !== 'devbuddy-left'
    || data.type !== 'DEVBUDDY_PROJECT_SWITCH') {
    return null
  }
  if (typeof data.projectId !== 'string' || data.projectId.length === 0) return null
  return { source: 'devbuddy-left', type: 'DEVBUDDY_PROJECT_SWITCH', projectId: data.projectId }
}

/** Validate an inbound CaretMessage; returns null when malformed or foreign. */
function parseCaretEvent(event: MessageEvent): CaretMessage | null {
  if (event.origin !== window.location.origin) return null
  const data = event.data
  if (!isRecord(data) || data.source !== 'devbuddy-left' || data.type !== 'DEVBUDDY_CARET') {
    return null
  }
  if (typeof data.projectId !== 'string' || typeof data.document !== 'string') return null
  if (!isAnchorDraft(data.anchor)) return null
  return {
    source: 'devbuddy-left',
    type: 'DEVBUDDY_CARET',
    projectId: data.projectId,
    document: data.document,
    anchor: data.anchor,
  }
}

/** Subscribe to any DevBuddy cross-barrier message; returns an unsubscribe fn. */
export function onDevBuddyMessage(handler: (message: DevBuddyMessage) => void): () => void {
  const listener = (event: MessageEvent): void => {
    const selection = parseSelectionEvent(event)
    if (selection !== null) {
      handler(selection)
      return
    }
    const caret = parseCaretEvent(event)
    if (caret !== null) {
      handler(caret)
      return
    }
    const docTree = parseDocTreeEvent(event)
    if (docTree !== null) {
      handler(docTree)
      return
    }
    const projectSwitch = parseProjectSwitchEvent(event)
    if (projectSwitch !== null) {
      handler(projectSwitch)
      return
    }
    if (event.origin !== window.location.origin) return
    const data = event.data
    if (isRecord(data)
      && data.source === 'devreviewer'
      && data.type === 'DEVBUDDY_REVIEW_CHANGED'
      && typeof data.projectId === 'string'
      && typeof data.document === 'string'
      && Array.isArray(data.reviewIds)) {
      handler({
        source: 'devreviewer',
        type: 'DEVBUDDY_REVIEW_CHANGED',
        projectId: data.projectId,
        document: data.document,
        reviewIds: data.reviewIds.filter((id): id is string => typeof id === 'string'),
      })
    }
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
