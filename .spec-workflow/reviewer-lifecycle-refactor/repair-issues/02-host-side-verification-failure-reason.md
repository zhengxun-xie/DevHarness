# Repair Ticket 02 — host 侧补 `verifying→implementing` reason 非空断言

- Parent spec: `.spec-workflow/reviewer-lifecycle-refactor/repair-spec.md`（第 1 轮）
- Problem source: 终审 `DR-002`（major）— `review-report.md` / `review-reports/01-lifecycle-refactor-first-pass.md`
- Status: `done`
- Priority: major（ticket 01 后修）
- Blocks delivery: 是
- Dependencies: ticket 01（串行）
- Blocked by: `repair-issues/01-accepted-implementing-needs-review-edge.md`（同改 `src/host/review-store.ts`）
- Can run in parallel: 否
- Parallel boundary: 本 ticket 独占 `review-store.ts` 校验段 + `review-store.reopen.test.ts`

## What to build（端到端行为）

`verifying → implementing`（验收打回）这条迁移在 host 侧与 `rejected`/Reopen 同等严格：`reason` 为空 → 400 `ValidationError`，带 reason → 成功且该 reason 落到同一条 `kind:status` 线程条目的 `body`。

## What to fix（改哪里）

1. `src/host/review-store.ts` `transitionReview()` 的条件校验段（紧邻 Reopen 断言），加：
   ```ts
   if (from === 'verifying' && to === 'implementing' && (input.reason ?? '').trim() === '') {
     throw new ValidationError('reason is required when failing verification')
   }
   ```
   保持与 Reopen/rejected 断言同款式、同 `ValidationError`。
2. 测试：`src/host/review-store.reopen.test.ts` 补两条 host 侧断言（`from verifying to implementing` 无 reason → `assert.rejects(..., ValidationError)`；带 reason → 成功且 thread 末条 `body === reason`）。客户端 `TransitionDialog('failVerify')` 的必填保留不动。
3. 文档（可选）：`design/06-lifecycle.md` §2 迁移表 `verifying→implementing` 一行若已有「线程记录原因」，只需保持不动（理想是无需改）。

## Forbidden scope

- 不改 `src/client/**`（弹窗已经是必填）、`src/protocol.ts`、路由、`package.json`。
- 不动 reject/Reopen 的既有断言语义、不动决策/历史/resolvedAt 逻辑。
- 不引入自定义错误类型（复用 `ValidationError`，走 400 既有映射）。

## Acceptance criteria

1. `pnpm typecheck`、`pnpm test`、`pnpm build` 全绿。
2. host 直连 `transitionReview({ from: verifying -> implementing, reason: '' })` 返回 `ValidationError`（400）。
3. 带 reason 的打回成功，且同一条 `kind:status` 条目的 `body` 记录该 reason。
4. 复现脚本 `verification/dr-001-repro.test.ts` 依旧 12/12 通过（不存在 DR-001 回归）。

## Input context for spec-do

- 权威修复方案：`.spec-workflow/reviewer-lifecycle-refactor/repair-spec.md` §5 根因 B
- 本 ticket：`repair-issues/02-host-side-verification-failure-reason.md`
- 相关模块：`src/host/review-store.ts`（`transitionReview`）、`src/host/review-store.reopen.test.ts`、`src/host/lifecycle.ts`（无需改）
- 验证：上述 4 条

## 完成记录（repair pass 01）

- 实现：`src/host/review-store.ts` `transitionReview()` 在 Reopen 断言旁新增 `from === 'verifying' && to === 'implementing'` 时 reason 必填 → `ValidationError('reason is required when failing verification')`（400）。
- 测试：`review-store.reopen.test.ts` 新增 1 条（无 reason 拒绝且状态不半改；带 reason 成功且 reason 落到 `kind:status` 条目 body）。
- 验证：`pnpm typecheck` ✅；`pnpm test` **43/43** ✅；`pnpm build` ✅；`verification/dr-001-repro.test.ts` 12/12 ✅。
- 报告：`.spec-workflow/reviewer-lifecycle-refactor/implementation-reports/01-repair-dr-001-dr-002.md`
