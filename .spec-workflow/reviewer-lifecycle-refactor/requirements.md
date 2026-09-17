# Requirements — Reviewer 状态机重构

> 本文为需求结论追溯记录。本次未走完整 `to-grill`（痛点已由 `reviewer_设计参考/lifecycle-refactor.md` 实测归因），需求在对话中直接澄清并关闭。

## Git entry

- Git entry: **not a git repo**（`/home/l-xiezhenxun/workspace/DevBuddy` 非 git 仓库，无基线）。
- 变更记录方式：无 VCS，改动直接落盘；依赖 typecheck + 轻量单测保障。

## 背景

DevBuddy Reviewer 插件（`ImplementSpace/dsh_reviewerSidebar`）当前生命周期状态机在实现里全部落地，但实际使用暴露四大痛点（用户实测四选全中）。现状与优化分析见 `design/06b-lifecycle-current-analysis.md`，修订提案见 `reviewer_设计参考/lifecycle-refactor.md`。

## 目标

- 状态 10 → 8，消除机械过渡态；
- 消除人工点击（Agent 回连、锚点分流自动化）；
- 终态可 Reopen，保留历史证据；
- 状态机收敛到单一来源，清死枚举，decision 改数组。

## 非目标

- 不引入账号/权限体系（仍单机 `author=reviewer`）；
- 不新增状态名（只收敛，避免旧插件读到未知状态误判）；
- 不改锚点匹配算法本身（anchors.ts 的 ladder 不动，只改「失效后的处置」）。

## 已关闭决策

1. 状态集合：**方案 A，8 个**。
2. `implementing` **不改名**，只做合并（`discussing→open`、`implemented+verifying→verifying`）。
3. Agent 回连：**一键建议迁移**（不静默改状态，保留人判定权）。
4. `critical` 的 Reopen 与 Resolve **仅人可执行**。
5. spec 覆盖 **S1–S4 全部**。
6. 测试 seam：**核心纯函数轻量单测 + typecheck**。
7. Goal Mode：**开启（仅本 spec，不自动提交）**；目标=实现全 spec+验证通过+终审无 must-fix；最大自动修复 2 轮。

## 推荐下一步

进入 `to-spec`（已进行），产出 `spec.md` + 分期 ticket。
