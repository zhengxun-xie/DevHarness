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

**Commit**：见下条记录。

