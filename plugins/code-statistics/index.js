const config = require('../../config/config')
const statistics = require('./statistics')
const redisExtension = require('./redis-extension')
const webRoutes = require('./web-routes')
const logger = require('../../src/utils/logger')

module.exports = {
  name: 'code-statistics',
  version: '1.0.0',
  description: '统计实际编辑操作的代码行数',

  init(app, hooks) {
    if (!config.plugins?.codeStatistics?.enabled) {
      logger.info('🔌 Code statistics plugin disabled')
      return
    }

    // 初始化 Redis 扩展
    redisExtension.init()

    // 注册使用量记录后的钩子
    hooks.afterUsageRecord = async (keyId, usageData, model, response) => {
      try {
        logger.info('📊 [Code Stats] Hook triggered', {
          keyId,
          model,
          hasUsageData: !!usageData,
          hasResponse: !!response,
          responseType: typeof response
        })

        // 详细记录响应内容
        if (response) {
          logger.info('📊 [Code Stats] Response details:', {
            hasContent: !!response.content,
            contentType: Array.isArray(response.content) ? 'array' : typeof response.content,
            contentLength: response.content ? response.content.length : 0
          })

          if (response.content && Array.isArray(response.content)) {
            logger.info(
              '📊 [Code Stats] Response content items:',
              response.content.map((item, index) => ({
                index,
                type: item.type,
                name: item.name,
                hasInput: !!item.input,
                inputKeys: item.input ? Object.keys(item.input) : []
              }))
            )
          }
        } else {
          logger.warn('📊 [Code Stats] No response data received in hook!')
        }

        // 只有当响应包含编辑工具使用时才进行统计
        if (!response || !response.content) {
          logger.info('📊 [Code Stats] Skipping - no response content')
          return
        }

        const editStats = statistics.extractEditStatistics(response)

        // 只要有工具调用就记录统计，不仅仅是编辑工具
        const hasToolUsage = editStats.toolUsage && Object.keys(editStats.toolUsage).length > 0
        const hasEditContent = editStats.totalEditedLines > 0

        if (hasToolUsage || hasEditContent) {
          await redisExtension.recordEditStatistics(keyId, editStats, model)

          if (hasEditContent) {
            logger.info(
              `📝 Code stats recorded: ${editStats.totalEditedLines} lines, ${editStats.editOperations} operations, ${Object.keys(editStats.toolUsage).length} tools`
            )
          } else if (hasToolUsage) {
            logger.info(
              `🔧 Tool usage only recorded: ${Object.keys(editStats.toolUsage).length} tools (${Object.keys(editStats.toolUsage).join(', ')}) - no edit content`
            )
          }
        } else {
          logger.info('📊 [Code Stats] No tools or editable content found in response')
        }
      } catch (error) {
        logger.error('❌ Code statistics error:', error)
      }
    }

    // 注册 Web 路由
    app.use('/api/v1/code-stats', webRoutes.api)
    app.use('/admin/code-stats', webRoutes.admin)

    logger.success('✅ Code statistics plugin initialized')
  }
}
