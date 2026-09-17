# Review Pass 01 — 状态机重构首轮终审（append-only）

> Pass 报告只追加不修改；权威汇总见同目录 `review-report.md`。
> 评审时间：t05 提交 `8f900d1` 之后；评审 diff `9354d24...8f900d1`（`ImplementSpace/dsh_reviewerSidebar`，+2068/−296）。

## 1. 评审 DAG（实际执行）

| 任务 | 目标 | 验证方法 | 允许改码 | 结果 |
| --- | --- | --- | --- | --- |
| R-A 基线固化 | 固定评审点 | `git log/diff --stat`、`git status` | 否 | 通过（工作树干净） |
| R-B 编译/测试基线 | 实现可验证 | `pnpm typecheck`、`pnpm test`、`pnpm build` | 否 | typecheck ✅ / 39 测试全绿 / build 两产物重建 ✅ |
| R-C Spec 轴（条款逐条） | 找缺失/错误/越界 | 读 spec §5..§19 + issues + 代码对照 | 否 | DR-001、DR-002、DR-003 |
| R-D Standards 轴（坏味道） | 工程一致性 | smell 基线逐轴 + 本地约定核对 | 否 | DR-004、DR-005 |
| R-E 功能验收（逻辑行为） | host 行为兑现 spec | 独立 store 级验证脚本（临时 DSH_HOME + 临时项目，动态 import；跑后移入 `verification/` 并删除 src 内副本） | 否 | 12 用例：10 通过 2 失败（失败=DR-001 复现） |
| R-F 前端真实交互 | UI 可用性 | 计划浏览器自动化 | 否 | **未执行**（见 §5 阻塞） |

**子代理状态**：Spec 轴子代理 `a330f6cc-280e-424a-b1be-5b08687e80bd`、Standards 轴子代理 `83d54b02-4c44-48ed-bc40-96e904948ebb` 均连续两次基础设施瞬断（无输出），各按恢复策略续跑后仍无产出 → 判定 `unrecoverable`，其轴由主 agent 本地完成（本报告 §3/§4）。**评审缺口：无独立第二意见。**

## 2. 验证证据

- 基线日志：`verification/baseline-typecheck-test-build.log`（typecheck ✅；`tests 39 / pass 39 / fail 0`；host build ✅，`lib/index.js`、`lib/client.js` 均重建）
- 独立功能验证：`verification/dr-001-repro.test.ts`（可复现脚本，12 用例）＋ `verification/dr-001-repro-node-test.log`（**10 pass / 2 fail**，2 失败即 DR-001 的两条复现）
- 复核脚本未残留在生产树：`src/host/verification-reopen.test.ts` 已删除（`git status` 仅见 `verification/` 新目录）

## 3. Spec 轴（条款核对）

| 条款 | 结论 | 证据 |
| --- | --- | --- |
| §5.1 8 态全集、不新增名字 | ✅ | `protocol.ts: STATUSES`（8 项）；`LegacyReviewStatus` 仅 `discussing/implemented` |
| §5.2 迁移表（逐行） | ⚠ 部分 | 大多数边正确；**accepted/implementing 缺 `→needs_review` 出边（DR-001）**；**verifying→implementing 缺 host 侧 reason 强制（DR-002）** |
| §6 用户故事 1–12 | ✅（除 #4/#5 受 DR-001 影响） | 见各 ticket 单元测试 + R-E 验证 |
| §8 前端 | ✅ | `ReviewList.tsx:21-28 VIEW_STATUS` 与四视图一一对应（含 `closed:[...TERMINAL_STATUSES]` 单一来源）；`ReviewDetail.tsx` 每状态单主按钮（`PRIMARY_ACTION` 6 项 + accepted=Send、needs_review=重绑），其余合法边收进 `SECONDARY_ACTIONS`，与 host `ALLOWED` 逐边比对一致（含 verifying 的 needs_review 边保留在次级区）；终态主按钮=Reopen；`implementing` 有回连时主按钮文案切「确认 Agent 完成」 |
| §9 后端 | ✅（除 DR-001 连带项） | 回连仅写 `agentCompletion` 建议不改状态（R-E ✔）；人工迁移清建议（R-E ✔）；trailer 回填只在活动迁移路径且无 catch 泄漏（`review-store.ts:602-606` try/best-effort）；`/review/reanchor` 路由仅一处；错误映射 403/409/400（`routes.ts:101-110`）|
| §10 数据模型 | ✅ | `decisions[]` append-only、`decision` 镜像、`agentCompletion` 字段、`ReanchorRequest/Response` |
| §11 旧状态兼容 | ✅ | 归一化读、历史保原名、展示层映射（R-E t02 ✔） |
| §12 锚点分流 | ⚠ 部分 | `anchor-triage.ts` 决策表与 spec 一致（终态恒 none、needs_review 抖动防护、orphaned 唯一自动）；**但 store 迁移表拦住了 accepted/implementing 的自动进入（DR-001）**；「读路径含列表扫描」与实现不一致（见 DR-003）|
| §13 API 设计 | ✅ | Reopen 复用 `/review/transition`；确认完成复用 `to='verifying'` |
| §14 权限与安全 | ✅ | 声明制 author 门禁、critical 仅人拒绝（R-E ✔，403）；agent 永不决策；trust fence 未变 |
| §16 错误处理 | ✅（除 DR-002 的 reason→400 缺失） | 409/403 映射核对一致；归一化未知→open；sha 冲突静默跳过 |
| §17 边界条件 | ✅（除 needs_review 抖动声明点见 DR-003） | 单 decision→decisions 迁移 ✔（R-E）；duplicate 的 Reopen 保留 `duplicatedOf` ✔（store 级用例）；终态 agent 评论早退 ✔ |
| §19 验收标准 1–11 | 7 全过 / 5 部分（DR-001）| 1 ✅（8 态 + typecheck）、2 ✅（R-E t02）、3 ✅（`verification` §19.3 用例）、4 ✅（R-E t03）、**5 ⚠（DR-001）**、6 ✅（store 级 Reopen 全链路 + critical 403）、7 ✅（视图分组）、8 ✅（R-E legacy 文件用例）、9 ✅（状态集合单一来源，见 DR-004 的残余例外）、10 ✅（DECISION_TYPES 无死枚举）、11 ✅（39/39）|
| issues 01–05 验收项 | ✅（除 04 中 accepted/implementing 自动进入项） | 见各 ticket 记录与 R-E |

**测试空洞（实现自带测试未覆盖、且 spec 要求覆盖的点）**：
1. §5.2 逐行迁移表只测了生命周期纯函数，没测「accepted/implementing 的 orphaned 自动进入」这条 store 级链路 —— 正是 DR-001 漏网的原因（t04 用例只覆盖了 open 路径）。
2. ·verifying→implementing 需 reason· 这行表从未有 host 侧断言（客户端弹窗兜底）—— DR-002 漏网原因。

## 4. Standards 轴（坏味道浏览）

结论：**有条件通过**（条件 = DR-004 列入后续，不阻塞交付）。

| 轴 | 检查 | 结论 |
| --- | --- | --- |
| Mysterious Name | 新增纯函数 `isReopen/isHumanOnlyTransition/decideAnchorTriage/preNeedsReviewStatus` 命名自解释 | 无问题 |
| Duplicated Code | **`DR-004`：可删除状态集两份硬编码**（host `review-store.ts:735`、client `ReviewDetail.tsx:85`） | minor |
| Feature Envy / Message Chains | `review-store.ts` +430 行集中了 triage/回连/Reopen/回填——按「评审单文件 store」本地约定可归为单一职责圈，未越界 | 无问题 |
| Primitive Obsession | `TransitionRequest.author: AuthorRef` 复用现有类型 | 无问题 |
| Repeated Switches | client `PRIMARY_ACTION/SECONDARY_ACTIONS` 用查表替代了原 6 个 if 分支 | 改进，无问题 |
| Shotgun Surgery | 状态集合改动集中在 `protocol.ts`，其余为 import 复用 | 无问题 |
| Node 24 type-strip | 新代码无参数属性/enum；`IllegalTransitionError` 已去参数属性化 | 通过 |
| `speculative generality` | `isHumanOnlyTransition` 纯函数只服务当前 spec，无超前抽象 | 通过 |
| **`DR-005`** | `markAgentDispatched` 中清 `agentCompletion` 的注释与代码在正常流程不可达（dispatch 只允许 open/accepted，而建议只在 implementing 才设置）——属防御性代码，无 bug，但注释表述令读者误以为有可达路径 | nit，留痕不改 |
| 测试文件质量 | 命名统一、断言带信息；矩阵断言无重复 | 通过 |

## 5. Findings

### DR-001（blocker · must-fix）
- **标题**：`accepted`/`implementing` 下的锚点 orphaned 无法自动进入 `needs_review`，读路径直接抛 409。
- **证据**：
  - `src/host/lifecycle.ts:70` `accepted: ['implementing','open']`、`:73` `implementing: ['verifying','accepted','open']` —— 缺 `needs_review`。
  - `src/host/review-store.ts:995-1021 applyAnchorTriage` 在读路径内调用 `assertTransition` 后直接 `throw`，不走 409→UI 的错误处理。
  - 复现：`verification/dr-001-repro-node-test.log` 中两颗 ✖（`Illegal transition: accepted->needs_review`、`implementing->needs_review`），并连带 `getDocument` 同样抛 `DR-001 impact` 用例证实（**整个文档视图在该 review 存在 orphaned 锚点期间不可用**）。
- **期望**：spec §5.2「open/accepted/implementing/verifying → needs_review（锚点 orphaned 自动进入）」、§12、§19 验收 5。
- **实际**：open/verifying 正常；accepted/implementing 抛错。
- **影响**：核心工作流被打断；用户看不到/无法操作该 review，也不能重绑退出。
- **范围**：`ImplementSpace/dsh_reviewerSidebar`。
- **建议**：`fix-review` → 在 `ALLOWED` 为 `accepted`、`implementing` 补 `needs_review` 出边（与 open/verifying 相同语义），补 store 级测试覆盖「accepted/implementing orphaned 自动进入」（修复这轮加上的条款级回归测试）。

### DR-002（major · must-fix）
- **标题**：spec §5.2 要求 `verifying → implementing` 的验收打回必须给 reason，host 侧未强制。
- **证据**：`src/host/review-store.ts:27-33` 只对 `rejected` 与 Reopen 强制 reason；`verifying→implementing` 无此分支。复现：`verification` 中 «DR-002 repro» 用例——无 reason 的打回成功写入、thread 条目标 body 为空。
- **期望**：spec §5.2 表「verifying | implementing | 验收打回，`reason` 非空」、§16「Reopen 缺 reason → 400」同类约束。
- **实际**：客户端 `TransitionDialog(failVerify)` 有必填校验，host 没有；任何不走弹窗的直接 API 调用可绕过。
- **影响**：工序可静音回退而失去审计理由。
- **建议**：`fix-review` → host 侧补断言（与 reopen/rejected 同款），补一条 host 侧测试。

### DR-003（minor · 不要求本轮修）
- **标题**：spec §12 把「列表扫描」列为 triage 读路径，但 `listReviews`/`scanSummaries` 只做读、不做自动写入。
- **证据**：`review-store.ts` `scanSummaries`/`listReviews` 未接入 `applyAnchorTriage`（仅 `getReview`/`getDocument` 接入）。
- **影响**：列表层不会把 `needs_review` 写回文件，第一次进入详情/文档时才会触发分流——结果一致但时点不同；与 §15 防抖目标一致，属实现取舍。
- **建议**：修复 spec 文案（把「列表扫描」改为「列表层只读消费，分流写入在详情/文档读路径」）或在后续 pass 评估是否补列表层写入。本轮建议改文档。

### DR-004（minor · 建议后续处理）
- **标题**：可删除状态集合两处硬编码：host `review-store.ts:735` 与 client `ReviewDetail.tsx:85 REMOVABLE`。
- **建议**：与 `TERMINAL_STATUSES` 同理提升到 `protocol.ts`（如 `REMOVABLE_STATUSES`），UI/host 共享。非阻塞。

### DR-005（nit · 留痕）
- **标题**：`markAgentDispatched` 中「clear agentCompletion」分支在正常流程不可达（注释易误导）。
- **建议**：不改为防御；如爱干净可在注释里说明「仅在异常双发路径可达」。

## 6. 前端真实交互与残余风险

- **未执行浏览器真实交互测试**。阻塞：本机无 `playwright` npm 包（`npx --no-install playwright` 缺失）、仅存在 chromium 浏览器二进制；评审阶段禁止新增依赖/改 lockfile、且插件需注入 DSH 运行时才能渲染，环境隔离成本高。
- **残余风险（前端）**：UI 主/次按钮、Reopen 弹窗、drift 徽标、文档视图「重绑」流程、confirm-agent-done 文案切换未在真实浏览器核对；存在样式/交互极端用例未覆盖的可能。
- **残余风险（后端运行时）**：插件为进程内 Cordis 插件，`lib/index.js`/`lib/client.js` 已重建，但未做「重启 DSH 进程并冒烟 loopback 路由」的运行时验证（评审阶段不允许重启共享进程）。
- **残余风险（分布式）**：无独立第二意见（子代理瞬断）；已尽力通过分轴记录 + 独立验证脚本补偿。

## 7. 结论与下一步

- Completion: **mostly complete**（核心链全通 + DR-001 前的所有条款达标，但 accepted/implementing 的锚点自动分流在运行时不可用且会拖垮文档视图）。
- Ship Decision: **fix before ship**。
- 进入下一阶段：**`fix-review`**，本 pass 产出 `repair-spec.md` + `repair-issues/`（Goal Mode 第 1 轮修复，预算剩余将由 `implementation-report.md` 记为 1/2）。
- 修复验收锚点：本报告 §3 的 DR-001/DR-002 条款重跑 + `verification/dr-001-repro.test.ts` 两颗复现用例由 ✖ 变 ✔、新增 host 侧 reason 断言用例、typecheck/build 仍绿。
