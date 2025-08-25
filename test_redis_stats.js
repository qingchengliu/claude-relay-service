#!/usr/bin/env node

// 测试Redis连接和统计存储功能
const redisExtension = require('./plugins/code-statistics/redis-extension')

async function testRedisIntegration() {
  console.log('🧪 Testing Redis Extension for Code Statistics...')
  console.log('='.repeat(50))

  try {
    // 初始化Redis扩展
    console.log('🔄 Initializing Redis extension...')
    redisExtension.init()

    // 模拟统计数据
    const testStats = {
      totalEditedLines: 15,
      editOperations: 3,
      newFiles: 1,
      modifiedFiles: 2,
      languages: {
        javascript: 8,
        python: 5,
        json: 2
      },
      fileTypes: {
        js: 8,
        py: 5,
        json: 2
      }
    }

    const keyId = 'test-key-' + Date.now()
    const model = 'claude-3-5-sonnet-20241022'

    console.log(`📝 Recording test statistics for key: ${keyId}`)
    console.log('Statistics:', JSON.stringify(testStats, null, 2))

    // 记录统计数据
    await redisExtension.recordEditStatistics(keyId, testStats, model)
    console.log('✅ Statistics recorded successfully!')

    // 获取统计数据
    console.log('\n📊 Retrieving statistics...')
    const retrievedStats = await redisExtension.getEditStatistics(keyId)
    console.log('Retrieved stats:', JSON.stringify(retrievedStats, null, 2))

    // 验证数据完整性
    if (retrievedStats && retrievedStats.totalEditedLines === testStats.totalEditedLines) {
      console.log('✅ Data integrity check passed!')
    } else {
      console.log('❌ Data integrity check failed!')
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
      console.log('💡 Hint: Make sure Redis is running and accessible')
    }
  }

  console.log('\n🔚 Redis integration test completed!')
}

testRedisIntegration()
