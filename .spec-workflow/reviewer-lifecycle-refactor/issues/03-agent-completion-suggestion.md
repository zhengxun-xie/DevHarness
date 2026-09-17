# Ticket 03 — Agent 完成一键建议回连

- Parent spec: `.spec-workflow/reviewer-lifecycle-refactor/spec.md`
- Problem source: 痛点 P2（Agent 完成要手动点、不知点哪个）
- Status: `ready-for-agent`
- Priority: 中高
- Blocks delivery: 是
- Dependencies: 02
- Blocked by: 02
- Can run in parallel: 是（与 04、05 并行）
- Parallel boundary: 仅改 `review-store.ts` 的 turn/end 回连路径、`session-feed` 消费、`ReviewDetail` 顶部提示条；避免与 04 争抢锚点写入路径、与 05 争抢 reopen 逻辑

## What to build（端到端行为）

作为评审人，当 Agent 报告完成（`turn/end` 且 completed）且 review 处于 `implementing` 时，详情顶部出现「Agent 报告完成 · 待验收」提示 + 一键「确认 Agent 完成」按钮，点击后 `implementing→verifying`；不点则状态不变。系统同时回填该 review 的 `related.agentRuns`（sessionId）与 `related.commits`（按 `DevBuddy-Review: <id>` trailer 解析）。

## 交付目标

- `review-store.ts` `onTurnEnd` completed 分支：除现有追加 agent comment 外，若当前状态 `implementing`，写入「完成建议」标记（不改状态，不自动迁移）；回填 `related.agentRuns`（去重）、`related.commits`（trailer 解析，两个时机：回连时 + 可选 git 扫读时）。
- 「完成建议」标记的载体：建议在 thread 追加一条 `kind:system` 条目 或 record 上一个可清除的 pending 标志（实现择一并注释；须能被前端读到、被后续人工确认清除）。
- `ReviewDetail.tsx`：`implementing` 且存在完成建议时，顶部渲染提示条 + 主按钮变为「确认 Agent 完成」→ 调 `/review/transition to=verifying`。
- `locales.ts`：新增 `transition.confirmAgentDone`、完成提示文案。
- Agent 永不自动改状态、永不产 decision（保留现有 `isTerminal` 早退：review 已被人改到终态则不追加建议）。

## 单测（新增）

- trailer 解析函数：从 commit message 提取 `DevBuddy-Review: REV-xxxx`，多条/无/大小写边界。
- 「是否应显示完成建议」的纯判定（输入状态+completed+是否有回连 → boolean）。

## 验收标准

1. typecheck + test 全绿。
2. Agent completed 且 implementing → 详情出现待验收一键；点击后 `verifying`；不点状态不变。
3. `related.agentRuns` 含 sessionId；带 trailer 的 commit 回填 `related.commits`。
4. review 已在终态时 Agent 回连不追加建议、不改状态。

## Input context for spec-do

- Spec §5.1 语义、§9（后端）、§13（复用 transition 路由）、§14（agent 权限）
- 本 ticket: `issues/03-agent-completion-suggestion.md`
- 相关模块: `src/host/review-store.ts`、`src/host/session-feed.ts`、`src/client/ReviewDetail.tsx`、`src/client/locales.ts`
- 验证: `pnpm typecheck`、`pnpm test`、手动会话回连
