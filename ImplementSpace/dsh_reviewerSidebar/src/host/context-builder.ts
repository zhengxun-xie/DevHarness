/**
 * Agent Context assembly (design/07-agent-integration.md §2-3, §6).
 *
 * One pure assembly function is shared by the dry-run GET /agent/context and
 * the real POST /agent/send ("what you preview is what you send"):
 *
 *   Review + target document + related documents + related decisions
 *          + related code + related tests + read-only git history
 *
 * Safety: every file read goes through assertInside; git only runs read-only
 * log/blame/status/diff/show with cwd=project root and a 5s timeout; a
 * non-git repo or a failed command yields available=false and never blocks.
 * The assembled payload is capped at 256 KiB by truncating code/tests first,
 * then the target document window, with truncated=true marked.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import {
  loadRegistry,
  requireProject,
  assertInside,
  readDocument,
} from './projects.ts'
import { readReviewFile } from './review-files.ts'
import { resolveAnchor } from './anchors.ts'
import type {
  AgentContextLayer2,
  AgentContextPayload,
  ProjectRecord,
  ReviewRecord,
  SendToAgentRequest,
  ThreadEntry,
} from '../protocol.ts'

const MAX_CONTEXT_BYTES = 256 * 1024
const GIT_TIMEOUT_MS = 5000
const GIT_LOG_LIMIT = 20
const TARGET_DOC_FLOOR_BYTES = 32 * 1024
const TEST_DIR_HINTS = new Set(['tests', 'test', '__tests__'])

export interface ContextIncludeFlags {
  relatedDocs: boolean
  decisions: boolean
  code: boolean
  tests: boolean
  gitHistory: boolean
}

export const DEFAULT_INCLUDES: ContextIncludeFlags = {
  relatedDocs: true,
  decisions: true,
  code: true,
  tests: true,
  gitHistory: true,
}

/** Read one project-relative text file through the containment guard. */
function readProjectFile(projectPath: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath === '') return null
  if (isAbsolute(relPath)) return null
  const file = resolve(projectPath, relPath)
  try {
    assertInside(projectPath, file)
  } catch {
    return null
  }
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8')
}

// ---------------------------------------------------------------------------
// Git (read-only, best effort)
// ---------------------------------------------------------------------------

function runGit(projectPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = execFile(
      'git',
      args,
      { cwd: projectPath, timeout: GIT_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        resolvePromise(error ? null : stdout)
      },
    )
    child.on('error', () => resolvePromise(null))
  })
}

async function gitAvailable(projectPath: string): Promise<boolean> {
  const out = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree'])
  return out !== null && out.trim() === 'true'
}

interface GitLogEntry {
  hash: string
  author: string
  date: string
  subject: string
}

async function gitLog(projectPath: string, paths: string[]): Promise<GitLogEntry[]> {
  const args = [
    'log',
    `-${GIT_LOG_LIMIT}`,
    '--pretty=format:%H%x1f%an%x1f%ad%x1f%s',
    '--date=iso-strict',
    ...(paths.length > 0 ? ['--', ...paths] : []),
  ]
  const out = await runGit(projectPath, args)
  if (out === null) return []
  return out
    .trim()
    .split('\n')
    .filter(line => line !== '')
    .map((line) => {
      const [hash = '', author = '', date = '', subject = ''] = line.split('\x1f')
      return { hash, author, date, subject }
    })
}

interface GitBlameLine {
  line: number
  hash: string
  author: string
}

async function gitBlame(
  projectPath: string,
  document: string,
  lineStart: number,
  lineEnd: number,
): Promise<GitBlameLine[]> {
  const args = [
    'blame',
    '--porcelain',
    `-L${lineStart},${lineEnd}`,
    '--',
    document,
  ]
  const out = await runGit(projectPath, args)
  if (out === null) return []
  const rows: GitBlameLine[] = []
  let line = lineStart
  // Porcelain: header line "<sha> <orig> <final> [<group>] <content-line-no>"
  for (const text of out.split('\n')) {
    const header = /^([0-9a-f]{7,40})\s+\d+\s+(\d+)/.exec(text)
    if (header === null) continue
    rows.push({ line, hash: header[1].slice(0, 12), author: '' })
    line += 1
  }
  // Fill authors from the following "author " fields in order.
  let cursor = 0
  for (const text of out.split('\n')) {
    if (text.startsWith('author ') && cursor < rows.length) {
      rows[cursor].author = text.slice('author '.length)
      cursor += 1
    }
  }
  return rows
}

/** Current HEAD commit of the worktree (workspace lock), null when unavailable. */
async function gitHead(projectPath: string): Promise<string | null> {
  if (!await gitAvailable(projectPath)) return null
  const out = await runGit(projectPath, ['rev-parse', 'HEAD'])
  const head = out?.trim()
  return head === '' || head == null ? null : head
}

// ---------------------------------------------------------------------------
// Related-file heuristics (M1: explicit declarations + simple conventions)
// ---------------------------------------------------------------------------

/** [[wikilink]] / markdown relative links appearing in the review + document. */
function extractLinkedPaths(text: string): string[] {
  const paths: string[] = []
  const wiki = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g
  const md = /\[[^\]]*\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g
  let match: RegExpExecArray | null
  while ((match = wiki.exec(text)) !== null) paths.push(match[1].trim())
  while ((match = md.exec(text)) !== null) paths.push(match[1].trim())
  return paths
}

/** Resolve a link-ish token to an existing project-relative markdown file. */
function resolveLinkedDocument(projectPath: string, token: string): string | null {
  const candidates = [token, token.endsWith('.md') ? token : `${token}.md`]
  for (const candidate of candidates) {
    const file = resolve(projectPath, candidate)
    try {
      assertInside(projectPath, file)
    } catch {
      continue
    }
    if (existsSync(file)) return relative(projectPath, file)
  }
  return null
}

/** Conventional sibling test files for an explicit related code path. */
function nearbyTestFiles(projectPath: string, codeRelPath: string): string[] {
  const results: string[] = []
  const abs = resolve(projectPath, codeRelPath)
  const dirParts = relative(projectPath, abs).split('/')
  const file = dirParts.pop() ?? ''
  const dot = file.lastIndexOf('.')
  const stem = dot === -1 ? file : file.slice(0, dot)
  const ext = dot === -1 ? '' : file.slice(dot + 1)
  const siblingCandidates = [
    `${file}.test.${ext}`,
    `${stem}.test.${ext}`,
    `${stem}.spec.${ext}`,
    `${stem}-test.${ext}`,
  ]
  const dir = dirParts.join('/')
  for (const name of siblingCandidates) {
    const rel = dir === '' ? name : `${dir}/${name}`
    const candidate = resolve(projectPath, rel)
    try {
      assertInside(projectPath, candidate)
      if (existsSync(candidate)) results.push(rel)
    } catch {
      // ignore
    }
  }
  // tests/<stem>.* convention (one level up).
  const testDir = [...dirParts.slice(0, -1), 'tests'].join('/')
  if (testDir !== '' && TEST_DIR_HINTS.has(dirParts[dirParts.length - 1] ?? '') === false) {
    const absTestDir = resolve(projectPath, testDir)
    try {
      assertInside(projectPath, absTestDir)
      if (existsSync(absTestDir)) {
        for (const name of readdirSync(absTestDir)) {
          if (name.startsWith(`${stem}.`) || name === `${stem}.test.${ext}`) {
            results.push(`${testDir}/${name}`)
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return [...new Set(results)]
}

// ---------------------------------------------------------------------------
// Instruction prompt (fixed English template, design/07 §3)
// ---------------------------------------------------------------------------

function formatThread(thread: ThreadEntry[]): string {
  if (thread.length === 0) return '(none)'
  return thread
    .map((entry) => {
      const who = entry.author.type === 'agent'
        ? `agent:${entry.author.id}${entry.author.agentRunId ? `:${entry.author.agentRunId}` : ''}`
        : entry.author.id
      if (entry.kind === 'status' && entry.fromStatus !== undefined && entry.toStatus !== undefined) {
        return `- [${entry.at} / ${who}] status ${entry.fromStatus} -> ${entry.toStatus} ${entry.body}`.trim()
      }
      if (entry.kind === 'decision') {
        return `- [${entry.at} / ${who}] decision ${entry.decisionType ?? 'unspecified'}: ${entry.body}`
      }
      const reply = entry.replyTo !== undefined ? ` (reply ${entry.replyTo})` : ''
      return `- [${entry.at} / ${who}]${reply} ${entry.body}`
    })
    .join('\n')
}

/**
 * Condensed thread digest for the Layer2 payload: discussion points (comments,
 * decisions), one short line each, capped. Pure status transitions are noise to
 * the Agent and dropped. Design/07 §Layer2 primary.thread_digest.
 */
function digestThread(thread: ThreadEntry[]): string {
  const points = thread.filter(entry => entry.kind === 'comment' || entry.kind === 'decision')
  if (points.length === 0) return '(none)'
  const lines = points.map((entry) => {
    const tag = entry.kind === 'decision' ? `decision:${entry.decisionType ?? 'unspecified'}` : 'note'
    const body = entry.body.replace(/\s+/g, ' ').trim()
    return `- ${tag} ${body.slice(0, 120)}`
  })
  const capped = lines.slice(0, 12)
  return lines.length > capped.length
    ? `${capped.join('\n')}\n- …(+${lines.length - capped.length} more)`
    : capped.join('\n')
}

function buildInstruction(payload: {
  review: ReviewRecord
  comment: string
  proposal: string
  threadText: string
  extrasText: string
}): string {
  const { review, comment, proposal, threadText, extrasText } = payload
  return [
    'You are acting on a reviewed engineering document in the DevBuddy workflow.',
    `Review id: ${review.reviewId} (severity: ${review.severity}, type: ${review.type})`,
    '',
    '# Requirement under review',
    `Target document: ${review.document} — read the current version from the worktree yourself`,
    '(path@sha in the structured payload; it is referenced, not inlined).',
    '',
    '# Review comment',
    comment,
    '',
    '# Proposed change',
    proposal === '' ? '(none)' : proposal,
    '',
    '# Discussion so far',
    threadText,
    '',
    '# Related decisions / code / tests / git history',
    extrasText === '' ? '(none)' : extrasText,
    '',
    'Rules:',
    '1. Treat the review as the task; the quoted text is the location in the document.',
    '2. Do not change requirements beyond the review scope; note diverging concerns as new review candidates instead.',
    '3. After implementation, summarize changed files and how they map to the review.',
    `4. Suggest commit trailer: DevBuddy-Review: ${review.reviewId}`,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Byte length of UTF-8 text (Buffer is available on the host half only). */
function byteSize(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Truncate from the end, keeping a head prefix within maxBytes. */
function capText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (byteSize(text) <= maxBytes) return { text, truncated: false }
  const cutoff = '\n…[truncated by DevBuddy context cap]…'
  const budget = Math.max(0, maxBytes - byteSize(cutoff))
  let lo = 0
  let hi = text.length
  // Binary search the longest prefix inside the byte budget.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (byteSize(text.slice(0, mid)) <= budget) lo = mid
    else hi = mid - 1
  }
  return { text: `${text.slice(0, lo)}${cutoff}`, truncated: true }
}

export interface BuildContextOptions {
  include?: SendToAgentRequest['include']
}

/**
 * Assemble the full agent context for one review.
 * The same output is returned for dry-run and actual send.
 */
export async function buildAgentContext(
  projectId: string,
  reviewId: string,
  options: BuildContextOptions = {},
): Promise<AgentContextPayload> {
  const flags: ContextIncludeFlags = {
    relatedDocs: options.include?.relatedDocs ?? DEFAULT_INCLUDES.relatedDocs,
    decisions: options.include?.decisions ?? DEFAULT_INCLUDES.decisions,
    code: options.include?.code ?? DEFAULT_INCLUDES.code,
    tests: options.include?.tests ?? DEFAULT_INCLUDES.tests,
    gitHistory: options.include?.gitHistory ?? DEFAULT_INCLUDES.gitHistory,
  }

  const registry = loadRegistry()
  const project: ProjectRecord = requireProject(registry, projectId)
  const { record: review } = readReviewFile(project.path, reviewId)

  const doc = readDocument(project.path, review.document)
  const anchorResolution = resolveAnchor(review.target, doc.content)

  // Related documents: explicit links from proposal/comment/selected text,
  // de-duplicated and excluding the target document.
  const relatedDocuments: AgentContextPayload['relatedDocuments'] = []
  if (flags.relatedDocs) {
    const linkSource = [
      review.comment,
      review.proposal,
      review.target.textual.selectedText,
      doc.content.slice(0, 4096),
    ].join('\n')
    const seen = new Set<string>([review.document])
    for (const token of extractLinkedPaths(linkSource)) {
      const rel = resolveLinkedDocument(project.path, token)
      if (rel === null || seen.has(rel)) continue
      seen.add(rel)
      // Layer3 manifest: reference repo-resident docs by path + reason, no
      // content — the Agent reads the current version from the worktree.
      if (existsSync(resolve(project.path, rel))) {
        relatedDocuments.push({ path: rel, reason: 'linked from review or document', content: '' })
      }
    }
  }

  // Related decisions: explicit related.decisions only (humans produce these).
  const decisions: AgentContextPayload['decisions'] = []
  if (flags.decisions) {
    for (const rel of review.related.decisions) {
      const content = readProjectFile(project.path, rel)
      if (content !== null) decisions.push({ path: rel, content })
    }
  }

  // Related code: explicit related.code (M4 grep-symbol candidate search is
  // intentionally left out of M1).
  const code: AgentContextPayload['code'] = []
  if (flags.code) {
    for (const rel of review.related.code) {
      const content = readProjectFile(project.path, rel)
      if (content !== null) code.push({ path: rel, content })
    }
  }

  // Related tests: explicit related.tests + sibling convention files.
  const tests: AgentContextPayload['tests'] = []
  if (flags.tests) {
    const testPaths = new Set<string>(review.related.tests)
    for (const rel of review.related.code) {
      for (const candidate of nearbyTestFiles(project.path, rel)) testPaths.add(candidate)
    }
    for (const rel of testPaths) {
      const content = readProjectFile(project.path, rel)
      if (content !== null) tests.push({ path: rel, content })
    }
  }

  // Git: availability gate first, then log over touched paths, then blame the
  // anchor line range in the target document.
  const git: AgentContextPayload['git'] = { log: [], blame: [], available: false }
  if (flags.gitHistory && await gitAvailable(project.path)) {
    git.available = true
    const paths = [
      review.document,
      ...review.related.code,
      ...review.related.tests,
    ].filter(path => path !== '')
    git.log = await gitLog(project.path, paths)
    const lineStart = anchorResolution.lineStart ?? review.target.positional.lineStart
    const lineEnd = anchorResolution.lineEnd ?? review.target.positional.lineEnd
    if (doc.exists && lineStart !== null) {
      git.blame = await gitBlame(project.path, review.document, lineStart, lineEnd ?? lineStart)
    }
  }

  // Target document is REFERENCED, not inlined (design/07 §Layer3): the Agent
  // reads the current version from the worktree itself. Keep `content` empty in
  // the structured payload; the sha pins the base version for reference.
  let targetContent = ''

  const threadText = formatThread(review.thread.entries)
  const extrasText = [
    decisions.length > 0
      ? decisions.map(entry => `## Decision ${entry.path}\n${entry.content}`).join('\n\n')
      : '',
    code.length > 0
      ? code.map(entry => `## Code ${entry.path}\n${entry.content}`).join('\n\n')
      : '',
    tests.length > 0
      ? tests.map(entry => `## Test ${entry.path}\n${entry.content}`).join('\n\n')
      : '',
    relatedDocuments.length > 0
      ? `## Related documents (referenced — read from worktree)\n${relatedDocuments.map(d => `- ${d.path} — ${d.reason}`).join('\n')}`
      : '',
    git.available
      ? [
          '## Git log',
          ...git.log.map(row => `${row.hash.slice(0, 12)} ${row.date} ${row.author} — ${row.subject}`),
          ...(git.blame.length > 0
            ? ['', '## Git blame (anchor lines)', ...git.blame.map(row => `${row.line}: ${row.hash} ${row.author}`)]
            : []),
        ].join('\n')
      : '',
  ].filter(section => section !== '').join('\n\n')

  // Build the instruction first (its fixed skeleton is never truncated), then
  // spend the remaining byte budget on structured file content.
  const preliminaryInstruction = buildInstruction({
    review,
    comment: review.comment,
    proposal: review.proposal,
    threadText,
    extrasText: '(see structured payload sections)',
  })

  // Budget pass: shrink code/tests first (they are supplementary), then the
  // target document. related docs keep whatever remains, capped individually.
  let truncated = false
  let used = byteSize(preliminaryInstruction)
  const capOrTrimArray = <T extends { content: string }>(rows: T[], reserveFloor = 0): void => {
    for (let i = 0; i < rows.length; i++) {
      const available = MAX_CONTEXT_BYTES - used
      if (available <= reserveFloor) {
        // Drop further rows entirely; mark truncation.
        if (rows.length > i) truncated = true
        rows.length = i
        return
      }
      const cap = Math.min(byteSize(rows[i].content), available - reserveFloor)
      if (cap < byteSize(rows[i].content)) {
        const result = capText(rows[i].content, Math.max(0, cap))
        rows[i] = { ...rows[i], content: result.text }
        truncated = true
      }
      used += byteSize(rows[i].content)
    }
  }
  capOrTrimArray(code)
  capOrTrimArray(tests)
  capOrTrimArray(decisions)

  // Target document content is empty by design (referenced, not inlined) —
  // no truncation pass applies to it. used += 0.
  used += byteSize(targetContent)
  capOrTrimArray(relatedDocuments)

  // Recompute structured extras text from the (possibly trimmed) rows for the
  // instruction so preview matches the structured payload exactly.
  const structuredExtras = [
    decisions.map(entry => `## Decision ${entry.path}\n${entry.content}`).join('\n\n'),
    code.map(entry => `## Code ${entry.path}\n${entry.content}`).join('\n\n'),
    tests.map(entry => `## Test ${entry.path}\n${entry.content}`).join('\n\n'),
    relatedDocuments.length > 0
      ? `## Related documents (referenced — read from worktree)\n${relatedDocuments.map(d => `- ${d.path} — ${d.reason}`).join('\n')}`
      : '',
    git.available
      ? [
          '## Git log',
          ...git.log.map(row => `${row.hash.slice(0, 12)} ${row.date} ${row.author} — ${row.subject}`),
          ...(git.blame.length > 0
            ? ['', '## Git blame (anchor lines)', ...git.blame.map(row => `${row.line}: ${row.hash} ${row.author}`)]
            : []),
        ].join('\n')
      : '',
  ].filter(section => section !== '').join('\n\n')

  const instruction = buildInstruction({
    review,
    comment: review.comment,
    proposal: review.proposal,
    threadText,
    extrasText: structuredExtras === '' ? '(none)' : structuredExtras,
  })
  if (byteSize(instruction) > MAX_CONTEXT_BYTES) {
    // Only reachable for pathological comment/thread sizes.
    truncated = true
  }

  // Layer 2 structured payload (design/07 §Layer2): review/thread/decision and
  // the anchor's captured original text are INLINED (DB-owned); the target
  // document and related docs are REFERENCED by path (+ reason) for the Agent
  // to read from the worktree. Resolution is pre-computed so the Agent does
  // not re-match. workspace pins the worktree to its current HEAD commit.
  const currentOffset = anchorResolution.matchOffsetStart !== null
    && anchorResolution.matchOffsetEnd !== null
    ? [anchorResolution.matchOffsetStart, anchorResolution.matchOffsetEnd] as [number, number]
    : null
  const layer2: AgentContextLayer2 = {
    primary: {
      review: review.reviewId,
      severity: review.severity,
      type: review.type,
      decision: review.decision === null ? null : review.decision.summary,
      threadDigest: digestThread(review.thread.entries),
    },
    anchor: {
      document: review.document,
      baseVersion: review.documentSha ?? doc.sha,
      selectedText: review.target.textual.selectedText,
      prefix: review.target.textual.prefix,
      suffix: review.target.textual.suffix,
      resolution: {
        status: anchorResolution.state,
        confidence: anchorResolution.confidence,
        currentOffset,
      },
    },
    manifest: relatedDocuments.map(d => ({ path: d.path, reason: d.reason })),
    workspace: { repo: project.name, commit: await gitHead(project.path) },
  }

  return {
    reviewId: review.reviewId,
    project: { id: project.id, name: project.name, path: project.path },
    payload: layer2,
    type: review.type,
    severity: review.severity,
    review: {
      comment: review.comment,
      proposal: review.proposal,
      thread: review.thread.entries,
      decision: review.decision,
      anchor: {
        document: review.document,
        selectedText: review.target.textual.selectedText,
        prefix: review.target.textual.prefix,
        suffix: review.target.textual.suffix,
        headingPath: review.target.structural.headingPath,
        documentSha: review.documentSha,
        anchorStatus: anchorResolution.state,
      },
    },
    targetDocument: { path: review.document, sha: doc.sha, content: targetContent },
    relatedDocuments,
    decisions,
    code,
    tests,
    git,
    truncated,
    instruction,
  }
}
