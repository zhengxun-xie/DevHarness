# DevBuddy 文档卡片「富文本/源码」双模式改造

## Context

DevBuddy 左侧栏插件的 `NodeCard.tsx` 当前是「预览/编辑」两模式：`preview` 用外部只读原语 `MarkdownText` 渲染 GFM，`edit` 用本地 `LineNumberTextarea` 编辑 Markdown 源码。

用户需求：把模式按钮改成「富文本/源码」，富文本模式下要**能直接编辑渲染后的内容**（WYSIWYG），且**富文本模式也必须保留 review marks 体验**（高亮、#N chip、选区→addReview 气泡、caretProvider）。

已确认的关键决策（与用户多轮对齐）：
- WYSIWYG 实现：引入第三方库（不自己写 DOM→Markdown 序列化器）。
- 富文本模式保留 review marks（不能只留在源码模式）。
- `preview-marks.ts`（DOM 注入式 review marks，1100+ 行）在改造后变死代码，**删除**，但其中的对齐纯函数先抽取到共享文件供富文本模式复用。

## 选库决策：Tiptap + 官方 `@tiptap/markdown`

| 维度 | Tiptap + `@tiptap/markdown` | Milkdown | Vditor |
|---|---|---|---|
| React 集成 | 一等公民（`@tiptap/react`、`useEditor`、`EditorContent`） | Crepe UI 是 Vue，React 需 `@prosemirror-adapter/react` 桥接 | 无官方 React 适配 |
| Markdown 双向 | `@tiptap/markdown`：`editor.getMarkdown()` + `setContent(md, {contentType:'markdown'})`，GFM 走 `markedOptions.gfm` + Table/TaskList 扩展 | 基于 Remark，原生双向 | 自带 Lute，WYSIWYG/IR/分屏三模式 |
| Review marks 扩展点 | **ProseMirror Decorations API**（`Decoration.inline`/`widget`，自 1.0 稳定，Tiptap v2 全兼容）——富文本 review marks 的原生路径 | 需手写 ProseMirror 插件 | 不暴露 ProseMirror |
| 包体积 | +150–180KB gzip | 相近或更大 | ~500KB+ gzip |
| 维护 | 38K★，活跃 | 生态小 | 维护缓慢 |

**选 Tiptap**：React 一等公民、Markdown 双向成熟、ProseMirror Decorations 给富文本 review marks 原生扩展点、Headless 与现有无框透明编辑器哲学一致。

## 模式枚举与命名

```ts
// NodeCard.tsx:78
export type NodeMode = 'closed' | 'richtext' | 'source'
```

`locales.ts` labels 更新：
- `node.preview` → `node.richtext`：zh `'富文本'` / en `'Rich text'`
- `node.edit` → `node.source`：zh `'源码'` / en `'Source'`
- `node.unsaved`（zh `'有未保存的修改 —— 预览展示的是当前草稿'`）→ zh `'有未保存的修改 —— 当前草稿尚未保存'` / en `'Unsaved changes — the current draft is not saved yet'`
- `node.empty`（zh `'文件为空 —— 点击「编辑」开始填写。'`）→ `'文件为空 —— 点击「富文本」开始填写。'` / en `'Empty file — click Rich text to start.'`

`DevBuddyPanel.tsx` 的 `nodeLabels` 字段名同步改名（`preview→richtext`、`edit→source`）。

## 富文本模式核心实现

### 1. 新建 `src/client/RichTextEditor.tsx`

用 `@tiptap/react` 的 `useEditor` + `EditorContent`，扩展栈：

```ts
extensions: [
  StarterKit,
  Table, TableRow, TableCell, TableHeader,   // GFM 表格
  TaskList, TaskItem,                          // GFM 任务列表
  Link,
  Markdown.configure({ markedOptions: { gfm: true } }),
  ReviewMarksExtension,                       // 富文本 review marks（见下）
]
```

**Props**（与 `LineNumberTextarea` 对称，便于 NodeCard 两模式对称切换）：

```ts
export interface RichTextEditorProps {
  value: string                                   // = draft（Markdown 字符串，真相源）
  onChange(next: string): void                    // editor.getMarkdown() debounce 150ms 回写 draft
  reviewRows: readonly DocumentReviewAnchor[]
  onSelectionChange(info: SelectionRectInfo): void   // LF 偏移
  onSelectionClear(): void
  onAddReview(): void
  onCloseReviewPop(): void
  onOpenReview(reviewId: string): void
  badgeTitle: (item: GutterBadgeItem) => string
  addReviewLabel: string
  closeLabel: string
}
export interface RichTextEditorHandle {
  isFocused(): boolean
  getSelectionRange(): { start: number; end: number } | null   // LF 偏移，给 caretProvider
}
```

### 2. value↔editor 双向同步（最易踩坑点）

- **外→内**（draft 被 discard/source 改动）：用 `lastEmittedRef` 记录上次 `onChange` 发出的字符串；props.value 与 `lastEmittedRef` 不一致时（说明是外部改动），`editor.commands.setContent(value, { contentType: 'markdown' })` 重解析。React 18 StrictMode 下配 `immediatelyRender: false` 防双 mount 抖动。
- **内→外**（用户编辑）：`onUpdate`/`onTransaction` debounce 150ms → `editor.getMarkdown()` → `onChange(md)` → 更新 `lastEmittedRef` 防回环。
- 进入 `richtext` 模式时由 NodeCard 先 seed draft（复用现有 `startEdit` 的 seed 逻辑，泛化为 `startEdit(target)`），RichTextEditor 拿到的 value 一定是已 seed 的 draft。

### 3. 与 NodeCard 的 draft/content/save 对接

- richtext `onChange → setDraft`，与 source `onChange={setDraft}` **完全对称**，`save`/`discard`/`dirty` 逻辑零改动复用。
- `dirty` 判断从 `mode === 'edit'` 改为 `mode === 'richtext' || mode === 'source'`（两个编辑模式都算 dirty）。
- `save()`（NodeCard:390-410）写 draft 到文件、刷新 reviews，不感知模式。
- `discardDraft()`（:383-386）重置 `draft = content`，RichTextEditor 通过外→内通道收到新 value 并 `setContent`。
- **richtext↔source 切换不自动 save**：两模式都是编辑面，draft 在 React state 跨模式保持。移除原 `openPreview` 的"edit→preview 先 save"逻辑。

## 富文本模式 review marks 实现（技术核心）

### 1. LF 偏移 ↔ ProseMirror position 映射

review 锚点数据是 Markdown 源码的 LF 字符偏移（`matchOffsetStart/End`、`lineStart/lineEnd`，基于 `normalizeContent` 后的 \n 偏移）。Tiptap/ProseMirror 用 doc position。富文本模式必须建立双向映射。

**推荐方案：复用 `preview-marks.ts` 的对齐纯函数，retarget 到 ProseMirror doc 树。**

新建 `src/client/doc-alignment.ts`，从 `preview-marks.ts` 抽出这些**纯函数**（不依赖 DOM）：
- `tokenizeSource`、`wordTokens`、`alignWords`、`srcToDomStart/End`、`domToSrc`、`lfToStripped`、`strippedToLf`、`rawLocalToStripped[End]`、`stripLine`、`stripInlineRange`、`isBlockStart`

新增 ProseMirror doc 侧收集（对应 `preview-marks.ts` 的 `collectDomBlocks`）：
- `collectDocBlocks(doc)`：前序遍历 PM doc 节点树，顶层块（paragraph/heading/bullet_list/ordered_list/block_quote/table/horizontal_rule）各自成块，列表项按 `list_item` 收集（嵌套独立），表格按 `table_cell`/`table_header` 展开。
- 块的 `text = node.textContent`（ProseMirror 原生方法）。
- code_block 在富文本里是真实节点，textContent 就是源码 fence 内容，可直接对齐（比 preview 更精确）。

**source 字符串选择（关键）**：富文本模式 source 取 `normalizeContent(editor.getMarkdown())`（实时序列化），而不是磁盘 content。理由：富文本里用户在改文档，marks 应跟着可见内容走。当 `editor.getMarkdown()` 与 `content` 字节级相等时（未编辑纯查看），降级用 `normalizeContent(content)` 跳过序列化开销。

**GFM 语法字符偏移差**：`tokenizeSource` + `stripLine` 已把 `#`/`-`/`**`/`` ` ``/`|`/`[]()` 等 GFM 语法字符识别并跳过，保留可见字符到 raw 的索引。ProseMirror 块的 `textContent` 已是剥完语法字符的可见文本（Tiptap 解析时把 `**` 变 bold mark、`#` 变 heading 节点），与 `SourceBlock.stripped` 词级对齐。**零新语法剥离逻辑**。

**构建/更新时机**：`editor.on('transaction')` debounce 100–150ms 重建 `DocAlignmentModel`，缓存到 ProseMirror plugin state。`editor.on('create')` 后首次构建。doc 变化时 dispatch `bump` meta-transaction 触发 decoration 重算。

**lineLevel 降级**：`matchOffset` 为 null（outdated/orphaned）或对齐 score < 0.5 时，用 `lineStart/lineEnd`（1-based 行号）→ `lfLineToPmRange` 把行号映射到段落边界 PM position，`Decoration.inline` 画整行高亮（class `dbl-rv-line-level`）。跨块时复用 preview-marks.ts 的 `intervalsForBlock` 切分逻辑。

**双向 API**：
```ts
export function buildDocAlignmentModel(doc: PMNode, source: string): DocAlignmentModel
export function lfToPmPos(model: DocAlignmentModel, lf: number, end?: boolean): number | null
export function pmPosToLf(model: DocAlignmentModel, pmPos: number): number | null
export function lfLineToPmRange(model: DocAlignmentModel, lineStart: number, lineEnd: number): { from: number; to: number } | null
```

### 2. 新建 `src/client/rich-text-review-marks.ts`：`ReviewMarksExtension`

Tiptap Extension，`addProseMirrorPlugins()` 注册一个 Plugin：
- `props.decorations(state)`：调用 `buildDecorations(state, options, key)`，对每个 `ACTIVE_REVIEW_STATUSES` 过滤后的 review row：
  1. `lfToPmPos(model, matchOffsetStart)` + `lfToPmPos(model, matchOffsetEnd, true)` → `{ from, to }`。
  2. 精确锚点：`Decoration.inline(from, to, { class: 'dbl-rv-anchor dbl-rv-sev-' + sev + ' dbl-rv-anchor-' + status })`。跨块时首块加 `dbl-rv-edge-start`、末块加 `dbl-rv-edge-end`（CSS inset box-shadow 画边缘竖线，同 preview 的 `minDs`/`maxDe`）。
  3. 零长度 point 锚点：`Decoration.widget(from, () => buildPointElement(specs, handlers))`，返回 `<span class="dbl-rv-point dbl-rv-point-sev-{sev}">`（同 preview `insertPoint`）。
  4. lineLevel（matchOffset null 或漂移）：`Decoration.inline(from, to, { class: 'dbl-rv-hl dbl-rv-line-level dbl-rv-sev-' + sev + ' dbl-rv-anchor-' + status })`。
  5. #N chip：在每段精确/point spec 的末尾 PM position 用 `Decoration.widget` 插入 `<span class="dbl-rv-anchor-nums">` 内含 `<button class="dbl-rv-anchor-num" data-review-id="{id}">{number}</button>`（纯 DOM，不用 ReactNodeView，与 preview `attachNums` 同构）。
- `props.handleClick(view, pos, event)`：事件委托，检查 `event.target` 是否 `[data-review-id]`，从 dataset 读 reviewId 调 `options.getHandlers().openReview(reviewId)`。
- widget button 的 `onMouseDown={e => e.preventDefault()}`（防失焦），同 preview。
- drifted 视觉区分走 CSS class：`valid/moved` 正常 severity tint；`modified` 加 `dbl-rv-anchor-modified`（amber）；`outdated/orphaned` 强制走 lineLevel + `dbl-rv-anchor-lost`（灰色 tint）。

### 3. 选区 → addReview 气泡（不用 `@tiptap/extension-bubble-menu`）

理由：现有 `dbl-rv-fab` 气泡是 NodeCard React 状态驱动（样式、关闭按钮、Escape/scroll 行为已实现），跨 React 边界管理反而麻烦。

在 RichTextEditor 内自写 selection subscription：
```ts
useEditorSubscription(editor, 'selectionUpdate', debounce(() => {
  const { from, to, empty } = editor.state.selection
  if (empty || !editor.isFocused || editor.isComposing) { onSelectionClear(); setFab(null); return }
  const lfStart = pmPosToLf(model, from), lfEnd = pmPosToLf(model, to)
  if (lfStart === null || lfEnd === null) return
  const source = sourceRef.current  // normalizeContent(editor.getMarkdown())
  if (!validateSelection(source.slice(lfStart, lfEnd))) { onSelectionClear(); setFab(null); return }
  const rect = editor.view.coordsAtPos(from)
  const box = wrapRef.current.getBoundingClientRect()
  setFab({ x: clamp(...), y: rect.top - box.top - FAB_GAP - FAB_HEIGHT })
  onSelectionChange({ lfStart, lfEnd })
}, 200))
```
- 气泡 DOM 复用现有 `dbl-rv-fab` 样式，在 RichTextEditor 的 JSX 里渲染。
- Escape/scroll dismiss 复用 LineNumberTextarea 现有 `useEffect`。
- 选区排除 codeBlock：`state.selection.$from.parent.type.name === 'codeBlock'` 时拒绝。

### 4. caretProvider 在富文本模式的实现

`RichTextEditorHandle.getSelectionRange()` 用 `useImperativeHandle`：
```ts
getSelectionRange: () => {
  if (!editor?.isFocused) return null
  const { from, to } = editor.state.selection
  const model = alignmentModelRef.current
  const start = pmPosToLf(model, from), end = pmPosToLf(model, to)
  return start !== null && end !== null ? { start, end } : null
}
```

NodeCard 拆为两个独立 `useEffect`：source 模式注册 `caretProviderSource`（现状），richtext 模式注册 `caretProviderRichtext`（调 `richTextEditorRef.current?.getSelectionRange()`）。`buildAnchorDraft` 用 `normalizeContent(draft)`（draft 是序列化 MD，自洽）。

### 5. review 刷新 → decoration 重建

`reviewRows` 变化时（`refreshReviews` / `onReviewChanged`）：
- RichTextEditor `useEffect(() => { editor?.setOptions({ reviewRows }) })` 把新 rows 传给 Extension options。
- dispatch `bump` meta-transaction，`decorations(state)` 重算。无需重置整个 editor。

## 源码模式

`LineNumberTextarea` 组件**零改动**：
- NodeCard 中 `mode === 'edit'` → `mode === 'source'`。
- 模式按钮 label 用 `labels.source`。
- `caretProviderSource` 仍只在 source 模式注册。
- gutter 徽章、overlay 高亮、pending anchor 气泡全部保留（LineNumberTextarea 现有逻辑不变）。

## 改动文件清单

### 新建

| 文件 | 关键点 |
|---|---|
| `src/client/RichTextEditor.tsx` | Tiptap `useEditor` + 扩展栈 + `ReviewMarksExtension`。`forwardRef<RichTextEditorHandle>`。value↔editor 双向同步、bubble fab、selection subscription、imperative handle。 |
| `src/client/rich-text-review-marks.ts` | `ReviewMarksExtension`（Tiptap Extension）。`buildDecorations`、`buildPointElement`、`buildNumsWidget`（纯 DOM）。chip click 走 editorView 事件委托。 |
| `src/client/doc-alignment.ts` | 从 `preview-marks.ts` 抽出的对齐纯函数 + `DocAlignmentModel`、`buildDocAlignmentModel`、`collectDocBlocks`、`lfToPmPos`、`pmPosToLf`、`lfLineToPmRange`。 |

### 修改

| 文件 | 关键点 |
|---|---|
| `src/client/NodeCard.tsx` | (a) `NodeMode` 改 `'closed'\|'richtext'\|'source'`；(b) 删除 preview 分支与所有 preview 相关 state/逻辑（`previewRef`/`alignmentRef`/`previewFab`/`capturePreviewSelection`/`previewMarkSpecs`/`previewMarkHandlers`/`previewNormalized`/`previewUsesDraft`/`previewText`/`previewEmpty`/`dropRootSelection`/`markdownLabels`、`MarkdownText` import、preview-fab JSX、:582-614 的 useLayoutEffect、:624-697 的 selection effect、:709-717 的 scroll/esc effect）；(c) `startEdit(target)` 泛化，`openPreview` 改名 `openRichText`；(d) `dirty = (mode==='richtext'\|\|mode==='source') && draftSeeded && draft!==content`；(e) 模式按钮两 segment 改 `richtext`/`source`，label 用 `labels.richtext`/`labels.source`；(f) save/discard/dirty-dot 的 `mode==='edit'` 条件改 `mode==='richtext'\|\|mode==='source'`；(g) preview JSX 块替换为 `<RichTextEditor ref={rtRef} value={draft} onChange={setDraft} reviewRows={reviewRows} onSelectionChange={handleSelectionChange} onSelectionClear={clearPending} onAddReview={handleAddReview} onCloseReviewPop={clearPending} onOpenReview={openReviewById} badgeTitle={renderBadgeTitle} addReviewLabel={labels.addReview} closeLabel={labels.closeReview} />`；(h) `caretProvider` 拆 source/richtext 两份，注册条件分别 `mode==='source'`/`mode==='richtext'`；(i) `NodeCardLabels` 改名 `preview→richtext`、`edit→source`，移除 `markdownCopy`/`markdownCopied`/`markdownFootnotes`（preview 专用）。 |
| `src/client/preview-marks.ts` | **删除整个文件**（纯函数已抽到 `doc-alignment.ts`，DOM 注入路线不再被任何模式使用）。 |
| `src/client/DevBuddyPanel.tsx` | `nodeLabels` 字段名 `preview→richtext`、`edit→source`，移除 markdown 三字段；`NodeMode` 类型 follow（仅类型，无逻辑改动）。 |
| `src/client/locales.ts` | `DevBuddyKey` 中 `node.preview`→`node.richtext`、`node.edit`→`node.source`；zh/en 文案按上面 §模式枚举与命名 更新。 |
| `src/client/styles.ts` | 新增 `.dbl-rt-editor` wrapper + `.ProseMirror` 排版（min-height: 200px、padding 0 12px 10px、font 13px/1.7、与 `.dbl-editor-ta` 一致）；补 `.ProseMirror .dbl-rv-hl { position: static; border-radius: 0; }`（覆盖 preview 绝对定位语义）；`.dbl-rv-anchor`/`.dbl-rv-point`/`.dbl-rv-anchor-nums`/`.dbl-rv-anchor-num`/`.dbl-rv-edge-*`/`.dbl-rv-sev-*`/`.dbl-rv-anchor-{modified,outdated,orphaned,lost}`/`.dbl-rv-fab*` 全部保留（Tiptap decoration DOM 与 preview 注入 DOM 同构，CSS 直接复用）；`.dbl-node-md-note` 可删。 |
| `package.json` | 新增依赖：`@tiptap/react`、`@tiptap/core`、`@tiptap/starter-kit`、`@tiptap/extension-table`、`@tiptap/extension-task-list`、`@tiptap/extension-link`、`@tiptap/extension-placeholder`、`@tiptap/markdown`。锁定与 React 18 兼容的 v2.x。 |
| `tsdown.config.ts` | `CLIENT_EXTERNALS` 不变（`@tiptap/*` 全部 inlined 进 client.js）。 |

## 验证方案

### 类型检查与构建
- `pnpm typecheck`（`tsc --noEmit`）须 0 错误。重点核对：`NodeMode` 改名后 `DevBuddyPanel.tsx` 的 `modes: Record<string, NodeMode>`、`handleModeChange`、`onModeChange` 类型一致；`NodeCardLabels` 字段改名后构造处对齐；`RichTextEditorHandle` 与 `editorRef` 类型对接。
- `pnpm build`（tsdown 双产物）须成功；检查 `lib/client.js` 体积增量（预期 +150–180KB gzip），确认 `@tiptap/*` 被 inlined、未触发 externals 报错。

### 手动验证矩阵
1. 富文本模式编辑→保存→重开卡片：内容与 GFM（标题/列表/表格/任务/代码块/链接）round-trip 一致。
2. source↔richtext 切换：draft 不丢；source 里手敲 `**粗体**` 切富文本显示粗体；富文本里加粗后切 source 显示 `**...**`。
3. dirty 点/保存/放弃按钮在 richtext 与 source 都正确出现与消失。
4. **富文本模式 review 体验**：gutter #N chip（widget decoration）、overlay 高亮（inline decoration）、选区→气泡→addReview、caretProvider→reviewer 快速评论均正常；点击 #N chip 跳转 reviewer detail。
5. source 模式 review 体验回归测试（LineNumberTextarea 零改动，应与改造前一致）。
6. reviewer 侧创建/删除评论后，richtext 与 source 模式 marks 都刷新正常（`refreshReviews` + `onReviewChanged`）。
7. lineLevel 降级：模拟 outdated/orphaned 锚点，富文本模式应画整行高亮（`dbl-rv-line-level`）而非精确高亮。
8. React 18 StrictMode 下 RichTextEditor 双 mount 不抖动（`immediatelyRender:false` + `lastEmittedRef` 防回环）。
9. IME 输入期间气泡不抖动（`editor.isComposing` 检查）。

## 风险与降级

| 风险 | 降级策略 |
|---|---|
| 词级对齐精度不足（重 GFM 表格、嵌套列表、HTML 内联） | 对齐 score < 0.5 时 spec 自动降级到 lineLevel。reviewer host 的 anchor resolver 本来就把 offset 当 estimate，模糊度可接受。 |
| `editor.getMarkdown()` 与磁盘 source 漂移（Tiptap 把 `-` 改 `*`、setext heading 改 ATX） | 富文本 alignment source 用 `normalizeContent(editor.getMarkdown())`，与序列化结果自洽。磁盘版本只在 dirty 检测和保存时用，alignment 不读磁盘——Tiptap 序列化风格差异不影响 marks 精度。 |
| Decoration.widget 内 React 生命周期问题 | chip 用纯 DOM（`document.createElement`），与 preview-marks `attachNums` 同构，零 React reconciliation。 |
| Tiptap Decorations API 版本风险 | `Decoration.inline`/`widget`/`Plugin.props.decorations` 自 ProseMirror 1.0 稳定，Tiptap v2 全兼容。无风险。 |
| 富文本编辑后 review 锚点漂移 | reviewer host 在 save 后重算锚点状态（`refreshReviews` 在 `save()` 末尾已调用）。富文本编辑期间锚点沿用磁盘版本 LF 偏移，可能与实时 doc 错位——表现为高亮偏移几字符，降级：alignment score < 0.5 或 LF offset 超出 `editor.getMarkdown()` 长度时自动 lineLevel。 |
| `preview-marks.ts` 删除后其他文件引用断裂 | typecheck 会暴露所有残留 import；`ReviewDetail.tsx` 用的是 `MarkdownText` 不是 `preview-marks`，不受影响。 |

## 实施顺序建议

1. **抽 `doc-alignment.ts`**：从 `preview-marks.ts` 复制纯函数 + 新增 `collectDocBlocks`/`buildDocAlignmentModel`/`lfToPmPos`/`pmPosToLf`/`lfLineToPmRange`。可先单测：给定 fake PM doc + source，验证 `lfToPmPos`/`pmPosToLf` 往返一致。
2. **加 Tiptap 依赖**，搭 `RichTextEditor.tsx` 最小可用版（无 review）：`useEditor` + StarterKit + `@tiptap/markdown`，`onChange` 序列化回 NodeCard 的 `draft`。先打通 NodeCard `richtext` 模式切换 + dirty/save/discard。
3. **加 `ReviewMarksExtension`**，先只画 inline 高亮（无 chip、无 point、无 lineLevel）。
4. 加 chip widget + point widget + lineLevel 降级。
5. 加 selection subscription + bubble fab + `RichTextEditorHandle` + caretProvider 注册。
6. **删 `preview-marks.ts`**，清理 NodeCard 的 preview 残留。
7. CSS 收尾（`.ProseMirror` 排版 + `.dbl-rv-hl` 静态化）。
8. labels/styles/DevBuddyPanel 收尾对齐。
