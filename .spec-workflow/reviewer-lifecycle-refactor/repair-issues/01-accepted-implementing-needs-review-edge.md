# Repair Ticket 01 — `accepted`/`implementing` 补 `needs_review` 出边 + triage 写入静默降级

- Parent spec: `.spec-workflow/reviewer-lifecycle-refactor/repair-spec.md`（第 1 轮）
- Problem source: 终审 `DR-001`（blocker）— `review-report.md` / `review-reports/01-lifecycle-refactor-first-pass.md`
- Status: `done`
- Priority: blocker（先修）
- Blocks delivery: 是
- Dependencies: t01–t05 已合并实现（`8f900d1`）
- Blocked by: 无
- Can run in parallel: 否（与 ticket 02 串行：同改 `src/host/review-store.ts`）
- Parallel boundary: 本 ticket 独占 `lifecycle.ts`/`review-store.ts`/`lifecycle.test.ts`/`review-store.reopen.test.ts`

## What to build（端到端行为）

`accepted`/`implementing` 的 review 锚点 `orphaned` 时，**和 `open`/`verifying` 一样**自动一次写入 `needs_review`，写入失败（sha 冲突或任何迁移异常）都**静默跳过**，绝不再让 `getReview`/`getDocument` 抛 409；`needs_review` 期间文档恢复可定位仍不自动退出；人工重绑仍退回 accept/implementing/open/verifying 的原状态。

## What to fix（改哪里）

1. `src/host/lifecycle.ts` `ALLOWED`：
   - `accepted: ['implementing', 'open']` → 追加 `'needs_review'`
   - `implementing: ['verifying', 'accepted', 'open']` → 追加 `'needs_review'`
   - 注释同步：与 `open`/`verifying` 同款「锚点 orphaned 自动进入（§12）」。
2. `src/host/review-store.ts` `applyAnchorTriage()`：包一层失败降级——分流写（进入 `needs_review` 或节点 system 条目）抛任何异常（含 `IllegalTransitionError` / 非 sha 冲突）时不向 `getReview`/`getDocument` 冒泡，返回现状 `parsed.record`；sha 冲突路径保留既有静默跳过语义（spec §12/§16）。
3. 测试：
   - `src/host/lifecycle.test.ts` 合法边矩阵补 `accepted→needs_review`、`implementing→needs_review`；对应非法矩阵不变（终态出边仍仅 `→ open`）。
   - `src/host/review-store.reopen.test.ts`（**沿用既有文件，不新建**，以免漏加 `package.json` 的 `test` 列表）新增：
     - accepted + orphaned → `needs_review`（此前抛 `illegal transition` 的反向回归）
     - implementing + orphaned → `needs_review`
     - accepted/implementing + orphaned → 重绑后退回原状态
     - triage 写入失败静默跳过（可用一个会非法迁移的 mock 或直接断言读路径不抛）

## Forbidden scope

- 不改 `src/client/**`、`src/protocol.ts`、路由、`package.json`、`lib/**` 产物。
- 不动 `open`/`verifying` 的既有 triage 行为与「终态恒 none」「needs_review 抖动防护」。
- 不做新状态名、不动 `ALLOWED` 其余行、不动「终态出边仅 `→ open`」。

## Acceptance criteria

1. `pnpm typecheck`、`pnpm test`、`pnpm build` 全绿。
2. `node --test .spec-workflow/reviewer-lifecycle-refactor/verification/dr-001-repro.test.ts` 由「10 pass / 2 fail」变 **12 pass / 0 fail**。
3. `accepted`/`implementing` 状态下破坏文档使锚点无法定位 → 详情/文档读都返回成功且状态为 `needs_review`（手动抽查）。
4. 未新增状态名，未扩 `ALLOWED` 其它行。

## Input context for spec-do

- 权威修复方案：`.spec-workflow/reviewer-lifecycle-refactor/repair-spec.md` §5 根因 A
- 本 ticket：`repair-issues/01-accepted-implementing-needs-review-edge.md`
- 复现脚本（必须跑）：`.spec-workflow/reviewer-lifecycle-refactor/verification/dr-001-repro.test.ts`
- 相关模块：`src/host/lifecycle.ts`、`src/host/review-store.ts`（`applyAnchorTriage`）、`src/host/lifecycle.test.ts`、`src/host/review-store.reopen.test.ts`、`src/host/anchor-triage.ts`
- 验证：上述 4 条命令

## 完成记录（repair pass 01）

- 实现：`src/host/lifecycle.ts` `ALLOWED.accepted/implementing` 各加 `needs_review`；`src/host/review-store.ts` `applyAnchorTriage()` 改为「先复制记录 → 失败即返回原记录」，`assertTransition` 与 `writeWithSlug` 失败均降级为「本次不分流」，不再向读路径抛错。
- 测试：`lifecycle.test.ts` 合法边补 2 条；`review-store.reopen.test.ts` 新增 3 条（accepted/implementing 自动进入、重绑退回原状态、triage 只写一次不重复）。
- 验证：`pnpm typecheck` ✅；`pnpm test` **43/43** ✅；`pnpm build` ✅；`verification/dr-001-repro.test.ts` **12/12** ✅（修复前为 10/12，两条 DR-001 复现已转 ✔；两条「记录旧缺陷」的负向用例已改写为修复后预期）。
- 报告：`.spec-workflow/reviewer-lifecycle-refactor/implementation-reports/01-repair-dr-001-dr-002.md`
