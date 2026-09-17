# Ticket 04 — 锚点失效自动分流

- Parent spec: `.spec-workflow/reviewer-lifecycle-refactor/spec.md`
- Problem source: 痛点 P3（锚点失效提示打扰）
- Status: `ready-for-agent`
- Priority: 中高
- Blocks delivery: 是
- Dependencies: 02
- Blocked by: 02
- Can run in parallel: 是（与 03、05 并行）
- Parallel boundary: 仅改锚点分流写入路径（读路径 + 一次状态写）、`needs_review` 进出逻辑；避免与 03 的 turn/end 回连、05 的 reopen 争抢

## What to build（端到端行为）

作为评审人，文档改动后：锚点只要还能定位（moved/modified/outdated）就静默跟随位置，最多在时间线留一条 system 记录/列表轻徽标，不打扰我；只有彻底定位不了（orphaned）时系统自动把 review 标为 `needs_review` 并提示我；我重新选中文档片段重绑锚点后，review 自动退回进入前的原状态。

## 交付目标

- 在读路径（`getReview`/`getDocument`/列表扫描）消费 `resolveAnchor`：
  - `moved`：静默更新 `positional`。
  - `modified`：静默更新位置 + 追加一条 `kind:system` 条目。
  - `outdated`：同上 + 列表轻量徽标字段。
  - `orphaned` 且当前为非终态、非 `needs_review`：**自动写入 `→ needs_review`**（幂等：带 `expectedSha`，冲突静默跳过，下次读再试）。
- 记录「进入 needs_review 前的原状态」（record 字段或从最近 `kind:status` 反推），供自动退出。
- 人工重绑锚点（重新选中片段并更新 `target`）后：若当前 `needs_review`，自动 `→ 原状态`，记 `kind:status`。
- 抖动防护：`needs_review` 期间文档非人工恢复可定位，不自动退出（仅人工重绑触发），代码注释说明。
- 更新 `design/06-lifecycle.md` §3 原则为「除 orphaned 外不自动改状态」。

## 单测（新增）

- 分流决策纯函数：输入 `AnchorResolution.state` + 当前 review 状态 → 目标动作（none / silent-update / system-note / auto-needs-review）。
- 「进入前原状态」记录/还原逻辑。

## 验收标准

1. typecheck + test 全绿。
2. moved/modified/outdated：状态不变、位置跟随；modified/outdated 有 system 痕迹/徽标。
3. orphaned：自动进入 `needs_review`（一次写入，重复读不重复写）。
4. 人工重绑后自动退回原状态。
5. 终态 review 不被锚点自动改状态。

## Input context for spec-do

- Spec §12（分流表）、§15（性能/幂等）、§17（边界）
- 本 ticket: `issues/04-anchor-auto-triage.md`
- 相关模块: `src/host/anchors.ts`（不改算法，只消费）、`src/host/review-store.ts`、`src/host/review-files.ts`、`src/client/ReviewDetail.tsx`/`ReviewList.tsx`（徽标）、`design/06-lifecycle.md`
- 验证: `pnpm typecheck`、`pnpm test`、手动改文档
