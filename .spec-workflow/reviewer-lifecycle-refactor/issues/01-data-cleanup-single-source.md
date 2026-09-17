# Ticket 01 — 数据清理与状态机单一来源

- Parent spec: `.spec-workflow/reviewer-lifecycle-refactor/spec.md`
- Problem source: 用户请求 + `design/06b-lifecycle-current-analysis.md` 缺陷 E1/E2/E3
- Status: `ready-for-agent`
- Priority: 最高（所有 ticket 的前置）
- Blocks delivery: 是
- Dependencies: 无
- Blocked by: 无
- Can run in parallel: 否（是 02–05 的地基）
- Parallel boundary: 独占，完成前不并行其它 ticket

## What to build（端到端行为）

作为维护者，改动后：状态机集合/迁移表/开放态/终态判定**只有一处定义**（`src/host/lifecycle.ts`），其余文件 import 复用；死枚举 `defer`/`wont_fix` 消失；每条 review 的决策以 append-only 数组承载，旧文件读入自动补齐。对用户可见行为**不变**（本 ticket 不动状态机语义，只统一来源与数据结构）。

## 交付目标

- `src/host/lifecycle.ts` 导出 `STATUSES`、`OPEN_STATUSES`、`TERMINAL_STATUSES`、`isOpen`、`isTerminal`、`canTransition`、`assertTransition`、`decisionTypeFor`（保持现有迁移表语义不变）。
- `src/protocol.ts` 的 `OPEN_STATUSES`/`TERMINAL_STATUSES` 改为从 lifecycle re-export 或删除；client `ReviewList.VIEW_STATUS`、`ReviewDetail.PLAIN_ACTIONS`、`review-files.asStatus` 白名单**引用同一来源**（保持当前 10 态语义，收敛在 02 做）。
- `ReviewDecision.type` 删除 `'defer' | 'wont_fix'` → `'accept' | 'reject' | 'duplicate'`。
- `ReviewRecord` 新增 `decisions: ReviewDecision[]`；`decision` 保留为「最新一条」。读旧文件（`review-files.ts`）时若无 `decisions` 则由 `decision` 补 `[decision]`（或空数组）。写入时两者同步。
- 引入轻量 test runner：`node:test`（配合 `tsx` 或对 `lib` 产物），加 `package.json` `test` 脚本。

## 单测（本 ticket 必须新增并全绿）

- `decisionTypeFor`：accept/reject/duplicate 有产出，其余返回 null。
- decision 单值 → `decisions[]` 迁移函数：有 decision→`[decision]`；无→`[]`；已有 decisions→不变。
- `canTransition`：抽样现有合法/非法迁移（语义不变的回归基线）。

## 验收标准

1. `pnpm typecheck` 通过。
2. `pnpm test` 全绿。
3. grep 全项目：开放/终态状态数组仅一处字面定义，其余为 import/re-export。
4. `ReviewDecision.type` 不含 `defer`/`wont_fix`。
5. 构造一个仅含 `decision` 无 `decisions` 的旧文件样本，读入后 `decisions` 正确补齐。

## Input context for spec-do

- Spec: `.spec-workflow/reviewer-lifecycle-refactor/spec.md`（§10 数据模型、§18 实现决策、§20/21 测试）
- 本 ticket: `.spec-workflow/reviewer-lifecycle-refactor/issues/01-data-cleanup-single-source.md`
- 相关模块: `src/host/lifecycle.ts`、`src/protocol.ts`、`src/host/review-files.ts`、`src/host/review-store.ts`、`src/client/ReviewList.tsx`、`src/client/ReviewDetail.tsx`
- 验证: `pnpm typecheck`、`pnpm test`
