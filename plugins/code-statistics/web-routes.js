const express = require('express')
const redisExtension = require('./redis-extension')
const { authenticateAdmin } = require('../../src/middleware/auth')

const apiRouter = express.Router()
const adminRouter = express.Router()

// API 路由 - 获取 API Key 的代码统计
apiRouter.get('/:keyId', async (req, res) => {
  try {
    const { keyId } = req.params
    const { days = 7 } = req.query

    const stats = await redisExtension.getKeyEditStatistics(keyId, parseInt(days))

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取系统级代码统计
adminRouter.get('/system', authenticateAdmin, async (req, res) => {
  try {
    const { days = 30, startDate, endDate } = req.query

    let daysNum
    if (startDate && endDate) {
      // 计算自定义日期范围的天数
      const start = new Date(startDate)
      const end = new Date(endDate)
      daysNum = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
    } else {
      daysNum = parseInt(days)
    }

    const stats = await redisExtension.getSystemEditStatistics(daysNum)

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取语言统计
adminRouter.get('/languages', authenticateAdmin, async (req, res) => {
  try {
    const { days = 30, startDate, endDate } = req.query

    let daysNum
    if (startDate && endDate) {
      // 计算自定义日期范围的天数
      const start = new Date(startDate)
      const end = new Date(endDate)
      daysNum = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
    } else {
      daysNum = parseInt(days)
    }

    const stats = await redisExtension.getLanguageStatistics(daysNum)

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取代码统计排行榜
adminRouter.get('/leaderboard', authenticateAdmin, async (req, res) => {
  try {
    const {
      limit = 10,
      page = 1,
      days,
      month,
      all,
      startDate,
      endDate,
      sortBy = 'totalEditedLines',
      sortOrder = 'desc'
    } = req.query
    const pageNumber = parseInt(page)
    const limitNumber = parseInt(limit)
    const offset = (pageNumber - 1) * limitNumber

    let leaderboard, total
    if (all === 'true') {
      // 获取历史以来的排行榜
      const result = await redisExtension.getLeaderboard(0, offset, limitNumber, sortBy, sortOrder)
      ;({ data: leaderboard, total } = result)
    } else if (month === 'current') {
      // 获取当月排行榜
      const result = await redisExtension.getLeaderboardByMonth(
        0,
        offset,
        limitNumber,
        sortBy,
        sortOrder
      )
      ;({ data: leaderboard, total } = result)
    } else if (startDate && endDate) {
      // 使用自定义日期范围
      const start = new Date(startDate)
      const end = new Date(endDate)
      const daysNum = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
      const result = await redisExtension.getLeaderboardByDays(
        0,
        daysNum,
        offset,
        limitNumber,
        sortBy,
        sortOrder
      )
      ;({ data: leaderboard, total } = result)
    } else {
      // 获取指定天数的排行榜
      const daysNum = days ? parseInt(days) : 30
      const result = await redisExtension.getLeaderboardByDays(
        0,
        daysNum,
        offset,
        limitNumber,
        sortBy,
        sortOrder
      )
      ;({ data: leaderboard, total } = result)
    }

    res.json({
      success: true,
      data: leaderboard,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber)
      }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取活跃人数统计
adminRouter.get('/active-users', authenticateAdmin, async (req, res) => {
  try {
    const { days, month, startDate, endDate } = req.query
    let daysNum

    if (startDate && endDate) {
      // 计算自定义日期范围的天数
      const start = new Date(startDate)
      const end = new Date(endDate)
      daysNum = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
    } else if (month === 'current') {
      // 计算当月的天数（从1号到今天）
      const today = new Date()
      daysNum = today.getDate() // 当月已过去的天数
    } else {
      daysNum = days ? parseInt(days) : 1 // 默认当天
    }

    const activeUsers = await redisExtension.getActiveUsersCount(daysNum)

    res.json({
      success: true,
      data: {
        activeUsers,
        days: daysNum
      }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取所有用户列表
adminRouter.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const users = await redisExtension.getAllUsers()

    res.json({
      success: true,
      data: users
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取指定用户的统计数据
adminRouter.get('/users/:keyId', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params
    const { days, month, all } = req.query

    let daysNum = 30 // 默认值
    if (all === 'true') {
      daysNum = 365 // 获取一年的数据作为历史数据
    } else if (month === 'current') {
      daysNum = 31 // 当月最多31天
    } else if (days) {
      daysNum = parseInt(days)
    }

    const stats = await redisExtension.getUserStatistics(keyId, daysNum)

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取工具调用统计
adminRouter.get('/tools', authenticateAdmin, async (req, res) => {
  try {
    const { days = 30, startDate, endDate } = req.query

    let daysNum
    if (startDate && endDate) {
      // 计算自定义日期范围的天数
      const start = new Date(startDate)
      const end = new Date(endDate)
      daysNum = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
    } else {
      daysNum = parseInt(days)
    }

    const stats = await redisExtension.getToolUsageStatistics(daysNum)

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取工具调用排行榜
adminRouter.get('/tools/ranking', authenticateAdmin, async (req, res) => {
  try {
    const { limit = 10, days = 30, startDate, endDate } = req.query

    let daysNum
    if (startDate && endDate) {
      // 计算自定义日期范围的天数
      const start = new Date(startDate)
      const end = new Date(endDate)
      daysNum = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
    } else {
      daysNum = parseInt(days)
    }

    const ranking = await redisExtension.getTopToolsRanking(parseInt(limit), daysNum)

    res.json({
      success: true,
      data: ranking
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// 管理员路由 - 获取指定用户的工具调用统计
adminRouter.get('/users/:keyId/tools', authenticateAdmin, async (req, res) => {
  try {
    const { keyId } = req.params
    const { days = 30 } = req.query

    const stats = await redisExtension.getUserToolUsageStatistics(keyId, parseInt(days))

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

module.exports = {
  api: apiRouter,
  admin: adminRouter
}
