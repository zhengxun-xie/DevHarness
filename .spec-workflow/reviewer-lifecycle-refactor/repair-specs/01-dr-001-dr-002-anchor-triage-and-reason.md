# Repair Pass 01 — DR-001 锚点分流漏边 + DR-002 host 侧 reason 断言（append-only）

> 权威汇总与最新内容见同目录 `repair-spec.md`；本文件是本轮 repair pass 的只追加快照。

## 元数据

- Authority: `local-spec-workflow`
- 源评审：`review-report.md` + `review-reports/01-lifecycle-refactor-first-pass.md`（Ship Decision: fix before ship）
- 授权锚点：`spec.md` Goal Mode 元数据（enabled for this spec only；max 修复轮 2；不自动提交）
- 运行态：修复轮 **1/2**（do-review pass 01 于 `implementation-report.md` 预留第 1 轮）；写本 spec 时剩余预算按 1 计（本轮完成并复审通过后完成该轮、剩余 1）
- 下一自动阶段：`spec-do`（串行，2 张 repair ticket）
- 发现源 ID：`DR-001`（blocker）、`DR-002`（major）

## 本轮 must-fix

1. **DR-001**：`ALLOWED` 缺 `accepted→needs_review`、`implementing→needs_review` 两条出边；自动分流在读路径写失败时把异常抛给 `getReview`/`getDocument`（详情/文档视图 409）。
2. **DR-002**：host 侧未对 `verifying→implementing` 强制 `reason` 非空（spec §5.2 明文要求；客户端弹窗有，API 层无）。

## 依据链

- 复核证据：`verification/dr-001-repro.test.ts`（终验脚本，12 用例 / 10 通过 2 失败=DR-001 复现）+ `verification/dr-001-repro-node-test.log`。
- 代码锚点：`src/host/lifecycle.ts` `ALLOWED` `accepted`/`implementing` 两行；`src/host/review-store.ts` `applyAnchorTriage()`（`assertTransition` 直抛）与 `transitionReview()` 条件校验段。
- spec 锚点：§5.2 迁移表（orphaned 自动进入 + `verifying→implementing` reason 非空）、§12（分流读路径 + `expectedSha` 静默跳过）、§16（错误处理）、§19 验收 5。

## 后续与延后项

- 已生成本轮 repair ticket：`repair-issues/01-accepted-implementing-needs-review-edge.md`、`02-host-side-verification-failure-reason.md`（串行）。
- 延后（非阻塞）：DR-003（spec §12「列表扫描」文案对齐为「列表层只读消费」）、DR-004（`REMOVABLE` 提到 `protocol.ts`）、DR-005（`markAgentDispatched` 注释可达性）。
