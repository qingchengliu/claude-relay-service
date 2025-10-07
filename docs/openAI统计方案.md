# OpenAI Responses API 代码统计功能实现方案

## 实现状态

✅ **已完成实现** - 2025/10/07

## 背景

Codex CLI 通过 OpenAI Responses API 调用时会产生工具调用（如 `shell`、`apply_patch` 等），需要统计这些编辑操作以支持代码统计排行榜功能。

## 技术方案：扩展现有插件

### 核心架构

```
OpenAI API Response (SSE流)
  ↓ 收集 output items
openaiRoutes.js (end事件)
  ↓ 调用钩子 afterUsageRecord
plugins/code-statistics/index.js
  ↓ handleAfterUsageRecord
plugins/code-statistics/statistics.js
  ↓ extractEditStatistics
    ├─ normalizeResponseItems (格式检测)
    ├─ extractOpenAIItems (提取OpenAI工具调用)
    └─ normalizeOpenAIToolItem (格式转换)
  ↓ 统一的 tool_use 格式
processToolUse / processBashCommand
  ↓ 统计行数、文件类型、语言
redis-extension.js (recordEditStatistics)
  ↓ 存储到 Redis
web-routes.js (API查询)
  ↓ 展示排行榜
```

## 已实现的关键功能

### 1. OpenAI 响应格式支持 (`statistics.js`)

#### 格式规范化
```javascript
function normalizeResponseItems(response) {
  // 1. 提取 Claude 格式: response.content[]
  // 2. 提取 OpenAI 格式: response.items[], response.output[]
  // 3. 去重（基于 name|callId|input）
  // 4. 返回统一的 tool_use 格式
}
```

#### OpenAI 工具类型映射

| OpenAI 类型 | 映射到 | 工具名称 | 说明 |
|------------|--------|---------|------|
| `custom_tool_call` | `tool_use` | `item.name` | Codex自定义工具 |
| `function_call` | `tool_use` | `item.name` | 函数调用 |
| `local_shell_call` | `tool_use` | `Bash` | Shell命令 |
| `tool_call` | `tool_use` | `item.function.name` | 标准工具调用 |

#### apply_patch 特殊处理
```javascript
// 解析 Patch 格式，支持多文件操作
function processApplyPatchTool(toolUse) {
  // 1. 提取 patch 文本
  // 2. 解析 *** Add File / Update File / Delete File
  // 3. 统计每个文件的行数变更
  // 4. 返回多个结果（每个文件一个）
}
```

### 2. OpenAI 路由钩子集成 (`openaiRoutes.js`)

#### 流式响应统计
```javascript
// 收集所有 output items
upstream.data.on('data', (chunk) => {
  if (eventData.type === 'response.output_item.done') {
    collectedOutputItems.push(eventData.item)
  }
  if (eventData.type === 'response.completed') {
    latestResponseSnapshot = eventData.response
  }
})

// 流结束时调用钩子
upstream.data.on('end', async () => {
  const responseForStats = {
    ...latestResponseSnapshot,
    items: collectedOutputItems  // 包含所有工具调用
  }

  await global.pluginHooks.afterUsageRecord(
    apiKeyData.id,
    usageData,
    modelForHook,
    responseForStats  // 完整响应对象
  )
})
```

#### 非流式响应统计
```javascript
// 直接使用完整响应
const responseData = upstream.data
await global.pluginHooks.afterUsageRecord(
  apiKeyData.id,
  usageData,
  actualModel,
  responseData  // 包含所有 output
)
```

## 数据流示例

### Codex CLI 请求示例
```json
{
  "model": "gpt-5-codex",
  "stream": true,
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [{"type": "input_text", "text": "删除某个测试文件"}]
    }
  ]
}
```

### OpenAI 响应格式 (SSE事件)
```javascript
// 工具调用事件
{
  "type": "response.output_item.done",
  "item": {
    "type": "custom_tool_call",
    "name": "apply_patch",
    "call_id": "call_xxx",
    "input": "*** Begin Patch\n*** Delete File: test.java\n*** End Patch"
  }
}

// 完成事件
{
  "type": "response.completed",
  "response": {
    "model": "gpt-5-codex",
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 567
    },
    "output": [...]  // 包含所有工具调用的完整输出
  }
}
```

### 转换后的统一格式
```javascript
{
  type: 'tool_use',
  name: 'apply_patch',
  input: {
    patch: '*** Begin Patch\n*** Delete File: test.java\n*** End Patch'
  },
  callId: 'call_xxx',
  source: 'openai',
  raw: {...}  // 原始数据
}
```

### 统计结果
```javascript
{
  totalEditedLines: 0,      // 删除操作不计行数
  editOperations: 1,        // 1次编辑操作
  newFiles: 0,
  modifiedFiles: 0,
  languages: {},
  fileTypes: { java: 0 },
  toolUsage: {
    'apply_patch': 1        // apply_patch 被调用1次
  }
}
```

## 支持的工具统计

### 编辑工具
- ✅ `apply_patch` - Codex patch格式（支持多文件）
- ✅ `Edit` - Claude 单文件编辑
- ✅ `MultiEdit` - Claude 多处编辑
- ✅ `Write` - 新建文件
- ✅ `NotebookEdit` - Jupyter notebook编辑

### Shell工具
- ✅ `Bash` / `local_shell_call` - Shell命令
  - 支持 PowerShell 命令识别
  - 支持文件操作命令（echo, cat, sed, touch等）

### 读取工具（不计入编辑统计）
- ✅ `Read` - 读取文件
- ✅ `Glob` - 文件搜索
- ✅ `Grep` - 内容搜索

## Redis 数据结构

统计数据与 Claude 共享相同的 Redis 键结构：

```
code_stats:key:{keyId}                    # API Key总统计
code_stats:daily:{keyId}:{date}           # 每日统计
code_stats:monthly:{keyId}:{month}        # 每月统计
code_stats:key:{keyId}:language:daily:{lang}:{date}  # 语言统计
code_stats:tool:daily:{toolName}:{date}   # 工具使用统计
```

## 排行榜统计

OpenAI 和 Claude 的统计数据在同一排行榜展示：

- **总行数排行** - `totalEditedLines`
- **单测行数排行** - `totalTestLines` (java-test语言)
- **编辑次数排行** - `totalEditOperations`
- **新建文件排行** - `totalNewFiles`
- **修改文件排行** - `totalModifiedFiles`
- **工具使用排行** - 按工具类型统计

## Web API 端点

所有现有的统计 API 自动支持 OpenAI 数据：

- `GET /plugin/code-statistics/leaderboard` - 排行榜
- `GET /plugin/code-statistics/users/:keyId` - 用户详情
- `GET /plugin/code-statistics/tools` - 工具统计
- `GET /plugin/code-statistics/languages` - 语言统计

## 测试验证

### 验证步骤
1. 使用 Codex CLI 发起请求到 `/openai/v1/responses`
2. 触发文件编辑操作（apply_patch）
3. 检查日志：`📊 Code statistics extracted`
4. 查询排行榜 API 确认数据记录

### 日志示例
```
[INFO] 📊 Code statistics extracted {
  lines: 15,
  operations: 1,
  tools: 1,
  toolList: 'apply_patch'
}
[INFO] 📊 Code statistics recorded for key: xxx
```

## 优势

1. **代码复用** - 统计逻辑、Redis存储、Web API完全复用
2. **统一展示** - Claude 和 OpenAI 数据在同一排行榜
3. **格式兼容** - 支持多种 OpenAI 工具调用格式
4. **向后兼容** - 不影响现有 Claude 统计功能
5. **易于维护** - 集中管理，避免代码重复

## 扩展支持

如需支持更多 OpenAI 工具类型，在 `statistics.js` 的 `normalizeOpenAIToolItem()` 中添加新的类型映射即可：

```javascript
else if (type === 'new_tool_type') {
  results.push({
    type: 'tool_use',
    name: 'NewTool',
    input: {...},
    callId: item.id,
    source: 'openai',
    raw: item
  })
}
```

## 参考文件

- `plugins/code-statistics/statistics.js` - 核心统计逻辑
- `plugins/code-statistics/index.js` - 钩子处理
- `src/routes/openaiRoutes.js` - OpenAI 路由
- `src/services/openaiResponsesRelayService.js` - OpenAI-Responses 服务
- `plugins/code-statistics/redis-extension.js` - Redis 存储
- `plugins/code-statistics/web-routes.js` - Web API

## 更新日志

- **2025/10/07** - 初始实现完成
  - 支持 OpenAI Responses API 格式解析
  - 支持 apply_patch、shell、function_call 等工具
  - 集成到现有统计系统
  - 流式和非流式响应均支持
