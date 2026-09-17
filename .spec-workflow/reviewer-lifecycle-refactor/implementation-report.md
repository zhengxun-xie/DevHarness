# Implementation Report — Reviewer 状态机重构

> spec: `.spec-workflow/reviewer-lifecycle-refactor/spec.md`（Goal Mode 开启，不自动提交，最大修复 2 轮）
> 进度逐 ticket 记录于此。

## Ticket 01 — 数据清理与状态机单一来源 ✅

**完成时间**：实现完成后即通过全部自验。

**改动**：
- `src/protocol.ts`：状态集单一来源——新增 `STATUSES` / `TERMINAL_STATUS_SET` / `isTerminal()` / `isOpen()`；`OPEN_STATUSES` 改为由 `STATUSES` 派生；`DECISION_TYPES` 收敛（删死枚举 `defer`/`wont_fix`）；`ReviewRecord` 新增 `decisions: ReviewDecision[]`（append-only），`decision` 保留为最新镜像。
- `src/host/lifecycle.ts`：删除本地 `isTerminal`/`isOpen`，改为从 protocol re-export 单一来源（迁移表语义不变）；`IllegalTransitionError` 参数属性改为显式字段（Node 24 type-stripping 兼容：参数属性非可擦除语法）。
- `src/host/json-store.ts`：`LockBusyError` 同样去掉参数属性（测试导入链必经）。
- `src/host/review-files.ts`：`asStatus` 白名单改用 `STATUSES`；`decisionFromYaml`/`entryFromYaml`/线程正则改用 `DECISION_TYPES`；新增 `decisionsFromYaml` + 旧单值懒迁移（无 `decisions` 时由 `decision` 补齐）；`KNOWN_KEYS` 加 `decisions`；序列化同步写 `decisions`；`formatThreadEntry` 不再对缺类型决策伪造 `defer`，降级为普通评论行。
- `src/host/review-store.ts`：新记录 `decisions: []`；两处决策写入点同步 `decisions.push`；`nextDecisionId` 扫描完整历史。
- `src/host/context-builder.ts`：两处 `?? 'defer'` 兜底改 `'unspecified'`。
- client 三处字面拷贝消除：`ReviewDetail.tsx` 与 `DocumentReviewView.tsx` 的 TERMINAL Set → `TERMINAL_STATUS_SET`；`ReviewList.tsx` closed 视图 → `[...TERMINAL_STATUSES]`。
- `package.json`：新增 `test` 脚本（`node --test`，Node 24 原生 type-stripping，零新增依赖）。
- 新增 `src/host/lifecycle.test.ts`（5 条）、`src/host/review-files.test.ts`（7 条）。

**自验**：
- `pnpm typecheck` ✅
- `pnpm test` 12/12 ✅（决策迁移、回环、死枚举、迁移表合法/非法逐条、decisionTypeFor、单源分区）
- `pnpm build`（host ESM + client CJS）✅
- grep 单源校验：非测试文件无第二份终态/开放字面定义 ✅

**残留说明**（有意保留，非缺陷）：
- `ReviewList.VIEW_STATUS` 的 open/inProgress/verify 分组字面量是**视图规约**（非状态集成员定义），ticket 02 收敛状态后同步重写。
- `ReviewDetail.REMOVABLE` 是独立的删除规约（open+2 终态），ticket 05 Reopen 时再审。
- 真实旧文件（`.devbuddy/reviews/REV-0001，schemaVersion 1，单值 decision，无 id 字段）与测试 fixture 同源，读路径已覆盖：迁移后 `decisions` 补 `DEC-0001`。

**Commit**：`1da2b2b`。

## Ticket 02 — 状态收敛 8 态 + 读时归一化 + 视图分组 ✅

**改动**：
- `src/protocol.ts`：`ReviewStatus` 收敛为 8 态；新增 `LegacyReviewStatus` / `StoredReviewStatus` / `LEGACY_STATUS_MAP` / `STORED_STATUSES` / `normalizeStatus()`；`ThreadEntry.fromStatus/toStatus` 改用 `StoredReviewStatus`（历史原名可落盘）。
- `src/host/lifecycle.ts`：`ALLOWED` 重写为 8 态迁移表（`open→accepted/rejected/duplicated/needs_review`；`accepted→implementing/open`；`implementing→verifying/accepted/open`；`verifying→resolved/implementing/needs_review/open`；`needs_review→open/rejected/duplicated`；终态无出边，Reopen 留给 t05）。
- `src/host/review-files.ts`：新增 `asStoredStatus`（原始读，含 legacy 名）与 `asStatus`（归一化）；记录状态归一化，**线程历史条目保留原名**（真实审计）；线程原文正则与结构化字段都走原始读。
- `src/host/review-store.ts`：删除首条回复自动 `open→discussing`（讨论不再推动状态）；`markAgentDispatched` 不再补写人没点过的 `accepted` 条目——open 直接一条 `open→implementing` + 一条 accept decision（`accepted` 起点仍走 `accepted→implementing`）。
- `src/client/ReviewList.tsx`：四视图重映射 `open:[open]` / `inProgress:[accepted,implementing]` / `verify:[verifying,needs_review]` / `closed:[终态]`（对齐 refactor §9.2）。
- `src/client/ReviewDetail.tsx`：`PLAIN_ACTIONS` 重写为 8 态；删 `discussing`/`implemented` 分支；`implemented→verifying` 的按钮改为 `implementing→verifying`（键 `transition.declareDone`，保留证据弹窗）；顺带修正原先 `verifying→implementing` 同时出现「平铺按钮 + 弹窗按钮」的重复；`statusText()` 按 §8.3 对历史状态做显示映射。
- `src/client/locales.ts`：删 `status.discussing`/`status.implemented`、`transition.backToDiscussing`/`transition.markImplemented`；新增 `transition.declareDone`（声明完成 / Declare done）、`transition.implementationBlocked`（实施受阻 / Implementation blocked）。
- 测试更新/新增：`lifecycle.test.ts` 重写为 8 态基线（16 条合法/12 条非法逐条 + 终态暂不可 Reopen 的显式 pin）；`review-files.test.ts` 新增归一化表 + 「记录状态归一、历史条目保原名」测试。

**自验**：
- `pnpm typecheck` ✅
- `pnpm test` **14/14** ✅
- `pnpm build`（host ESM + client CJS）✅
- grep 残留：`discussing`/`implemented` 仅存在于 `protocol.ts` 的 `LegacyReviewStatus` 声明 ✅

**设计判读（已核对用户参考文档）**：
- `needs_review` 归入 **Verify** 视图 —— 与 `reviewer_设计参考/lifecycle-refactor.md` §9.2 一致（spec §8 原文如此，非笔误）。
- 历史条目 `[discussing → open]` 数据保原名、**渲染时映射**为收敛后词表（refactor §8.3 明确要求），故该条会显示为 `open → open`；这是文档化契约，换取 UI 只有一套状态词表。
- `implementing→verifying` 保留证据弹窗（合并原 `implemented→verifying` 的 evidence 采集，点击少一次、信息不丢）。

**Commit**：`d205a17`。

## Ticket 03 — Agent 回连一键建议 + commit trailer 回填 ✅

**改动**：
- `src/protocol.ts`：新增 `AgentCompletion`（at/sessionId/rpcId/provider/model）与 `ReviewRecord.agentCompletion: AgentCompletion | null`；`hasAgentCompletionSuggestion()` 是提示条唯一显示谓词（`implementing` 且 marker 非空）。
- `src/host/review-files.ts`：`agent_completion` 键进 KNOWN_KEYS；新增 `agentCompletionFromYaml/ToYaml`；parse/serialize 双侧接线（旧文件缺键 → null，回环测试覆盖）。
- `src/host/git-read.ts`（新）：从 context-builder 提取共享只读 git（`runGit`/`gitAvailable`）+ `parseReviewTrailers()`（整行匹配、大小写不敏感、去重、保持首见顺序）+ `scanReviewCommits()`（`git log` 有界扫描 `DevBuddy-Review: <id>` trailer）。
- `src/host/context-builder.ts`：git helper 改为复用 `git-read.ts`（删掉本地重复实现，保持单一来源）。
- `src/host/review-store.ts`：
  - `appendAgentComment` 在 review 处于 `implementing` 时写入 `agentCompletion` 建议标记（**建议，不改状态**；Agent 永不裁决）。
  - `transitionReview`：人类驱动的转换先清掉残留建议，再执行转换；进入 `accepted/implementing/verifying/resolved` 时同步 `backfillReviewCommits()`（trailer → `related.commits`，去重、best-effort 不阻塞转换）。
  - `markAgentDispatched`：重新派发时清掉上一轮的陈旧建议。
- `src/client/ReviewDetail.tsx`：`implementing` 且存在建议时渲染 `dbr-toast dbr-ok` 提示条 + 「确认完成」主按钮 → 弹 evidence 对话框直达 `verifying`。
- `src/client/locales.ts`：新增 `agent.doneHint`（Agent 报告完成 · 待你验收）与 `transition.confirmAgentDone`（确认完成），en/zh 双侧。
- 测试：新增 `git-read.test.ts`（trailer 解析 3 例、codec 回环 2 例、显示谓词全状态矩阵）；`package.json` test 脚本加入新文件。

**自验**：
- `pnpm typecheck` ✅
- `pnpm test` **20/20** ✅
- `pnpm build`（host ESM + client CJS）✅；client bundle 无 node 依赖（grep=0）✅

**设计判读**：
- trailer 回填刻意放在 **await 的同步写路径**（transitionReview 内）而不是 turn/end 的后台异步——避免游离异步写入与人工编辑并发时产生 sha 覆盖竞态；代价是回填时机略晚（下一个转换），可接受且有注释说明。
- 「确认完成」按钮复用 `verify` 对话框（保留 evidence 采集），即 spec 所说「一键」= 点击后仍在同一弹窗内确认提交证据，而非无任何确认的静默迁移。

**Commit**：`3c75be1`。

## Ticket 04 — 锚点失效自动分流 ✅

**改动**：
- `src/host/anchor-triage.ts`（新，纯函数）：
  - `decideAnchorTriage({state, status, positionalChanged})` → `none | silent-update | system-note | auto-needs-review`。终态恒 `none`；`needs_review` 期间恒 `none`（抖动防护）；`orphaned` 且非终态非 `needs_review` → `auto-needs-review`；`moved`/`modified`/`outdated` 仅在**行号真的变了**时才写（防抖：文档未变化 = 严格零写入）。
  - `preNeedsReviewStatus(entries)`：从线程最近的「进入 needs_review」条目反推进入前状态；拒绝还原终态、缺历史回落 `open`。
- `src/host/lifecycle.ts`：`needs_review` 出向扩为任意非终态（自动退出的合法边；UI 只暴露重绑/Reject/Duplicate）。
- `src/host/review-store.ts`：
  - 抽出共享 `buildAnchor()`（创建与重绑共用同一套校验：包含性、存在性、LF 偏移精确匹配、指纹计算）。
  - 新增 `applyAnchorTriage()` 并在 `getReview`/`getDocument` 读路径接入：静默跟随位置 / 写 `kind:system` 条目 / 自动 `→ needs_review`；写前用**读取时的 sha 复核**，冲突即静默跳过（下次读重试）；仅在真的发生写入时重算 resolution（避免重复 Levenshtein）。
  - 新增 `reanchorReview()`：重绑 `target`（同时更新 `documentSha`），若在 `needs_review` 则自动退回进入前状态并记 `kind:status`；**这是唯一退出方式**。
  - 位置跟随时丢弃过期 offset（fuzzy 命中不报 offset，保留旧值等于说谎）。
- `src/protocol.ts`：新增 `ReanchorRequest` / `ReanchorResponse`。
- `src/host/routes.ts` + `src/client/api.ts`：新增 `POST /review/reanchor`。
- `src/client/ReviewDetail.tsx`：`needs_review` 主按钮改为「重新定位锚点」（`onRebind`），移除 `needs_review` 的 `backToOpen` 平铺动作（对齐 refactor §9.1）。
- `src/client/ReviewerPanel.tsx`：document 路由加 `rebindFor`，详情 → 文档重绑模式 → 完成后回详情并广播变更。
- `src/client/DocumentReviewView.tsx`：重绑模式横幅 + FAB 文案切换，选区直接调 `reanchorReview`；对 `needsReviewCandidate` 的 gutter 徽标加 `dbr-is-drift` 点标 + popover 小标签。
- `src/client/styles.ts`：`.dbr-is-drift` / `.dbr-drift-chip`。
- `src/client/locales.ts`：`anchor.rebind` / `anchor.rebindHint`（en/zh）。
- 文档：`design/06-lifecycle.md` —— §1 状态机与 mermaid 重画为 8 态（讨论不再推动状态）、§2 迁移表重写、**§3 原则修订为「除 orphaned 外不自动改状态」**并补分流表与幂等/抖动说明。
- 测试：新增 `anchor-triage.test.ts`（终态不可动全矩阵、needs_review 抖动防护全矩阵、orphaned 唯一自动、静默跟随 debounce 矩阵、note 非空、进入前状态反推 5 例）；`lifecycle.test.ts` 同步新的 `needs_review` 出向边。

**自验**：
- `pnpm typecheck` ✅
- `pnpm test` **30/30** ✅
- `pnpm build`（host ESM + client CJS，两个产物均已重建）✅

**设计判读（需你过目）**：
1. **`modified`/`outdated` 的 system 条目只在行号变化时写**：spec §12 说「静默更新位置 + 一条 system 条目」，§15 又要求「防抖/幂等，避免读放大」。二者取交集后我选了「有真实位置变化才写」——文本漂移但行号未变的情况由列表徽标（`needsReviewCandidate`）体现，不刷线程。若你希望「每次检测到 modified 都留痕」，需要引入 `lastAnchorState` 字段来做真幂等（本次未加字段）。
2. **重绑入口**：插件此前**没有**重绑锚点的写入路径，本 ticket 补了 host 方法 + 路由 + UI 流程（详情 →「重新定位锚点」→ 文档视图选片段 → 自动退回原状态）。由于该流程跨详情/文档两个视图，未做「选中即静默重绑」的猜测式交互。
3. 位置跟随会**丢弃旧 offset**（fuzzy 命中无 offset），避免以过期精确区间误导后续匹配。

**Commit**：见下条记录。

## Ticket 05 — Reopen + UI 主次分明 ✅

**改动**：
- `src/host/lifecycle.ts`：终态 `resolved`/`rejected`/`duplicated` 各放开且仅放开 `→ open` 一条出边（Reopen）；新增纯函数 `isReopen({from,to})`（终态→open）与 `isHumanOnlyTransition({from,to,severity})`（critical 的 `→ resolved` 与终态 Reopen 保留给人）；`protocol.ts` 的导入/再导出合并为单一 import surface。
- `src/protocol.ts`：`TransitionRequest` 新增可选 `author?: AuthorRef`（调用方声明身份，缺席即人）。
- `src/host/review-store.ts`：新增 `ForbiddenError`（403）；`transitionReview` 在 `assertTransition` 后执行两道门禁——agent 身份 + human-only 规则 → 拒绝（resolve 与 reopen 各自的文案）、终态 Reopen 需 `reason` 非空（活态 → open 回退不需要）；`resolveActor()` 把身份落到状态/决策条目上；`isReopen` 时清 `resolvedAt`。Reopen 不触发 commit-trailer 回填（`to='open'` 不在回填集合），历史不丢。
- `src/host/routes.ts`：`statusForError` 加 `ForbiddenError → 403`（其余不变：409 illegal/conflict、400 validation）。
- `src/client/TransitionDialog.tsx`：新增 `reopen` kind（reason 必填，标题用 `transition.reopen`）。
- `src/client/ReviewDetail.tsx`：动作模型重为主/次两层——每状态一个 `dbr-primary`（`PRIMARY_ACTION`：`open`=采纳、`implementing`=声明完成、`verifying`=验收通过、三终态=Reopen；`accepted` 提升 Send to Agent、`needs_review` 主操作=重绑导航）；其余合法出边收进次级区（`SECONDARY_ACTIONS`，全量保留不出死角）；`implementing` 有 Agent 回连待验收时主按钮文案切为「确认 Agent 完成」；`open` 的 Send 保持次级。
- `src/client/locales.ts`：`transition.reopen`（en/zh）。
- 文档：`design/06-lifecycle.md` —— mermaid 补三条终态 Reopen 边、迁移表加 Reopen 行、约束补「critical 仅人 403」「Reopen 保留历史/duplicatedOf、清 resolvedAt」；`design/06b-lifecycle-current-analysis.md` —— 归档标注 §0 落地对照表（含 t03/t04 设计判断留痕）。
- 测试：`lifecycle.test.ts` 终态→open 由非法改合法 + 补「仅 `→open` 一条出边」全矩阵 + `isReopen`/`isHumanOnlyTransition` 全矩阵；新增 **`review-store.reopen.test.ts`（store 级，临时 DSH_HOME + 临时项目，动态 import）**——三终态 Reopen 需 reason、历史/duplicatedOf 保留、`resolvedAt` 清空、Reopen 后可写、活态回退不算 Reopen、critical resolve/reopen 被 agent 拒绝而人可、非 critical 不受限、Reopen 后可再走完流程。
- `package.json`：`test` 脚本追加新测试文件（Node `--test` 用显式文件列表）。

**自验**：
- `pnpm typecheck` ✅
- `pnpm test` **39/39** ✅（含 8 条 store 级 Reopen 用例）
- `pnpm build`（host ESM + client CJS，两产物均重建）✅

**设计判读（需你过目）**：
1. **「仅人」的权威依据是调用方声明的 `TransitionRequest.author.type`**：spec §9/§13 明示「仍单机模型、`author=reviewer`、无账号体系」，所以这是**声明制门禁**而非鉴权——主机面板（同一 loopback 内）技术上可伪造。它拦的是「Agent 侧默认路径误触」，不是恶意越权；若将来真要给 Agent 独立的认证身份，这里要换成真鉴权。
2. **Open 的 Send to Agent 保持次级**：refactor §9.1 的 accepted 主按钮即 Send；`open` 的主按钮沿用「采纳」，Send 作为次级并列于 Reject/Duplicate，避免 open 出两个主按钮。
3. `ReviewList` 分组（`verify` 含 `needs_review`、`closed` 用单一来源 `TERMINAL_STATUSES`）此前已对齐 spec §8，本 ticket 未再改。

**Commit**：见下条记录。


