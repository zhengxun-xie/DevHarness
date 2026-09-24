# 01 · 文档级长期 AI 会话（AI 按键）

## 背景与目标

左侧 DevBuddy 面板的富文本工具栏里有一个 **AI** 按键，弹层为两行：

1. **快捷动作**：润色 / 翻译 / 总结 / 续写 / 解释（固定任务模板）。
2. **修改意见行**（2026-09-21 新增）：一个文本框 + **修改** 按键 —— 用户直接输入
   自定义修改意见（如「更正式一点，去掉口语」），按 `Enter` 或点「修改」即以
   `custom` 动作执行；同样走弹窗预览（编辑 / 取消 / 追问 / 应用）。
   - **有选区**：改写选中文本（应用时替换选区）。
   - **无选区**：不报「请先选择文本」——以光标位置为锚，把前后文档窗口与修改意见
     一并发给 AI（同「续写」的 caret 模式，`<<<光标>>>` 标记编辑位置），AI 给出
     修改建议；应用时建议文本插入原光标处（弹窗内可先编辑）。

早期实现是前端占位（`mockAiAssist`，返回 `[AI 占位 —— 通道尚未接入]`），并且是直接改写文档。

本次改造达成两点：

1. **真实 AI**：AI 按键接入真实的 DSH 会话（session），由 agent 返回结果。
2. **长期会话**：在某个文档首次启用 AI 时，为该文档创建一个**长期存在的会话**，
   命名为 `[AI优化]<文档名>`；此后该文档的所有 AI 操作（含弹窗内的追问）**复用同一个会话**，
   从而获得完整的上下文连续性。

AI 结果**不再直接改写文档**：先在弹窗中预览，允许「编辑 / 取消 / 追问 / 应用」。
（弹窗交互见 `AiSuggestionModal.tsx`，本次在其之上接入真实会话。）

## 会话命名与绑定

| 项 | 值 |
| --- | --- |
| 会话标题 | `[AI优化]<文档名>`，文档名 = 节点文件 basename 去掉扩展名（如 `Intent.md` → `[AI优化]Intent`） |
| 绑定文件 | `<项目根>/.devbuddy/ai-sessions.json` |
| 绑定结构 | `{ "version": 1, "sessions": { "<文档文件名>": "<sessionId>" } }` |

绑定按**文档文件名**索引（同一项目内每个文档一个长期会话）。
写入采用「临时文件 + rename」原子替换，避免半写。

## 派发流程（host 侧）

`AiSessionService.dispatch()`（`src/host/ai-session.ts`）：

1. `resolveAiContext(projectId)` → `{ path, workspaceId }`（store 提供）。
2. `getOrCreateSession()`：
   - 绑定文件里已有该文档的 `sessionId` → **复用**；
   - 否则 `sessionController.create({ workspaceId } | { cwd: projectPath })`
     → `rename(sessionId, '[AI优化]<文档名>')` → 落盘绑定。

### 归档会话的失效

复用前会检查绑定的会话是否还活着：归档一个会话只是把它从各分组视图隐藏，
并不把它从工作区 `sessionIds` 移除，也不清我们的绑定。若绑定指向一个**已归档**的会话
（`workspaceRegistry.archivedSessionIds`），说明用户刻意把它收起来了，此时
`getOrCreateSession` 会**新建一个会话并覆盖绑定**，而不是复用归档会话。
旧归档会话保持隐藏。registry 不可用时 `isArchived` 返回 `false`（安全默认：照旧复用）。
3. `controller.follow({ address: { kind: 'session', sessionId } }, signal)`：
   - 收到 `snapshot` 帧 → 记录 `cursor`，随即 `controller.prompt({ requestId, mode: 'queue', content: [{ type: 'text', text }] })`；
   - 收集 `seq > cursor` 的 `assistant/message` 事件，`extractAssistantText()` 取出文本；
   - **拿到第一条非空回复立即 `break`** —— 这会触发 follow 生成器 `finally` 清理并结束请求。
     （若不断开，流会一直空闲到 180s 超时才终止，导致请求挂死数分钟。）
4. 返回 `{ delivered, sessionId, text, reason }`。

### 上下文：必须发送，但不重复发送

只发 `selection` 是不够的 —— 尤其「续写」时选区为空，agent 拿不到任何正文，只能瞎写。
因此客户端从编辑器取**光标前后各一段纯文本窗口**（`contextBefore` 最多 4000 字、`contextAfter` 最多 2000 字，
`doc.textBetween` 按块分隔），随请求一起发送；host 侧再用 `clipContext` 兜底截断（上限 6000）。

提示词里用标记交代**编辑位置**：

- 「续写」：`{before}<<<续写点>>>{after}`，明确从哪续；
- `custom`（修改意见行）：
  - **有选区**：与其它选区动作同构 ——【待处理文字】+【文档上下文】，但任务行
    不是固定模板，而是用户输入的修改意见本身，并显式要求
    「除该意见要求的改动外，保持原文的内容、语言与格式不变」；意见为空时兜底为
    「让表达更清晰、准确。」（正常路径下按键在空输入时禁用，不会触发）；
  - **无选区**（caret 模式）：同「续写」——`{before}<<<光标>>>{after}` 标记编辑
    位置，修改意见作为任务行；AI 按意见输出改写后的完整文字或新增内容，
    应用时插入光标处；
- 其它动作：单独列出【待处理文字】，窗口作为「仅供理解」的上下文。

### 提示词约束

会话运行的是完整 DSH 编码 agent，因此每条提示都显式禁止调用工具 / 读写文件 / 输出解释或代码块，
并要求「只输出结果文本本身」，避免 agent 去改文件而不是回文本。

**规则每轮都发**（约 150 字）：它是行为护栏，长会话里指令会衰减；一旦模型忘了「不许改文件」，
它就可能去改文档。这个开销很小，保留。

### 上下文去重（同一会话不重复发送）

一个文档 = 一个长期会话，会话历史里已经带着上一轮的上下文。因此 host 侧维护
`contextSignatures: Map<sessionId, signature>`（签名 = `action` + `selection` + `before` + `after` + `instruction`）：

- 窗口**与上次不同** → 发送完整【文档上下文】；
- 窗口**未变** → 用一句「（与上一轮相同，见本会话上一条消息。）」替代，避免每轮最多 6000 字的重复。

签名按会话 id 存储、进程内有效（重启后首个请求会重发一次，属安全默认）。
`instruction` 进签名：同一个选区换一条修改意见就是一轮新对话，必须重发窗口。
「追问」不发送上下文（上一轮已在会话里），因此不进签名缓存。

## 降级与错误

| reason | 含义 |
| --- | --- |
| `sent` | 正常，`text` 为回复 |
| `no-session-controller` | 未注入 `sessionController`（服务缺席） |
| `controller-error` | 创建 / 重命名会话失败 |
| `no-reply` | 已投递但 180s 内没拿到回复（`delivered: true`） |

客户端在派发失败时显示内联错误（`ai.unavailable`），弹窗内的追问失败显示 `AiSuggestionModal` 的 `error` 文案。

## 客户端接线

- `NodeCard` 把节点文件名作为 `documentName` 传给 `RichTextEditor`（`meta.file`）。
- `RichTextEditor` 的 `documentName` 透传给 `RichTextToolbar`；
  `runAiAction` 用 `editor.state.doc.textBetween` 取出 `selection` 与前后窗口
  `contextBefore` / `contextAfter`，连同 `action` 一起交给 `aiAssist(request)`
  → `api.aiDispatch()` → `POST /api/devbuddy-left/ai/dispatch`。
- 修改意见行（弹层第二行）由 `runCustomRevision` 提交：空输入时「修改」按键禁用，
  `Enter` 或点按键触发 `runAiAction('custom', 意见)`，与快捷动作共用同一弹窗预览。
  `custom` 允许无选区（caret 模式，走「续写」式的光标窗口）；有选区时属
  **替换类**动作（应用时覆盖原选区），无选区时应用等价于在原光标处插入。
- 追问复用同一 `document`，因此 host 侧复用同一会话，上下文连续。

> 注意：props 命名为 `documentName`（而非 `document`），避免在组件内遮蔽全局 `document`。

## 接口

`POST /api/devbuddy-left/ai/dispatch`

请求：`{ projectId, document, action, selection, contextBefore?, contextAfter?, followUp?, instruction? }`
`action ∈ { polish, translate, summarize, continue, explain, custom }`
（`instruction` 仅 `custom` 使用：用户在弹层第二行输入的修改意见。白名单由
`AI_ACTION_IDS` 单一来源派生，路由与 host 共用。`custom` 无选区时 `selection`
为空字符串，host 以 `<<<光标>>>` 标记编辑位置。）

响应：`{ delivered, sessionId, text, reason }`

## 验证记录（2026-09-21）

- 会话创建并命名为 `[AI优化]Intent`（会话日志 `session/title` 事件确认）。
- 绑定持久化：`.devbuddy/ai-sessions.json` → `{"Intent.md": "session-2d69af9e-…"}`。
- 连续两次派发（含追问「再简洁一些，控制在 25 个字以内」）**复用同一会话**，
  回复为 21 字，证明上下文连续。
- 返回耗时 2.3s / 32s（修复前为固定 180s 超时挂死）。
- **上下文修复**：「续写」提示词里 `<<<续写点>>>` 前确实带上了真实上文，
  agent 正确接续了 bullet 列表（修复前只发 「12:20」这类片段，回复离题）。
- **去重**：同一会话连续两次相同窗口 → 第二次提示词为
  「（【文档上下文】与上一轮相同，见本会话上一条消息。）」，回复依然正确。

## 已知约束 / 后续

- 绑定不做自动清理：文档改名或删除后，旧绑定会残留（复用时会话仍存在，不影响使用）。
- 同一文档的 AI 会话在 DevBuddy 工作区可见，会产生真实会话记录。
- 首次派发为同步等待（最长 180s），界面上仅表现为 AI 按键变为「AI 处理中…」。
- 去重缓存是进程内 Map，插件重启后第一个请求会重发一次上下文（安全默认）。
- 待定：翻译 / 总结 / 解释等「参考类」动作是否应改为**只展示、不写入文档**。
