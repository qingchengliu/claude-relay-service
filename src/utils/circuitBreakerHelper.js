/**
 * 🔥 成功率熔断器助手
 * 统一处理 Claude Console 和 OpenAI Responses 的成功率熔断逻辑
 */

const redis = require('../models/redis')
const config = require('../../config/config')
const logger = require('./logger')

/**
 * 判断是否为应排除的错误（不应计入熔断统计）
 * 包括：客户端参数错误、内部错误（未到达上游API）
 * @param {string|Object} errorInfo - 错误信息
 * @returns {boolean} - 是否应排除
 */
function isExcludedError(errorInfo) {
  if (!errorInfo) return false

  const errorStr = typeof errorInfo === 'string' ? errorInfo : JSON.stringify(errorInfo)
  const lowerStr = errorStr.toLowerCase()

  // 不应计入熔断统计的错误模式（内部错误 + 客户端参数错误）
  // 注意：所有模式使用小写，因为比较时 errorStr 已转为小写
  const excludeErrorPatterns = [
    // 客户端参数错误
    'invalid_request_error',
    'invalid request',
    'bad request',
    'invalid url',
    'sensitive_words_detected', // 敏感词检测（客户端内容问题）

    // 内部并发限制（未到达上游）
    'concurrency limit exceeded',
    'concurrency limit reached',
    'console_account_concurrency_full',

    // 内部错误（账户/连接问题，未到达上游）
    'account not found',
    'client disconnected',
    'aborterror',
    'cancelederror',
    'econnaborted',
    'err_canceled'
  ]

  return excludeErrorPatterns.some((pattern) => lowerStr.includes(pattern))
}

/**
 * 记录请求结果并检查是否需要触发熔断
 * @param {Object} options - 配置选项
 * @param {string} options.accountId - 账号ID
 * @param {boolean} options.isSuccess - 请求是否成功（2xx为成功）
 * @param {string} options.accountName - 账号名称（用于日志）
 * @param {string} options.serviceType - 服务类型：'claude-console' | 'openai-responses'
 * @param {Function} options.markRateLimitedFn - 标记账号限流的函数
 * @param {string|null} options.sessionHash - 会话哈希（可选，OpenAI Responses 需要）
 * @param {string|Object|null} options.errorInfo - 错误信息（用于判断是否为客户端参数错误）
 * @returns {Promise<boolean>} - 是否触发了熔断
 */
async function checkAndTriggerCircuitBreaker(options) {
  const {
    accountId,
    isSuccess,
    accountName = '',
    serviceType,
    markRateLimitedFn,
    sessionHash = null,
    errorInfo = null
  } = options

  // 获取对应服务的配置
  const configKey = serviceType === 'claude-console' ? 'claudeConsole' : 'openaiResponses'
  const serviceConfig = config[configKey]

  // 检查是否启用熔断器
  if (!serviceConfig?.enableSuccessRateCircuitBreaker) {
    return false
  }

  // 🔥 如果是失败且为应排除的错误（内部错误/客户端参数错误），则不记录到统计中
  if (!isSuccess && errorInfo && isExcludedError(errorInfo)) {
    logger.debug(
      `⏭️ Circuit breaker skip [${serviceType}] ${accountName || accountId}: excluded error (internal/client)`
    )
    return false
  }

  const windowSeconds = serviceConfig.successRateWindowSeconds || 60
  const minSamples = serviceConfig.successRateMinSamples || 10
  const threshold = serviceConfig.successRateThreshold || 0.5

  try {
    const stats = await redis.recordAccountSuccessRate(accountId, isSuccess, windowSeconds)

    // 样本量不足，不触发熔断
    if (stats.total < minSamples) {
      return false
    }

    // 成功率低于阈值，触发熔断
    if (stats.rate < threshold) {
      logger.warn(
        `🔥 Circuit breaker triggered for ${serviceType} account ${accountName || accountId}: ` +
          `success rate ${(stats.rate * 100).toFixed(1)}% (${stats.success}/${stats.total}) < ${threshold * 100}%`
      )

      // 调用传入的标记限流函数
      if (markRateLimitedFn) {
        await markRateLimitedFn(accountId, sessionHash)
      }

      return true
    }

    return false
  } catch (error) {
    // Redis 错误不影响正常转发
    logger.error(`❌ Circuit breaker check failed for ${serviceType} account ${accountId}:`, error)
    return false
  }
}

/**
 * 创建 Claude Console 熔断器检查函数
 * @param {Function} markAccountRateLimited - claudeConsoleAccountService.markAccountRateLimited
 * @returns {Function} - 熔断器检查函数
 */
function createClaudeConsoleCircuitBreaker(markAccountRateLimited) {
  return async (accountId, isSuccess, accountName = '', errorInfo = null) => {
    return checkAndTriggerCircuitBreaker({
      accountId,
      isSuccess,
      accountName,
      errorInfo,
      serviceType: 'claude-console',
      markRateLimitedFn: async (id) => {
        await markAccountRateLimited(id)
      }
    })
  }
}

/**
 * 创建 OpenAI Responses 熔断器检查函数
 * @param {Object} unifiedOpenAIScheduler - 统一调度器实例
 * @returns {Function} - 熔断器检查函数
 */
function createOpenAIResponsesCircuitBreaker(unifiedOpenAIScheduler) {
  return async (accountId, isSuccess, accountName = '', sessionHash = null, errorInfo = null) => {
    return checkAndTriggerCircuitBreaker({
      accountId,
      isSuccess,
      accountName,
      sessionHash,
      errorInfo,
      serviceType: 'openai-responses',
      markRateLimitedFn: async (id, hash) => {
        await unifiedOpenAIScheduler.markAccountRateLimited(id, 'openai-responses', hash)
      }
    })
  }
}

module.exports = {
  checkAndTriggerCircuitBreaker,
  createClaudeConsoleCircuitBreaker,
  createOpenAIResponsesCircuitBreaker,
  isExcludedError
}
