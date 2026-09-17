# Ticket 02 — 状态收敛 8 态 + 读时归一化 + 视图分组

- Parent spec: `.spec-workflow/reviewer-lifecycle-refactor/spec.md`
- Problem source: 痛点 P1 + 缺陷 E4 + E5
- Status: `ready-for-agent`
- Priority: 高
- Blocks delivery: 是
- Dependencies: 01
- Blocked by: 01
- Can run in parallel: 否（03/04/05 依赖本 ticket 的目标状态机）
- Parallel boundary: 完成后 03/04/05 可并行

## What to build（端到端行为）

作为评审人，改动后只看到 8 个状态：讨论不再触发 `open↔discussing` 跳动；Send to Agent 从 open 出发时间线不再出现我没点过的 `accepted` 条目；`implemented` 与 `verifying` 合并为「待验收」；旧 review 文件读入自动归一化显示，不报错。列表四视图与状态一一对应。

## 交付目标

- `lifecycle.ts`：`ALLOWED` 重写为 spec §5.2 目标迁移表；写入态收敛为 `open/accepted/implementing/verifying/needs_review/resolved/rejected/duplicated`。
- `ReviewStatus` 类型删除 `discussing`/`implemented`（写入面）；`asStatus` 读白名单保留识别并归一化 `discussing→open`、`implemented→verifying`。
- `review-store.ts`：
  - 删除 `appendReview` 里首条回复自动 `open→discussing`。
  - `markAgentDispatched`：`open→implementing` 只写一条 accept decision + 一条 `open→implementing` status（不落独立 `accepted` status 条目）；`accepted→implementing` 不变。
- `ReviewList.VIEW_STATUS`：`open:[open]`、`inProgress:[accepted,implementing]`、`verify:[verifying,needs_review]`、`closed:[resolved,rejected,duplicated]`。
- `ReviewDetail.PLAIN_ACTIONS`：重写为 8 态；删除 `discussing`/`implemented` 分支；修正 `markImplemented`/`failVerification` 语义错位（`implementing→verifying` 用独立 key）。
- `statusText()` 渲染旧历史条目按归一化映射显示。
- `locales.ts` 文案同步。

## 单测（新增/更新）

- `canTransition/assertTransition`：目标迁移表逐条合法/非法（覆盖 §5.2 全表 + 若干非法边如 `verifying→open` 仅经讨论回退合法性）。
- `asStatus`：`discussing→open`、`implemented→verifying`、未知→open、正常 8 态不变。

## 验收标准

1. typecheck + test 全绿。
2. 首条回复不产生任何 status 迁移。
3. 从 open Send to Agent 后，thread 只有 1 条 accept decision，无独立 `accepted` status 条目，最终状态 `implementing`。
4. 构造含 `discussing`/`implemented` 的旧文件，列表/详情正确归一化显示。
5. 四视图分组与 spec §8 一致。

## Input context for spec-do

- Spec §5（状态机）、§8/§9、§11（归一化）
- 本 ticket: `issues/02-status-convergence-normalization.md`
- 相关模块: `lifecycle.ts`、`protocol.ts`、`review-files.ts`、`review-store.ts`、`client/ReviewList.tsx`、`client/ReviewDetail.tsx`、`client/locales.ts`
- 验证: `pnpm typecheck`、`pnpm test`、手动点击核对
