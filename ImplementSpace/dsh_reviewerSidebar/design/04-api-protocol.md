# 接口协议（API Protocol）

## 1. 约定

- Base URL：`/api/devbuddy`（左栏 [protocol.ts](../../dsh_devbuddy/src/protocol.ts) 注释中已为右栏预留此前缀，与 `/api/devbuddy-left` 区分，两插件共存）；
- 全部为 **exact 路由**，JSON over HTTP，`cache-control: no-store`；
- 信任围栏与左栏一致：loopback 地址 + localhost Host + 同源 Origin + 拒绝跨站 `Sec-Fetch-Site`；
- 请求体上限 4 MiB；
- 资源 id 放 query（GET）或 body（POST），不放 path 段；
- 错误体统一为 `{ "error": string }`，状态码：400 参数错误 / 404 不存在 / 409 乐观锁冲突 / 403 信任校验失败 / 405 方法不允许。

## 2. 端点总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/devbuddy/projects` | 当前可评审项目列表（读共享注册表） |
| POST | `/api/devbuddy/project/activate` | 设置右栏当前项目 |
| GET | `/api/devbuddy/reviews` | Review 列表（索引 + 筛选） |
| GET | `/api/devbuddy/review` | 单条 Review 详情（含正文线程） |
| POST | `/api/devbuddy/reviews` | 创建 Review（Inline Review 提交） |
| POST | `/api/devbuddy/review/append` | 追加讨论条目 |
| POST | `/api/devbuddy/review/transition` | 状态迁移 |
| POST | `/api/devbuddy/review/remove` | 删除（仅 open/rejected/duplicated 且 author 本人） |
| GET | `/api/devbuddy/document` | 取文档内容 + 评审锚点解析结果 |
| POST | `/api/devbuddy/agent/send` | Send to Agent（见 07） |
| GET | `/api/devbuddy/agent/context` | 预览将装配的 Agent Context（dry-run） |

## 3. 详细定义

### 3.1 GET `/projects`

```ts
// Response 200
interface ProjectsResponse {
  projects: Array<{
    id: string
    name: string
    path: string
    active: boolean          // 是否为右栏当前项目
    workspaceLinked: boolean // 是否解析到 dsh workspace
    openCount: number        // 未关闭 Review 数
  }>
}
```

### 3.2 POST `/project/activate`

```ts
interface ActivateRequest { id: string }
// 200 -> { projectId: string }
```

### 3.3 GET `/reviews`

Query：

| 参数 | 说明 |
| --- | --- |
| `projectId` | 必填 |
| `status` | 可选，逗号分隔，如 `open,discussing` |
| `severity` | 可选，逗号分隔 |
| `document` | 可选，按文档路径过滤 |
| `author` / `tag` | 可选 |

```ts
// Response 200
interface ListReviewsResponse {
  reviews: ReviewSummary[]   // 见 03 数据模型
}
```

### 3.4 GET `/review`

Query：`projectId`、`reviewId`。

```ts
// Response 200
interface GetReviewResponse {
  review: ReviewRecord
  /** 锚点在当前文档中的实时解析（漂移校正后）。state 与 Review Status 分离，见 05/06。 */
  anchorResolution: {
    state: 'valid' | 'moved' | 'modified' | 'outdated' | 'orphaned'
    lineStart: number | null
    lineEnd: number | null
    confidence: number       // 0~1
    /** true 时提示「NEEDS_REVIEW 候选」，供 UI 引导人工确认。 */
    needsReviewCandidate: boolean
  }
}
```

### 3.5 POST `/reviews`

```ts
interface CreateReviewRequest {
  projectId: string
  document: string                   // 项目相对路径
  target: {                          // 锚点四层模型，见 03 §4
    structural: { section: string | null; headingPath: string[] }
    textual: {
      selectedText: string
      prefix?: string
      suffix?: string
    }
    positional: { lineStart: number; lineEnd: number }
  }
  type?: ReviewType                  // 缺省 suggestion
  severity?: Severity                // 缺省 minor
  title?: string
  comment: string                    // 必填，非空白
  proposal?: string
  tags?: string[]
  /** 发起时文档 sha，用于登记 documentSha。 */
  documentSha?: string | null
}

interface CreateReviewResponse {
  review: ReviewRecord               // host 计算并写入 fingerprint 与文档级 number
}
```

校验：`comment` 非空白、`selectedText` 非空、行号合法、文档在项目目录内；否则 400。`fingerprint` 由 host 用 `sha256(prefix + selectedText + suffix)` 计算写入，客户端不直接传。`reviewId`（项目级）与 `number`（文档级）均由 host 分配。

### 3.6 POST `/review/append`

```ts
interface AppendRequest {
  projectId: string
  reviewId: string
  body: string
  replyTo?: string              // 楼层回复，见 03 §6
  author?: AuthorRef            // 缺省 user/reviewer；M5 Agent 发言传 { type:'agent', id, agentRunId }
  expectedSha?: string | null   // 记录文件 sha，冲突 409
}
// 200 -> { review: ReviewRecord, sha: string }
```

### 3.7 POST `/review/transition`

```ts
interface TransitionRequest {
  projectId: string
  reviewId: string
  to: ReviewStatus
  reason?: string               // 拒绝 / 打回时必填
  duplicatedOf?: string         // to=duplicated 时必填
  /** accept/reject/duplicate 时生成 Decision，见 03 §6。 */
  decisionSummary?: string
  expectedSha?: string | null
}
// 200 -> { review: ReviewRecord, sha: string }
// 409 非法迁移（状态机见 06）或 sha 冲突（error 字段区分 code）
```

### 3.8 POST `/review/remove`

```ts
interface RemoveRequest { projectId: string; reviewId: string }
// 删除 .md 文件并重建索引；仅允许 open/rejected/duplicated
```

### 3.9 GET `/document`

供右栏文档视图渲染与高亮：

```ts
// Query: projectId, path
interface DocumentResponse {
  path: string
  content: string
  sha: string | null
  exists: boolean
  headings: Array<{ slug: string; text: string; level: number; line: number }>
  reviews: Array<{               // 该文档上的全部评审锚点（已做漂移校正）
    reviewId: string
    number: number               // 文档内编号（#N），见 03 §3.1
    status: ReviewStatus
    severity: Severity
    type: ReviewType
    /** 选区原文快照，供预览态在渲染 DOM 中反查定位并包裹 <mark>。 */
    selectedText: string
    lineStart: number | null
    lineEnd: number | null
    /**
     * 漂移校正后命中的字符偏移（相对当前文档 LF 文本，0-based，半开区间）。
     * valid/moved/modified 时尽量给出；outdated/orphaned 或无法精确定位时为 null，
     * 客户端退化为行级区间高亮。
     */
    matchOffsetStart: number | null
    matchOffsetEnd: number | null
    anchorStatus: 'valid' | 'moved' | 'modified' | 'outdated' | 'orphaned'
    needsReviewCandidate: boolean
  }>
}
```

### 3.10 POST `/agent/send`

```ts
interface SendToAgentRequest {
  projectId: string
  reviewId: string
  /** null = 发送到项目绑定 workspace 的活动会话；否则新建会话。 */
  sessionId?: string | null
  /** 覆盖默认 Context 装配项。 */
  include?: {
    relatedDocs?: boolean
    decisions?: boolean
    code?: boolean
    tests?: boolean
    gitHistory?: boolean
  }
  dryRun?: boolean              // true 时只返回 context 不发送
}

interface SendToAgentResponse {
  context: AgentContextPayload  // 结构见 07
  sessionId: string | null      // 实际发送目标
  delivered: boolean
}
```

`GET /agent/context` 为其 dry-run 形态（query 传 `projectId/reviewId`）。

## 4. 客户端封装约定

- `api.ts` 统一拼前缀、解析 JSON、非 2xx 抛 `ApiError(status, error)`；
- 写操作携带 `expectedSha` 时，409 由 UI 层提示「内容已更新，请刷新后重试」，不静默覆盖；
- 面板挂载后拉取一次列表，之后依赖：
  - 自身写操作后的响应增量更新；
  - `window` 可见性变化（`visibilitychange`）时刷新；
  - 左栏 `postMessage('DEVBUDDY_REVIEW_CHANGED')` 跨栏通知（M1 不做 SSE/WebSocket）。

## 5. 与左栏 API 的边界

| 数据 | 归属端点 |
| --- | --- |
| 项目注册表 CRUD、节点文档读写 | `/api/devbuddy-left/*`（不重复实现） |
| Review 全部读写、状态、Agent 下发 | `/api/devbuddy/*` |
| 共享读取：注册表、节点文件内容 | Reviewer host 直接复用左栏 store 的磁盘约定（同一 `~/.dsh/devbuddy/` 与项目目录），但不 import 左栏包，避免安装耦合 |
