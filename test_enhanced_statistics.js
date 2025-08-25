#!/usr/bin/env node

const statistics = require('./plugins/code-statistics/statistics')

// 测试扩展后的统计功能
function testEnhancedStatistics() {
  console.log('🧪 Testing Enhanced Tool Statistics...')
  console.log('='.repeat(60))

  // 测试数据：包含多种工具调用
  const mockResponse = {
    content: [
      {
        type: 'tool_use',
        name: 'Read',
        input: {
          file_path: '/home/user/app.js'
        }
      },
      {
        type: 'tool_use',
        name: 'Edit',
        input: {
          file_path: '/home/user/app.js',
          old_string: 'console.log("old")',
          new_string: 'console.log("new version")\nconsole.log("with debug")'
        }
      },
      {
        type: 'tool_use',
        name: 'Glob',
        input: {
          pattern: '**/*.py'
        }
      },
      {
        type: 'tool_use',
        name: 'Grep',
        input: {
          pattern: 'function',
          glob: '*.js'
        }
      },
      {
        type: 'tool_use',
        name: 'Bash',
        input: {
          command: 'echo "Hello World" > output.txt'
        }
      },
      {
        type: 'tool_use',
        name: 'Write',
        input: {
          file_path: '/home/user/config.json',
          content: '{\n  "version": "1.0.0",\n  "name": "test"\n}'
        }
      },
      {
        type: 'tool_use',
        name: 'Read',
        input: {
          file_path: '/home/user/README.md'
        }
      },
      {
        type: 'tool_use',
        name: 'Grep',
        input: {
          pattern: 'TODO',
          type: 'py'
        }
      }
    ]
  }

  console.log('\n📊 Extracting statistics from mock response...')
  const stats = statistics.extractEditStatistics(mockResponse)

  console.log('\n📈 Results:')
  console.log(JSON.stringify(stats, null, 2))

  // 验证结果
  console.log('\n✅ Validation:')
  console.log(`- Total edited lines: ${stats.totalEditedLines}`)
  console.log(`- Edit operations: ${stats.editOperations}`)
  console.log(`- New files: ${stats.newFiles}`)
  console.log(`- Modified files: ${stats.modifiedFiles}`)
  console.log(`- Languages detected: ${Object.keys(stats.languages).length}`)
  console.log(`- File types: ${Object.keys(stats.fileTypes).length}`)

  console.log('\n🔧 Tool Usage Analysis:')
  const sortedTools = Object.entries(stats.toolUsage).sort(([, a], [, b]) => b - a)

  sortedTools.forEach(([tool, count]) => {
    console.log(`  ${tool}: ${count} call${count > 1 ? 's' : ''}`)
  })

  console.log('\n📋 Tool Categories:')
  const editTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
  const readTools = ['Read', 'Glob', 'Grep', 'LS']
  const systemTools = ['Bash', 'WebFetch', 'WebSearch']

  const editCount = sortedTools
    .filter(([tool]) => editTools.includes(tool))
    .reduce((sum, [, count]) => sum + count, 0)

  const readCount = sortedTools
    .filter(([tool]) => readTools.includes(tool))
    .reduce((sum, [, count]) => sum + count, 0)

  const systemCount = sortedTools
    .filter(([tool]) => systemTools.includes(tool))
    .reduce((sum, [, count]) => sum + count, 0)

  console.log(`  Edit tools: ${editCount} calls`)
  console.log(`  Read tools: ${readCount} calls`)
  console.log(`  System tools: ${systemCount} calls`)

  // 测试空响应
  console.log('\n📝 Testing edge cases...')
  const emptyStats = statistics.extractEditStatistics({ content: [] })
  console.log(`Empty response - Tool usage keys: ${Object.keys(emptyStats.toolUsage).length}`)

  const nullStats = statistics.extractEditStatistics(null)
  console.log(`Null response - Tool usage keys: ${Object.keys(nullStats.toolUsage).length}`)

  console.log('\n✨ Enhanced statistics test completed!')

  // 返回测试结果
  return {
    success: stats.toolUsage && Object.keys(stats.toolUsage).length > 0,
    totalTools: Object.keys(stats.toolUsage).length,
    totalCalls: Object.values(stats.toolUsage).reduce((sum, count) => sum + count, 0),
    editLines: stats.totalEditedLines,
    editOps: stats.editOperations
  }
}

// 运行测试
const result = testEnhancedStatistics()

if (result.success) {
  console.log(
    `\n🎉 SUCCESS: Detected ${result.totalTools} tool types with ${result.totalCalls} total calls`
  )
  console.log(`📝 Code editing: ${result.editLines} lines in ${result.editOps} operations`)
} else {
  console.log('\n❌ FAILED: Tool usage statistics not working correctly')
}
