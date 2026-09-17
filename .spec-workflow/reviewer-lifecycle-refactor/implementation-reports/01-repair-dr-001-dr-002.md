# Implementation Pass 01 — Repair DR-001 / DR-002（append-only）

> 权威汇总见 `implementation-report.md`；本文件是第 1 轮修复实现的只追加记录。

## 元数据

- Authority: `local-spec-workflow`
- 修复依据：`repair-spec.md`、`repair-specs/01-dr-001-dr-002-anchor-triage-and-reason.md`、`repair-issues/01`、`repair-issues/02`；源评审 `review-reports/01-lifecycle-refactor-first-pass.md`
- Goal Mode：启用（spec.md 元数据，max 2 轮）；**当前轮 1/2（do-review 预留，本 pass 实现）**；spec-do 不扣减预算——由修复后的 do-review 复核时记完成并扣减
- 实现 fixed point：`8f900d1`（t05，do-review 评审点）；本轮 diff = `8f900d1..HEAD`
- 协调结构：**本地串行单 agent**（两张 ticket 同改 `review-store.ts`，串行避免冲突；未启用子代理）
- Auto-commit：不自动（spec Goal Mode 元数据约定；提交由人/默认流程确认——本会话按此前每 ticket 提交的既有约定执行）

## 基线检查

- branch：master；进入前工作树：干净（`8f900d1` 提交后状态）。
- 新增未分类脏文件：仅 `.spec-workflow/` 工作流产出（review-report、review-reports、repair-spec、repair-issues、verification），与 do-review/fix-review 所需件一致，不是未知漂移。

## 实现 DAG 与实际执行

| 任务 | 范围 | 执行 | 结果 |
| --- | --- | --- | --- |
| R1 DR-001：迁移表补边 + triage 降级 | `lifecycle.ts`、`review-store.ts` | 串行第 1 步 | ✅ |
| R2 DR-002：host reason 断言 | `review-store.ts` | 串行第 2 步 | ✅ |
| R3 测试矩阵 + store 级回归 | `lifecycle.test.ts`、`review-store.reopen.test.ts`（沿用既有文件未新建） | 同步 | ✅ |
| R4 文档同步 | `design/06-lifecycle.md`（§1 mermaid、§2 表、§7 遗留旧状态名/视图分组） | 同步 | ✅ |
| R5 集成检查 + 复现脚本 | 四命令 + dr-001-repro 12 用例 | 收口 | ✅ |

## 实现内容

1. `src/host/lifecycle.ts`：`ALLOWED.accepted` / `ALLOWED.implementing` 各补 `'needs_review'`（spec §5.2）。
2. `src/host/review-store.ts`：
   - `applyAnchorTriage()`：改为在**记录副本**上做 triage 变更；`assertTransition` 或 `writeWithSlug` 任一步失败 → 返回**未修改的原记录**（本次不分流、读路径成功、下次读重试）。杜绝「读路径被写入失败炸掉」与「半写状态透传给调用方」。
   - `transitionReview()`：`from === 'verifying' && to === 'implementing'` 且 `reason` 为空 → `ValidationError('reason is required when failing verification')`（400），与 reject/Reopen 同款式。
3. 测试：
   - `lifecycle.test.ts`：合法矩阵补 `accepted→needs_review`、`implementing→needs_review`。
   - `review-store.reopen.test.ts`：新增 4 条——accepted/implementing + orphaned 自动进入、重绑退回原状态、triage 幂等只写一次、host 侧 reason 断言（无 reason 拒绝且不半改；带 reason 成功且落入线程条目）。
4. `verification/dr-001-repro.test.ts`：两条「记录旧缺陷」的负向用例改写为修复后正向预期（getDocument 不再抛、reasonless 被拒绝）；其余用例不变。
5. `design/06-lifecycle.md`：§1 mermaid 补两条边、§2 表改为「open/accepted/implementing/verifying | needs_review」并删除被覆盖的 verifying 行、`verifying→implementing` 补 host 侧 reason 必填、§7 修正遗留的旧状态名（`discussing`/`implemented`）与视图分组（对齐 spec §8 已在客户端落地的分组）。

## 验证

- `pnpm typecheck` ✅
- `pnpm test` **43/43** ✅（基线 39 → +4 修复回归用例）
- `pnpm build`（host ESM + client CJS 均重建）✅
- `node --test verification/dr-001-repro.test.ts` **12/12** ✅（修复前 10 pass / **2 fail**，两条 DR-001 复现已转 ✔）
- 证据：`verification/repair-01-verify.log`、`verification/dr-001-repro-after-repair.log`

## 自建评审（内置，非 do-review 替代）

- Standards：新代码无不可擦除语法；triage 的副本式降级与既有「sha 冲突静默跳过」语义一致；无新坏味道（沿用同文件同模式的 try/catch 边界）。
- Spec：改动只在 repair-spec §5 两个根因内；无越界新增（未动 client/协议/路由/产物）。
- Scope：无未落实的 must-fix 项；延后项 DR-003/DR-004/DR-005 与「前端真实交互未验证、插件运行时未重启冒烟」按计划不属本轮。

## 移交

- 修复工单：`repair-issues/01`、`02` → `done`（附完成记录）。
- 剩余风险：前端真实浏览器交互仍未验证（评审阶段阻塞原因未变）；triage 静默降级会把「未来再发生的缺边类错误**藏**起来」——缓解由本次全矩阵测试承担（4 个非终态全覆盖，缺边会由测试而非线上暴露）。
- 下一自动阶段（Goal Mode）：`do-review` 复核本轮修复（复核通过后把账本「预留第 1 轮」记为完成并把剩余预算从 1 扣为 0）。
- commit：按本会话每 ticket 提交的既有约定执行，hash 记录在 `implementation-report.md`。
