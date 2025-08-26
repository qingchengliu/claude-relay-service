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

  if (!response?.content || !Array.isArray(response.content)) {
    logger.warn('📊 [Stats Extract] Invalid response structure', {
      hasResponse: !!response,
      hasContent: !!response?.content,
      contentType: typeof response?.content
    })
    return stats
  }

  // 处理响应内容项

  for (const item of response.content) {
    // 处理单个内容项

    if (item.type === 'tool_use') {
      // 获取工具名称，支持多种可能的字段位置
      const toolName = item.name || item.function?.name || item.tool_name || 'Unknown'

      // 统计所有工具调用次数
      stats.toolUsage[toolName] = (stats.toolUsage[toolName] || 0) + 1
      // 记录工具调用

      let result = null

      if (isEditTool(toolName)) {
        // 处理编辑工具
        result = processToolUse(item)
      } else if (toolName === 'Bash') {
        // 处理Bash工具
        result = processBashCommand(item)
      } else {
        // 处理其他工具
        // 处理其他工具（Read、Glob等）
        result = processOtherTool(item)
      }

      if (result) {
        // 工具处理结果

        stats.totalEditedLines += result.lines
        stats.editOperations += result.operations

        if (result.type === 'create') {
          stats.newFiles++
        } else if (result.type === 'modify') {
          stats.modifiedFiles++
        }

        // 统计文件类型和语言
        if (result.fileType) {
          stats.fileTypes[result.fileType] = (stats.fileTypes[result.fileType] || 0) + result.lines
        }

        if (result.language) {
          stats.languages[result.language] = (stats.languages[result.language] || 0) + result.lines
        }
      } else {
        // 无编辑结果
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

/**
 * 判断是否为编辑相关工具
 */
function isEditTool(toolName) {
  return ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(toolName)
}

/**
 * 处理具体的工具使用
 */
function processToolUse(toolUse) {
  const logger = require('../../src/utils/logger')

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
      result.lines = countNonEmptyLines(toolUse.input.new_string)
      result.type = 'modify'
      result.fileType = extractFileType(toolUse.input.file_path)
      result.language = detectLanguage(toolUse.input.file_path, toolUse.input.new_string)
      break

    case 'MultiEdit':
      // MultiEdit工具
      result.type = 'modify'
      result.fileType = extractFileType(toolUse.input.file_path)

      for (const edit of toolUse.input.edits || []) {
        const editLines = countNonEmptyLines(edit.new_string)
        result.lines += editLines
        // 处理单个编辑
      }

      result.language = detectLanguage(
        toolUse.input.file_path,
        toolUse.input.edits?.[0]?.new_string || ''
      )
      break

    case 'Write':
      // Write工具
      result.lines = countNonEmptyLines(toolUse.input.content)
      result.type = 'create'
      result.fileType = extractFileType(toolUse.input.file_path)
      result.language = detectLanguage(toolUse.input.file_path, toolUse.input.content)
      break

    case 'NotebookEdit':
      // NotebookEdit工具
      result.lines = countNonEmptyLines(toolUse.input.new_source)
      result.type = 'modify'
      result.fileType = 'ipynb'
      result.language = toolUse.input.cell_type || 'notebook'
      break
  }

  // 工具处理完成

  return result
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
 */
function extractFileType(filePath) {
  if (!filePath) {
    return null
  }

  const extension = filePath.split('.').pop()?.toLowerCase()
  return extension || null
}

/**
 * 检测编程语言
 */
function detectLanguage(filePath, content) {
  if (!filePath) {
    return null
  }

  const extension = extractFileType(filePath)

  const languageMap = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    html: 'html',
    css: 'css',
    sql: 'sql',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    xml: 'xml',
    md: 'markdown'
  }

  return languageMap[extension] || extension
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
 * 根据文件扩展名检测编程语言
 */
function detectLanguageFromExtension(extension) {
  const languageMap = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    cs: 'csharp',
    vb: 'vbnet',
    fs: 'fsharp',
    scala: 'scala',
    r: 'r',
    m: 'objectivec',
    h: 'c',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'fish',
    ps1: 'powershell',
    psm1: 'powershell',
    psd1: 'powershell',
    sql: 'sql',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    xml: 'xml',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    cfg: 'cfg',
    conf: 'conf',
    properties: 'properties',
    md: 'markdown',
    rst: 'rst',
    tex: 'latex',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    cmake: 'cmake',
    gradle: 'gradle'
  }

  return languageMap[extension?.toLowerCase()] || 'unknown'
}

module.exports = {
  extractEditStatistics,
  countNonEmptyLines,
  isEditTool,
  detectLanguage,
  processBashCommand,
  analyzeBashCommand,
  processOtherTool,
  detectLanguageFromExtension
}
