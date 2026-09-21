/**
 * Review file codec: one Markdown file per review, YAML frontmatter carries
 * structured fields, the body carries only-append Comment / Proposal / Thread
 * sections (design/03-data-model.md §3).
 *
 * Unknown frontmatter keys round-trip: they are captured in `extra` and
 * re-emitted in their original positions after the known keys, so older/newer
 * plugin versions do not drop data.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { sha256 } from './projects.ts'
import { parseYaml, serializeYaml, isYamlObject, type YamlObject, type YamlValue } from './yaml-lite.ts'
import type {
  AgentCompletion,
  AuthorRef,
  ReviewAnchor,
  ReviewDecision,
  ReviewRecord,
  ReviewRelated,
  ReviewStatus,
  ReviewThread,
  ReviewType,
  Severity,
  StoredReviewStatus,
  ThreadEntry,
} from '../protocol.ts'
import { DECISION_TYPES, STORED_STATUSES, normalizeRelatedParties, normalizeStatus } from '../protocol.ts'

export const REVIEW_SCHEMA_VERSION = 2
/** Version stamped by legacy builds; read is still supported via lazy migration. */
const LEGACY_SCHEMA_VERSION = 1
export const REVIEWS_DIRNAME = '.devbuddy/reviews'
const REVIEW_FILE_RE = /^(REV-\d{4})-.*\.md$/

export class ReviewFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewFileError'
  }
}

// ---------------------------------------------------------------------------
// Coercion helpers (YAML values -> typed model, tolerant on read)
// ---------------------------------------------------------------------------

function asString(value: YamlValue | undefined, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function asNullableString(value: YamlValue | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = asString(value, '')
  return text === '' ? null : text
}

function asNumber(value: YamlValue | undefined, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return fallback
}

function asStringArray(value: YamlValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => asString(item)).filter(item => item !== '')
}

function asObject(value: YamlValue | undefined): YamlObject {
  return isYamlObject(value) ? value : {}
}

/** Raw read: write set + legacy aliases, deliberately NOT normalized. */
function asStoredStatus(value: YamlValue | undefined): StoredReviewStatus {
  const text = asString(value, 'open')
  return (STORED_STATUSES as readonly string[]).includes(text)
    ? (text as StoredReviewStatus)
    : 'open'
}

/**
 * Review status: legacy names are normalized onto the converged 8-status set
 * (design 06 §11). Thread entries keep their raw historical names instead —
 * see asStoredStatus above — so the audit trail is never rewritten.
 */
function asStatus(value: YamlValue | undefined): ReviewStatus {
  return normalizeStatus(asStoredStatus(value))
}

function asSeverity(value: YamlValue | undefined): Severity {
  const text = asString(value, 'minor')
  return (['info', 'minor', 'major', 'critical'] as string[]).includes(text)
    ? (text as Severity)
    : 'minor'
}

function asReviewType(value: YamlValue | undefined): ReviewType {
  const text = asString(value, 'suggestion')
  const allowed: ReviewType[] = [
    'question', 'exploration', 'suggestion', 'bug', 'design_issue',
    'requirement_issue', 'implementation_issue', 'test_issue',
  ]
  return (allowed as string[]).includes(text) ? (text as ReviewType) : 'suggestion'
}

const KNOWN_KEYS = new Set([
  'schemaVersion', 'schema_version', 'review_id', 'number', 'document', 'document_sha',
  'type', 'severity', 'title', 'status', 'tags', 'related_parties', 'target', 'author', 'author_ref',
  'assignee', 'assignee_member', 'team_task_id', 'session_id', 'related', 'decision', 'decisions', 'agent_completion', 'thread',
  'created_at', 'updated_at', 'resolved_at', 'duplicated_of', 'comment_edited_at',
])

/** Parse optional LF 0-based caret offsets; legacy files omit them. */
function optionalOffsets(positional: YamlObject): { offsetStart?: number; offsetEnd?: number } {
  const startRaw = positional.offset_start ?? positional.offsetStart
  const endRaw = positional.offset_end ?? positional.offsetEnd
  const out: { offsetStart?: number; offsetEnd?: number } = {}
  if (typeof startRaw === 'number' && Number.isFinite(startRaw)) out.offsetStart = startRaw
  if (typeof endRaw === 'number' && Number.isFinite(endRaw)) out.offsetEnd = endRaw
  return out
}

function anchorFromYaml(target: YamlObject): ReviewAnchor {
  const structural = asObject(target.structural)
  const textual = asObject(target.textual)
  const positional = asObject(target.positional)
  const fingerprint = asObject(target.fingerprint)
  return {
    structural: {
      section: asNullableString(structural.section),
      headingPath: asStringArray(structural.heading_path ?? structural.headingPath),
    },
    textual: {
      selectedText: asString(textual.selected_text ?? textual.selectedText),
      prefix: asString(textual.prefix),
      suffix: asString(textual.suffix),
    },
    positional: {
      lineStart: asNumber(positional.line_start ?? positional.lineStart, 1),
      lineEnd: asNumber(positional.line_end ?? positional.lineEnd, 1),
      ...optionalOffsets(positional),
    },
    fingerprint: {
      algorithm: 'sha256',
      value: asString(fingerprint.value),
    },
  }
}

function asAuthorRef(value: YamlValue | undefined, fallbackId = 'reviewer'): AuthorRef {
  if (isYamlObject(value)) {
    const type = asString(value.type, 'user') === 'agent' ? 'agent' : 'user'
    const id = asString(value.id, fallbackId) || fallbackId
    const author: AuthorRef = { type, id }
    const provider = asNullableString(value.provider)
    if (provider !== null) author.provider = provider
    const displayName = asNullableString(value.display_name ?? value.displayName)
    if (displayName !== null) author.displayName = displayName
    const runId = asNullableString(value.agent_run_id ?? value.agentRunId)
    if (runId !== null) author.agentRunId = runId
    return author
  }
  // Legacy / shorthand scalar: a bare string is a user id; "agent:id[:runId]"
  // is the v1 thread-line encoding.
  return parseAuthorRef(asString(value, fallbackId))
}

function authorRefToYaml(author: AuthorRef): YamlObject {
  return {
    type: author.type,
    id: author.id,
    ...(author.provider !== undefined ? { provider: author.provider } : {}),
    ...(author.displayName !== undefined ? { display_name: author.displayName } : {}),
    ...(author.agentRunId !== undefined ? { agent_run_id: author.agentRunId } : {}),
  }
}

function decisionFromYaml(value: YamlValue | undefined): ReviewDecision | null {
  if (!isYamlObject(value)) return null
  const type = asString(value.type)
  if (!(DECISION_TYPES as readonly string[]).includes(type)) return null
  // v1 stored decided_by as a bare string; migrate it to a rich user identity.
  const decidedByRaw = value.decided_by ?? value.decidedBy
  const decidedBy = decidedByRaw === undefined || typeof decidedByRaw === 'string'
    ? { type: 'user' as const, id: asString(decidedByRaw, 'reviewer') || 'reviewer' }
    : asAuthorRef(decidedByRaw)
  return {
    id: asString(value.id, 'DEC-0001'),
    type: type as ReviewDecision['type'],
    summary: asString(value.summary),
    decidedBy,
    decidedAt: asString(value.decided_at ?? value.decidedAt),
  }
}

function decisionsFromYaml(value: YamlValue | undefined): ReviewDecision[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => decisionFromYaml(item))
    .filter((decision): decision is ReviewDecision => decision !== null)
}

function agentCompletionFromYaml(value: YamlValue | undefined): AgentCompletion | null {
  if (!isYamlObject(value)) return null
  const at = asString(value.at)
  const sessionId = asString(value.session_id ?? value.sessionId)
  if (at === '' || sessionId === '') return null
  return {
    at,
    sessionId,
    rpcId: asString(value.rpc_id ?? value.rpcId),
    provider: asNullableString(value.provider),
    model: asNullableString(value.model),
  }
}

function agentCompletionToYaml(completion: AgentCompletion | null): YamlValue {
  if (completion === null) return null
  return {
    at: completion.at,
    session_id: completion.sessionId,
    rpc_id: completion.rpcId,
    provider: completion.provider,
    model: completion.model,
  }
}

function relatedFromYaml(value: YamlValue | undefined): ReviewRelated {
  const related = asObject(value)
  return {
    decisions: asStringArray(related.decisions),
    reviews: asStringArray(related.reviews),
    code: asStringArray(related.code),
    tests: asStringArray(related.tests),
    commits: asStringArray(related.commits),
    agentRuns: asStringArray(related.agent_runs ?? related.agentRuns),
  }
}

// ---------------------------------------------------------------------------
// Thread body codec
// ---------------------------------------------------------------------------

// nowIso() emits millisecond precision (toISOString), so fractional seconds
// are mandatory to accept — without them every thread line written by this
// plugin would silently drop on re-read.
const THREAD_LINE_RE = /^- \[(\d{4}-\d{2}-\d{2}[ T][\d:]+(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?) \/ ([^\]]+)] (.*)$/

/** Parse the `- [time / author] body` thread lines into structured entries. */
export function parseThreadSection(section: string): ThreadEntry[] {
  const entries: ThreadEntry[] = []
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const match = THREAD_LINE_RE.exec(line)
    if (match === null) continue
    const [, at, rawAuthorField, body] = match
    // "(edited ISO)" rides inside the author field, before any reply marker.
    let authorField = rawAuthorField
    let editedAt: string | undefined
    const editedMatch = /\(edited ([^)]+)\)/.exec(authorField)
    if (editedMatch !== null) {
      editedAt = editedMatch[1]
      authorField = authorField.replace(editedMatch[0], '').trim()
    }
    const replyMatch = /\s*\(reply (ENTRY-\d+)\)\s*$/.exec(authorField)
    const replyTo = replyMatch?.[1]
    const author = parseAuthorRef(authorField.replace(/\s*\(reply (ENTRY-\d+)\)\s*$/, '').trim())
    const base = {
      id: `ENTRY-${String(entries.length + 1).padStart(4, '0')}`,
      at,
      author,
      ...(editedAt !== undefined ? { editedAt } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    }
    // Encoded status entries: "[open -> accepted] reason". The bracket shape
    // is unambiguous, so status lines are recognized regardless of author.
    const statusMatch = /^\[([a-z_]+) -> ([a-z_]+)\]\s?([\s\S]*)$/.exec(body)
    if (statusMatch !== null) {
      entries.push({
        ...base,
        kind: 'status',
        body: statusMatch[3],
        fromStatus: statusMatch[1] as StoredReviewStatus,
        toStatus: statusMatch[2] as StoredReviewStatus,
      })
      continue
    }
    const decisionMatch = /^Decision\((accept|reject|duplicate)\):?\s?([\s\S]*)$/.exec(body)
    if (decisionMatch !== null) {
      entries.push({
        ...base,
        kind: 'decision',
        body: decisionMatch[2],
        decisionType: decisionMatch[1] as ThreadEntry['decisionType'],
      })
      continue
    }
    entries.push({ ...base, kind: 'comment', body })
  }
  return entries
}

function parseAuthorRef(text: string): AuthorRef {
  if (text.startsWith('agent:')) {
    const id = text.slice('agent:'.length).trim()
    const colon = id.indexOf(':')
    if (colon !== -1) {
      return { type: 'agent', id: id.slice(0, colon).trim(), agentRunId: id.slice(colon + 1).trim() }
    }
    return { type: 'agent', id }
  }
  return { type: 'user', id: text }
}

/** Split the Markdown body into Comment / Proposal sections (v2: the body's
 * Thread section is only a human-readable projection; structured thread lives
 * in frontmatter and is authoritative). */
function parseBodySections(body: string): { comment: string; proposal: string } {
  const sectionRe = /^## (Comment|Proposal|Thread)\s*$/
  const sections: Record<string, string> = {}
  let current: string | null = null
  const buffer: string[] = []
  const flush = () => { if (current !== null) sections[current] = buffer.join('\n').trim() }
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const match = sectionRe.exec(line.trim())
    if (match !== null) {
      flush()
      current = match[1]
      buffer.length = 0
    } else if (current !== null) {
      buffer.push(line)
    }
  }
  flush()
  return {
    comment: sections.Comment ?? '',
    proposal: sections.Proposal ?? '',
  }
}

// ---------------------------------------------------------------------------
// v2 structured thread codec
// ---------------------------------------------------------------------------

function asEntryKind(value: YamlValue | undefined): ThreadEntry['kind'] {
  const text = asString(value, 'comment')
  return (['comment', 'status', 'decision', 'system'] as string[]).includes(text)
    ? (text as ThreadEntry['kind'])
    : 'comment'
}

/** De-duplication key for participants: an entity is type+id+provider; the
 * run id is comment-scoped and does not split one agent into participants. */
export function participantKey(author: AuthorRef): string {
  return `${author.type}:${author.id}:${author.provider ?? ''}`
}

export function deriveParticipants(entries: ThreadEntry[], extras: AuthorRef[] = []): AuthorRef[] {
  const map = new Map<string, AuthorRef>()
  for (const author of [...extras, ...entries.map(entry => entry.author)]) {
    const key = participantKey(author)
    if (!map.has(key)) map.set(key, author)
  }
  return [...map.values()]
}

/** Assign stable ENTRY-#### ids by max+1, filling missing/duplicate ids while
 * preserving every well-formed unique id (never positional re-numbering). */
function stabilizeEntryIds(entries: ThreadEntry[]): ThreadEntry[] {
  const used = new Set<string>()
  let max = 0
  for (const entry of entries) {
    const match = /^ENTRY-(\d+)$/.exec(entry.id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return entries.map((entry) => {
    if (/^ENTRY-\d{4}$/.test(entry.id) && !used.has(entry.id)) {
      used.add(entry.id)
      return entry
    }
    max += 1
    const id = `ENTRY-${String(max).padStart(4, '0')}`
    used.add(id)
    return { ...entry, id }
  })
}

function entryFromYaml(value: YamlValue, index: number): ThreadEntry {
  const o = asObject(value)
  const entry: ThreadEntry = {
    id: asString(o.id, `ENTRY-${String(index + 1).padStart(4, '0')}`) || `ENTRY-${String(index + 1).padStart(4, '0')}`,
    at: asString(o.at),
    author: asAuthorRef(o.author),
    kind: asEntryKind(o.kind),
    body: asString(o.body),
  }
  const replyTo = asNullableString(o.reply_to ?? o.replyTo)
  if (replyTo !== null) entry.replyTo = replyTo
  const editedAt = asNullableString(o.edited_at ?? o.editedAt)
  if (editedAt !== null) entry.editedAt = editedAt
  if (o.from_status ?? o.fromStatus) entry.fromStatus = asStoredStatus(o.from_status ?? o.fromStatus)
  if (o.to_status ?? o.toStatus) entry.toStatus = asStoredStatus(o.to_status ?? o.toStatus)
  const decisionType = asString(o.decision_type ?? o.decisionType)
  if ((DECISION_TYPES as readonly string[]).includes(decisionType)) {
    entry.decisionType = decisionType as ThreadEntry['decisionType']
  }
  const decisionId = asNullableString(o.decision_id ?? o.decisionId)
  if (decisionId !== null) entry.decisionId = decisionId
  return entry
}

function threadFromYaml(value: YamlValue, reviewId: string, fallbackStatus: ReviewStatus): ReviewThread {
  const o = asObject(value)
  const rawEntries = Array.isArray(o.entries) ? o.entries : []
  const entries = stabilizeEntryIds(rawEntries.map(entryFromYaml))
  const storedParticipants = Array.isArray(o.participants)
    ? o.participants.map((p) => asAuthorRef(p))
    : []
  const participants = storedParticipants.length > 0
    ? storedParticipants
    : deriveParticipants(entries)
  return {
    id: asString(o.id, reviewId) || reviewId,
    status: o.status === undefined || o.status === null ? fallbackStatus : asStatus(o.status),
    participants,
    entries,
  }
}

/**
 * Migrate a v1 record to v2: v1 stored the discussion as body `- [time /
 * author] …` lines with positional ids and kept the opening comment only in
 * the top-level `comment` field. The opening comment becomes ENTRY-0001 and
 * every legacy line shifts down by one (ids + replyTo remapped).
 */
function migrateV1Thread(
  bodyEntries: ThreadEntry[],
  opening: { author: AuthorRef; at: string; body: string },
  reviewId: string,
  status: ReviewStatus,
  decision: ReviewDecision | null,
): ReviewThread {
  const idMap = new Map<string, string>()
  bodyEntries.forEach((entry, index) => {
    idMap.set(entry.id, `ENTRY-${String(index + 2).padStart(4, '0')}`)
  })
  const shifted = bodyEntries.map(entry => ({
    ...entry,
    id: idMap.get(entry.id) ?? entry.id,
    ...(entry.replyTo !== undefined && idMap.has(entry.replyTo)
      ? { replyTo: idMap.get(entry.replyTo) }
      : {}),
  }))
  // Best-effort link of the v1 decision timeline line to its canonical decision.
  if (decision !== null) {
    const target = shifted.find(
      entry => entry.kind === 'decision' && entry.decisionType === decision.type,
    )
    if (target !== undefined) target.decisionId = decision.id
  }
  const openingEntry: ThreadEntry = {
    id: 'ENTRY-0001',
    at: opening.at,
    author: opening.author,
    kind: 'comment',
    body: opening.body,
  }
  const entries = stabilizeEntryIds([openingEntry, ...shifted])
  return {
    id: reviewId,
    status,
    participants: deriveParticipants(entries),
    entries,
  }
}

function threadEntryToYaml(entry: ThreadEntry): YamlObject {
  return {
    id: entry.id,
    at: entry.at,
    kind: entry.kind,
    author: authorRefToYaml(entry.author),
    body: entry.body,
    ...(entry.replyTo !== undefined ? { reply_to: entry.replyTo } : {}),
    ...(entry.editedAt !== undefined ? { edited_at: entry.editedAt } : {}),
    ...(entry.fromStatus !== undefined ? { from_status: entry.fromStatus } : {}),
    ...(entry.toStatus !== undefined ? { to_status: entry.toStatus } : {}),
    ...(entry.decisionType !== undefined ? { decision_type: entry.decisionType } : {}),
    ...(entry.decisionId !== undefined ? { decision_id: entry.decisionId } : {}),
  }
}

function threadToYaml(thread: ReviewThread): YamlObject {
  return {
    id: thread.id,
    status: thread.status,
    participants: thread.participants.map(authorRefToYaml),
    entries: thread.entries.map(threadEntryToYaml),
  }
}

// ---------------------------------------------------------------------------
// Record parse / serialize
// ---------------------------------------------------------------------------

export interface ParsedReviewFile {
  record: ReviewRecord
  extra: YamlObject
}

/** Parse a full review file (frontmatter + body) into a v2 record.
 *
 * v1 files are migrated in memory on read; the store persists the upgrade on
 * the first write-back (design/03 §9 — no bulk rewrite). */
export function parseReviewFile(content: string): ParsedReviewFile {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    throw new ReviewFileError('review file missing frontmatter fence')
  }
  const close = normalized.indexOf('\n---\n', 4)
  if (close === -1) throw new ReviewFileError('review file frontmatter is not closed')
  const yamlText = normalized.slice(4, close)
  const body = normalized.slice(close + '\n---\n'.length)
  const fm = parseYaml(yamlText)

  const extra: YamlObject = {}
  for (const [key, value] of Object.entries(fm)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value
  }

  const diskVersion = asNumber(fm.schemaVersion ?? fm.schema_version, LEGACY_SCHEMA_VERSION)
  const isV2 = diskVersion >= 2 && fm.thread !== undefined && fm.thread !== null

  const reviewId = asString(fm.review_id)
  const status = asStatus(fm.status)
  const decision = decisionFromYaml(fm.decision)
  const decisions = decisionsFromYaml(fm.decisions)
  // Lazy migration (spec §10): a legacy single `decision` becomes the
  // append-only history on first read; the field itself stays for layout
  // compat, `decision` mirrors the latest entry.
  if (decisions.length === 0 && decision !== null) decisions.push(decision)
  const authorRef = asAuthorRef(fm.author_ref ?? fm.authorRef, asString(fm.author, 'reviewer'))

  const { comment, proposal } = parseBodySections(body)
  const commentEditedAt = asNullableString(fm.comment_edited_at ?? fm.commentEditedAt)

  const thread: ReviewThread = isV2
    ? threadFromYaml(fm.thread, reviewId, status)
    : migrateV1Thread(
        extractBodyThread(body),
        { author: authorRef, at: asString(fm.created_at ?? fm.createdAt), body: comment },
        reviewId,
        status,
        decision,
      )

  // v2: the opening entry is authoritative for the comment projection.
  const openingComment = thread.entries[0]?.kind === 'comment' ? thread.entries[0].body : comment

  const record: ReviewRecord = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    reviewId,
    // 0 = legacy record written before per-document numbers existed; the
    // store lazily backfills a stable number on read (design/03 §7).
    number: asNumber(fm.number, 0),
    document: asString(fm.document),
    documentSha: asNullableString(fm.document_sha ?? fm.documentSha),
    type: asReviewType(fm.type),
    severity: asSeverity(fm.severity),
    title: asNullableString(fm.title),
    status,
    tags: asStringArray(fm.tags),
    relatedParties: normalizeRelatedParties(asStringArray(fm.related_parties)),
    target: anchorFromYaml(asObject(fm.target)),
    author: asString(fm.author, authorRef.id) || authorRef.id,
    authorRef,
    // 1:1 lifecycle session (design/09); legacy files parse null.
    sessionId: asNullableString(fm.session_id ?? fm.sessionId),
    assignee: asNullableString(fm.assignee),
    // Team dispatch attribution (design/08); legacy files simply parse null.
    assigneeMember: asNullableString(fm.assignee_member ?? fm.assigneeMember),
    teamTaskId: asNullableString(fm.team_task_id ?? fm.teamTaskId),
    related: relatedFromYaml(fm.related),
    decision,
    decisions,
    agentCompletion: agentCompletionFromYaml(fm.agent_completion),
    duplicatedOf: asNullableString(fm.duplicated_of ?? fm.duplicatedOf),
    createdAt: asString(fm.created_at ?? fm.createdAt),
    updatedAt: asString(fm.updated_at ?? fm.updatedAt),
    resolvedAt: asNullableString(fm.resolved_at ?? fm.resolvedAt),
    comment: openingComment,
    proposal,
    ...(commentEditedAt !== null ? { commentEditedAt } : {}),
    thread,
  }
  return { record, extra }
}

/** Pull v1 body `## Thread` lines (used only during v1 -> v2 migration). */
function extractBodyThread(body: string): ThreadEntry[] {
  const sectionRe = /^## Thread\s*$/
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const buffer: string[] = []
  let inside = false
  for (const line of lines) {
    if (/^## /.test(line.trim())) {
      if (inside) break
      inside = sectionRe.test(line.trim())
      continue
    }
    if (inside) buffer.push(line)
  }
  return parseThreadSection(buffer.join('\n'))
}

function anchorToYaml(anchor: ReviewAnchor): YamlObject {
  return {
    structural: {
      section: anchor.structural.section,
      heading_path: anchor.structural.headingPath,
    },
    textual: {
      // emitString renders a block scalar only when the value actually
      // contains an interior newline; a single-line selection must stay
      // inline, otherwise the block-scalar clip chomp adds a trailing '\n'
      // that breaks exact anchor re-resolution on read-back.
      selected_text: anchor.textual.selectedText,
      prefix: anchor.textual.prefix,
      suffix: anchor.textual.suffix,
    },
    positional: {
      line_start: anchor.positional.lineStart,
      line_end: anchor.positional.lineEnd,
      ...(anchor.positional.offsetStart !== undefined && anchor.positional.offsetEnd !== undefined
        ? {
            offset_start: anchor.positional.offsetStart,
            offset_end: anchor.positional.offsetEnd,
          }
        : {}),
    },
    fingerprint: { algorithm: 'sha256', value: anchor.fingerprint.value },
  }
}

function decisionToYaml(decision: ReviewDecision | null): YamlValue {
  if (decision === null) return null
  return {
    id: decision.id,
    type: decision.type,
    summary: decision.summary,
    decided_by: authorRefToYaml(decision.decidedBy),
    decided_at: decision.decidedAt,
  }
}

function relatedToYaml(related: ReviewRelated): YamlObject {
  return {
    decisions: related.decisions,
    reviews: related.reviews,
    code: related.code,
    tests: related.tests,
    commits: related.commits,
    agent_runs: related.agentRuns,
  }
}

function formatAuthor(author: AuthorRef): string {
  if (author.type === 'agent') {
    return author.agentRunId ? `agent:${author.id}:${author.agentRunId}` : `agent:${author.id}`
  }
  return author.id
}

/** Serialize one thread entry to its `- [time / author] body` line. */
export function formatThreadEntry(entry: ThreadEntry): string {
  let body = entry.body
  if (entry.kind === 'status' && entry.fromStatus !== undefined && entry.toStatus !== undefined) {
    body = `[${entry.fromStatus} -> ${entry.toStatus}] ${entry.body}`.trim()
  } else if (entry.kind === 'decision' && entry.decisionType !== undefined) {
    body = `Decision(${entry.decisionType}): ${entry.body}`
  }
  const edited = entry.editedAt !== undefined ? ` (edited ${entry.editedAt})` : ''
  const reply = entry.replyTo !== undefined ? ` (reply ${entry.replyTo})` : ''
  return `- [${entry.at} / ${formatAuthor(entry.author)}${edited}${reply}] ${body}`
}

/** Serialize a record back to the full file text. */
export function serializeReviewFile(record: ReviewRecord, extra: YamlObject = {}): string {
  const target = anchorToYaml(record.target) as YamlObject
  // Keep the derived thread fields in sync on every write (participants/status
  // are projections of the entries; never trust possibly-stale stored values).
  const thread: ReviewThread = {
    ...record.thread,
    id: record.thread.id || record.reviewId,
    status: record.status,
    participants: deriveParticipants(record.thread.entries),
  }
  const fm: YamlObject = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    review_id: record.reviewId,
    number: record.number,
    document: record.document,
    document_sha: record.documentSha,
    type: record.type,
    severity: record.severity,
    title: record.title,
    status: record.status,
    tags: record.tags,
    related_parties: record.relatedParties,
    target,
    author: record.author,
    author_ref: authorRefToYaml(record.authorRef),
    assignee: record.assignee,
    assignee_member: record.assigneeMember,
    team_task_id: record.teamTaskId,
    session_id: record.sessionId,
    related: relatedToYaml(record.related),
    decision: decisionToYaml(record.decision),
    decisions: record.decisions.map(decisionToYaml),
    agent_completion: agentCompletionToYaml(record.agentCompletion),
    thread: threadToYaml(thread),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    resolved_at: record.resolvedAt,
    duplicated_of: record.duplicatedOf,
    ...(record.commentEditedAt !== undefined ? { comment_edited_at: record.commentEditedAt } : {}),
    ...extra,
  }
  // The body's Thread section is a human-readable projection only; structured
  // thread data is authoritative in frontmatter.
  const threadText = thread.entries.map(formatThreadEntry).join('\n')
  const body =
    `\n## Comment\n\n${record.comment}\n\n` +
    `## Proposal\n\n${record.proposal}\n\n` +
    `## Thread\n\n${threadText}\n`
  return `---\n${serializeYaml(fm)}---\n${body}`
}

// ---------------------------------------------------------------------------
// On-disk access
// ---------------------------------------------------------------------------

export function reviewsDir(projectPath: string): string {
  return resolve(projectPath, REVIEWS_DIRNAME)
}

export function reviewFilePath(projectPath: string, reviewId: string): string {
  // reviewId is host-allocated (REV-\d{4}); still validate to avoid traversal.
  if (!/^REV-\d{4}$/.test(reviewId)) throw new ReviewFileError(`invalid review id: ${reviewId}`)
  const dir = reviewsDir(projectPath)
  const files = existsSync(dir)
    ? readdirSync(dir).filter(name => name.startsWith(`${reviewId}-`) && name.endsWith('.md'))
    : []
  return resolve(dir, files[0] ?? `${reviewId}.md`)
}

/** Read + parse one review file, returning content sha alongside. */
export function readReviewFile(
  projectPath: string,
  reviewId: string,
): { record: ReviewRecord; extra: YamlObject; sha: string; content: string } {
  const file = reviewFilePath(projectPath, reviewId)
  if (!existsSync(file)) {
    const error = new ReviewFileError(`review not found: ${reviewId}`)
    error.name = 'NotFoundError'
    throw error
  }
  const content = readFileSync(file, 'utf8')
  const parsed = parseReviewFile(content)
  return { ...parsed, sha: sha256(content), content }
}

/** kebab-case slug for the human-readable part of a new file name. */
function slugifyFileName(text: string): string {
  const cleaned = text
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return cleaned === '' ? 'review' : cleaned.slice(0, 48).replace(/-+$/g, '') || 'review'
}

/** Atomically write a review file (tmp + rename); returns content sha. */
export function writeReviewFile(
  projectPath: string,
  record: ReviewRecord,
  extra: YamlObject = {},
): { sha: string; fileName: string } {
  const dir = reviewsDir(projectPath)
  mkdirSync(dir, { recursive: true })
  const existing = readdirSync(dir).find(
    name => (name.startsWith(`${record.reviewId}-`) || name === `${record.reviewId}.md`) && name.endsWith('.md'),
  )
  const fileName = existing ?? `${record.reviewId}-${slugifyFileName(record.title ?? record.document)}.md`
  const file = resolve(dir, fileName)
  const content = serializeReviewFile(record, extra)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
  return { sha: sha256(content), fileName }
}

/** Enumerate all REV-XXXX review files in a project (id + absolute path). */
export function listReviewFiles(projectPath: string): Array<{ reviewId: string; file: string }> {
  const dir = reviewsDir(projectPath)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => {
      const match = REVIEW_FILE_RE.exec(name)
      return match !== null ? { reviewId: match[1], file: resolve(dir, name) } : null
    })
    .filter((entry): entry is { reviewId: string; file: string } => entry !== null)
    .sort((a, b) => a.reviewId.localeCompare(b.reviewId))
}
