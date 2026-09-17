# Review 生命周期重构方案（Lifecycle Refactor）

> 本文是 [06-lifecycle.md](06-lifecycle.md) 的修订提案，聚焦「状态机太难用」的四个实测痛点。
> 状态：**待评审**。落地前需在 §11 决策项上定稿。

## 1. 背景

06 定义的状态机在实现里已经全部落地，但实际使用中暴露了四个痛点（用户实测反馈，四选全中）：

| # | 痛点 | 现场证据 |
| --- | --- | --- |
| P1 | 状态太多 / 分不清区别 | `accepted`、`implementing`、`implemented`、`verifying` 四者界限说不清 |
| P2 | Agent 完成后要手动点状态 | `REV-0004`：11:16:26 点 `implementing→implemented`，3 秒后 11:16:29 又点回 `implementing`——不确定该点哪个 |
| P3 | 锚点失效提示打扰 | 文档一改，一批 review 显示锚点失效，但状态不动，需逐条人工判断 |
| P4 | 终态无法复活 | `resolved`/`rejected`/`duplicated` 无出边且禁止评论，反悔只能新建 review，丢上下文 |

## 2. 现状盘点

### 2.1 状态与迁移

10 个状态（`src/protocol.ts` L45-68），迁移表 `ALLOWED`（`src/host/lifecycle.ts` L18-30）：

| from | 可达 to |
| --- | --- |
| open | discussing, needs_review, accepted, rejected, duplicated |
| discussing | open, needs_review, accepted, rejected, duplicated |
| needs_review | discussing, rejected, duplicated |
| accepted | implementing, discussing |
| implementing | implemented, discussing |
| implemented | verifying, implementing |
| verifying | resolved, implementing, needs_review |
| resolved / rejected / duplicated | （终态） |

### 2.2 现状点击链路

一条 review 从 `open` 走到 `resolved`，纯人工需要 **5 次点击 + 1 个弹窗**：

```text
Accept → Send to Agent → Mark implemented → Submit verification(弹窗) → Resolve
open     accepted         implementing      implemented                  verifying      resolved
```

`open` 状态底部同时平铺 **6 个按钮**（Accept / Needs review / Reject / Duplicate / Send to Agent / Remove），无主次引导（`src/client/ReviewDetail.tsx` L49-78、L470-517）。

### 2.3 实现与 06 的偏差

1. **Send to Agent 一步连跳**：`open→accepted→implementing` 连写两条 status + 一条 decision（`src/host/review-store.ts` L620-645），`accepted` 在 Agent 路径上是人看不见的中间态。
2. **死枚举**：`ReviewDecision.type` 有 5 种，`decisionTypeFor` 只产出 `accept`/`reject`/`duplicate`，`defer`/`wont_fix` 无任何产出路径。
3. **按钮语义错位**：`implemented → implementing` 复用 `transition.failVerification` key（`src/client/ReviewDetail.tsx` L70-72），但该阶段尚未提交验证。
4. **`isOpen` 双份定义**：`lifecycle.ts` 用 `!isTerminal`，`protocol.ts` 另有硬编码 `OPEN_STATUSES`，靠人工同步。

### 2.4 痛点归因

| 痛点 | 根因 |
| --- | --- |
| P1 | 状态集合里有 2 个状态是「机械过渡」，不对应人的任何决策 |
| P2 | `session-feed.ts` 在 turn/end 只追加 agent comment，不推状态；06 §5 设计的「Agent 报告完成」提示未实现 |
| P3 | 锚点健康度（实时算、不落盘）与 `needs_review`（落盘状态）是镜像关系，却要求人工同步 |
| P4 | 06 §2 明确「Reopen 留到 M5」 |

## 3. 设计原则

1. **一个状态 = 一个待办**。每个非终态要能回答「现在轮到谁做什么」；答不出来的状态就是噪音。
2. **机器能判的不要问人**。锚点位置、Agent 完成信号，都由系统给出默认结论，人只在例外时介入。
3. **人的决策点保留，机械过渡消除**。
4. **枚举只收敛不新增**。目标状态集是现有 10 个的子集，避免旧数据读到未知状态——`asStatus` 对未知值会静默回退成 `open`（`src/host/review-files.ts` L77-84），新增状态名会导致旧插件版本静默误读。

## 4. 目标状态机（推荐方案）

### 4.1 状态定义

**10 → 8 个**：

| 状态 | 谁在等 | 含义 |
| --- | --- | --- |
| `open` | 人 | 已提出，待决断（讨论并入此状态） |
| `accepted` | 人 / Agent | 已采纳，待派活或排队中（有 Decision） |
| `in_progress` | Agent | 实施中 |
| `verifying` | **人** | 实施已完成，待人验收（原 `implemented` + `verifying` 合并） |
| `resolved` | — | 终态 |
| `rejected` | — | 终态 |
| `duplicated` | — | 终态 |
| `needs_review` | 人 | 旁路：锚点已失效，需人工重新定位（改为自动进出，见 §5.2） |

合并理由：

- **`discussing` → `open`**：「有人在讨论」不改变任何人该做的事，且评论数与 thread 已完整表达该信息。现状 `open↔discussing` 的来回迁移是纯噪音。
- **`implemented` + `verifying` → `verifying`**：两者合起来只有一个语义——「做完了，等人验」。拆成两态导致 `implemented→verifying` 只是填一个 evidence 弹窗，甚至出现 `implemented→implementing` 这种语义错位的按钮（§2.3）。
- **`accepted` 保留**：它对应真实的「已决定但未派活」队列，且是 Decision 的落点，不增加人负担。
- **`needs_review` 保留但换机制**：它是有明确行动号召的例外态，问题不在状态本身，而在「由人手工进入」（见 §5.2）。

### 4.2 完整迁移表

```text
open ──┬─→ accepted ──→ in_progress ──→ verifying ──→ resolved
       │      ↑              ↓              │
       │      └────────────────────────────┘        （打回 / 重新讨论）
       ├─→ rejected        （终态，可 Reopen）
       ─→ duplicated      （终态，可 Reopen）

open / accepted / in_progress / verifying  needs_review   （锚点 orphaned 自动进入）
```

| from | to | 必要条件 |
| --- | --- | --- |
| open | accepted | 生成 `decision: accept` |
| open | rejected | `reason` 非空 + `decision: reject` |
| open | duplicated | `duplicatedOf` 存在 + `decision: duplicate` |
| open | needs_review | 锚点自动判定为 `orphaned`（§5.2） |
| accepted | in_progress | Send to Agent 成功（自动），或手动标记开始 |
| accepted | open | 撤回采纳 |
| in_progress | verifying | **Agent 完成回连自动迁移**（§5.1），或人工声明完成 |
| in_progress | accepted | 实施受阻 / 方案变更 |
| verifying | resolved | 人工验收通过（仅人，`critical` 强制人工） |
| verifying | in_progress | 验收打回，`reason` 非空 |
| verifying | needs_review | 验证中发现锚点已实质失效 |
| needs_review | 原状态 | 人工重新定位锚点后**自动退出** |
| needs_review | rejected / duplicated | 确认不再成立 |
| resolved / rejected / duplicated | open | **Reopen**（§6），`reason` 非空 |
| 任意非终态 | open | 讨论回退 |

### 4.3 人的操作成本对比

| 路径 | 现状 | 目标 |
| --- | --- | --- |
| open → resolved（走 Agent） | 5 次点击 + 1 弹窗 | **2 次**（Send to Agent + 验收 Resolve） |
| open → resolved（不走 Agent） | 5 次点击 + 1 弹窗 | **3 次**（Accept + 开始实施 + Resolve） |
| 锚点失效处理 | 逐条人工判断并点 needs_review | **0 次**（自动），仅在 orphaned 时介入 1 次 |

### 4.4 备选方案

| 方案 | 状态数 | 取舍 |
| --- | --- | --- |
| **A. 推荐**（§4.1） | 8 | 合并 2 个机械过渡态，保留 accepted 与 needs_review |
| B. 激进 | 6 | 再合并 `accepted`→`in_progress`、`needs_review` 降级为锚点徽标。代价：失去「已决定待实施」可见性，锚点失效无行动入口 |
| C. 保守 | 10 | 状态机不动，只做 §5/§6 的自动化。代价：P1（分不清区别）不解决 |

## 5. 自动化规则（消除人工点击）

### 5.1 Agent 完成回连（解 P2）

现状：`session-feed.ts` 在 `turn/end` 时把 Agent 最终回复作为 agent comment 追加进 thread，**不改状态**（06 §5 承诺的「Agent 报告完成」提示未实现）。

目标：

1. 会话 `turn/end` 且 `reason.kind === 'completed'` 时，系统在 Review 详情标注 **「Agent 报告完成 · 待验收」**，并把 `in_progress → verifying` 作为**建议迁移**一键可点（不静默改状态，保留人的判定权）；
2. `related.agentRuns` 回填 sessionId，`related.commits` 依据 `DevBuddy-Review: <id>` trailer 解析回填；
3. **不自动 resolved**——`verifying → resolved` 恒由人执行（保留 06 §5 与 §7.5 的边界）。

理由：Agent 的「我做完了」是事实，人的「验收通过」是判断。前者机器给，后者留人。

### 5.2 锚点失效分流（解 P3）

现状：锚点健康度实时算、不落盘；`needs_review` 落盘，靠人手工同步（06 §3）。

目标：按锚点状态分级处置，**只有真正不可恢复的才打扰人**：

| 锚点状态 | 处置 | 是否打扰 |
| --- | --- | --- |
| `valid` | 无 | 否 |
| `moved`（精确重定位） | 静默更新 `positional` 行号/偏移 | 否 |
| `modified`（模糊匹配命中） | 静默更新位置 + 记录一条 `kind: system` 线程条目 | 否 |
| `outdated`（基线落后但可定位） | 同上，列表加轻量徽标 | 否 |
| `orphaned`（无法定位） | **自动进入 `needs_review`** | 是，仅此一种 |

配套：

- 人工重新选中文档片段并绑定后，`needs_review` **自动退出**回原状态（记录 `kind: status` 条目）；
- 06 §3 的原则「文档变化不自动改变 Review Status」据此修订为**「除 orphaned 外不自动改变状态」**。

### 5.3 状态与 Decision 的清理

- 删除 `defer` / `wont_fix`（无产出路径的死枚举），或补上 `deferred` 状态——本次选删除（§2.3）；
- `record.decision`（单值）改为追加 `decisions: ReviewDecision[]`，`decision` 保留为最新一条以兼容读取；
- `isOpen` 统一为 `protocol.ts` 单一来源，`lifecycle.ts` 改为复用。

## 6. Reopen（解 P4）

终态不再是绝对终态：

| from | to | 条件 |
| --- | --- | --- |
| resolved | open | `reason` 非空，记 `kind: status` 条目 |
| rejected | open | 同上 |
| duplicated | open | 同上；保留 `duplicatedOf` 链接但不再限制迁移 |

约束：

- Reopen 后原 Discussion 与 Decision 历史**完整保留**（这也是必须先修 §5.3 decision 数组的原因——单值会被 Reopen 覆盖）；
- `resolvedAt` 清空，`updatedAt` 更新；
- `critical` 的 Reopen 与 Resolve 同样仅人可执行（与 06 §5 的权限模型一致）；
- 仍不引入账号体系，`author` 记本地标识 `reviewer`。

## 7. 证据链补全

06 §8 设计的链路是 `Review → Decision → Agent Run → Change/Commit → Test → Verify → Resolve`，现状只有前 3 段落地（`REV-0004` 的 `related.commits` / `related.tests` 为空）。

目标（不阻断、只留痕）：

- `verifying → resolved` 时若 `related.commits` / `related.tests` / `related.agentRuns` 全空，追加一条 `kind: system` 条目 **「验收无关联证据」**，让缺口在 thread 里可见；
- `severity: major | critical` 时在 Resolve 弹窗内提示待关联项，但**不阻断**（避免增加摩擦）；
- 依据 commit trailer `DevBuddy-Review: <review_id>` 自动回填 `related.commits`（在 Agent 回连与 git 扫读两个时机各做一次）。

## 8. 数据兼容

### 8.1 旧状态映射（读时归一化）

| 旧值 | 归一为 |
| --- | --- |
| `discussing` | `open` |
| `implemented` | `verifying` |
| 其余 8 个 | 不变 |

### 8.2 关键风险与对策

`asStatus` 对未知状态**静默回退 `open`**（`src/host/review-files.ts` L77-84）。函数式迁移下：

- 目标状态集是现有枚举的**子集**，因此**不需要引入任何新状态名**，已安装的旧版插件读到新文件不会误判；
- `asStatus` 的 `allowed` 列表保留 `discussing`/`implemented` 用于读取，但归一化后再返回；写入路径永不产出这两个值；
- `schemaVersion` 保持 `2`（无格式变更），仅在文件名/字段层面无破坏性修改；
- 磁盘文件按「读—归一化—写」懒迁移，不提供批量脚本；未触及的旧文件保持原样仍可正常显示。

### 8.3 状态机演进后的历史条目

旧文件 thread 里已有的 `[discussing → open]`、`[implementing → implemented]` 条目**原样保留**（它们是真实审计记录），仅在 UI 渲染时按 §8.1 映射显示。`statusText()` 需同步该映射（`src/client/ReviewDetail.tsx` L559-565）。

## 9. UI 交互契约

### 9.1 主操作（主次分明）

每个状态**只暴露一个主按钮**，其余收进次级菜单：

| 状态 | 主按钮 | 次级 |
| --- | --- | --- |
| open | **Accept** | Reject / Duplicate / Needs review / Remove |
| accepted | **Send to Agent** | 开始实施（手动）/ 撤回 |
| in_progress | **声明完成**（有 Agent 回连时变为「确认 Agent 完成」） | 实施受阻回退 |
| verifying | **验收通过** | 打回（reason 必填） |
| needs_review | **重新定位锚点** | Reject / Duplicate |
| 终态 | — | Reopen |

### 9.2 视图归组（与状态一一对应）

| 视图 | 状态 |
| --- | --- |
| 待决断（Open） | `open` |
| 进行中（In progress） | `accepted`, `in_progress` |
| 待验收（Verify） | `verifying`, `needs_review` |
| 已关闭（Closed） | `resolved`, `rejected`, `duplicated` |

现状 `needs_review` 归 Open 但唯一的前进动作是回 `discussing`、`implemented` 归 Verify 但主操作是打回 In progress（§2.3），本次一并修正。

### 9.3 批量操作

列表视图支持多选 + 批量 Accept / 批量 Reject（`severity: info | minor` 才可批量），用于清理低频意见堆积。

## 10. 分阶段落地

| 阶段 | 内容 | 依赖 |
| --- | --- | --- |
| S1 | §5.3 数据清理（decision 数组、去死枚举、isOpen 单一来源） | 无，独立可做 |
| S2 | §4 状态机收敛 + §8 读时归一化 + §9.2 视图归组 | S1 |
| S3 | §5.1 Agent 回连 + §5.2 锚点分流 | S2 |
| S4 | §6 Reopen + §7 证据链留痕 + §9.1/9.3 UI 契约 | S2 |

每阶段保持可独立发布：S2 之后系统对用户表现为「状态少了、点击少了」，S3 之后表现为「Agent 做完会自动提示」。

## 11. 待决策项

1. **状态集合定稿**：采用 §4.4 的 A（8 个）/ B（6 个）/ C（10 个不动）？
2. **`accepted` 去留**：是否保留「已采纳待派活」这一独立状态？
3. **Agent 回连力度**：`in_progress → verifying` 是「一键建议」（本文推荐）还是「全自动迁移」？
4. **Reopen 权限**：是否对 `critical` 只允许人 Reopen（本文推荐），还是不做区分？
5. **批量操作范围**：是否限制只有 `info | minor` 可批量处置？