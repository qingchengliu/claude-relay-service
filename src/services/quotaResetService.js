const logger = require('../utils/logger')
const redis = require('../models/redis')

/**
 * API Key 额度重置服务
 * 每日 00:00 自动将已申请过额度的 API Key 限额恢复为原始值
 */
class QuotaResetService {
  constructor() {
    this.checkInterval = null
    this.isRunning = false
    this.lastResetDate = null
    this.checkIntervalMs = 60 * 1000 // 每分钟检查一次
  }

  /**
   * 启动定时检查
   */
  start() {
    if (this.checkInterval) {
      logger.warn('⚠️ Quota reset service is already running')
      return
    }

    logger.info('🔄 Starting quota reset service (checking every 1 minute)')

    // 立即检查一次，防止错过启动时的 00:00 窗口
    this.checkAndReset()

    this.checkInterval = setInterval(() => {
      this.checkAndReset()
    }, this.checkIntervalMs)
  }

  /**
   * 停止定时检查
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
      logger.info('🛑 Quota reset service stopped')
    }
  }

  /**
   * 检查时间并决定是否执行重置
   */
  async checkAndReset() {
    try {
      const now = redis.getDateInTimezone()
      const hour = now.getUTCHours()
      const minute = now.getUTCMinutes()
      const currentDate = redis.getDateStringInTimezone(now)

      if (hour !== 0 || minute !== 0) {
        return
      }

      if (this.lastResetDate === currentDate) {
        logger.debug(`⏭️ Quota reset already executed for ${currentDate}, skipping`)
        return
      }

      const executed = await this.performReset()
      if (executed) {
        this.lastResetDate = currentDate
      }
    } catch (error) {
      logger.error('❌ Quota reset schedule check failed:', error)
    }
  }

  /**
   * 执行重置逻辑
   */
  async performReset() {
    if (this.isRunning) {
      logger.debug('⏭️ Quota reset is already in progress, skipping this run')
      return false
    }

    this.isRunning = true
    const startTime = Date.now()

    try {
      const client = redis.getClientSafe()
      const yesterday = redis.getDateStringInTimezone(new Date(Date.now() - 86400000))
      const keyIds = await client.smembers(`quota_request:daily:${yesterday}`)

      if (!keyIds || keyIds.length === 0) {
        logger.info('📋 No quota requests to reset for yesterday')
        return true
      }

      let successCount = 0
      let failCount = 0

      for (const keyId of keyIds) {
        try {
          const originalLimit = await client.get(`quota_request:original:${keyId}`)
          const resetLimit = originalLimit ? parseFloat(originalLimit) : 50

          await client.hset(`apikey:${keyId}`, 'dailyCostLimit', String(resetLimit))
          successCount++
          logger.info(`🔄 Reset daily quota for API Key ${keyId}: ${resetLimit}`)
        } catch (error) {
          failCount++
          logger.error(`❌ Failed to reset quota for key ${keyId}:`, error)
        }
      }

      const duration = Date.now() - startTime
      logger.info(
        `✅ Quota reset completed: ${successCount} success, ${failCount} failed out of ${keyIds.length} total (${duration}ms)`
      )
      return true
    } catch (error) {
      logger.error('❌ Quota reset service error:', error)
    } finally {
      this.isRunning = false
    }

    return false
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    return {
      running: !!this.checkInterval,
      lastResetDate: this.lastResetDate,
      isProcessing: this.isRunning,
      checkIntervalMinutes: this.checkIntervalMs / (60 * 1000)
    }
  }
}

// 单例模式导出
const quotaResetService = new QuotaResetService()

module.exports = quotaResetService
