/**
 * 从 Claude 响应中提取编辑操作和工具调用统计
 */
function extractEditStatistics(response) {
  const logger = require('../../src/utils/logger')

  // 开始统计提取

  const stats = {
    totalEditedLines: 0,
    editOperations: 0,
    newFiles: 0,
    modifiedFiles: 0,
    languages: {},
    fileTypes: {},
    toolUsage: {} // 新增：工具调用统计
  }

  const normalizedItems = normalizeResponseItems(response)

  if (normalizedItems.length === 0) {
    logger.debug('📊 [Stats Extract] No tool usage items found in response', {
      hasResponse: !!response,
      hasContentArray: Array.isArray(response?.content),
      hasOutputArray: Array.isArray(response?.output),
      hasItemsArray: Array.isArray(response?.items)
    })
    return stats
  }

  for (const item of normalizedItems) {
    if (!item || item.type !== 'tool_use') {
      continue
    }

    const toolName =
      item.name || item.function?.name || item.tool_name || item.toolName || 'Unknown'

    stats.toolUsage[toolName] = (stats.toolUsage[toolName] || 0) + 1

    let result = null

    if (isEditTool(toolName)) {
      result = processToolUse(item)
    } else if (toolName === 'Bash') {
      result = processBashCommand(item)
    } else {
      result = processOtherTool(item)
    }

    const results = Array.isArray(result) ? result : result ? [result] : []

    for (const singleResult of results) {
      if (!singleResult) {
        continue
      }

      const normalizedFileType =
        typeof singleResult.fileType === 'string'
          ? singleResult.fileType.trim().toLowerCase()
          : null

      const isTargetFile =
        normalizedFileType && isCodeFileExtension(normalizedFileType)

      if (!isTargetFile) {
        continue
      }

      const editedLines = singleResult.lines || 0
      const operations = singleResult.operations || 0

      stats.totalEditedLines += editedLines
      stats.editOperations += operations

      if (singleResult.type === 'create') {
        stats.newFiles++
      } else if (singleResult.type === 'modify') {
        stats.modifiedFiles++
      }

      if (normalizedFileType) {
        stats.fileTypes[normalizedFileType] =
          (stats.fileTypes[normalizedFileType] || 0) + editedLines
      }

      if (singleResult.language) {
        stats.languages[singleResult.language] =
          (stats.languages[singleResult.language] || 0) + editedLines
      }
    }
  }

  // 记录关键统计结果
  if (stats.totalEditedLines > 0 || Object.keys(stats.toolUsage).length > 0) {
    logger.info('📊 Code statistics extracted', {
      lines: stats.totalEditedLines,
      operations: stats.editOperations,
      tools: Object.keys(stats.toolUsage).length,
      toolList: Object.keys(stats.toolUsage).join(', ') // 添加工具列表日志
    })
  }

  return stats
}

function normalizeResponseItems(response) {
  const items = []

  if (!response) {
    return items
  }

  if (Array.isArray(response.content)) {
    for (const item of response.content) {
      if (item?.type === 'tool_use') {
        items.push(item)
      }
    }
  }

  const openaiItems = extractOpenAIItems(response)
  if (openaiItems.length > 0) {
    const seenKeys = new Set()

    for (const rawItem of openaiItems) {
      const normalizedList = normalizeOpenAIToolItem(rawItem)
      for (const normalized of normalizedList) {
        if (!normalized || normalized.type !== 'tool_use' || !normalized.name) {
          continue
        }

        const cacheKey = `${normalized.name}|${normalized.callId || ''}|${JSON.stringify(
          normalized.input || {}
        )}`

        if (seenKeys.has(cacheKey)) {
          continue
        }

        seenKeys.add(cacheKey)
        items.push(normalized)
      }
    }
  }

  return items
}

function extractOpenAIItems(payload) {
  const collected = []

  if (!payload || typeof payload !== 'object') {
    return collected
  }

  if (payload.item && typeof payload.item === 'object') {
    collected.push(payload.item)
  }

  if (Array.isArray(payload.items)) {
    for (const item of payload.items) {
      if (item && typeof item === 'object') {
        collected.push(item)
      }
    }
  }

  if (Array.isArray(payload.output)) {
    for (const outputItem of payload.output) {
      if (!outputItem || typeof outputItem !== 'object') {
        continue
      }

      collected.push(outputItem)

      if (Array.isArray(outputItem.content)) {
        for (const contentItem of outputItem.content) {
          if (contentItem && typeof contentItem === 'object') {
            collected.push(contentItem)
          }
        }
      }

      if (Array.isArray(outputItem.tool_calls)) {
        for (const toolCall of outputItem.tool_calls) {
          if (toolCall && typeof toolCall === 'object') {
            collected.push(toolCall)
          }
        }
      }
    }
  }

  if (payload.response && payload.response !== payload) {
    collected.push(...extractOpenAIItems(payload.response))
  }

  if (Array.isArray(payload.data)) {
    for (const nested of payload.data) {
      collected.push(...extractOpenAIItems(nested))
    }
  }

  return collected
}

function normalizeOpenAIToolItem(item) {
  if (!item || typeof item !== 'object') {
    return []
  }

  const type = typeof item.type === 'string' ? item.type.toLowerCase() : ''
  const results = []

  if (type === 'custom_tool_call') {
    const toolName = item.name || item.tool_name || 'custom_tool'
    let input = null

    if (toolName === 'apply_patch') {
      input = { patch: item.input || '' }
    } else if (typeof item.input === 'string') {
      input = safeJsonParse(item.input) || { raw: item.input }
    } else if (item.input && typeof item.input === 'object') {
      input = item.input
    } else {
      input = { raw: item.input }
    }

    results.push({
      type: 'tool_use',
      name: toolName,
      input,
      callId: item.call_id || item.id,
      source: 'openai',
      raw: item
    })
  } else if (type === 'function_call') {
    const toolName = item.name || item.function?.name || 'function_call'
    let input =
      safeJsonParse(item.arguments) ||
      (item.arguments && typeof item.arguments === 'object' ? item.arguments : null) ||
      {}

    if (toolName === 'apply_patch') {
      if (typeof input.input === 'string') {
        input = { patch: input.input }
      } else if (!input.patch && typeof item.arguments === 'string') {
        input = { patch: item.arguments }
      }
    }

    results.push({
      type: 'tool_use',
      name: toolName,
      input,
      callId: item.call_id || item.id,
      source: 'openai',
      raw: item
    })
  } else if (type === 'local_shell_call') {
    const commandArray = item.action?.command
    const command =
      Array.isArray(commandArray) && commandArray.length > 0
        ? commandArray.join(' ')
        : typeof commandArray === 'string'
          ? commandArray
          : typeof item.command === 'string'
            ? item.command
            : ''

    results.push({
      type: 'tool_use',
      name: 'Bash',
      input: {
        command,
        working_directory: item.action?.working_directory,
        env: item.action?.env
      },
      callId: item.call_id || item.id,
      source: 'openai',
      raw: item
    })
  } else if (type === 'tool_call') {
    const toolName =
      item.function?.name || item.name || item.tool?.name || 'function_call'

    const argumentSource =
      item.function?.arguments ??
      item.arguments ??
      (typeof item.input === 'string' ? item.input : null) ??
      (item.input && typeof item.input === 'object' ? item.input : null)

    let parsedArguments = {}

    if (typeof argumentSource === 'string') {
      parsedArguments = safeJsonParse(argumentSource) || {}
    } else if (argumentSource && typeof argumentSource === 'object') {
      parsedArguments = argumentSource
    }

    if (toolName === 'apply_patch' && typeof parsedArguments.input === 'string') {
      parsedArguments.patch = parsedArguments.input
    } else if (toolName === 'apply_patch' && typeof argumentSource === 'string') {
      parsedArguments.patch = argumentSource
    }

    results.push({
      type: 'tool_use',
      name: toolName,
      input: parsedArguments,
      callId: item.id,
      source: 'openai',
      raw: item
    })
  }

  return results
}

/**
 * 判断是否为编辑相关工具
 */
function isEditTool(toolName) {
  return ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch', 'ApplyPatch'].includes(
    toolName
  )
}

/**
 * 处理具体的工具使用
 */
function processToolUse(toolUse) {
  const logger = require('../../src/utils/logger')

  if (!toolUse || typeof toolUse !== 'object') {
    logger.debug('📊 [Stats Extract] Received invalid tool_use payload', {
      hasToolUse: !!toolUse
    })
    return null
  }

  if (toolUse.name === 'apply_patch' || toolUse.name === 'ApplyPatch') {
    return processApplyPatchTool(toolUse)
  }

  // 处理工具使用

  const result = {
    lines: 0,
    operations: 1,
    type: 'unknown',
    fileType: null,
    language: null
  }

  switch (toolUse.name) {
    case 'Edit':
      // Edit工具
      result.lines = countNonEmptyLines(toolUse.input?.new_string)
      result.type = 'modify'
      result.fileType = extractFileType(toolUse.input?.file_path)
      result.language = detectLanguage(
        toolUse.input?.file_path,
        toolUse.input?.new_string || ''
      )
      break

    case 'MultiEdit':
      // MultiEdit工具
      result.type = 'modify'
      result.fileType = extractFileType(toolUse.input?.file_path)

      for (const edit of toolUse.input?.edits || []) {
        const editLines = countNonEmptyLines(edit?.new_string)
        result.lines += editLines
        // 处理单个编辑
      }

      result.language = detectLanguage(
        toolUse.input?.file_path,
        toolUse.input?.edits?.[0]?.new_string || ''
      )
      break

    case 'Write':
      // Write工具
      result.lines = countNonEmptyLines(toolUse.input?.content)
      result.type = 'create'
      result.fileType = extractFileType(toolUse.input?.file_path)
      result.language = detectLanguage(
        toolUse.input?.file_path,
        toolUse.input?.content || ''
      )
      break

    case 'NotebookEdit':
      // NotebookEdit工具
      result.lines = countNonEmptyLines(toolUse.input?.new_source)
      result.type = 'modify'
      result.fileType = 'ipynb'
      result.language = toolUse.input?.cell_type || 'notebook'
      break
  }

  // 工具处理完成

  return result
}

function processApplyPatchTool(toolUse) {
  const logger = require('../../src/utils/logger')

  const rawInput = toolUse?.input
  let patchText = null

  if (typeof rawInput === 'string') {
    patchText = rawInput
  } else if (rawInput && typeof rawInput === 'object') {
    if (typeof rawInput.patch === 'string') {
      patchText = rawInput.patch
    } else if (typeof rawInput.input === 'string') {
      patchText = rawInput.input
    } else if (typeof rawInput.raw === 'string') {
      patchText = rawInput.raw
    } else if (typeof rawInput.text === 'string') {
      patchText = rawInput.text
    }
  }

  if (!patchText) {
    logger.debug('📊 [Stats Extract] apply_patch call without patch text', {
      hasInput: !!rawInput
    })
    return {
      lines: 0,
      operations: 1,
      type: 'unknown',
      fileType: null,
      language: null
    }
  }

  const sections = parseApplyPatchSections(patchText)

  if (sections.length === 0) {
    return {
      lines: countNonEmptyLines(patchText),
      operations: 1,
      type: 'modify',
      fileType: null,
      language: null
    }
  }

  return sections.map((section) => ({
    lines: section.linesAdded,
    operations: 1,
    type: section.operation,
    fileType: extractFileType(section.filePath),
    language: detectLanguage(section.filePath),
    filePath: section.filePath
  }))
}

function parseApplyPatchSections(patchText) {
  const sections = []
  const lines = patchText.split(/\r?\n/)
  let current = null

  const finalizeCurrent = () => {
    if (current) {
      sections.push({ ...current })
      current = null
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (line.startsWith('*** Begin Patch')) {
      finalizeCurrent()
      continue
    }

    if (line.startsWith('*** End Patch')) {
      finalizeCurrent()
      continue
    }

    const addMatch = line.match(/^\*\*\*\s+Add File:\s+(.+)$/i)
    if (addMatch) {
      finalizeCurrent()
      current = {
        filePath: addMatch[1].trim(),
        operation: 'create',
        linesAdded: 0
      }
      continue
    }

    const updateMatch = line.match(/^\*\*\*\s+Update File:\s+(.+)$/i)
    if (updateMatch) {
      finalizeCurrent()
      current = {
        filePath: updateMatch[1].trim(),
        operation: 'modify',
        linesAdded: 0
      }
      continue
    }

    const deleteMatch = line.match(/^\*\*\*\s+Delete File:\s+(.+)$/i)
    if (deleteMatch) {
      finalizeCurrent()
      sections.push({
        filePath: deleteMatch[1].trim(),
        operation: 'delete',
        linesAdded: 0
      })
      continue
    }

    const moveMatch = line.match(/^\*\*\*\s+Move to:\s+(.+)$/i)
    if (moveMatch && current) {
      current.filePath = moveMatch[1].trim()
      continue
    }

    if (!current) {
      continue
    }

    if (line.startsWith('***')) {
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (line.slice(1).trim().length > 0) {
        current.linesAdded += 1
      }
    }
  }

  finalizeCurrent()
  return sections
}

/**
 * 统计非空行数
 */
function countNonEmptyLines(content) {
  const logger = require('../../src/utils/logger')

  if (!content || typeof content !== 'string') {
    // 无效内容
    return 0
  }

  const lines = content.split('\n')
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0)

  // 统计非空行数

  return nonEmptyLines.length
}

/**
 * 从文件路径提取文件类型
 * 只统计编程语言相关的文件扩展名
 */
function extractFileType(filePath) {
  if (!filePath) {
    return null
  }

  const extension = filePath.split('.').pop()?.toLowerCase()

  // 只统计编程语言和相关文件类型
  if (isCodeFileExtension(extension)) {
    return extension
  }

  return null // 不统计非编程文件
}

/**
 * 检测编程语言
 * 只检测编程语言相关的文件类型
 */
function detectLanguage(filePath, content) {
  if (!filePath) {
    return null
  }

  const extension = extractFileType(filePath)
  if (!extension) {
    return null // 不是编程文件
  }

  const languageMap = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',

    // Python
    py: 'python',
    pyw: 'python',

    // Java
    java: 'java',

    // C/C++
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',

    // C#
    cs: 'csharp',

    // Other languages
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',

    // Scripts
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    ps1: 'powershell',
    bat: 'batch',
    cmd: 'batch',

    // Web frontend
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'css',
    sass: 'css',
    less: 'css',
    vue: 'vue',
    svelte: 'svelte',

    // Documentation and markup
    md: 'markdown',
    markdown: 'markdown',
    rst: 'rst',
    json: 'json',

    // Database
    sql: 'sql'
  }

  const baseLanguage = languageMap[extension] || extension

  // 特殊处理：Java测试文件识别
  if (baseLanguage === 'java' && isJavaTestFile(filePath)) {
    return 'java-test'
  }

  return baseLanguage
}

/**
 * 判断是否为Java单元测试文件
 * 识别规则：路径包含\src\test\java 且文件名包含Test
 */
function isJavaTestFile(filePath) {
  if (!filePath) {
    return false
  }

  // 标准化路径分隔符
  const normalizedPath = filePath.replace(/\\/g, '/')

  // 检查路径是否包含 src/test/java/ (支持相对路径和绝对路径)
  const hasTestPath = normalizedPath.includes('src/test/java/')

  // 检查文件名是否包含Test（大小写不敏感）
  const fileName = normalizedPath.split('/').pop() || ''
  const hasTestInName = /test/i.test(fileName)

  return hasTestPath && hasTestInName
}

/**
 * 处理Bash命令的文件编辑操作
 */
function processBashCommand(toolUse) {
  const result = {
    lines: 0,
    operations: 0,
    type: 'unknown',
    fileType: null,
    language: null
  }

  if (!toolUse.input?.command) {
    return result
  }

  const command = toolUse.input.command.trim()
  const analysis = analyzeBashCommand(command)

  if (!analysis.isFileEdit) {
    return result
  }

  result.operations = 1
  result.type = analysis.operation
  result.fileType = extractFileType(analysis.targetFile)
  result.language = detectLanguage(analysis.targetFile)
  result.lines = estimateEditedLines(command, analysis)

  return result
}

/**
 * 分析Bash命令是否进行文件编辑
 */
function analyzeBashCommand(command) {
  // 文件编辑命令的正则表达式模式
  const patterns = [
    // 直接编辑器命令
    {
      regex: /^(vi|vim|nano|emacs|gedit|pico|code|subl)\s+([^\s]+)/,
      operation: 'modify',
      fileIndex: 2
    },
    // 追加重定向 (echo "content" >> file) - 必须在单个>之前
    {
      regex: /^echo\s+.*\s*>>\s*([^\s]+)$/,
      operation: 'modify',
      fileIndex: 1
    },
    // 重定向创建文件 (echo "content" > file)
    {
      regex: /^echo\s+.*\s*>\s*([^\s]+)$/,
      operation: 'create',
      fileIndex: 1
    },
    // cat 追加 - 必须在单个>之前
    {
      regex: /^cat\s*>>\s*([^\s]+)/,
      operation: 'modify',
      fileIndex: 1
    },
    // cat 创建文件
    {
      regex: /^cat\s*>\s*([^\s]+)/,
      operation: 'create',
      fileIndex: 1
    },
    // sed 原地编辑
    {
      regex: /^sed\s+-i[^\s]*\s+.*\s+([^\s]+)$/,
      operation: 'modify',
      fileIndex: 1
    },
    // awk 输出到文件
    {
      regex: /^awk\s+.*\s+[^\s]+\s*>\s*([^\s]+)$/,
      operation: 'create',
      fileIndex: 1
    },
    // touch 创建文件
    {
      regex: /^touch\s+([^\s]+)/,
      operation: 'create',
      fileIndex: 1
    },
    // cp/copy 复制文件
    {
      regex: /^(cp|copy)\s+[^\s]+\s+([^\s]+)$/,
      operation: 'create',
      fileIndex: 2
    },
    // mv/move 移动/重命名
    {
      regex: /^(mv|move)\s+[^\s]+\s+([^\s]+)$/,
      operation: 'modify',
      fileIndex: 2
    },
    // PowerShell Set-Content (multiple parameter formats)
    {
      regex: /^Set-Content\s+.*-Path\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^Set-Content\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    // PowerShell Add-Content (multiple parameter formats)
    {
      regex: /^Add-Content\s+.*-Path\s+([^\s]+)/i,
      operation: 'modify',
      fileIndex: 1
    },
    {
      regex: /^Add-Content\s+([^\s]+)/i,
      operation: 'modify',
      fileIndex: 1
    },
    // PowerShell Out-File (multiple formats)
    {
      regex: /^.*\s*\|\s*Out-File\s+.*-FilePath\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*\|\s*Out-File\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    // PowerShell redirection operators
    {
      regex: /^.*\s*>\s*([^\s]+)$/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*>>\s*([^\s]+)$/i,
      operation: 'modify',
      fileIndex: 1
    },
    // PowerShell New-Item (file creation)
    {
      regex: /^New-Item\s+.*-Path\s+([^\s]+).*-ItemType\s+File/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^New-Item\s+([^\s]+).*-ItemType\s+File/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^ni\s+([^\s]+)/i, // PowerShell alias for New-Item
      operation: 'create',
      fileIndex: 1
    },
    // PowerShell Copy-Item
    {
      regex: /^Copy-Item\s+.*-Destination\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^Copy-Item\s+[^\s]+\s+([^\s]+)$/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^(copy|cp)\s+[^\s]+\s+([^\s]+)$/i, // PowerShell aliases
      operation: 'create',
      fileIndex: 2
    },
    // PowerShell Move-Item
    {
      regex: /^Move-Item\s+.*-Destination\s+([^\s]+)/i,
      operation: 'modify',
      fileIndex: 1
    },
    {
      regex: /^Move-Item\s+[^\s]+\s+([^\s]+)$/i,
      operation: 'modify',
      fileIndex: 1
    },
    {
      regex: /^(move|mv)\s+[^\s]+\s+([^\s]+)$/i, // PowerShell aliases
      operation: 'modify',
      fileIndex: 2
    },
    // PowerShell Tee-Object
    {
      regex: /^.*\s*\|\s*Tee-Object\s+.*-FilePath\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*\|\s*Tee-Object\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*\|\s*tee\s+([^\s]+)/i, // PowerShell alias
      operation: 'create',
      fileIndex: 1
    },
    // PowerShell Select-String with output
    {
      regex: /^Select-String\s+.*\s*>\s*([^\s]+)$/i,
      operation: 'create',
      fileIndex: 1
    },
    // PowerShell Format-Table/Format-List with output
    {
      regex: /^.*\s*\|\s*Format-Table\s*>\s*([^\s]+)$/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*\|\s*Format-List\s*>\s*([^\s]+)$/i,
      operation: 'create',
      fileIndex: 1
    },
    // PowerShell ConvertTo-* cmdlets with output
    {
      regex: /^.*\s*\|\s*ConvertTo-Json\s*>\s*([^\s]+)$/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*\|\s*ConvertTo-Csv\s*>\s*([^\s]+)$/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*\|\s*ConvertTo-Xml\s*>\s*([^\s]+)$/i,
      operation: 'create',
      fileIndex: 1
    },
    // PowerShell Export-* cmdlets
    {
      regex: /^.*\s*\|\s*Export-Csv\s+.*-Path\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*\|\s*Export-Csv\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    {
      regex: /^.*\s*\|\s*Export-Clixml\s+([^\s]+)/i,
      operation: 'create',
      fileIndex: 1
    },
    // Windows notepad and other editors
    {
      regex: /^notepad\s+([^\s]+)/i,
      operation: 'modify',
      fileIndex: 1
    },
    {
      regex: /^notepad\+\+\s+([^\s]+)/i,
      operation: 'modify',
      fileIndex: 1
    },
    {
      regex: /^wordpad\s+([^\s]+)/i,
      operation: 'modify',
      fileIndex: 1
    }
  ]

  for (const pattern of patterns) {
    const match = command.match(pattern.regex)
    if (match) {
      return {
        isFileEdit: true,
        operation: pattern.operation,
        targetFile: match[pattern.fileIndex]?.replace(/['"]/g, ''), // 移除引号
        pattern: pattern.regex.source
      }
    }
  }

  return { isFileEdit: false }
}

/**
 * 估算编辑的行数
 */
function estimateEditedLines(command, analysis) {
  // echo命令：计算输出内容行数
  if (command.includes('echo')) {
    const contentMatch = command.match(/echo\s+["']?(.*?)["']?\s*[>]{1,2}/)
    if (contentMatch) {
      const content = contentMatch[1]
      // 计算换行符数量 + 1
      return (content.match(/\\n/g) || []).length + 1
    }
    return 1
  }

  // cat命令：如果有HERE文档，需要分析更复杂的情况
  if (command.includes('cat')) {
    // 简单情况：假设是单行或少量行
    return 1
  }

  // sed替换：默认假设处理1行
  if (command.includes('sed')) {
    return 1
  }

  // awk命令：假设处理1行输出
  if (command.includes('awk')) {
    return 1
  }

  // touch命令：创建空文件
  if (command.includes('touch')) {
    return 0
  }

  // cp/copy：假设复制了原文件的内容，但这里无法确定，保守估计
  if (command.match(/^(cp|copy)/)) {
    return 1
  }

  // PowerShell Set-Content/Out-File: 创建文件，假设1行内容
  if (command.match(/(Set-Content|Out-File)/i)) {
    return 1
  }

  // PowerShell Add-Content: 追加内容，假设1行
  if (command.match(/Add-Content/i)) {
    return 1
  }

  // PowerShell New-Item: 创建空文件
  if (command.match(/(New-Item|ni\s)/i)) {
    return 0
  }

  // PowerShell Copy-Item/Move-Item: 假设复制/移动文件内容
  if (command.match(/(Copy-Item|Move-Item|copy|move|cp|mv)/i)) {
    return 1
  }

  // PowerShell Tee-Object: 类似tee，假设1行
  if (command.match(/(Tee-Object|tee)/i)) {
    return 1
  }

  // PowerShell Export cmdlets: 导出数据，假设多行
  if (command.match(/(Export-Csv|Export-Clixml)/i)) {
    return 3 // 导出操作通常包含多行数据
  }

  // PowerShell ConvertTo cmdlets: 格式转换，假设多行
  if (command.match(/(ConvertTo-Json|ConvertTo-Csv|ConvertTo-Xml)/i)) {
    return 2 // 转换操作可能产生结构化数据
  }

  // PowerShell Format cmdlets: 格式化输出，假设多行
  if (command.match(/(Format-Table|Format-List)/i)) {
    return 3 // 格式化通常产生多行输出
  }

  // PowerShell Select-String: 搜索输出，假设少量行
  if (command.match(/Select-String/i)) {
    return 1
  }

  // PowerShell redirection: 重定向输出
  if (command.match(/.*\s*[>]{1,2}\s*[^\s]+$/)) {
    return 1
  }

  // 编辑器命令：无法准确估算，假设编辑了少量行
  if (command.match(/^(vi|vim|nano|emacs|gedit|pico|code|subl|notepad|notepad\+\+|wordpad)/i)) {
    return 5 // 假设编辑器操作平均编辑5行
  }

  // 默认估算
  return 1
}

/**
 * 处理其他工具（非编辑工具）
 */
function processOtherTool(toolUse) {
  const result = {
    lines: 0,
    operations: 0, // 非编辑工具不计入编辑操作次数
    type: 'read',
    fileType: null,
    language: null
  }

  // 这些工具不直接编辑代码，但可以统计访问的文件类型
  switch (toolUse.name) {
    case 'Read':
      if (toolUse.input?.file_path) {
        result.fileType = extractFileType(toolUse.input.file_path)
        result.language = detectLanguage(toolUse.input.file_path)
      }
      break

    case 'Glob':
      // Glob工具可以统计搜索的文件类型模式
      if (toolUse.input?.pattern) {
        const { pattern } = toolUse.input
        const fileExtMatch = pattern.match(/\*\.(\w+)/)
        if (fileExtMatch) {
          result.fileType = fileExtMatch[1].toLowerCase()
          result.language = detectLanguageFromExtension(result.fileType)
        }
      }
      break

    case 'Grep':
      // Grep工具可以根据glob参数统计搜索的文件类型
      if (toolUse.input?.glob) {
        const { glob } = toolUse.input
        const fileExtMatch = glob.match(/\*\.(\w+)/)
        if (fileExtMatch) {
          result.fileType = fileExtMatch[1].toLowerCase()
          result.language = detectLanguageFromExtension(result.fileType)
        }
      } else if (toolUse.input?.type) {
        // 根据type参数推断文件类型
        result.fileType = toolUse.input.type
        result.language = detectLanguageFromExtension(result.fileType)
      }
      break

    case 'LS':
      // LS工具主要用于目录浏览，不统计具体文件类型
      break

    case 'WebFetch':
    case 'WebSearch':
      // 网络工具不涉及本地文件
      break

    default:
      // 其他工具暂不处理
      break
  }

  return result
}

/**
 * 判断是否为编程语言相关的文件扩展名
 */
function isCodeFileExtension(extension) {
  if (!extension) {
    return false
  }

  // 编程语言源码文件
  const programmingLanguages = [
    // JavaScript/TypeScript
    'js',
    'jsx',
    'ts',
    'tsx',
    'mjs',
    // Python
    'py',
    'pyw',
    // Java
    'java',
    // C/C++
    'c',
    'cpp',
    'cc',
    'cxx',
    'h',
    'hpp',
    // C#
    'cs',
    // 其他编程语言
    'go',
    'rs',
    'php',
    'rb',
    'swift',
    'kt',
    'kts',
    'scala',
    'r',
    'pl',
    'pm',
    'lua',
    'dart'
  ]

  // 脚本文件
  const scriptFiles = ['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd']

  // Web前端文件
  const webFiles = ['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte']

  // 文档和标记语言
  const documentFiles = ['md', 'markdown', 'rst', 'adoc', 'json']

  // 数据库相关
  const databaseFiles = ['sql', 'graphql', 'gql']

  const codeExtensions = [
    ...programmingLanguages,
    ...scriptFiles,
    ...webFiles,
    ...documentFiles,
    ...databaseFiles
  ]

  return codeExtensions.includes(extension.toLowerCase())
}

/**
 * 根据文件扩展名检测编程语言（只检测编程相关文件）
 */
function detectLanguageFromExtension(extension, filePath = null) {
  if (!extension || !isCodeFileExtension(extension)) {
    return null // 不是编程文件则返回null
  }

  const languageMap = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',

    // Python
    py: 'python',
    pyw: 'python',

    // Java
    java: 'java',

    // C/C++
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',

    // C#
    cs: 'csharp',

    // 其他编程语言
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    r: 'r',
    pl: 'perl',
    pm: 'perl',
    lua: 'lua',
    dart: 'dart',

    // 脚本文件
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    ps1: 'powershell',
    bat: 'batch',
    cmd: 'batch',

    // Web前端
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    vue: 'vue',
    svelte: 'svelte',

    // 文档和标记语言
    md: 'markdown',
    markdown: 'markdown',
    rst: 'rst',
    adoc: 'asciidoc',
    json: 'json',

    // 数据库
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql'
  }

  const baseLanguage = languageMap[extension.toLowerCase()] || 'unknown'

  // 特殊处理：Java测试文件识别
  if (baseLanguage === 'java' && filePath && isJavaTestFile(filePath)) {
    return 'java-test'
  }

  return baseLanguage
}

function safeJsonParse(value) {
  if (typeof value !== 'string') {
    return null
  }

  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}

module.exports = {
  extractEditStatistics,
  countNonEmptyLines,
  isEditTool,
  detectLanguage,
  processBashCommand,
  analyzeBashCommand,
  processOtherTool,
  detectLanguageFromExtension,
  isCodeFileExtension,
  isJavaTestFile
}
