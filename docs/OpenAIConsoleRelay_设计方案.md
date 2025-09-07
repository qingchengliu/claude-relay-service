# OpenAIConsoleRelay 设计方案（并行提供商，按绑定路由）

本文基于 Codex Wire API 文档中 “Responses API (/v1/responses)” 的接口格式，以及抓包示例请求/响应（C:\Users\13363\Downloads\codex_req.txt），设计新增 “OpenAIConsoleRelay” 能力：作为一个与 Azure OpenAI、Claude Console 等并行的提供商类型，通过上游 BaseURL 的 `/v1/responses` 端点提供转发服务。

本方案仅为设计，不包含任何代码实现。

## 目标与边界
- 对外暴露统一入口：`POST /openai/responses`（保持现有路径与行为约定）。
- 新增 OpenAI Console 提供商（与 Azure OpenAI、OpenAI OAuth 并行），按 API Key 的“专属绑定”进行路由，不增加“启用开关”或“路由优先级”类额外配置。
- 支持 SSE 与非流式，兼容抓包所示 `OpenAI-Beta: responses=experimental` 及 `session_id` 等头部。
- 解析 usage（SSE 完成事件或非流式响应体）并对齐现有记账与监控。
- 保持对现有 OAuth OpenAI 和 Azure OpenAI 流程无破坏。

不在范围：
- 新的全局“优先级/启用”配置（沿用现有系统在“账号”和“API Key 绑定”层面的既有优先级语义）。
- 修改现有 OpenAI OAuth 或 Azure OpenAI 行为（仅在 API Key 绑定到 OpenAI Console 时使用 Console 上游）。

## 上游接口与头规范（依据文档与抓包）
- 端点：`POST {baseUrl}{responsesPath}`，默认 `responsesPath = /v1/responses`
- 关键请求头：
  - `Authorization: Bearer <TOKEN>` 或 `x-api-key: <TOKEN>`（按上游类型）
  - `OpenAI-Beta: responses=experimental`
  - `Accept: text/event-stream`（流式）或 `application/json`（非流）
  - `Content-Type: application/json`
  - `session_id: <uuid>`（可选，用于会话关联/缓存）
- 可选/诊断：`User-Agent`, `chatgpt-account-id`（如上游需要）等。
- 请求体：`model`, `instructions`, `input[]`, `tools`, `tool_choice`, `parallel_tool_calls`, `reasoning`, `store`, `stream`, `include`, `prompt_cache_key`, `text.verbosity` 等（默认 `stream: true` 与现有一致）。
- SSE 事件：兼容 `response.completed` 与 `response.done`，识别 `response.output_text.delta` 等增量事件。

## 架构与职责划分

### 1) OpenAIConsoleAccount（账户）
- 定义一个新的“OpenAI Console 账户”实体，与下列账户并行：
  - OpenAI OAuth 账户（openaiAccountService）
  - Azure OpenAI 账户（azureOpenaiAccountService）
  - Claude Console 账户（claudeConsoleAccountService）
- 数据字段（对齐现有账户模型习惯）：
  - 基本：`id`, `name`, `baseUrl`, `responsesPath`(默认`/v1/responses`), `isActive`, `schedulable`, `priority`, `createdAt`, `updatedAt`, `lastUsedAt`
  - 认证：`auth.type`（`bearer`|`x-api-key`|`none`），`auth.token`（建议加密存储）
  - 头部：`headers`（可选 KV，默认包含 `OpenAI-Beta: responses=experimental`）
  - 代理：`proxy`（与 ProxyHelper 统一结构一致）
  - 能力：`supportedModels`（数组或映射，支持模型别名映射）
  - 观测：`status`（`active`/`limited`/`overloaded`/`error` 等）、`rateLimit` 标记、最近错误计数等

- 管理 API（与 Azure/ClaudeConsole 风格保持一致）：
  - `GET /admin/openai-console-accounts` 列表
  - `POST /admin/openai-console-accounts` 创建/更新（含连通性测试可选）
  - `PUT /admin/openai-console-accounts/:id` 更新
  - `DELETE /admin/openai-console-accounts/:id` 删除或停用
  - `POST /admin/openai-console-accounts/:id/test` 连通性测试（最小 payload；非流式）

### 2) OpenAIConsoleRelayService（转发）
- 负责将请求转发至 `{baseUrl}{responsesPath}`，并桥接 SSE/非流式响应：
  - Header 处理：
    - 过滤敏感/逐跳头：`authorization`, `x-api-key`, `host`, `content-length`, `connection`, `proxy-authorization`, `content-encoding`, `transfer-encoding` 等
    - 设置必要头：`OpenAI-Beta: responses=experimental`（若未显式指定）、`Accept`, `Content-Type`
    - 透传：`session_id`, `User-Agent`（优先客户端 UA）
    - 注入上游认证：`Authorization: Bearer` 或 `x-api-key`
  - 代理：按账户的 `proxy` 配置创建 `httpsAgent`（禁用 axios proxy 字段，统一走自建 agent）
  - SSE：
    - 下游设置 `text/event-stream` 等头，边转发边解析事件
    - 在 `response.completed/done` 事件收集 `usage`（`input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`, `input_tokens_details.cache_creation_tokens`）与 `model`
  - 非流式：直接返回 JSON；若响应体包含 `usage` 则可用于记账
  - 错误映射：透传上游状态码与错误体；超时/断连返回 502/504 并带错误信息

### 3) 路由集成（/openai/responses）
- 决策原则：仅按 API Key 的“专属绑定”决定转发提供商；不引入新的“启用开关/优先级”配置。
  - 若 `apiKey.openaiConsoleAccountId` 已绑定 → 使用 OpenAIConsoleRelayService 转发到该账户的 BaseURL `/v1/responses`
  - 否则若 `apiKey.openaiAccountId` 已绑定 → 走现有 OpenAI OAuth（ChatGPT Codex）流程
  - 否则若 `apiKey.azureOpenaiAccountId` 已绑定 → 走 Azure OpenAI 流程
  - 否则 → 根据现有系统既定策略返回错误或提示未绑定
- 说明：
  - 不做“自动在多个提供商之间切换”的路由策略，不添加“openaiRouteMode/openaiConsoleEnabled”等新字段。
  - 是否“共享池”或“专属绑定”由现有账号池与 API Key 绑定机制决定（与 Azure/ClaudeConsole 保持一致）。

### 4) API Key 配置（与现有保持一致的方式）
- API Key 页面支持“专属账号绑定”：
  - 新增 “OpenAI Console 专属账号” 下拉（与 Azure OpenAI、OpenAI OAuth 等并列）
  - 可在同一页面便捷跳转到“创建 OpenAI Console 账户”，填写：`baseUrl`、`responsesPath`（默认 `/v1/responses`）、认证、代理、额外头、支持模型与优先级等
- 不新增以下字段：
  - 不需要 `openaiConsoleEnabled`
  - 不需要 `openaiRouteMode`

## usage 统计与监控
- 统计来源：
  - 非流式：响应体中的 `usage`
  - 流式：完成事件中的 `usage`（`response.completed`/`response.done`）
- 记账：沿用 `apiKeyService.recordUsage(...)` 或统一的新版 `recordUsageWithDetails(...)`
- 头部透传白名单（下游响应）：`openai-version`, `x-request-id`, `openai-processing-ms`, `x-chatgpt-account-id` 等（避免传输相关头冲突）
- 代理与状态监控：记录代理信息（脱敏）、上游响应码、时延、限流/过载标识

## 安全
- 认证 token 加密存储（沿用 AES-256-CBC 与统一 KDF）
- 日志脱敏（不打印明文 token 与隐私头）
- 账户连通性测试走最小化请求并限制输出

## 兼容性与迁移
- 不改变现有 `/openai/responses` 对 OAuth/ Azure 的既有行为
- 仅在 API Key 显式绑定 OpenAI Console 账户时走 Console 上游
- 支持在不重启的情况下增删 OpenAI Console 账户（与其他账户管理一致）

## 里程碑与实施计划
- M1：
  - 定义 OpenAIConsoleAccount 数据结构与管理 API（CRUD、测试、状态/优先级）
  - 实现 OpenAIConsoleRelayService（SSE/非流式、headers/代理/错误处理、usage 解析）
  - 在 `/openai/responses` 中按“专属绑定”接入 Console 路径（不更改其他路径）
- M2：
  - Admin UI：新增 OpenAI Console 账户管理页（与 Azure/ClaudeConsole 风格统一）
  - API Key 创建/编辑：新增“OpenAI Console 专属账号”绑定；可一键创建并回填
- M3：
  - 完善日志与观测：限流/过载的自动标记与恢复、失败重试策略
  - 扩展支持的事件类型与头部透传白名单

## 验收清单
- 能以绑定到 OpenAI Console 账户的 API Key 调用 `/openai/responses`：
  - 非流式：返回 200 JSON，包含 model/usage；系统成功记账
  - 流式：SSE 正常推送，完成事件解析 usage；系统成功记账
- 未绑定 Console 的 Key 仍按原有 OAuth/Azure 行为工作
- 代理可按账户配置生效；错误时有清晰日志与错误透传

### 3.1 共享账户与分组调度（补充）
- 账户来源优先级（仅针对 OpenAI Console 类型）：
  1) 专属绑定：API Key 显式绑定 openaiConsoleAccountId → 直选该账户。
  2) 粘性会话：存在会话映射且账户仍可用 → 沿用映射（见 3.2）。
  3) 分组绑定：API Key 绑定分组 group:<id>（平台为 openai_console）→ 从分组成员中择优选择。
  4) 共享池：从全部 openai_console 可调度账户池中选择。
- 可调度条件：isActive 为真、schedulable 未禁用、未处于限流/过载/错误状态、模型支持匹配（必要时做模型别名映射）。
- 选择排序：先按 priority（数值越小优先级越高或依系统约定），再按 lastUsedAt（最久未使用优先），与现有调度策略保持一致。
- 分组平台：为避免与 OAuth 混淆，建议新增/沿用平台标识 openai_console 的账户分组（与 openai 平台的 OAuth 账户分组并行存在）。

### 3.2 粘性会话（补充）
- 会话哈希：使用请求头/体中的 session_id（或既有算法）计算哈希值 sessionHash。
- 映射键：与现有 OpenAI 粘性逻辑一致，键名延用 unified_openai_session_mapping:{sessionHash}，映射值加入 ccountType: 'openai-console'，例如：{ accountId, accountType: 'openai-console' }。
- 生存期：与现有一致（例如 1 小时），并在以下情况清理映射：401/403、429 限流、连续 5xx 超阈值、账户被标记为不可用或退出分组。
- 成功路径：2xx 成功或正常完成 SSE 时更新 lastUsedAt，必要时移除先前的“限流/过载”标记。
- 回退：当粘性账户不可用时，删除映射并按 3.1 的顺序重新选择（不会引入新的全局优先级字段）。

### 3.3 与现有统一调度器的关系（补充）
- 推荐扩展现有统一调度器（如 unifiedOpenAIScheduler）以纳入 openai-console 账户类型：
  - 获取候选时同时汇聚 OAuth（openai）与 Console（openai-console）两类来源，再按 3.1 排序；
  - 或者为 Console 维护独立的聚合逻辑，但对外通过同一套粘性会话键与状态标记，保持体验一致。
- API Key 可绑定到分组或专属账户；若两类账户（OAuth 与 Console）均配置，实际使用哪个由绑定对象与分组平台决定；无额外"启用/优先级"新字段。

## 最终实现架构

### 后端实现

#### 1. 核心服务模块

**openaiConsoleAccountService.js** (新建)
- 位置：`src/services/openaiConsoleAccountService.js`
- 职责：OpenAI Console账户的完整生命周期管理
- 功能：
  - 使用AES-256-CBC加密存储API密钥
  - 提供完整的CRUD操作接口
  - 支持账户连通性测试
  - Redis键：`openai_console_account:{id}`

**openaiConsoleRelayService.js** (新建)
- 位置：`src/services/openaiConsoleRelayService.js`
- 职责：处理请求转发和响应处理
- 功能：
  - 构建上游请求头（包含OpenAI-Beta: responses=experimental）
  - 支持SSE流式响应转发
  - 支持非流式JSON响应
  - 解析usage数据并记录统计
  - 代理支持（HTTP/SOCKS5）

#### 2. 路由集成

**openaiConsoleAdmin.js** (新建)
- 位置：`src/routes/openaiConsoleAdmin.js`
- 独立的管理路由文件
- 端点：
  ```
  GET    /admin/openai-console-accounts       # 列表
  POST   /admin/openai-console-accounts       # 创建
  PUT    /admin/openai-console-accounts/:id   # 更新
  DELETE /admin/openai-console-accounts/:id   # 删除
  POST   /admin/openai-console-accounts/:id/test # 测试
  ```

**admin.js** (最小化修改)
- 仅添加3行代码引入openaiConsoleAdmin路由：
  ```javascript
  try {
    const openaiConsoleAdminRoutes = require('./openaiConsoleAdmin')
    router.use('/', openaiConsoleAdminRoutes)
  } catch (e) {}
  ```

**openaiRoutes.js** (最小化修改)
- 在`/openai/responses`端点添加OpenAI Console支持
- 路由决策逻辑：
  1. 检查API Key的openaiConsoleAccountId绑定
  2. 若绑定则使用openaiConsoleRelayService转发
  3. 否则走现有OAuth/Azure流程

#### 3. 调度器集成

**unifiedOpenAIScheduler.js** (最小化修改)
- 直接导入openaiConsoleAccountService（无条件加载判断）
- 在账户聚合时包含OpenAI Console账户
- 复用现有的粘性会话和优先级机制

### 前端实现

#### 1. 账户管理界面

**OpenAIConsoleAccounts.vue** (新建)
- 位置：`web/admin-spa/src/views/OpenAIConsoleAccounts.vue`
- 完整的账户管理UI组件
- 功能：
  - 账户列表展示（表格/卡片双模式）
  - 创建/编辑账户对话框
  - 连通性测试
  - 代理配置
  - 支持暗黑模式和响应式设计

#### 2. 现有视图集成

**AccountsView.vue** (最小化修改)
- 添加'openai-console'到平台选项
- 支持加载和显示OpenAI Console账户
- 复用现有的账户显示组件

**ApiKeysView.vue** (最小化修改)
- 在账户绑定部分支持OpenAI Console
- 更新getBoundAccountName函数识别新账户类型
- 更新getOpenAIBindingInfo函数处理Console账户

**TabBar.vue** (未修改)
- 现有导航结构已满足需求，无需修改

**router/index.js** (最小化修改)
- 添加OpenAI Console账户管理路由：
  ```javascript
  {
    path: '/openai-console-accounts',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'OpenAIConsoleAccounts',
        component: OpenAIConsoleAccounts
      }
    ]
  }
  ```

### 技术决策

1. **加密方案**：使用AES-256-CBC对API密钥进行加密存储，与现有系统保持一致

2. **最小化改动原则**：
   - 创建独立的服务和路由文件
   - 现有文件仅添加必要的引用和条件分支
   - 避免修改核心业务逻辑

3. **路由策略**：基于API Key的专属绑定，不引入新的全局优先级配置

4. **前端架构**：
   - 使用Vue 3 Composition API
   - 支持响应式设计和暗黑模式
   - 复用现有的UI组件和样式系统

### 数据模型

OpenAI Console账户结构：
```javascript
{
  id: string,
  name: string,
  baseUrl: string,
  responsesPath: string (默认: /v1/responses),
  authType: 'bearer' | 'x-api-key',
  apiKey: string (加密存储),
  isActive: boolean,
  schedulable: boolean,
  priority: number,
  proxy: {
    type: string,
    host: string,
    port: number,
    username: string,
    password: string
  },
  supportedModels: array,
  headers: object,
  status: string,
  createdAt: timestamp,
  updatedAt: timestamp,
  lastUsedAt: timestamp
}
```

### 使用流程

1. **账户配置**：
   - 管理员在OpenAI Console账户页面创建账户
   - 配置BaseURL、认证方式、代理等
   - 测试连通性

2. **API Key绑定**：
   - 在API Key管理页面选择OpenAI Console账户绑定
   - 系统自动将该Key的请求路由到绑定的Console账户

3. **请求处理**：
   - 客户端使用API Key调用`/openai/responses`
   - 系统根据绑定关系选择OpenAI Console账户
   - 通过openaiConsoleRelayService转发请求
   - 返回流式或非流式响应并记录usage

### 监控与观测

- 请求日志记录所有转发详情
- Usage统计集成到现有系统
- 错误追踪包含上游状态码和错误信息
- 代理连接状态监控
