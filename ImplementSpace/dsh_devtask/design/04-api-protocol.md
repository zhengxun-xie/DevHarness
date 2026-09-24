# API 协议（API Protocol）

## 1. 总则

- 前缀：`/api/devtask`（`DEVTASK_API_PREFIX`，见 protocol.ts）。
- 所有端点注册为 **exact 路由**，与客户端连接包的 `/api` 前缀路由并存：webServer 先匹配精确表，因此 loopback 请求绕开浏览器鉴权通道，保持同源信任围栏（与 DevBuddy / DevReviewer 同款模式）。
- **所有变更端点返回完整 `DevTaskState`**，不是增量：浏览器永远用返回值整体替换快照，无需对账。
- 错误体统一为 `{ "error": string }`；状态码见各端点。

## 2. 信任围栏（Trust Fence）

每个请求先过 `isTrusted(req)`，任一不满足即 **403**：

| 检查 | 要求 |
| --- | --- |
| 源地址 | `req.socket.remoteAddress` 必须是 loopback（`127.*` / `::1` / `::ffff:127.*`） |
| Host | `req.headers.host` 的 hostname 为 `localhost` / `::1` / loopback |
| Fetch 站点 | `sec-fetch-site` 不为 `cross-site` |
| Origin | 无 Origin 头时放行；有则必须与 Host 同 origin |

## 3. 错误映射

handler 抛错时按消息内容分流：

- 命中 `required|unknown|not found|cannot be removed|must be` → **400**（调用方错误）
- 其余（锁竞争、磁盘、lark-cli 失败）→ **500**

面板把错误消息内联展示在顶部状态条，附「重试」按钮。

## 4. 端点一览

| 方法 | 路径 | 说明 | 成功码 |
| --- | --- | --- | --- |
| GET | `/api/devtask/state` | 全量状态（视图 + 任务 + 名册） | 200 |
| GET | `/api/devtask/activity` | 活动事件流（record-history 聚合，host 缓存 60s） | 200 |
| POST | `/api/devtask/views` | 新增视图 | 200 |
| POST | `/api/devtask/views/remove` | 删除视图 | 200 |
| POST | `/api/devtask/views/select` | 切换激活视图 | 200 |
| POST | `/api/devtask/tasks` | 新建任务（写 Bitable） | 200 |
| POST | `/api/devtask/tasks/update` | 局部更新任务 | 200 |
| POST | `/api/devtask/tasks/remove` | 删除任务（删 Bitable 记录） | 200 |
| POST | `/api/devtask/tasks/move` | 拖拽流转状态 | 200 |
| POST | `/api/devtask/agents` | 新建 agent（registry-only，不碰 Bitable） | 200 |
| POST | `/api/devtask/agents/update` | 改名称/描述/状态 | 200 |
| POST | `/api/devtask/agents/remove` | 删除 agent | 200 |

## 5. 端点契约

### 5.1 GET /state

返回 `DevTaskState`：

```json
{
  "views": [{ "id": "…", "name": "软件组", "scope": "team", "employeeId": null, "order": 0, "createdAt": "…" }],
  "tasks": [{ "id": "rec…", "title": "…", "status": "running", "parentId": null, "dueDate": "…", "progress": 0.5, "…": "…" }],
  "activeViewId": "…",
  "employees": [{ "id": "ou_…", "name": "…" }]
}
```

语义：视图来自 registry.json（normalize 保证至少一个激活视图）；任务与名册来自 Bitable 实时读。

### 5.2 POST /views

Body：

```json
{ "name": "王胡森", "employeeId": "ou_…" }
```

- `employeeId` 必填（任意非空字符串，实际为 Bitable 负责人 open_id）。
- `name` 可选：缺省时 host 查 Bitable 名册取名，取不到退回 id。面板表单只问员工、不问名字，服务端据此命名。
- 副作用：registry.json 追加一条 `scope: 'individual'` 视图并激活；返回新 state。
- 400：`employeeId is required` / `view name is required`。

### 5.3 POST /views/remove

Body：`{ "id": "…" }`

- 400：`view not found`；`the last view cannot be removed`。
- 不删任何任务（任务在 Bitable，与视图无关）。

### 5.4 POST /views/select

Body：`{ "id": "…" }`

- 400：`view not found`。
- 面板以纯客户端即时切换 + 后台静默调用实现零延迟。

### 5.5 POST /tasks

Body：

```json
{ "viewId": "…", "title": "…", "description": "…", "status": "todo", "tags": [] }
```

- `viewId` 用于解析绑定员工：视图为 individual 时其 `employeeId` 成为 Bitable「负责人」；team 视图创建的任务暂不指派（描述里说明后续可在编辑弹窗指派）。
- `status` 必须是五态之一，否则回落 `todo`。
- `priority` 已接受但不写入 Bitable（无对应字段）。
- `tags` 已接受但不持久化（无对应字段），仅内存占位。
- 400：`task title is required` / `view not found`。
- 副作用：Bitable 新增一条记录；返回 state。

### 5.6 POST /tasks/update

Body：

```json
{ "id": "rec…", "patch": { "title": "…", "status": "done", "description": "…" } }
```

- patch 缺省字段不动；`status` 非五态值被忽略（isTaskStatus 闸门）。
- `parentId` / `dueDate` / `progress` 不可写（见数据模型 03 §2）。
- 副作用：Bitable 更新对应字段。

### 5.7 POST /tasks/remove

Body：`{ "id": "rec…" }`

- 直接删除 Bitable 记录，不可恢复（面板有 confirm 二次确认）。

### 5.8 POST /tasks/move

Body：`{ "id": "rec…", "status": "running" }`

- 即看板拖拽的落点；`status` 非五态值 → 400 `unknown status`。
- 写入时五态折叠为表格三选项（backlog/failed → 未开始，见 03 §3）。

### 5.9 GET /activity

Query：`?limit=N`（1–500，默认 100）、`?fresh=1`（绕过 60s 缓存）。

```json
{
  "events": [
    {
      "id": "rec…:29",
      "recordId": "rec…",
      "taskTitle": "机器人视觉目标头部跟踪控制系统V1.0_",
      "operator": "谢郑勋",
      "at": "2026-09-11T05:31:00.000Z",
      "type": "update",
      "changes": [{ "field": "任务状态", "before": "未开始", "after": "进行中" }]
    }
  ]
}
```

- `type`：`create`（新建，`changes` 恒空）/ `update`（字段变更）。
- `changes` 只含白名单字段（见 02 §3.8）；派生字段变更与过滤后无有效 change 的 update 事件不出现在流里。
- 排序：`at` 倒序，取前 `limit` 条。
- 副作用：无（只读）；`fresh=1` 时全量重新聚合（约 30s），结果刷新缓存。

### 5.10 POST /agents

```json
// 请求
{ "name": "Alpha", "description": "检索与资料整理" }
// 响应：DevTaskState（含新 agent，status = provisioning）
```

- `name` 必填（trim 后非空，最长 120）；`description` 可选（最长 500）。
- 重名在花名册内拒绝（400 `agent name already exists`）。
- registry-only 路径：`withLockedJson` 加锁追加后仍走 `fetchState()` 返回全量，浏览器无需再拉一次。
- `description` 缺省时落空串。

### 5.11 POST /agents/update

```json
// 请求
{ "id": "ou…", "patch": { "status": "running" } }
// 响应：DevTaskState
```

- `patch` 三字段全可选：`name`（非空，唯一性同样校验）/ `description` / `status`（`isAgentStatus` 白名单，非法值 400 `unknown agent status`）。
- 未知 id 抛 400 `agent not found`；`updatedAt` 随每次更新刷新。

### 5.12 POST /agents/remove

```json
// 请求 / 响应
{ "id": "ou…" }  →  DevTaskState
```

- 未知 id 抛 400 `agent not found`。
- 纯 registry 删除，不影响任何 Bitable 数据（agent 本来就不是表概念）。

## 6. 浏览器客户端（client/api.ts）

`api.ts` 是上述端点的薄封装，约定：

- `fetch` 相对路径（同源 loopback），统一处理非 2xx：读 `{ error }` 并 throw `Error(error)`。
- 每个方法返回 store 回传的 `DevTaskState | null`。
- 面板侧所有变更走 `run()`：try/catch 包裹，成功 setState + 清错误，失败 setError 内联展示。

## 7. 安全边界小结

- 仅 loopback + 同源可信；默认不对局域网开放（403）。
- 请求体上限 1MB。
- 不持有任何凭证：飞书访问完全由 host 侧 lark-cli（bot 身份）完成，浏览器永远接触不到表格凭证。
