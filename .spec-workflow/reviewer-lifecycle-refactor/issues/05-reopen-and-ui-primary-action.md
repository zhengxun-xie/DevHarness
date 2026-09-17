# Ticket 05 — Reopen + UI 主次分明

- Parent spec: `.spec-workflow/reviewer-lifecycle-refactor/spec.md`
- Problem source: 痛点 P4（终态无法复活）+ UI 平铺 6 按钮无主次
- Status: `ready-for-agent`
- Priority: 中
- Blocks delivery: 是
- Dependencies: 02
- Blocked by: 02
- Can run in parallel: 是（与 03、04 并行）
- Parallel boundary: 改 reopen 校验（review-store/lifecycle 终态出边）+ TransitionDialog + ReviewDetail 按钮布局；避免与 03/04 争抢 turn/end、锚点写入路径

## What to build（端到端行为）

作为评审人，我能把 resolved/rejected/duplicated 的 review Reopen 回 open（填 reason），原讨论与 decisions 历史完整保留、`resolvedAt` 清空；`critical` 的 Reopen 与 Resolve 都只有人能执行、agent 触发被拒。每个状态只暴露一个醒目的主按钮，其余操作收进次级区，降低误点。

## 交付目标

- `lifecycle.ts`：终态 → `open` 出边放开（Reopen 专用校验路径）。
- `review-store.ts`：Reopen 逻辑（复用 `transitionReview` 的 `to='open'` from 终态分支或独立 `reopenReview`）：reason 必填；`critical` 且 author=agent 拒绝；清 `resolvedAt`；追加 `kind:status`；保留 `decisions[]` 与 thread；`duplicated` 保留 `duplicatedOf` 但解锁迁移。
- 终态 review 在 Reopen 后恢复 append/edit 可写（现有终态只读判定需让 Reopen 后的 open 正常可写——本就是 open，天然满足）。
- `TransitionDialog.tsx`：新增 `reopen` kind（reason 必填）。
- `ReviewDetail.tsx`：每状态单主按钮（`dbr-primary`）+ 次级收纳（更多菜单/次级区）；终态展示 Reopen 主按钮。按 spec §8 主/次表实现。
- `locales.ts`：`transition.reopen` 等文案。
- 更新 `design/06-lifecycle.md`（终态可 Reopen）与 `design/06b-lifecycle-current-analysis.md`（标注已落地）。

## 单测（新增）

- Reopen 校验：终态→open 需 reason；critical+agent 拒绝；非终态→open 走普通讨论回退不误判为 reopen。
- Reopen 后 `decisions[]`/thread 未丢失、`resolvedAt` 清空。

## 验收标准

1. typecheck + test 全绿。
2. 三个终态均可 Reopen 回 open，reason 必填，历史保留，`resolvedAt` 清空。
3. `critical` Reopen/Resolve 由 agent 触发被拒（host 校验）。
4. 每个状态详情底部只有一个主按钮，其余在次级区；terminal 显示 Reopen。
5. `design/06*` 文档同步更新。

## Input context for spec-do

- Spec §5.2（终态→open）、§6（Reopen）等价条款、§9/§13/§14、§8（UI 主次表）
- 本 ticket: `issues/05-reopen-and-ui-primary-action.md`
- 相关模块: `src/host/lifecycle.ts`、`src/host/review-store.ts`、`src/client/TransitionDialog.tsx`、`src/client/ReviewDetail.tsx`、`src/client/locales.ts`、`design/06-lifecycle.md`、`design/06b-lifecycle-current-analysis.md`
- 验证: `pnpm typecheck`、`pnpm test`、手动 Reopen + 按钮布局核对
