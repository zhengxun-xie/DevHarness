# Spec — Reviewer 状态机重构（Lifecycle Refactor）

## Goal Mode 元数据

- **Goal mode: enabled for this spec only**
- Spec ID: `reviewer-lifecycle-refactor`
- Amendment ID: 无（首版）
- Artifact root: `.spec-workflow/reviewer-lifecycle-refactor/`
- Authority: `local-spec-workflow`
- 决策来源: `user-confirmed-in-current-conversation`，日期 2025-09-17
- Supersedes: 无 / Superseded-by: 无
- Goal 目标: 实现本 spec 全部 ticket → `typecheck` 与新增单测通过 → `do-review` 无 must-fix → 可交付
- 最大自动修复轮数: **2**
- Auto-commit: **否**（无 git 仓库，改动直接落盘，不做自动提交）
- 必须暂停条件: 出现新的业务/数据/兼容决策缺口；范围超出本 spec；验证失败需接受风险；终审发现需扩范围的问题；达到 2 轮修复上限。
- 运行期修复轮次由 `implementation-report.md` 维护，本元数据不记运行态。

## Git entry

- Git entry: **not a git repo**；无分支/HEAD/脏工作区基线；改动直接落盘。

---

## 1. 问题陈述（用户视角）

评审插件的状态机「很难用」：状态太多分不清（`accepted`/`implementing`/`implemented`/`verifying`）、Agent 做完还要手动点状态且不知点哪个、文档一改一批锚点失效提示打扰、终态改错了无法复活只能新建丢上下文。一条 review 从提出到关闭纯人工要 5 次点击 + 1 个弹窗，`open` 底部还平铺 6 个无主次的按钮。

## 2. 解决方案（用户视角）

状态从 10 收敛到 8；Agent 报告完成时系统给「待验收」一键建议；锚点失效只有真正定位不了（orphaned）才打扰人，其余静默重定位；终态可 Reopen 且保留全部历史；每个状态只暴露一个主按钮。目标：走 Agent 的路径从「5 点击+1 弹窗」降到 **2 次点击**。

## 3. 背景与目标

见 `design/06b-lifecycle-current-analysis.md`（现状整理+缺陷）与 `reviewer_设计参考/lifecycle-refactor.md`（修订提案，方案 A）。本 spec 是二者的可执行化。

**目标**：状态收敛 + 自动化 + Reopen + 一致性重构，覆盖参考文档 S1–S4。

## 4. 非目标

- 不引入账号/权限体系（仍单机 `author=reviewer`）。
- **不新增任何状态名**（只收敛现有 10 个的子集，规避 `asStatus` 静默回退 `open` 的旧版兼容风险）。
- 不改锚点匹配 ladder 算法本身（`anchors.ts` 的 resolveAnchor 不动），只改「失效后的处置」。
- 不改 REST 路由的路径集合与 trust fence。

## 5. 目标状态机

### 5.1 状态全集（8 个）

| 状态 | 谁在等 | 含义 | 相对现状 |
| --- | --- | --- | --- |
| `open` | 人 | 已提出，待决断（讨论并入此态） | 吸收 `discussing` |
| `accepted` | 人/Agent | 已采纳，待派活/排队（有 Decision） | 保留 |
| `implementing` | Agent | 实施中 | 保留（**不改名**） |
| `verifying` | 人 | 实施已完成，待人验收 | 吸收 `implemented` |
| `needs_review` | 人 | 锚点 orphaned，需人工重定位 | 保留但换机制 |
| `resolved` | — | 终态（可 Reopen） | 保留 |
| `rejected` | — | 终态（可 Reopen） | 保留 |
| `duplicated` | — | 终态（可 Reopen） | 保留 |

被删除的运行态：`discussing`、`implemented`（仅作**读时归一化**保留识别，见 §11）。

### 5.2 目标迁移表（host 权威）

```text
open ──┬─→ accepted ──→ implementing ──→ verifying ──→ resolved
       │      ↑______________|______________|   （打回 / 重新讨论回退）
       ├─→ rejected     （终态，可 Reopen）
       └─→ duplicated   （终态，可 Reopen）

open/accepted/implementing/verifying ──→ needs_review   （锚点 orphaned 自动进入）
needs_review ──→ 原状态（重定位后自动退出）/ rejected / duplicated
resolved/rejected/duplicated ──→ open   （Reopen）
```

| from | to | 必要条件 |
| --- | --- | --- |
| open | accepted | 生成 `decision: accept` |
| open | rejected | `reason` 非空 + `decision: reject` |
| open | duplicated | `duplicatedOf` 存在 + `decision: duplicate` |
| open | needs_review | 锚点自动判定 orphaned（系统触发） |
| accepted | implementing | Send to Agent 成功（自动），或手动开始 |
| accepted | open | 撤回采纳 |
| implementing | verifying | Agent 完成回连的**一键建议**，或人工声明完成 |
| implementing | accepted | 实施受阻/方案变更 |
| verifying | resolved | 人工验收通过（仅人；critical 强制仅人） |
| verifying | implementing | 验收打回，`reason` 非空 |
| verifying | needs_review | 验证中发现锚点已实质失效（可保留系统触发） |
| needs_review | 原状态 | 人工重定位后系统自动退出 |
| needs_review | rejected / duplicated | 确认不再成立 |
| resolved / rejected / duplicated | open | **Reopen**：`reason` 非空 |
| 任意非终态 | open | 讨论回退 |

约束：
- 非法迁移返回 409，`error` 形如 `illegal transition: verifying -> open`（当 open 不在合法出边时）。
- 每次迁移在 thread 追加一条 `kind:status` 条目（含 from/to/时间/操作人/reason）。
- Reopen 后终态可再次评论/编辑；`resolvedAt` 清空。

## 6. 用户故事

1. 作为评审人，我希望回复讨论时状态不再在 `open↔discussing` 之间来回跳，这样时间线不被噪音污染。
2. 作为评审人，我希望采纳后点 Send to Agent 一步进入实施，不再看到我没点过的 `accepted` 中间记录。
3. 作为评审人，我希望 Agent 报告完成时系统提示「待验收」并给一键按钮，而不用自己猜点 `implemented` 还是 `implementing`。
4. 作为评审人，我希望文档改动后锚点只要还能定位就静默跟随，只有彻底定位不了才提示我。
5. 作为评审人，我希望锚点失效时系统自动把 review 标为 `needs_review`，我重新选中片段绑定后它自动恢复原状态。
6. 作为评审人，我希望把 resolved/rejected/duplicated 的 review Reopen 回 open，并保留原讨论与决策历史。
7. 作为评审人，我希望每个状态只有一个醒目的主操作，次要操作收进菜单，降低误点。
8. 作为评审人，我希望 `critical` 的 Resolve 和 Reopen 都只能由人执行。
9. 作为维护者，我希望状态集合、迁移表、开放/终态判定只有一份定义，改一处不用同步六处。
10. 作为维护者，我希望旧 review 文件（含 `discussing`/`implemented`）读入后自动归一化显示，不报错、不误判。
11. 作为维护者，我希望死枚举 `defer`/`wont_fix` 被清理，`decision` 变为可追加数组以支撑 Reopen。
12. 作为评审人，我希望列表视图分组与状态一一对应（待决断/进行中/待验收/已关闭）。

## 7. 用户流程

- **走 Agent（2 点击）**：open →[Send to Agent]→ implementing →（Agent 完成，系统提示）→[确认完成]→ verifying →[验收通过]→ resolved。实际人点击 = Send to Agent + 验收通过（+ Agent 完成确认为可选一键）。
- **不走 Agent（3 点击）**：open →[Accept]→ accepted →[开始实施]→ implementing →[声明完成]→ verifying →[验收通过]→ resolved（可省略 accepted 停留）。
- **锚点失效**：文档改动 → 系统解析 orphaned → 自动 `→ needs_review` + 系统线程条目 → 人重新选中绑定 → 自动退回原状态。
- **Reopen**：终态 →[Reopen]（填 reason）→ open，历史保留。

## 8. 前端改动（`src/client`）

- `ReviewDetail.tsx`：
  - `PLAIN_ACTIONS` 迁移表重写为目标 8 态；删除 `discussing`/`implemented` 分支。
  - 每个状态主按钮主次分明（主按钮 `dbr-primary`，其余进「更多」次级区/菜单）。
  - `implementing` 主按钮：无 Agent 回连时=「声明完成」；有回连待验收时=「确认 Agent 完成」。
  - 修正 `markImplemented`/`failVerification` 语义错位：`implementing→verifying` 用独立 key，不再复用 `failVerification`。
  - 终态展示 `Reopen` 按钮（填 reason 弹窗）。
  - `statusText()` 渲染旧 `discussing`/`implemented` 历史条目时按 §11 映射显示。
- `ReviewList.tsx`：`VIEW_STATUS` 改为 `open:[open]`、`inProgress:[accepted,implementing]`、`verify:[verifying,needs_review]`、`closed:[resolved,rejected,duplicated]`。
- `TransitionDialog.tsx`：新增 `reopen` kind（reason 必填）；`verify` 弹窗保留 evidence；`failVerify` reason 必填不变。
- `locales.ts`：清理 `transition.markImplemented`/`submitVerification` 相关文案，新增 `transition.reopen`、`transition.confirmAgentDone`、`transition.declareDone` 等；状态标签映射同步。
- Agent 回连提示：详情顶部在 `implementing` 且收到完成信号时显示「Agent 报告完成·待验收」条 + 一键按钮。

## 9. 后端改动（`src/host`）

- `lifecycle.ts`：成为**状态机单一来源**。重写 `ALLOWED` 为目标迁移表；导出 `STATUSES`、`OPEN_STATUSES`、`TERMINAL_STATUSES`、`isOpen`、`isTerminal`、`decisionTypeFor`。`protocol.ts` 的 `OPEN_STATUSES`/`TERMINAL_STATUSES` 改为从此处 re-export 或删除，client/review-files 复用。
- `review-store.ts`：
  - `markAgentDispatched`：`open→implementing` 只写一条 accept decision + 一条 status（不再显式落人看不见的 `accepted` 中间记录）；`accepted→implementing` 不变。
  - Agent 回连（`onTurnEnd` completed 分支）：除追加 agent comment 外，若当前 `implementing`，写入「完成建议」标记（不静默改状态）；回填 `related.agentRuns`、按 `DevBuddy-Review:` trailer 回填 `related.commits`。
  - 新增 `reopenReview`（或在 `transitionReview` 放开终态→open）：reason 必填，`critical` 仅人；清 `resolvedAt`；追加 `kind:status`。
  - `decision` 单值 → `decisions: ReviewDecision[]`；`decision` 字段保留为「最新一条」兼容读取（见 §10 数据模型）。
  - append/edit：终态在 Reopen 前仍只读；Reopen 后恢复可写。
  - 锚点分流：见 §12。
- `anchors.ts`：不改算法；`resolveAnchor` 输出继续驱动分流（在 store/读路径消费）。
- `review-files.ts`：`asStatus` 读时归一化 `discussing→open`、`implemented→verifying`（见 §11）；序列化 `decisions[]`。

## 10. 数据模型变更

`ReviewRecord`（`protocol.ts`）：

- `decision: ReviewDecision | null` → 保留字段但语义=「最新决策」；**新增** `decisions: ReviewDecision[]`（append-only）。读旧文件时把单个 `decision` 迁入 `decisions=[decision]`。
- `ReviewDecision.type`：删除 `'defer' | 'wont_fix'`，收敛为 `'accept' | 'reject' | 'duplicate'`。
- `ReviewStatus`：类型上删除 `'discussing' | 'implemented'`（写入面），但 `asStatus` 读取白名单仍识别它们用于归一化（见 §11）。
- `schemaVersion` 保持 `2`（无破坏性字段变更；`decisions[]` 为新增可选）。
- 迁移方式：**懒迁移**（读—归一化—写），不提供批量脚本；未触及文件保持原样仍可显示。

## 11. 旧状态兼容（读时归一化）

| 旧值 | 归一为 |
| --- | --- |
| `discussing` | `open` |
| `implemented` | `verifying` |
| 其余 8 个 | 不变 |

- `asStatus` 的 `allowed` 保留 `discussing`/`implemented` 用于**识别**，返回前归一化；**写入路径永不产出这两个值**。
- thread 里历史条目 `[discussing → open]`、`[implementing → implemented]` **原样保留**（真实审计），仅 UI 渲染按上表映射。
- 因目标状态集是现有枚举子集，旧版插件读到新文件不会触发 `asStatus` 静默回退。

## 12. 锚点失效分流（自动化）

在读路径（`getReview`/`getDocument`/列表扫描）消费 `resolveAnchor` 结果：

| 锚点状态 | 处置 | 打扰 |
| --- | --- | --- |
| `valid` | 无 | 否 |
| `moved` | 静默更新 `positional` 行号/偏移 | 否 |
| `modified` | 静默更新位置 + 一条 `kind:system` 线程条目 | 否 |
| `outdated` | 同上 + 列表轻量徽标 | 否 |
| `orphaned` | **自动 `→ needs_review`** | 是（仅此一种） |

- 自动进入 `needs_review` 需持久化（一次写入，避免每次读都判），写入时机与幂等策略在实现中确定（建议：读路径检测到 orphaned 且当前为非终态非 needs_review 时，触发一次带 `expectedSha` 的状态写；失败静默跳过下次再试）。
- 人工重新选中文档片段并重绑锚点后，`needs_review` 自动退出回**进入前的原状态**（需记录进入前状态；实现可在进入时把原状态写入一个字段或从最近一条 `kind:status` 反推）。
- 06 §3 原则「文档变化不自动改状态」修订为「**除 orphaned 外不自动改状态**」，同步更新 `design/06-lifecycle.md`。

## 13. API 设计

- 路由集合、路径、trust fence **不变**（`routes.ts`）。
- `TransitionRequest` 复用于 Reopen：`to='open'` 且 from 为终态时走 Reopen 校验（reason 必填）。无需新增路由。
- `markAgentDispatched` 内部行为变更，对外 `/agent/send` 响应结构不变。
- 若「确认 Agent 完成」需要专门入口，复用 `/review/transition`（`to='verifying'`），前端在收到完成信号时呈现该按钮；无需新路由。

## 14. 权限与安全

- 仍单机模型，`author=reviewer`；无账号体系。
- `verifying→resolved` 与终态 Reopen：`critical` 强制仅人（host 侧校验 author.type，agent 触发直接拒绝）。
- Agent 只能 append comment，永不产出 decision、永不改状态（回连仅「建议」）。
- trust fence（loopback/same-origin）不变。

## 15. 性能与扩展性

- 锚点分流的自动写入必须防抖/幂等，避免读放大导致每次 GET 都写盘（沿用现有 `expectedSha` 乐观锁 + `scheduleIndexRebuild` 防抖）。
- 状态机单一来源为纯函数，无性能影响。

## 16. 错误处理

- 非法迁移 → 409 `illegal transition: <from> -> <to>`。
- Reopen 缺 reason → 400。
- Reopen `critical` 由 agent 触发 → 403/400（拒绝）。
- 锚点自动写入冲突（sha 不匹配）→ 静默跳过，下次读再试，不抛给用户。
- 归一化读取遇未知状态 → 回退 `open`（现状行为保留）。

## 17. 边界条件

- 旧文件 `decision` 存在但 `decisions` 缺失 → 读时补 `decisions=[decision]`。
- review 处于 `needs_review` 时文档又恢复可定位（非人工重绑）→ 是否自动退出：本 spec 采用「仅人工重绑触发退出」，避免抖动（实现注释说明）。
- Reopen 一条 `duplicated` review：保留 `duplicatedOf` 链接但解除迁移限制。
- Agent 回连时 review 已被人改到终态 → 不追加建议、不改状态（现有 `isTerminal` 早退保留）。

## 18. 实现决策（已定）

- 状态机单一来源 = `src/host/lifecycle.ts`。
- `implementing` 不改名。
- Agent 回连 = 一键建议（写标记，不自动迁移）。
- `decision` 保留为最新值 + 新增 `decisions[]`。
- 归一化在 `asStatus`（读），写入面永不产出旧值。

## 19. 验收标准

1. 状态类型与 `ALLOWED` 仅含 8 个写入态；typecheck 通过。
2. 首条回复不再产生 `open→discussing` 迁移。
3. Send to Agent 从 open 出发，时间线不出现独立的人未点过的 `accepted` status 条目（只有一条 accept decision）。
4. Agent `turn/end` completed 时详情出现「待验收」一键建议，点击后 `implementing→verifying`；不点则状态不变。
5. 文档改动使锚点 moved/modified/outdated 时状态不变、位置跟随；orphaned 时自动 `needs_review`；人工重绑后自动回原状态。
6. 终态可 Reopen 回 open（reason 必填），历史 thread 与 decisions 完整保留；`critical` 由 agent 触发被拒。
7. 列表四视图与 §8 分组一致。
8. 旧 review 文件（构造含 `discussing`/`implemented` 的样本）读入后归一化为 open/verifying，不报错。
9. 开放/终态判定全项目仅一处定义，其余 import 复用（grep 校验无第二份硬编码数组）。
10. `ReviewDecision.type` 不含 `defer`/`wont_fix`。
11. 新增核心纯函数单测全绿。

## 20. 测试计划

- **验证 seam**：核心纯函数轻量单测 + `pnpm typecheck`（`tsc --noEmit`）。
- 引入一个轻量 test runner（建议 node 内置 `node:test` + `tsx`/直接对 `lib` 产物测，避免重依赖；具体在 ticket 01 定）。
- 覆盖点：
  - `lifecycle.canTransition/assertTransition`：目标迁移表逐条合法/非法。
  - `asStatus` 归一化：`discussing→open`、`implemented→verifying`、未知→open、正常值不变。
  - `decisionTypeFor`：accept/reject/duplicate 有产出，其余 null。
  - decision 单值→数组迁移函数。
  - 锚点分流决策函数（输入 AnchorResolution → 是否应进 needs_review）。
- 手动验收：Agent 回连一键、Reopen、锚点自动进出（UI 层）。

## 21. 测试决策

- Seam = host 纯函数（lifecycle / review-files 归一化 / 分流决策）。这些是状态机正确性的核心且无 IO，最适合单测。
- 不测 React 组件（无既有前端测试基建，成本高、收益低）；UI 走手动验收。
- 不引入重型框架，优先 `node:test`。

## 22. 风险与回滚

| 风险 | 对策 |
| --- | --- |
| 无 git，改坏难回滚 | 每 ticket 独立可验证；改动前 `design/06b` 已存现状快照；必要时手动备份 `src`。 |
| 旧插件读新文件误判 | 严守「不新增状态名」；归一化只在读；schemaVersion 不变。 |
| 锚点自动写入读放大 | 幂等 + sha 乐观锁 + 防抖，冲突静默跳过。 |
| Reopen 覆盖历史决策 | 先落 `decisions[]` 数组（ticket 01 前置）。 |
| Agent 回连误改状态 | 只写建议标记，绝不自动迁移。 |

回滚：按 ticket 逆序撤销；`decisions[]` 为叠加字段，回退后旧读路径仍认 `decision`。

## 23. 推荐实现顺序

S1 → S2 → S3 → S4（对应 ticket 01→05）。每阶段可独立验证：
- S1 后：一致性/数据清理完成，行为对用户不变但代码单源。
- S2 后：状态少了、点击少了。
- S3 后：Agent 做完自动提示、锚点不打扰。
- S4 后：终态可复活、UI 主次分明。

## 24. 补充说明

- 同步更新 `design/06-lifecycle.md`（状态机、§3 锚点原则）与 `design/06b-lifecycle-current-analysis.md`（标注已落地项）。
- 参考文档 `reviewer_设计参考/lifecycle-refactor.md` §11 待决策项本 spec 已全部关闭。
