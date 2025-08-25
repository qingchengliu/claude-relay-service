#!/usr/bin/env node

// 模拟插件钩子测试
const config = require('./config/config')

console.log('🧪 Testing Plugin Configuration...')
console.log('='.repeat(50))

// 检查插件配置
console.log('\n📋 Plugin Configuration:')
console.log(`- Plugins enabled: ${config.plugins?.enabled}`)
console.log(`- Code statistics enabled: ${config.plugins?.codeStatistics?.enabled}`)
console.log(`- Redis prefix: ${config.plugins?.codeStatistics?.redisPrefix}`)
console.log(`- Web path: ${config.plugins?.codeStatistics?.webPath}`)

// 模拟钩子调用
console.log('\n🔧 Testing Plugin Hook Integration...')

// 模拟插件初始化
const hooks = {}

// 模拟代码统计插件的钩子注册
hooks.afterUsageRecord = async (keyId, usageData, model, response) => {
  console.log('📞 Plugin hook called with:')
  console.log(`  - Key ID: ${keyId}`)
  console.log(`  - Model: ${model}`)
  console.log(`  - Usage data type: ${typeof usageData}`)
  console.log(`  - Response content length: ${response?.content?.length || 0}`)

  if (response?.content?.length > 0) {
    console.log('  - Tool uses found:')
    response.content.forEach((item, index) => {
      console.log(`    ${index + 1}. ${item.name} (${item.type})`)
    })
  }

  // 模拟统计提取
  const statistics = require('./plugins/code-statistics/statistics')
  const stats = statistics.extractEditStatistics(response)

  if (stats.totalEditedLines > 0) {
    console.log('  📊 Statistics extracted:')
    console.log(`     - Lines: ${stats.totalEditedLines}`)
    console.log(`     - Operations: ${stats.editOperations}`)
    console.log(`     - New files: ${stats.newFiles}`)
    console.log(`     - Modified files: ${stats.modifiedFiles}`)
    return true
  } else {
    console.log('  📊 No editable content found')
    return false
  }
}

// 测试钩子调用
console.log('\n🧪 Test Hook Calls:')

// 测试1：有工具使用的响应
const mockUsageData1 = {
  input_tokens: 100,
  output_tokens: 200,
  model: 'claude-3-5-sonnet-20241022'
}

const mockResponse1 = {
  content: [
    {
      type: 'tool_use',
      name: 'Edit',
      input: {
        file_path: '/test/file.js',
        old_string: 'old code',
        new_string: 'new code\nsecond line'
      }
    }
  ]
}

console.log('\n📝 Test 1: Response with tool usage')
hooks
  .afterUsageRecord('test-key-123', mockUsageData1, 'claude-3-5-sonnet-20241022', mockResponse1)
  .then((result) => console.log(`   Result: ${result ? '✅ SUCCESS' : '❌ FAILED'}`))
  .catch((err) => console.log(`   Error: ${err.message}`))

// 测试2：无工具使用的响应
const mockResponse2 = {
  content: []
}

setTimeout(() => {
  console.log('\n📝 Test 2: Response without tool usage')
  hooks
    .afterUsageRecord('test-key-456', mockUsageData1, 'claude-3-5-sonnet-20241022', mockResponse2)
    .then((result) =>
      console.log(`   Result: ${result ? '✅ SUCCESS' : '❌ NO CONTENT (EXPECTED)'}`)
    )
    .catch((err) => console.log(`   Error: ${err.message}`))
}, 100)

console.log('\n🔚 Plugin Hook Test Completed!')
