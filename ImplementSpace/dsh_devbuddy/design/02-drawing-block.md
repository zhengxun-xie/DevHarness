# 画板（Excalidraw 嵌入）设计

## 机制总览

富文本文档里嵌入画板，画板内容是**项目资产文件**，不进 markdown 正文。

```
markdown:  ![[diagram-1.excalidraw]]          (wikilink，规范化后的标准写法)
           ![](diagram-1.excalidraw)          (标准图片语法，同样识别)
                │ drawingBlock (Tiptap 节点) 解析/序列化
                ▼
文件:      <project>/diagram-N.excalidraw   （Excalidraw 场景 JSON）
```

两种写法都在**独立成行（块级）**时识别；保存时统一规范化为 `![[…]]`。
段中出现（行内）不识别——wikilink 亦同。

- 分配：`POST /drawing/create` → `nextDrawingSrc()` 找项目根下第一个空闲的
  `diagram-N.excalidraw`（N 从 1 起，上限 9999）→ 写入空场景 → 返回 `{ src }`。
- 读写：`GET /drawing?projectId&src` / `POST /drawing`（校验 src 必须以
  `.excalidraw` 结尾、不得绝对路径、不得越出项目根 `assertInside`）。
  写入原子（tmp + rename）。`POST` 侧校验内容必须是 `type:"excalidraw"` 的 JSON。
- 展示：文档中由 `DrawingBlockView` 渲染缩略图（空场景/缺文件给紧凑占位）；
  点击打开 `ExcalidrawModal` 全屏编辑，防抖保存（SAVE_DEBOUNCE_MS）。

## 浏览器端 Excalidraw 的加载方式

主 client.js **不**静态打进 @excalidraw/excalidraw（否则每个会话都要背 11MB），
而是运行时懒加载：

1. tsdown 单独产出 `lib/excalidraw-bundle.js`（CJS，react/react-dom 为 external）；
2. host 在 `GET /api/devbuddy-left/excalidraw-bundle.js` 提供该文件
   （`cache-control: public, max-age=3600`，浏览器缓存 1 小时）；
3. `excalidraw-loader.ts` fetch 该文件 → `new Function('require','module','exports', …)`
   沙箱求值 → 合成 `require` 只提供 `react` / `react-dom` / `react/jsx-runtime`
   （映射到平台已注入主 client 的同一 React 实例，避免双 React 实例）→
   返回 `module.exports`（Excalidraw 组件、serializeAsJSON、exportToBlob、restore、CSS）。
   结果按文档生命周期缓存（inflight 去重，避免并发双拉）。

## 已知坑

### `require("crypto")`（2026-09-21 修复）

**症状**：插入画板后 modal 报「无法加载画板文件」，但画板文件本身完好
（create 成功、GET /drawing 200、JSON 合法）。

**根因**：Excalidraw 依赖 `uuid@14`，其 Node 入口（`dist-node/v4.js`）被 tsdown
打进 bundle 后，在**模块顶层** `require("crypto")` 并使用 `randomFillSync`
（另有 ESM 互操作里的 `.default` 访问）。浏览器的合成 require 只认
react 三件套 → 求值即抛 `unresolvable require "crypto"` → loader reject →
modal fatal。两条 fatal 路径（bundle 失败 / 场景请求失败）共用同一条文案，
所以症状有误导性——画板文件从来不是问题。

**修复**：`excalidraw-loader.ts` 增加 `cryptoShim`（`randomUUID` /
`randomFillSync` 由浏览器 Web Crypto `getRandomValues`/`randomUUID` 实现，
附 `default` 自指满足互操作），合成 require 增加 `if (mod === 'crypto')`。

**验证方法**（无需浏览器）：Node 里复刻浏览器加载器（同样的合成 require +
`new Function` + 浏览器全局桩 window/document/navigator/Element 等），
对 `lib/excalidraw-bundle.js` 求值：
- 不带 shim → `unresolvable require "crypto"`（复现用户症状）；
- 带 shim → EVAL OK，导出齐全（Excalidraw / serializeAsJSON / exportToBlob /
  restore / restoreElements / CSS 144KB）。
测试脚本模式见会话记录（/tmp/bundle-eval4.mjs 的思路）。

### 其它备忘

- bundle 里唯一的 require 缺口就是 crypto（模拟器完整跑通后确认）；
  若未来升级 Excalidraw 出现新 require，模拟器会立刻暴露。
- 静态文件服务是每请求 `readFile`、无服务端缓存：**client-only 改动硬刷新即可，
  不必重启 dsh-web**；host（lib/index.js）改动才需要重启。
- bundle 构建有 jotai 的 EMPTY_IMPORT_META 警告——求值实测无害。

## 与 dsh-diagram 插件的关系（为何不复用它）

`dsh-diagram`（第三方，hanzhangzzz/dsh-diagram v0.5.0）是会话侧「文章转画布」
插件：host 注册 `canvas-diagram` skill + `diagram_create` tool + webServer 路由，
`lib/editor/` 是 22MB 独立 Vite 应用（画布 tab 的 iframe），画布数据存 DSH 会话。

不复用的原因：
1. **没有插件间契约**——它不 provide 任何可 inject 的 host 服务，另一个插件
   无法以 cordis 方式调用它；只有面向 agent 的 tool/skill。
2. **数据模型不匹配**——它的画布挂在会话上（diagram id），不落项目文件；
   DevBuddy 画板必须是项目资产（`![[引用]]`、随项目走、可 git 管理、可评审）。
3. **体验**——DevBuddy 需要编辑器嵌在面板 React 树里（同主题/同交互），
   iframe 嵌它需要上游先提供「打开外部 .excalidraw 文件」的能力（提 PR，不可控）。

结论：自研嵌入编辑器 + 修 require 缺口，是当前最小且完全自主的路径。
