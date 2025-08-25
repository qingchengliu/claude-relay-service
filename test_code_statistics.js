#!/usr/bin/env node

const statistics = require('./plugins/code-statistics/statistics')

// 测试数据：模拟真实的Claude响应
const mockResponse = {
  content: [
    {
      type: 'tool_use',
      name: 'Edit',
      input: {
        file_path: '/home/user/test.js',
        old_string: 'console.log("old")',
        new_string: 'console.log("new")\nconsole.log("another line")\n// A comment'
      }
    },
    {
      type: 'tool_use',
      name: 'Write',
      input: {
        file_path: '/home/user/new_file.py',
        content:
          'def hello():\n    print("Hello World!")\n    return True\n\nif __name__ == "__main__":\n    hello()'
      }
    },
    {
      type: 'tool_use',
      name: 'MultiEdit',
      input: {
        file_path: '/home/user/config.json',
        edits: [
          {
            old_string: '"name": "old"',
            new_string: '"name": "new"\n"version": "1.0.0"'
          },
          {
            old_string: '"debug": false',
            new_string: '"debug": true\n"env": "development"'
          }
        ]
      }
    }
  ]
}

// 测试空响应
const emptyResponse = {
  content: []
}

// 测试无效响应
const invalidResponse = {
  content: [
    {
      type: 'text',
      text: 'This is just text, not tool use'
    }
  ]
}

console.log('🧪 Testing Code Statistics Extraction...')
console.log('='.repeat(50))

// 测试1: 正常工具使用
console.log('\n📝 Test 1: Normal tool usage')
const stats1 = statistics.extractEditStatistics(mockResponse)
console.log('Result:', JSON.stringify(stats1, null, 2))

// 测试2: 空响应
console.log('\n📝 Test 2: Empty response')
const stats2 = statistics.extractEditStatistics(emptyResponse)
console.log('Result:', JSON.stringify(stats2, null, 2))

// 测试3: 无效响应
console.log('\n📝 Test 3: Invalid response')
const stats3 = statistics.extractEditStatistics(invalidResponse)
console.log('Result:', JSON.stringify(stats3, null, 2))

// 测试4: 无响应
console.log('\n📝 Test 4: No response')
const stats4 = statistics.extractEditStatistics(null)
console.log('Result:', JSON.stringify(stats4, null, 2))

console.log('\n✅ Code Statistics Test Completed!')

// 验证预期结果
console.log('\n📊 Expected Results Analysis:')
console.log(`- Total edited lines: ${stats1.totalEditedLines} (should be > 0)`)
console.log(`- Edit operations: ${stats1.editOperations} (should be 3)`)
console.log(`- New files: ${stats1.newFiles} (should be 1)`)
console.log(`- Modified files: ${stats1.modifiedFiles} (should be 2)`)
console.log(`- Languages detected: ${Object.keys(stats1.languages).length} (should be 2+)`)
console.log(`- File types: ${Object.keys(stats1.fileTypes).length} (should be 2+)`)

if (stats1.totalEditedLines > 0 && stats1.editOperations === 3) {
  console.log('✅ Code statistics extraction is working correctly!')
} else {
  console.log('❌ Code statistics extraction has issues!')
}
