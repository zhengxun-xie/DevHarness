# Repair Spec — Reviewer 状态机重构（第 1 轮修复）

> 权威状态：`Authority: local-spec-workflow`（Goal Mode 元数据在 `spec.md`，`user-confirmed-in-current-conversation`）。
> 本轮只修终审 must-fix，不扩范围。追加式 pass spec：`repair-specs/01-dr-001-dr-002-anchor-triage-and-reason.md`。

## 1. 问题陈述（来自终审 findings）

`review-report.md` / `review-reports/01-lifecycle-refactor-first-pass.md` 报告 2 条 must-fix：

- **DR-001（blocker）**：`accepted`/`implementing` 状态下锚点 `orphaned` 时**无法**自动进入 `needs_review`：`ALLOWED` 缺这两条出边，而 t04 的自动分流写在读路径里直接 `assertTransition` → 抛 `IllegalTransitionError`。后果：详情读（`getReview`）与**整个文档视图读**（`getDocument`）抛 409，该 review 在被修复前不可打开/不可操作；spec §5.2、§12、§19 验收 5 均未达成。
- **DR-002（major）**：spec §5.2 迁移表（host 权威）要求 `verifying → implementing`（验收打回）`reason` 非空，host 侧只在 `rejected` 与 Reopen 上强制，弹窗之外可静默打回、审计理由丢失。

## 2. 修复目标

1. `accepted`/`implementing` 的锚点 `orphaned` 自动分流与 `open`/`verifying` 行为一致：一次带 `expectedSha` 的写入 → `needs_review`，失败静默跳过（不打断读）。
2. 自动分流的**任何**写入失败都不得把错误抛给读路径（防御性：未来再缺边也只降级为「不分流」）。
3. host 侧对 `verifying → implementing` 强制 `reason` 非空（400），与 `rejected`/Reopen 同款。
4. 把 DR-001 的复现用例固化进常规测试，防止回归。

## 3. 非目标

- 不引入新状态名、不改 8 态集合、不改迁移表其余行。
- 不改 UI 主/次按钮布局、不动 Reopen 语义、不动 trailer 回填与回连建议。
- 不修 DR-003（spec §12 文案与实现的「列表扫描」表述差异）、DR-004（可删除状态集两份硬编码）、DR-005（注释可达性）→ 见 §10 延后项。
- 不动客户端文案与样式。

## 4. 修复前后的用户可见行为

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| `open` + 文档改动致锚点 orphaned | 自动 `needs_review` | 不变 |
| `accepted`/`implementing` + 锚点 orphaned | **详情/文档视图报错（409），无法操作** | 自动进入 `needs_review`，列表显示漂移徽标，详情给出「重新定位锚点」主操作 |
| 在 `needs_review` 重绑锚点 | 退回进入前状态 | 不变（`accepted`/`implementing` 现在真能到达该流程） |
| `verifying` 无 reason 打回（弹窗） | 弹窗拦截 | 不变（客户端必填保留） |
| `verifying` 无 reason 打回（直连 API） | **成功** | 400 拒绝，错误信息与 reject/Reopen 同款式 |

## 5. 修复方案（按根因）

### 根因 A（DR-001）—— 迁移表漏边 + 读路径内写失败逃逸
- `src/host/lifecycle.ts`：`ALLOWED.accepted` 加 `'needs_review'`；`ALLOWED.implementing` 加 `'needs_review'`。语义与 `open`/`verifying` 一致（spec §5.2 图与 §12 表）。
- `src/host/review-store.ts` `applyAnchorTriage()`：分流写入（进入 `needs_review` 的那次状态写）失败时**静默跳过并保留现状**，不再让异常穿透 `getReview`/`getDocument`；与既有「sha 冲突静默跳过、下次读重试」（spec §12/§16）同一处理口径。
- 注意保留既有约束：终态恒不自动进入、`needs_review` 期间不自动退出（抖动防护）、写入前 `expectedSha` 复核、仅在真的写入时重算 resolution。

### 根因 B（DR-002）—— host 侧缺 reason 断言
- `src/host/review-store.ts` `transitionReview()`：在 `to === 'rejected'` 与 Reopen 的断言旁，补 `from === 'verifying' && to === 'implementing'` 时 `reason` 必填 → `ValidationError('reason is required when failing verification')`（400）。
- 不改客户端（`TransitionDialog('failVerify')` 已有必填），保持双层校验一致。

## 6. 前端改动

Not applicable —— 本修复只涉及 host 迁移表、host 校验与 triage 写入路径；客户端已按目标 8 态渲染，`needs_review` 的主操作（重绑）与次级（Reject/Duplicate）在 t04/t05 已就位。

## 7. 后端改动

- `src/host/lifecycle.ts`：`ALLOWED` 两条出边。
- `src/host/review-store.ts`：`applyAnchorTriage()` 写入失败降级；`transitionReview()` 补 reason 断言。
- 无新增/删除路由；`routes.ts` 错误映射复用（`ValidationError → 400`）。

## 8. API 契约变更

Not applicable —— 无请求/响应结构变化。仅收紧既有契约：`POST /review/transition` 在 `verifying → implementing` 缺 `reason` 时由「成功」变为 `400`（与 spec §5.2 一致，属修复偏离而非新增契约）。

## 9. 数据模型 / 权限 / 错误处理

- 数据模型：Not applicable（无字段变更；`needs_review` 进入前状态仍由 t04 的 `preNeedsReviewStatus()` 从最近 `kind:status` 反推）。
- 权限：Not applicable（不涉及 author 门禁）。
- 错误处理：`verifying → implementing` 缺 reason → 400；triage 写入失败 → 静默跳过（不新增错误码）。

## 10. 边界与回归场景（修复必须同时成立）

1. `accepted` + orphaned → `needs_review`（新增，先前抛错）。
2. `implementing` + orphaned → `needs_review`（新增，先前抛错）。
3. `open`/`verifying` + orphaned → `needs_review`（回归，不得退化）。
4. 终态 + orphaned → 恒不动（回归）。
5. `needs_review` 期间文档恢复可定位 → 不自动退出（抖动防护，回归）。
6. `needs_review` 重绑 → 退回 `accepted`/`implementing`/`open`/`verifying` 原状态（回归 + 新增 accepted/implementing 版）。
7. triage 写入遇 sha 冲突 → 静默跳过，读仍成功返回（回归）。
8. `verifying → implementing` 带 reason → 成功且 reason 落 thread；不带 → 400（新增）。
9. `rejected`/Reopen 缺 reason → 400（回归）。

## 11. 验收标准

1. `pnpm typecheck` 通过。
2. `pnpm test` 全绿，且**新增**：`lifecycle.test.ts` 合法边矩阵含 `accepted→needs_review`、`implementing→needs_review`；store 级测试覆盖「accepted/implementing + orphaned → needs_review」与「重绑后退回原状态」；host 侧 reason 断言测试（`verifying→implementing` 无 reason 抛 `ValidationError`）。
3. `verification/dr-001-repro.test.ts` 中两条 `DR-001 repro` 用例由 ✖ 变 ✔（同一脚本、同一命令）。
4. `pnpm build` 成功（host ESM + client CJS 均重建）。
5. 修复不得引入新状态名；`git diff` 只触及 §5/§7 列出的文件与测试。

## 12. 测试与验证计划

- 验证 seam（沿用原 spec）：核心纯函数轻量单测 + host 现有 store 级测试 + `pnpm typecheck`（`tsc --noEmit`）。
- 命令：
  - `cd ImplementSpace/dsh_reviewerSidebar && pnpm typecheck`
  - `pnpm test`（`node --test` 显式文件列表；**新增 store 级用例请放入既有 `src/host/review-store.reopen.test.ts`，避免新增文件后漏加 `package.json` 的 `test` 脚本**）
  - `node --test .spec-workflow/reviewer-lifecycle-refactor/verification/dr-001-repro.test.ts`（期望 12/12 通过）
  - `pnpm build`
- 人工抽查：`accepted` 状态的 review，改动文档使其锚点无法定位 → 详情应显示 `needs_review` 与「重新定位锚点」，不报错。

## 13. 测试决策

- 复现即回归：把本次终审写出的 `verification/dr-001-repro.test.ts` 中两条 repro 断言**原样搬进常规测试套件**（不要只依赖 verification 目录里的临时脚本）。
- 不新建测试文件，除非确实需要；若新建，必须同步 `package.json` 的 `test` 文件列表。
- reason 断言用 `assert.rejects(..., ValidationError)` 断言类型与消息，不只断言「抛错」。

## 14. 风险与回滚

- 风险：给 `accepted`/`implementing` 放 `needs_review` 出边后，人工理论上可从这两态手工点进 `needs_review`。当前客户端 UI 未暴露该按钮（`SECONDARY_ACTIONS` 未含），风险可忽略；若未来暴露，属功能而非缺陷。
- 风险：triage 降级为静默跳过会把「边缺失」类错误藏起来。缓解：本次同步用测试矩阵把 4 个非终态全覆盖，缺边会由测试而非线上暴露。
- 回滚：改动仅 2 个 host 文件 + 测试，`git revert` 单次即可；无数据迁移、无产物不兼容。

## 15. 推荐修复顺序

**必须串行**（t01 与 t02 都改 `src/host/review-store.ts`）：

1. `repair-issues/01-accepted-implementing-needs-review-edge.md`（DR-001，blocker）
2. `repair-issues/02-host-side-verification-failure-reason.md`（DR-002，major）
3. 收口：`pnpm typecheck` + `pnpm test` + `verification/dr-001-repro.test.ts` + `pnpm build` → 更新 `implementation-report.md`（记完成第 1 轮、剩余预算 1）→ 提交（不自动提交，按 spec 约定由人确认）

## 16. 下一轮实现执行策略

- 执行方式：**串行单 agent**（两次改动同文件，且总改动量小；并行收益低于冲突风险）。
- 允许改：`src/host/lifecycle.ts`、`src/host/review-store.ts`、`src/host/lifecycle.test.ts`、`src/host/review-store.reopen.test.ts`、`design/06-lifecycle.md`（如需同步文案）。
- 禁止改：`src/client/**`、`src/protocol.ts`、路由契约、`lib/**` 产物（构建命令生成）、`package.json`（除非新增测试文件）、`verification/` 内文件（除本 spec 允许的追加证据）。
- 交接物：修复后的 diff + 测试输出日志 + `implementation-report.md` 本轮记录。
- 集成检查点：每张 ticket 完成即跑 `pnpm test`；两张完成后统一跑完整四命令并核对 `verification/dr-001-repro.test.ts` 12/12。
- 决策门：若修复中发现 `needs_review` 出边会破坏既有抖动防护或终态语义 → 停下汇报，不自行放宽。

## 17. 结论

- must-fix 2 条 → 生成 2 张 repair ticket（01 blocker 先行、02 随之，串行）。
- 延后项（本轮不修，非阻塞）：DR-003（spec §12 文案与实现的「列表扫描」表述差异；建议改文案）、DR-004（`REMOVABLE` 两份硬编码 → 提升 `protocol.ts` 单一来源）、DR-005（`markAgentDispatched` 注释可达性）。
- 残余风险（本轮修复不覆盖）：前端真实浏览器交互未验证；插件运行时未做重启冒烟。
