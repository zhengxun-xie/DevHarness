# 数据模型与存储（Data Model）

## 1. 设计原则

1. **Review 是工程文档，不是聊天记录**：每条评审是项目目录中的一个 Markdown 文件，随 Git 提交；
2. **单文件单记录**：一条 Review 一个文件，frontmatter 承载结构化字段，正文承载讨论；
3. **只追加的讨论**：状态变更与讨论以追加条目写入，保留完整审计轨迹；
4. **与左栏共享**：项目注册表仍由左栏插件负责（`~/.dsh/devbuddy/registry.json`），本插件只在项目目录内写数据；
5. **Review 绑定工程上下文，而非行号**：锚点采用语义化冗余定位（见 §4）；
6. **Review Status 与 Anchor Status 分离**：评审结论（open/resolved）与锚点健康（valid/orphaned）是两条独立维度，不互相覆盖；
7. **Agent 可执行 Review，但不可决定 Review**：Decision、Resolve 等结论性动作归属人，Agent 只能建议。

## 2. 存储布局

```text
<project-root>/
├── ProjectInfo.md
├── CoreRequirements.md
└── .devbuddy/
    └── reviews/
        ├── REV-0001-limb-control-authority.md
        ├── REV-0002-...md
        └── index.json          # 派生性索引，可随时重建
```

- `.devbuddy/` 加入项目自身版本管理（建议在项目 README 说明，不自动改 `.gitignore`）；
- 文件名：`REV-{4位序号}-{kebab-slug}.md`，slug 由标题/文档名截断生成，仅为可读性，不作为标识；
- `index.json` 是**纯派生缓存**（列表页快速加载），损坏或缺失时 host 全量扫描重建。

## 3. Review 记录 Schema

对应需求中的 YAML 结构，并按 [DES-003](../../../../Downloads/robot_studio_new/DES-003-Document%20Anchor%20&%20Review%20Thread%20Model.md) 原则扩展锚点、类型、Decision 与可追溯字段：

```yaml
# --- frontmatter（v2：结构化 thread 为讨论的权威存储） ---
schemaVersion: 2
review_id: REV-0001            # 项目内唯一、单调递增、不复用
number: 1                      # 文档内唯一、单调递增、不复用（同一 document 维度）
document: CoreRequirements.md            # 相对项目根的文档路径
document_sha: "9f2c…"          # 创建时目标文档 sha256（锚点基线版本）

type: suggestion               # question | suggestion | bug | design_issue
                               # | requirement_issue | implementation_issue | test_issue | exploration
severity: major                # info | minor | major | critical
title: "控制权仲裁职责"          # 可选，列表展示用
status: open                   # open | discussing | needs_review | accepted
                               # | implementing | implemented | verifying
                               # | resolved | rejected | duplicated
tags: [architecture, authority]

target:                        # 锚点模型见 §4
  structural:
    section: "review-driven"
    heading_path:
      - "Reviewer 插件"
      - "Review Driven"
  textual:
    selected_text: |-
      MotionManager 不应该直接获得 LimbController
      的硬件控制权。
    prefix: ""
    suffix: ""
  positional:
    line_start: 24
    line_end: 26
    offset_start: 842          # LF 归一化、0-based 半开字符偏移；新锚点必有
    offset_end: 918            # 零长度「点锚点」时 offset_start === offset_end
  fingerprint:
    algorithm: sha256
    value: "7a1c…"             # sha256(prefix + selected_text + suffix)

author: reviewer               # 开场评论作者 id 的投影（列表过滤用）
author_ref:                    # 开场评论作者的富身份，也是 thread 首个参与者
  type: user                   # user | agent
  id: reviewer
  display_name: "Reviewer"     # 可选
assignee: null                 # 指派 Agent / 人（dispatch 后写 sessionId）

related:                       # 可选关联（可追溯链）
  decisions: []                # ADR / 决策文档锚点
  reviews: []                  # 关联 Review id
  code: []                     # 相关代码路径
  tests: []                    # 验收测试路径
  commits: []                  # 关联实施提交
  agent_runs: []               # dispatch 关联的 agent session 标识（与 assignee 同源，去重追加）

decision: null                 # 见 §6，Accept/Reject 时生成；含稳定 id（DEC-####）与富 decided_by

# 讨论线程：与 review 1:1 的独立实体（见 §6）。id 恒等于 review_id；
# status 为 review status 的镜像，每次写回由 host 重算；
# participants 由 entries 作者去重派生（key = type:id:provider）。
thread:
  id: REV-0001
  status: open
  participants:
    - type: user
      id: reviewer
      display_name: "Reviewer"
  entries:                     # 只追加时间线；entry[0] 恒为开场评论
    - id: ENTRY-0001           # 稳定 id，ENTRY-####，max+1 分配，绝不按位置重算
      at: "2026-09-15T10:00:00.000Z"
      kind: comment            # comment | status | decision | system
      author:
        type: user
        id: reviewer
        display_name: "Reviewer"
      body: |-
        MotionManager 不应该直接参与控制权仲裁。

created_at: "2026-09-15T10:00:00+08:00"
updated_at: "2026-09-15T10:00:00+08:00"
resolved_at: null
duplicated_of: null
```

一个发生过人类讨论、Agent dispatch 与 Agent 回流的 review，其 `thread.entries` 形如（`decision` 顶层记录同步存在）：

```yaml
decision:
  id: DEC-0001                 # 稳定 id，DEC-####，append-only 不复用
  type: accept
  summary: "Accepted when sent to agent"
  decided_by:
    type: user
    id: reviewer
  decided_at: "2026-09-15T10:05:00.000Z"
thread:
  id: REV-0001
  status: implementing
  participants:
    - { type: user, id: reviewer, display_name: "Reviewer" }
    - { type: agent, id: anthropic, provider: anthropic, display_name: claude-sonnet-4, agent_run_id: 0c5f…-uuid }
  entries:
    - { id: ENTRY-0001, at: "…", kind: comment,  author: { type: user, id: reviewer }, body: "开场评论（= 顶层 comment 投影）" }
    - { id: ENTRY-0002, at: "…", kind: status,   author: { type: user, id: reviewer }, body: "", from_status: open, to_status: accepted }
    - { id: ENTRY-0003, at: "…", kind: decision, author: { type: user, id: reviewer }, body: "Accepted when sent to agent", decision_type: accept, decision_id: DEC-0001 }
    - { id: ENTRY-0004, at: "…", kind: status,   author: { type: user, id: reviewer }, body: "", from_status: accepted, to_status: implementing }
    - { id: ENTRY-0005, at: "…", kind: comment,  author: { type: agent, id: anthropic, provider: anthropic, display_name: claude-sonnet-4, agent_run_id: 0c5f…-uuid }, reply_to: ENTRY-0001, body: "Agent 回流正文（多 step 以空行拼接）" }
```

```markdown
<!-- --- 正文：以下三节均为 frontmatter 的人类可读投影，不作为解析权威 --- -->

## Comment
<!-- 投影自 thread.entries[0]（顶层 comment 同步镜像）；编辑时两处同改 -->

MotionManager 不应该直接参与控制权仲裁。

## Proposal

增加 GlobalAuthorityManager，所有硬件控制权请求经由统一仲裁。

## Thread
<!-- 投影自 thread.entries，行格式仅给人/Git diff 阅读；v1 文件的本节仍可被读时迁移解析 -->

- [2026-09-15T10:00:00.000Z / reviewer] MotionManager 不应该直接参与控制权仲裁。
- [2026-09-15T10:05:00.000Z / reviewer] [open -> accepted]
- [2026-09-15T10:05:00.000Z / reviewer] Decision(accept): Accepted when sent to agent
- [2026-09-15T10:05:00.000Z / reviewer] [accepted -> implementing]
- [2026-09-15T10:20:00.000Z / agent:anthropic:0c5f…-uuid] 已补充优先级设计。
```

### 3.1 字段规则

| 字段 | 规则 |
| --- | --- |
| `review_id` | host 分配，`REV-` + 项目内单调 4 位序号；跨文件加锁分配（见 §7） |
| `number` | host 分配，**文档维度**的单调正整数（同一 `document` 内从 1 起），删除后不复用、允许空号；用于行号小标、内联角标与列表展示（显示为 `#3`）。双序号并存，互不派生（见 §7） |
| `document` | 必须落在项目目录内（`assertInside`），允许子目录文档 |
| `type` | 默认 `suggestion`；用于列表筛选与 Agent 任务分类 |
| `severity` | 默认 `minor`；UI 四档单选 |
| `status` | 仅可经状态机合法迁移写入（见 06） |
| `selected_text` | 选区原文，trim 后非空；长度上限 4000 字符 |
| `prefix` / `suffix` | 选区前 / 后各 1~2 行原文（归一化空白），用于消歧与 fingerprint |
| `line_start/end` | 创建时行号，1-based；仅作提示，不作定位依据 |
| `offset_start/end` | LF 归一化、0-based 半开字符偏移，新锚点必有；零长度点锚点两者相等且 `selected_text === ''` |
| `fingerprint` | `sha256(prefix + selected_text + suffix)`，用于快速判断「原始上下文是否完整存在」 |
| `author` / `author_ref` | 前者是开场评论作者 id 的字符串投影（列表过滤用）；后者是富身份 `AuthorRef`，也是 thread 首个参与者 |
| `decision` | Accept / Reject 时生成，含稳定 `id: DEC-####` 与富 `decided_by`，见 §6 |
| `thread` | v2 讨论权威存储：`ReviewThread`（id/status/participants/entries），见 §6 |
| `thread.entries[].id` | 稳定 `ENTRY-####`，按现存 max+1 分配；读侧只补缺/去重，绝不按位置重编号 |
| `comment`（正文投影） | `thread.entries[0].body` 的镜像；编辑开场评论时 thread entry 与投影同改，并置 `comment_edited_at` |
| `updated_at` | 每次追加线程 / 状态迁移时更新 |

## 4. 锚点模型（Anchor）

锚点一经创建**不可变**；文档变化后由 Anchor Resolver 实时重新定位（见 05），不回写锚点。定位依据按可靠性分四层冗余：

| 层 | 字段 | 作用 |
| --- | --- | --- |
| Version | `document_sha` | 锚点创建时的基线版本，判断文档是否已变更 |
| Structural | `heading_path` / `section` | 缩小搜索范围，解析 Markdown AST 得到 |
| Textual | `selected_text` + `prefix` + `suffix` | fuzzy 定位主依据 + 重复段落消歧 |
| Positional | `line_start/end` + `offset_start/end` | 行号作初始估计与 UI 滚动提示；LF 0-based 半开字符偏移供精确梯子（valid/moved）高亮，均非漂移后的定位依据 |
| Fingerprint | `fingerprint` | O(1) 判断「原始上下文是否仍完整存在」 |

## 5. TypeScript 线模型

```ts
export type Severity = 'info' | 'minor' | 'major' | 'critical'

export type ReviewType =
  | 'question'
  | 'suggestion'
  | 'bug'
  | 'design_issue'
  | 'requirement_issue'
  | 'implementation_issue'
  | 'test_issue'
  | 'exploration'

export type ReviewStatus =
  | 'open'
  | 'discussing'
  | 'needs_review'
  | 'accepted'
  | 'implementing'
  | 'implemented'
  | 'verifying'
  | 'resolved'
  | 'rejected'
  | 'duplicated'

export type AnchorStatus = 'valid' | 'moved' | 'modified' | 'outdated' | 'orphaned'

export interface ReviewAnchor {
  structural: { section: string | null; headingPath: string[] }
  textual: { selectedText: string; prefix: string; suffix: string }
  /** lineStart/lineEnd 1-based；offset 为 LF 0-based 半开字符偏移，新锚点必有，
   *  零长度点锚点 selectedText==='' 且 offsetStart===offsetEnd。 */
  positional: {
    lineStart: number
    lineEnd: number
    offsetStart?: number
    offsetEnd?: number
  }
  fingerprint: { algorithm: 'sha256'; value: string }
}

export interface ReviewDecision {
  /** 稳定 id，DEC-####，review 内 append-only、不复用。 */
  id: string
  type: 'accept' | 'reject' | 'defer' | 'duplicate' | 'wont_fix'
  summary: string
  decidedBy: AuthorRef
  decidedAt: string
}

export interface ReviewRelated {
  decisions: string[]
  reviews: string[]
  code: string[]
  tests: string[]
  commits: string[]
  agentRuns: string[]
}

/**
 * 富作者身份（参考设计 §13 Comment / §14 Agent Comment）。
 * - user:  { type:'user',  id, displayName? }
 * - agent: { type:'agent', id, provider, agentRunId, displayName? }
 * Agent 身份不携带 Approval 权限：只能追加 comment，不能写 ReviewDecision。
 */
export interface AuthorRef {
  type: 'user' | 'agent'
  id: string
  /** 模型/供应商路由键（仅 agent；来自平台消息 source 的 provider）。 */
  provider?: string
  displayName?: string
  /** 本次发言所属 run：agent 为发起 prompt 的 requestId（落为 user/message source.rpcId），一次 dispatch = 一个 run。 */
  agentRunId?: string
}

export interface ThreadEntry {
  id: string                   // ENTRY-####，稳定 max+1，支持 replyTo
  at: string
  author: AuthorRef
  kind: 'comment' | 'status' | 'decision' | 'system'
  body: string
  replyTo?: string
  editedAt?: string            // 发布后被编辑（GitHub 风格 edited 标记）
  fromStatus?: ReviewStatus    // status 类条目
  toStatus?: ReviewStatus
  decisionType?: ReviewDecision['type']  // decision 类条目
  decisionId?: string          // decision 时间线条目 -> 权威 ReviewDecision 的链接
}

/**
 * Review Thread（参考设计 §12）：与 review 1:1 的独立实体。
 * status 镜像 review status；participants 是 entries 中出现过的作者的
 * 去重派生投影。
 */
export interface ReviewThread {
  id: string                   // 稳定 thread id；与 review 1:1，故恒等于 reviewId
  status: ReviewStatus
  participants: AuthorRef[]
  /** 只追加时间线；首条恒为开场评论（review body），thread 即完整讨论记录。 */
  entries: ThreadEntry[]
}

export interface ReviewRecord {
  schemaVersion: 2
  reviewId: string
  number: number                 // 文档内编号（同一 document 单调、不复用）；0 = 待惰性回填的旧记录
  document: string
  documentSha: string | null
  type: ReviewType
  severity: Severity
  title: string | null
  status: ReviewStatus
  tags: string[]
  target: ReviewAnchor
  author: string                 // 开场评论作者 id 投影（列表过滤）
  authorRef: AuthorRef           // 开场评论作者富身份，也是 thread 首个参与者
  assignee: string | null
  related: ReviewRelated
  decision: ReviewDecision | null
  duplicatedOf: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  comment: string                // 投影：thread.entries[0].body（v1 兼容/列表渲染）
  proposal: string               // 正文 ## Proposal 投影
  commentEditedAt?: string
  thread: ReviewThread           // v2：讨论权威存储
}

/** index.json 单行（列表页，不含正文）。 */
export interface ReviewSummary {
  reviewId: string
  number: number                 // 文档内编号，列表中以 #N 展示
  document: string
  type: ReviewType
  severity: Severity
  status: ReviewStatus
  title: string | null
  section: string | null
  lineStart: number
  lineEnd: number
  tags: string[]
  author: string
  assignee: string | null
  createdAt: string
  updatedAt: string
}
```

> 注：`anchorStatus` **不落盘**，由 host 在读取时实时计算返回（见 05），避免与文档版本漂移后不一致。

## 6. Decision 与 Thread

- **Thread 是独立实体（v2 已落地）**：`ReviewThread` 与 review 1:1（`thread.id === reviewId`），结构化整体落于 frontmatter；`status` 镜像 review status、`participants` 由 entries 作者按 `type:id:provider` 去重派生，二者每次写回由 host 重算，不信任盘中旧值。
- **开场评论并入 thread**：`thread.entries[0]` 恒为开场评论（稳定 `ENTRY-0001`，author = 创建者）；顶层 `comment` 仅为其 body 的读时投影，编辑开场评论时两者同改。正文 `## Comment` / `## Thread` 只是给人/Git diff 阅读的投影，不是解析权威。
- **条目只追加、稳定 id**：`ENTRY-####` 按现存 max+1 分配；读侧 `stabilizeEntryIds` 只对缺失/畸形/重复 id 补缺，绝不按位置重编号。comment 条目支持 `replyTo` 楼层与 `editedAt` 编辑标记。
- **Decision 是一等公民**：Accept/Reject/Defer/Duplicate/Wont-fix 生成带稳定 `id: DEC-####` 的 `decision` 记录（同样 max+1、append-only），并追加一条 `kind: decision` 条目，以 `decisionId` 回链权威 decision；状态迁移各追加一条 `kind: status` 条目（`fromStatus`/`toStatus`）。dispatch 走 open→accepted（人类 accept decision「Accepted when sent to agent」= DEC-0001 + decision/status 条目）→ implementing（再一条 status 条目）。
- **Agent Comment 回流（富身份 + run 关联）**：agent 发言建模为 `author: { type:'agent', id, provider, displayName, agentRunId }`，其中 `agentRunId` = 发起 prompt 时 mint 的 requestId（落在 user/message 的 `source.rpcId`），一次 dispatch = 一个 run，该 run id 只出现在 Agent 评论的作者身份上（`related.agent_runs` 记的是承载实施的 session 标识，与 `assignee` 同源）。回流正文取该 run 全部非中断 step 的 textParts，以空行拼接并 trim；interrupted、空文本、异 session/异 turn 的消息一律丢弃。Agent 可参与讨论，但**不能产生 Decision、不产 decision 条目、不主动改 review status**（UI/host 双重拦截；终态 review 静默拒收回流）。

## 7. 并发与一致性

| 场景 | 策略 |
| --- | --- |
| 双序号分配 | host 维护两套独立内存锁：①`review_id` 按 project 加锁、扫描项目全部记录取 `REV-` 最大序号；②`number` 按 `projectPath + document` 加锁、扫描该 document 的全部记录取 `max(number)` + 1。两者在同一次 create 事务内串行分配，写文件用 tmp + rename 原子落盘（同左栏 `writeNode`）。`number` 单调不复用，删除留空号 |
| 旧记录 `number` 回填 | 编号字段上线前创建的记录无 `number`。host 在**索引重建（含缺失/损坏触发）与读取列表时惰性回填**：按 `createdAt` 升序对每个 document 的缺号记录分配 1..k（k = 缺号数），使新记录起点为「现存 max + 1」；回填仅在该记录下次因其他原因写回时顺带落盘，不批量改文件；内存/索引投影中的回填值立即生效。极端情况下两条缺号记录 createdAt 相同，以 `review_id` 升序兜底 |
| 同一 Review 并发编辑 | 记录文件写入带 `expectedSha`（文件内容 sha256），冲突返回 409，由客户端合并线程后重试 |
| 讨论追加 | host 提供专用 append 端点，内部读—向 frontmatter `thread.entries` 追加（重算 status/participants 与投影正文）—原子写，避免客户端整文件覆盖；终态 review 拒绝追加 |
| 索引竞争 | `index.json` 采用写后重建（debounce 200ms）；读取发现缺失/损坏则扫描重建 |
| 文档已变更 | 不阻断 Review 创建；锚点记录基线 sha，展示时实时做漂移校正（见 05） |

## 8. 索引文件

```json
{
  "version": 1,
  "projectId": "…",
  "updatedAt": "2026-09-15T10:00:00+08:00",
  "reviews": [
    { "reviewId": "REV-0001", "number": 1, "document": "CoreRequirements.md", "status": "open", "severity": "major" },
    { "reviewId": "REV-0002", "number": 2, "document": "CoreRequirements.md", "status": "open", "severity": "minor" },
    { "reviewId": "REV-0003", "number": 1, "document": "ProjectInfo.md", "status": "resolved", "severity": "info" }
  ]
}
```

## 9. schema 演进

- `schemaVersion` 写入 frontmatter（当前 `2`；缺省视为 v1）；
- host 读取时按版本走迁移函数，**迁移只在内存进行、于首次写回时惰性固化**，不批量改文件；
- 未知 frontmatter 字段收集进 `extra`，写回时在已知键之后原样重发，前向兼容旧版插件。

### 9.1 v1 → v2 迁移（thread 结构化）

v1 的讨论是正文 `## Thread` 下的 `- [at / author] body` 行（按位置编号），开场评论只存在于顶层 `comment`。读 v1 文件时：

1. **开场评论回填为 ENTRY-0001**：顶层 `## Comment`（author = `author_ref`，v1 无富身份时由裸 `author` 升级为 `{type:'user'}`）成为首条 entry；
2. **旧行整体后移一位**：v1 正文第 i 行变为 `ENTRY-(i+2)`；旧行之间的 `reply ENTRY-####` 经 idMap 重映射到新 id；
3. **Decision 链接**：v1 decision 行按 `decisionType` 匹配顶层 `decision`，挂上其规范 `decisionId`（`DEC-####`）；v1 `decision.decided_by` 的裸字符串升级为富 user 身份；
4. **Agent 身份升级**：v1 行内 `agent:id[:runId]` 编码升级为 `{type:'agent', id, agentRunId}`；
5. **participants 派生**：由迁移后全部 entries 的作者按 `type:id:provider` 去重派生；
6. **固化**：迁移仅存在于内存；该记录下次因任何原因写回时，以 `schemaVersion: 2` + frontmatter 结构化 `thread` 落盘，正文 `## Thread` 重渲染为投影。
