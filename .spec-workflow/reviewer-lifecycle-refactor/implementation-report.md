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

**Commit**：待用户确认（auto-commit=否）。
