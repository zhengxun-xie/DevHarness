# Review Pass 02 — 修复后复核（DR-001 / DR-002，append-only）

> 权威汇总见同目录 `review-report.md`。本轮为 Goal Mode 预留修复轮 1 的**复核评审**。
> 评审范围：repair pass 01 的 diff `8f900d1..6378faa`（host-only，5 文件 +139/−18），复核两条 must-fix 是否真正关闭，并检查是否引入新问题。

## 1. 复核范围与基线

- 目标：`repair-spec.md` / `repair-issues/01`（DR-001）、`repair-issues/02`（DR-002）声明的修复是否兑现，且未产生越界改动。
- diff 边界：`git diff --stat 8f900d1..6378faa -- ImplementSpace/dsh_reviewerSidebar`
  → `design/06-lifecycle.md`(11) · `src/host/lifecycle.test.ts`(2) · `src/host/lifecycle.ts`(4) · `src/host/review-store.reopen.test.ts`(+92) · `src/host/review-store.ts`(48)
- **无客户端改动**（`src/client/**` 零变更）→ 本轮不涉及前端行为，前端的真实交互验证不构成本轮 must-fix（整体残余风险另计，见 §5）。
- 协调结构：本地评审（无子代理；pass 01 已记录子代理瞬断不可用）。
- 评审阶段只读：未修改生产代码/测试/配置/产物；本 pass 只追加报告、更新 `implementation-report.md` 的 Goal Mode 运行态字段。

## 2. must-fix 复核

### DR-001（blocker）→ ✅ 已关闭
- 修复：`ALLOWED.accepted` / `ALLOWED.implementing` 各补 `needs_review`（`lifecycle.ts:70,73`）；`applyAnchorTriage()` 改为在**记录副本**上变更，`assertTransition` 或 `writeWithSlug` 失败即返回未修改的原记录。
- 验证证据：
  - `verification/dr-001-repro-after-repair.log`：**12/12 通过**。修复前同一脚本为 10 pass / 2 fail（`accepted→needs_review`、`implementing→needs_review` 抛 `IllegalTransitionError`）。
  - 其中 `DR-001 impact fixed: getDocument triages an accepted review with an orphaned anchor` 证明**文档视图不再 409**，而是正常返回并显示 `needs_review`。
  - 新增 store 级回归：accepted/implementing 自动进入（含线程 `kind:status` 条目 from/to 断言）、重绑退回原状态、triage 只写一次（幂等）。
- 结论：与 spec §5.2 / §12 / §19 验收 5 一致。

### DR-002（major）→ ✅ 已关闭
- 修复：`transitionReview()` 增加 `from === 'verifying' && to === 'implementing'` 时 `reason` 必填（`ValidationError` → 400，文案 `reason is required when failing verification`）。
- 验证证据：`review-store.reopen.test.ts` 新增用例——无 reason 被拒且状态保持 `verifying`（不半改）；带 reason 成功且 reason 落到末条 `kind:status` 的 `body`；`verification/dr-001-repro.test.ts` 的 `DR-002 fixed` 用例断言拒绝。
- 结论：与 spec §5.2 表「verifying | implementing | 验收打回，`reason` 非空」一致；客户端弹窗必填保留为双层校验，无冲突。

## 3. 新引入问题检查（Standards / Spec / Scope）

- **Spec**：改动严格落在 repair-spec §5 两个根因；无新增行为、无新状态名、`ALLOWED` 其余行未动；`needs_review` 出向与终态出边保持原样。测试矩阵同步（合法边 +2），未放宽非法边断言。
- **Standards**：triage 的副本式降级复用同文件既有「sha 冲突静默跳过」模式；异常边界只用 try/catch 且注释说明依据；无不可擦除语法；无新坏味道。新增测试命名与既有矩阵风格一致。
- **Scope**：`design/06-lifecycle.md` 的三处同步（§1 mermaid 两条边、§2 合并行、§7 遗留旧状态名与视图分组）属修复所需文档一致性，且修复工单明确允许；未动 `src/client/**`、`src/protocol.ts`、路由、`package.json` 与产物。
- 未发现新增 must-fix，未发现需要新业务决策的缺口。

## 4. 回归与整体验证

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | ✅ 无错误 |
| `pnpm test` | ✅ **43/43**（pass 01 基线 39 条全过 + 新增 4 条修复回归，无既有用例被改坏） |
| `pnpm build` | ✅ host ESM + client CJS 均重建 |
| `node --test verification/dr-001-repro.test.ts` | ✅ **12/12** |

证据文件：`verification/repair-01-verify.log`、`verification/dr-001-repro-after-repair.log`、`verification/dr-001-repro-node-test.log`（修复前基线）。

## 5. 残余风险（不构成本轮 must-fix）

1. **前端真实浏览器交互未验证**（本机缺 playwright 库、评审期不允许改 lockfile、插件需注入 DSH 运行时）——一直未关闭；本轮 diff 无前端改动，故不阻塞本轮。
2. **插件运行时未重启冒烟**：`lib/index.js` / `lib/client.js` 已重建，但未在真实 DSH 进程内做 loopback 路由冒烟（评审/g修复阶段均未重启共享进程）。
3. **延后项**：DR-003（spec §12「列表扫描」文案与实现差异，建议改文案）、DR-004（`REMOVABLE` 两份硬编码 → 提升 `protocol.ts`）、DR-005（`markAgentDispatched` 注释可达性）。
4. **triage 静默降级的副作用**：未来若再缺边，故障会表现为「不再自动分流」而非报错——由本次覆盖 4 个非终态的测试矩阵兜底。

## 6. 结论

- Completion: **complete**（针对本 spec 与 repair pass 01 的修复范围）
- Ship Decision: **can ship**
- Goal Mode：预留修复轮 1 → **完成**；剩余预算 2 → **1**；目标（全部 ticket + typecheck/单测通过 + do-review 无 must-fix）**已满足**，自动循环停止。
- 建议后续（非阻塞）：安排一次真实浏览器点击验收（Reopen 弹窗、主/次按钮、锚点漂移徽标、重绑流程），并做一次插件运行时冒烟。
