const config = require('../../config/config')
const logger = require('../../src/utils/logger')

class CodeStatisticsRedis {
  constructor() {
    this.redis = null
    this.prefix = config.plugins?.codeStatistics?.redisPrefix || 'code_stats:'
  }

  init() {
    // 复用主应用的 Redis 连接
    this.redis = require('../../src/models/redis')
    logger.info('📊 Code statistics Redis extension initialized')
  }

  /**
   * 记录编辑统计数据
   */
  async recordEditStatistics(keyId, editStats, _model = 'unknown') {
    if (!this.redis) {
      logger.error('❌ Redis not initialized for code statistics')
      return
    }

    const now = new Date()
    const today = this.getDateString(now)
    const currentMonth = this.getMonthString(now)

    const pipeline = this.redis.getClient().pipeline()

    const hasEditContent = editStats.totalEditedLines > 0

    // 只有真正有编辑内容时才记录编辑相关的统计
    if (hasEditContent) {
      // API Key 级别编辑统计
      const keyStatsKey = `${this.prefix}key:${keyId}`
      pipeline.hincrby(keyStatsKey, 'totalEditedLines', editStats.totalEditedLines)
      pipeline.hincrby(keyStatsKey, 'totalEditOperations', editStats.editOperations)
      pipeline.hincrby(keyStatsKey, 'totalNewFiles', editStats.newFiles)
      pipeline.hincrby(keyStatsKey, 'totalModifiedFiles', editStats.modifiedFiles)

      // 每日编辑统计
      const dailyKey = `${this.prefix}daily:${keyId}:${today}`
      pipeline.hincrby(dailyKey, 'editedLines', editStats.totalEditedLines)
      pipeline.hincrby(dailyKey, 'editOperations', editStats.editOperations)
      pipeline.hincrby(dailyKey, 'newFiles', editStats.newFiles)
      pipeline.hincrby(dailyKey, 'modifiedFiles', editStats.modifiedFiles)
      pipeline.hset(dailyKey, 'lastUpdated', now.toISOString())
      pipeline.expire(dailyKey, 86400 * 90) // 保留90天

      // 每月编辑统计
      const monthlyKey = `${this.prefix}monthly:${keyId}:${currentMonth}`
      pipeline.hincrby(monthlyKey, 'editedLines', editStats.totalEditedLines)
      pipeline.hincrby(monthlyKey, 'editOperations', editStats.editOperations)
      pipeline.expire(monthlyKey, 86400 * 365) // 保留1年
    }

    // 工具调用统计 - 独立于编辑内容，总是记录
    if (editStats.toolUsage && Object.keys(editStats.toolUsage).length > 0) {
      // 确保基础键存在（无论是否有编辑内容）
      const keyStatsKey = `${this.prefix}key:${keyId}`
      const dailyKey = `${this.prefix}daily:${keyId}:${today}`
      pipeline.expire(dailyKey, 86400 * 90) // 保留90天

      for (const [toolName, count] of Object.entries(editStats.toolUsage)) {
        // API Key级别的工具调用统计
        pipeline.hincrby(keyStatsKey, `tool_${toolName}`, count)

        // 每日工具调用统计
        pipeline.hincrby(dailyKey, `tool_${toolName}`, count)
        pipeline.hset(dailyKey, 'lastUpdated', now.toISOString())

        // 系统级每日工具调用统计
        const systemDailyKey = `${this.prefix}system:daily:${today}`
        pipeline.hincrby(systemDailyKey, `tool_${toolName}`, count)

        // 专门的工具统计键
        const toolDailyKey = `${this.prefix}tool:daily:${toolName}:${today}`
        pipeline.hincrby(toolDailyKey, 'count', count)
        pipeline.hincrby(toolDailyKey, 'users', 0) // 初始化用户计数器
        pipeline.sadd(`${toolDailyKey}:users`, keyId) // 用集合记录使用该工具的用户
        pipeline.expire(toolDailyKey, 86400 * 90)
        pipeline.expire(`${toolDailyKey}:users`, 86400 * 90)
      }
    }

    // 按编程语言统计 - 只在有编辑内容时记录
    if (hasEditContent && editStats.languages && Object.keys(editStats.languages).length > 0) {
      for (const [language, lines] of Object.entries(editStats.languages)) {
        const langDailyKey = `${this.prefix}language:daily:${language}:${today}`
        pipeline.hincrby(langDailyKey, 'lines', lines)
        pipeline.hincrby(langDailyKey, 'operations', 1)
        pipeline.expire(langDailyKey, 86400 * 90)

        const keyLangDailyKey = `${this.prefix}key:${keyId}:language:daily:${language}:${today}`
        pipeline.hincrby(keyLangDailyKey, 'lines', lines)
        pipeline.expire(keyLangDailyKey, 86400 * 90)

        // 特殊处理 java-test 语言，累加到总计中
        if (language === 'java-test') {
          const keyStatsKey = `${this.prefix}key:${keyId}`
          pipeline.hincrby(keyStatsKey, 'totalTestLines', lines)
        }
      }
    }

    // 按文件类型统计 - 只在有编辑内容时记录
    if (hasEditContent && editStats.fileTypes && Object.keys(editStats.fileTypes).length > 0) {
      for (const [fileType, lines] of Object.entries(editStats.fileTypes)) {
        const typeDailyKey = `${this.prefix}filetype:daily:${fileType}:${today}`
        pipeline.hincrby(typeDailyKey, 'lines', lines)
        pipeline.expire(typeDailyKey, 86400 * 90)
      }
    }

    // 系统级统计 - 只在有编辑内容时记录
    if (hasEditContent) {
      const systemDailyKey = `${this.prefix}system:daily:${today}`
      pipeline.hincrby(systemDailyKey, 'totalEditedLines', editStats.totalEditedLines)
      pipeline.hincrby(systemDailyKey, 'totalEditOperations', editStats.editOperations)
      pipeline.hincrby(systemDailyKey, 'totalNewFiles', editStats.newFiles)
      pipeline.hincrby(systemDailyKey, 'totalModifiedFiles', editStats.modifiedFiles)
      pipeline.expire(systemDailyKey, 86400 * 365)
    }

    try {
      await pipeline.exec()
    } catch (error) {
      logger.error('❌ Failed to record code statistics:', error)
      throw error
    }
  }

  /**
   * 获取 API Key 的编辑统计
   */
  async getKeyEditStatistics(keyId, days = 7) {
    const stats = {
      total: {},
      daily: [],
      languages: {},
      fileTypes: {}
    }

    try {
      // 获取总计数据
      const keyStatsKey = `${this.prefix}key:${keyId}`
      stats.total = await this.redis.getClient().hgetall(keyStatsKey)

      // 获取每日数据
      const today = new Date()
      for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateString = this.getDateString(date)

        const dailyKey = `${this.prefix}daily:${keyId}:${dateString}`
        const dailyData = await this.redis.getClient().hgetall(dailyKey)

        stats.daily.push({
          date: dateString,
          ...dailyData
        })
      }

      return stats
    } catch (error) {
      logger.error('❌ Failed to get code statistics:', error)
      return stats
    }
  }

  /**
   * 获取系统级编辑统计
   */
  async getSystemEditStatistics(days = 30) {
    const stats = {
      daily: [],
      languages: {},
      fileTypes: {}
    }

    try {
      const today = new Date()

      for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateString = this.getDateString(date)

        const systemDailyKey = `${this.prefix}system:daily:${dateString}`
        const dailyData = await this.redis.getClient().hgetall(systemDailyKey)

        stats.daily.push({
          date: dateString,
          ...dailyData
        })
      }

      return stats
    } catch (error) {
      logger.error('❌ Failed to get system code statistics:', error)
      return stats
    }
  }

  /**
   * 获取语言统计数据
   */
  async getLanguageStatistics(days = 30) {
    const stats = {}

    try {
      const today = new Date()

      for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateString = this.getDateString(date)

        // 获取所有语言的统计
        const keys = await this.redis
          .getClient()
          .keys(`${this.prefix}language:daily:*:${dateString}`)

        for (const key of keys) {
          const language = key.split(':')[3] // 从 code_stats:language:daily:javascript:2024-01-01 中提取 javascript
          const data = await this.redis.getClient().hgetall(key)

          if (!stats[language]) {
            stats[language] = { lines: 0, operations: 0 }
          }

          stats[language].lines += parseInt(data.lines || 0)
          stats[language].operations += parseInt(data.operations || 0)
        }
      }

      return stats
    } catch (error) {
      logger.error('❌ Failed to get language statistics:', error)
      return stats
    }
  }

  /**
   * 获取排行榜数据
   */
  async getLeaderboard(
    limit = 10,
    offset = 0,
    pageLimit = null,
    sortBy = 'totalEditedLines',
    sortOrder = 'desc'
  ) {
    try {
      const keys = await this.redis.getClient().keys(`${this.prefix}key:*`)
      const leaderboard = []

      for (const key of keys) {
        // 只处理基础的用户统计键，过滤掉语言统计键等子键
        const parts = key.split(':')
        if (parts.length !== 3) {
          // code_stats:key:keyId 应该正好是3部分
          continue
        }

        const keyId = parts[2]
        const data = await this.redis.getClient().hgetall(key)

        if (data.totalEditedLines) {
          // 获取API Key的详细信息来获取用户名
          const apiKeyInfo = await this.redis.getClient().hgetall(`apikey:${keyId}`)
          const userName = apiKeyInfo.name || keyId

          // 获取总请求数和总费用
          const usageTotalKey = `usage:${keyId}`
          const costTotalKey = `usage:cost:total:${keyId}`

          const [usageData, totalCost] = await Promise.all([
            this.redis.getClient().hgetall(usageTotalKey),
            this.redis.getClient().get(costTotalKey)
          ])

          const totalRequests = parseInt(usageData.totalRequests || usageData.requests || 0)
          const totalCostValue = parseFloat(totalCost || 0)

          // 直接从预处理的总计中获取 java-test 行数
          const totalTestLines = parseInt(data.totalTestLines || 0)

          leaderboard.push({
            keyId,
            userName,
            totalEditedLines: parseInt(data.totalEditedLines || 0),
            totalTestLines, // 新增单测行数字段
            totalEditOperations: parseInt(data.totalEditOperations || 0),
            totalNewFiles: parseInt(data.totalNewFiles || 0),
            totalModifiedFiles: parseInt(data.totalModifiedFiles || 0),
            totalRequests,
            totalCost: totalCostValue
          })
        }
      }

      // 自定义排序
      this.sortLeaderboard(leaderboard, sortBy, sortOrder)

      const total = leaderboard.length
      const finalLimit = pageLimit || limit
      const paginatedData =
        finalLimit > 0 ? leaderboard.slice(offset, offset + finalLimit) : leaderboard

      return {
        data: paginatedData,
        total
      }
    } catch (error) {
      logger.error('❌ Failed to get leaderboard:', error)
      return { data: [], total: 0 }
    }
  }

  /**
   * 获取指定天数内的排行榜数据
   */
  async getLeaderboardByDays(
    limit = 10,
    days = 7,
    offset = 0,
    pageLimit = null,
    sortBy = 'totalEditedLines',
    sortOrder = 'desc'
  ) {
    try {
      const keys = await this.redis.getClient().keys(`${this.prefix}key:*`)
      const leaderboard = []
      const today = new Date()

      for (const key of keys) {
        // 只处理基础的用户统计键，过滤掉语言统计键等子键
        const parts = key.split(':')
        if (parts.length !== 3) {
          // code_stats:key:keyId 应该正好是3部分
          continue
        }

        const keyId = parts[2]
        let totalLines = 0
        let totalOperations = 0
        let totalNewFiles = 0
        let totalModifiedFiles = 0
        let totalTestLines = 0 // 新增单测行数统计

        // 累计指定天数的统计数据
        let totalRequests = 0
        let totalCost = 0

        // 计算活跃天数
        let activeDays = 0
        for (let i = 0; i < days; i++) {
          const date = new Date(today)
          date.setDate(date.getDate() - i)
          const dateString = this.getDateString(date)

          const dailyKey = `${this.prefix}daily:${keyId}:${dateString}`
          const dailyData = await this.redis.getClient().hgetall(dailyKey)

          const dayLines = parseInt(dailyData.editedLines || 0)
          const dayOperations = parseInt(dailyData.editOperations || 0)
          const dayNewFiles = parseInt(dailyData.newFiles || 0)
          const dayModifiedFiles = parseInt(dailyData.modifiedFiles || 0)

          totalLines += dayLines
          totalOperations += dayOperations
          totalNewFiles += dayNewFiles
          totalModifiedFiles += dayModifiedFiles

          // 获取当天java-test语言的统计
          const javaTestKey = `${this.prefix}key:${keyId}:language:daily:java-test:${dateString}`
          const dayTestLines = parseInt(
            (await this.redis.getClient().hget(javaTestKey, 'lines')) || 0
          )
          totalTestLines += dayTestLines

          // 如果当天有任何编辑活动，则计为活跃天
          if (dayLines > 0 || dayOperations > 0 || dayNewFiles > 0 || dayModifiedFiles > 0) {
            activeDays++
          }

          // 获取对应日期的请求数和费用
          const usageDailyKey = `usage:daily:${keyId}:${dateString}`
          const costDailyKey = `usage:cost:daily:${keyId}:${dateString}`

          const [usageData, costData] = await Promise.all([
            this.redis.getClient().hgetall(usageDailyKey),
            this.redis.getClient().get(costDailyKey)
          ])

          totalRequests += parseInt(usageData.totalRequests || usageData.requests || 0)
          totalCost += parseFloat(costData || 0)
        }

        // 只包含有数据的用户
        if (totalLines > 0 || totalOperations > 0) {
          // 获取API Key的详细信息来获取用户名
          const apiKeyInfo = await this.redis.getClient().hgetall(`apikey:${keyId}`)
          const userName = apiKeyInfo.name || keyId

          leaderboard.push({
            keyId,
            userName,
            totalEditedLines: totalLines,
            totalTestLines, // 新增单测行数字段
            totalEditOperations: totalOperations,
            totalNewFiles,
            totalModifiedFiles,
            totalRequests,
            totalCost,
            activeDays // 新增活跃天数字段
          })
        }
      }

      // 自定义排序
      this.sortLeaderboard(leaderboard, sortBy, sortOrder)

      const total = leaderboard.length
      const finalLimit = pageLimit || limit
      const paginatedData =
        finalLimit > 0 ? leaderboard.slice(offset, offset + finalLimit) : leaderboard

      return {
        data: paginatedData,
        total
      }
    } catch (error) {
      logger.error('❌ Failed to get leaderboard by days:', error)
      return { data: [], total: 0 }
    }
  }

  /**
   * 获取当月排行榜数据
   */
  async getLeaderboardByMonth(
    limit = 10,
    offset = 0,
    pageLimit = null,
    sortBy = 'totalEditedLines',
    sortOrder = 'desc'
  ) {
    try {
      const keys = await this.redis.getClient().keys(`${this.prefix}key:*`)
      const leaderboard = []
      const today = new Date()
      const year = today.getFullYear()
      const month = today.getMonth() + 1

      for (const key of keys) {
        // 只处理基础的用户统计键，过滤掉语言统计键等子键
        const parts = key.split(':')
        if (parts.length !== 3) {
          // code_stats:key:keyId 应该正好是3部分
          continue
        }

        const keyId = parts[2]
        let totalLines = 0
        let totalOperations = 0
        let totalNewFiles = 0
        let totalModifiedFiles = 0
        let totalTestLines = 0 // 新增单测行数统计

        // 获取当月的所有日期
        let totalRequests = 0
        let totalCost = 0
        let activeDays = 0

        const daysInMonth = new Date(year, month, 0).getDate()
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(year, month - 1, day)
          const dateString = this.getDateString(date)

          const dailyKey = `${this.prefix}daily:${keyId}:${dateString}`
          const dailyData = await this.redis.getClient().hgetall(dailyKey)

          const dayLines = parseInt(dailyData.editedLines || 0)
          const dayOperations = parseInt(dailyData.editOperations || 0)
          const dayNewFiles = parseInt(dailyData.newFiles || 0)
          const dayModifiedFiles = parseInt(dailyData.modifiedFiles || 0)

          totalLines += dayLines
          totalOperations += dayOperations
          totalNewFiles += dayNewFiles
          totalModifiedFiles += dayModifiedFiles

          // 获取当天java-test语言的统计
          const javaTestKey = `${this.prefix}key:${keyId}:language:daily:java-test:${dateString}`
          const dayTestLines = parseInt(
            (await this.redis.getClient().hget(javaTestKey, 'lines')) || 0
          )
          totalTestLines += dayTestLines

          // 如果当天有任何编辑活动，则计为活跃天
          if (dayLines > 0 || dayOperations > 0 || dayNewFiles > 0 || dayModifiedFiles > 0) {
            activeDays++
          }

          // 获取对应日期的请求数和费用
          const usageDailyKey = `usage:daily:${keyId}:${dateString}`
          const costDailyKey = `usage:cost:daily:${keyId}:${dateString}`

          const [usageData, costData] = await Promise.all([
            this.redis.getClient().hgetall(usageDailyKey),
            this.redis.getClient().get(costDailyKey)
          ])

          totalRequests += parseInt(usageData.totalRequests || usageData.requests || 0)
          totalCost += parseFloat(costData || 0)
        }

        // 只包含有数据的用户
        if (totalLines > 0 || totalOperations > 0) {
          // 获取API Key的详细信息来获取用户名
          const apiKeyInfo = await this.redis.getClient().hgetall(`apikey:${keyId}`)
          const userName = apiKeyInfo.name || keyId

          leaderboard.push({
            keyId,
            userName,
            totalEditedLines: totalLines,
            totalTestLines, // 新增单测行数字段
            totalEditOperations: totalOperations,
            totalNewFiles,
            totalModifiedFiles,
            totalRequests,
            totalCost,
            activeDays // 新增活跃天数字段
          })
        }
      }

      // 自定义排序
      this.sortLeaderboard(leaderboard, sortBy, sortOrder)

      const total = leaderboard.length
      const finalLimit = pageLimit || limit
      const paginatedData =
        finalLimit > 0 ? leaderboard.slice(offset, offset + finalLimit) : leaderboard

      return {
        data: paginatedData,
        total
      }
    } catch (error) {
      logger.error('❌ Failed to get leaderboard by month:', error)
      return { data: [], total: 0 }
    }
  }

  /**
   * 获取指定用户的统计数据
   */
  async getUserStatistics(keyId, days = 30) {
    try {
      const stats = {
        user: null,
        daily: [],
        languages: {},
        fileTypes: {},
        total: {}
      }

      // 获取用户信息
      const apiKeyInfo = await this.redis.getClient().hgetall(`apikey:${keyId}`)
      if (!apiKeyInfo.name) {
        return stats
      }

      stats.user = {
        keyId,
        userName: apiKeyInfo.name,
        description: apiKeyInfo.description || ''
      }

      // 获取用户的总统计
      const keyStatsKey = `${this.prefix}key:${keyId}`
      stats.total = await this.redis.getClient().hgetall(keyStatsKey)

      // 获取每日统计
      const today = new Date()
      for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateString = this.getDateString(date)

        const dailyKey = `${this.prefix}daily:${keyId}:${dateString}`
        const dailyData = await this.redis.getClient().hgetall(dailyKey)

        stats.daily.push({
          date: dateString,
          ...dailyData
        })
      }

      // 获取语言统计 (过去N天汇总)
      for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateString = this.getDateString(date)

        const langKeys = await this.redis
          .getClient()
          .keys(`${this.prefix}key:${keyId}:language:daily:*:${dateString}`)

        for (const key of langKeys) {
          const language = key.split(':')[5] // 从 code_stats:key:xxx:language:daily:python:2024-01-01 中提取 python
          const data = await this.redis.getClient().hgetall(key)

          if (!stats.languages[language]) {
            stats.languages[language] = { lines: 0, operations: 0 }
          }

          stats.languages[language].lines += parseInt(data.lines || 0)
          stats.languages[language].operations += parseInt(data.operations || 0)
        }
      }

      return stats
    } catch (error) {
      logger.error('❌ Failed to get user statistics:', error)
      return { user: null, daily: [], languages: {}, fileTypes: {}, total: {} }
    }
  }

  /**
   * 获取所有有统计数据的用户列表
   */
  async getAllUsers() {
    try {
      // 只获取基础统计键，避免语言统计键等重复
      const keys = await this.redis.getClient().keys(`${this.prefix}key:*`)
      const users = []
      const userSet = new Set() // 用于去重

      for (const key of keys) {
        // 只处理基础统计键 (code_stats:key:xxx)，不包含子键
        const parts = key.split(':')
        if (parts.length === 3) {
          // code_stats:key:keyId
          const keyId = parts[2]

          if (!userSet.has(keyId)) {
            const apiKeyInfo = await this.redis.getClient().hgetall(`apikey:${keyId}`)

            if (apiKeyInfo.name) {
              users.push({
                keyId,
                userName: apiKeyInfo.name,
                description: apiKeyInfo.description || ''
              })
              userSet.add(keyId)
            }
          }
        }
      }

      return users.sort((a, b) => a.userName.localeCompare(b.userName))
    } catch (error) {
      logger.error('❌ Failed to get all users:', error)
      return []
    }
  }

  /**
   * 获取工具调用统计
   */
  async getToolUsageStatistics(days = 30) {
    const stats = {
      daily: {},
      tools: {},
      totalUsage: 0
    }

    try {
      const today = new Date()

      for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateString = this.getDateString(date)

        // 获取该日期所有工具的统计
        const toolKeys = await this.redis
          .getClient()
          .keys(`${this.prefix}tool:daily:*:${dateString}`)

        stats.daily[dateString] = {}

        for (const key of toolKeys) {
          const toolName = key.split(':')[3] // 从 code_stats:tool:daily:Edit:2024-01-01 中提取 Edit
          const data = await this.redis.getClient().hgetall(key)
          const userSet = await this.redis.getClient().smembers(`${key}:users`)

          const count = parseInt(data.count || 0)
          const users = userSet.length

          stats.daily[dateString][toolName] = {
            count,
            users
          }

          // 累计工具统计
          if (!stats.tools[toolName]) {
            stats.tools[toolName] = {
              totalCount: 0,
              totalUsers: new Set(),
              dailyAvg: 0
            }
          }

          stats.tools[toolName].totalCount += count
          userSet.forEach((userId) => stats.tools[toolName].totalUsers.add(userId))
          stats.totalUsage += count
        }
      }

      // 计算平均值和转换Set为数量
      for (const [_toolName, toolData] of Object.entries(stats.tools)) {
        toolData.dailyAvg = Math.round((toolData.totalCount / days) * 100) / 100
        toolData.totalUsers = toolData.totalUsers.size
      }

      return stats
    } catch (error) {
      logger.error('❌ Failed to get tool usage statistics:', error)
      return stats
    }
  }

  /**
   * 获取指定用户的工具调用统计
   */
  async getUserToolUsageStatistics(keyId, days = 30) {
    const stats = {
      daily: {},
      tools: {},
      totalUsage: 0
    }

    try {
      const today = new Date()

      for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateString = this.getDateString(date)

        const dailyKey = `${this.prefix}daily:${keyId}:${dateString}`
        const dailyData = await this.redis.getClient().hgetall(dailyKey)

        stats.daily[dateString] = {}

        // 提取工具调用数据
        for (const [field, value] of Object.entries(dailyData)) {
          if (field.startsWith('tool_')) {
            const toolName = field.substring(5) // 移除 'tool_' 前缀
            const count = parseInt(value || 0)

            stats.daily[dateString][toolName] = count

            // 累计工具统计
            if (!stats.tools[toolName]) {
              stats.tools[toolName] = { totalCount: 0, dailyAvg: 0 }
            }

            stats.tools[toolName].totalCount += count
            stats.totalUsage += count
          }
        }
      }

      // 计算平均值
      for (const toolData of Object.values(stats.tools)) {
        toolData.dailyAvg = Math.round((toolData.totalCount / days) * 100) / 100
      }

      return stats
    } catch (error) {
      logger.error('❌ Failed to get user tool usage statistics:', error)
      return stats
    }
  }

  /**
   * 获取最受欢迎的工具排行
   */
  async getTopToolsRanking(limit = 10, days = 30) {
    try {
      const toolStats = await this.getToolUsageStatistics(days)

      const ranking = Object.entries(toolStats.tools)
        .filter(([toolName]) => toolName !== 'Unknown' && toolName !== 'undefined')
        .map(([toolName, data]) => ({
          tool: toolName,
          totalCount: data.totalCount,
          totalUsers: data.totalUsers,
          dailyAvg: data.dailyAvg
        }))
        .sort((a, b) => b.totalCount - a.totalCount)
        .slice(0, limit)

      return ranking
    } catch (error) {
      logger.error('❌ Failed to get top tools ranking:', error)
      return []
    }
  }

  /**
   * 获取活跃用户数
   */
  async getActiveUsersCount(days = 1) {
    try {
      const activeUsers = new Set()
      const today = new Date()

      for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateString = this.getDateString(date)

        // 获取该日期所有用户的统计数据
        const keys = await this.redis.getClient().keys(`${this.prefix}daily:*:${dateString}`)

        for (const key of keys) {
          const parts = key.split(':')
          // 格式: code_stats:daily:keyId:date
          if (parts.length === 4) {
            const keyId = parts[2]
            const dailyData = await this.redis.getClient().hgetall(key)

            // 检查是否有任何编辑活动
            const hasActivity =
              parseInt(dailyData.editedLines || 0) > 0 ||
              parseInt(dailyData.editOperations || 0) > 0 ||
              parseInt(dailyData.newFiles || 0) > 0 ||
              parseInt(dailyData.modifiedFiles || 0) > 0

            if (hasActivity) {
              activeUsers.add(keyId)
            }
          }
        }
      }

      return activeUsers.size
    } catch (error) {
      logger.error('❌ Failed to get active users count:', error)
      return 0
    }
  }

  /**
   * 排序排行榜数据
   */
  sortLeaderboard(leaderboard, sortBy = 'totalEditedLines', sortOrder = 'desc') {
    leaderboard.sort((a, b) => {
      const aValue = a[sortBy] || 0
      const bValue = b[sortBy] || 0

      // 处理字符串类型的排序
      if (sortBy === 'userName') {
        return sortOrder === 'desc' ? bValue.localeCompare(aValue) : aValue.localeCompare(bValue)
      }

      // 数值类型排序
      if (sortOrder === 'desc') {
        return bValue - aValue
      } else {
        return aValue - bValue
      }
    })
  }

  getDateString(date) {
    return date.toISOString().split('T')[0]
  }

  getMonthString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }
}

module.exports = new CodeStatisticsRedis()
