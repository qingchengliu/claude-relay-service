const express = require('express')
const openaiConsoleAccountService = require('../services/openaiConsoleAccountService')
const accountGroupService = require('../services/accountGroupService')
const { authenticateAdmin } = require('../middleware/auth')
const logger = require('../utils/logger')

const router = express.Router()

// 🌐 OpenAI Console 账户管理

// 获取所有 OpenAI Console 账户
router.get('/openai-console-accounts', authenticateAdmin, async (req, res) => {
  try {
    const accounts = await openaiConsoleAccountService.getAllAccounts()
    
    // 添加分组信息
    for (const account of accounts) {
      const groups = await accountGroupService.getGroupsByAccount(account.id, 'openai-console')
      account.groups = groups
    }
    
    return res.json({
      success: true,
      data: accounts
    })
  } catch (error) {
    logger.error('❌ Failed to get OpenAI Console accounts:', error)
    return res.status(500).json({
      error: 'Failed to get accounts',
      message: error.message
    })
  }
})

// 获取单个 OpenAI Console 账户
router.get('/openai-console-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const account = await openaiConsoleAccountService.getAccount(id)
    
    if (!account) {
      return res.status(404).json({
        error: 'Account not found'
      })
    }
    
    // 添加分组信息
    const groups = await accountGroupService.getGroupsByAccount(id, 'openai-console')
    account.groups = groups
    
    return res.json({
      success: true,
      data: account
    })
  } catch (error) {
    logger.error(`❌ Failed to get OpenAI Console account ${req.params.id}:`, error)
    return res.status(500).json({
      error: 'Failed to get account',
      message: error.message
    })
  }
})

// 创建 OpenAI Console 账户
router.post('/openai-console-accounts', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      baseUrl,
      responsesPath,
      authType,
      apiKey,
      headers,
      proxy,
      supportedModels,
      priority,
      accountType,
      groupId
    } = req.body

    // 验证必填字段
    if (!name || !apiKey) {
      return res.status(400).json({
        error: 'Missing required fields: name and apiKey are required'
      })
    }

    // 验证 accountType
    if (accountType && !['shared', 'dedicated', 'group'].includes(accountType)) {
      return res.status(400).json({
        error: 'Invalid account type. Must be "shared", "dedicated" or "group"'
      })
    }

    // 创建账户
    const accountData = {
      name,
      description,
      baseUrl: baseUrl || 'https://api.openai.com',
      responsesPath: responsesPath || '/v1/responses',
      authType: authType || 'Bearer',
      apiKey,
      headers: headers || {},
      proxy: proxy || null,
      supportedModels: supportedModels || [],
      priority: priority || 50,
      accountType: accountType || 'shared'
    }

    const createdAccount = await openaiConsoleAccountService.createAccount(accountData)

    // 如果是分组类型，添加到分组
    if (accountType === 'group' && groupId) {
      await accountGroupService.addAccountToGroup(createdAccount.id, groupId, 'openai-console')
    }

    logger.success(`✅ Created OpenAI Console account: ${name} (ID: ${createdAccount.id})`)

    return res.json({
      success: true,
      data: createdAccount
    })
  } catch (error) {
    logger.error('❌ Failed to create OpenAI Console account:', error)
    return res.status(500).json({
      error: 'Failed to create account',
      message: error.message
    })
  }
})

// 更新 OpenAI Console 账户
router.put('/openai-console-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const updates = req.body

    // 验证 accountType
    if (updates.accountType && !['shared', 'dedicated', 'group'].includes(updates.accountType)) {
      return res.status(400).json({
        error: 'Invalid account type. Must be "shared", "dedicated" or "group"'
      })
    }

    const updatedAccount = await openaiConsoleAccountService.updateAccount(id, updates)

    logger.success(`✅ Updated OpenAI Console account: ${id}`)
    return res.json({
      success: true,
      data: updatedAccount
    })
  } catch (error) {
    logger.error(`❌ Failed to update OpenAI Console account ${req.params.id}:`, error)
    return res.status(500).json({
      error: 'Failed to update account',
      message: error.message
    })
  }
})

// 删除 OpenAI Console 账户
router.delete('/openai-console-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    
    // 从分组中移除
    const groups = await accountGroupService.getGroupsByAccount(id, 'openai-console')
    for (const group of groups) {
      await accountGroupService.removeAccountFromGroup(id, group.id, 'openai-console')
    }
    
    // 删除账户
    const result = await openaiConsoleAccountService.deleteAccount(id)
    
    if (!result) {
      return res.status(404).json({
        error: 'Account not found'
      })
    }
    
    logger.success(`✅ Deleted OpenAI Console account: ${id}`)
    return res.json({
      success: true,
      message: 'Account deleted successfully'
    })
  } catch (error) {
    logger.error(`❌ Failed to delete OpenAI Console account ${req.params.id}:`, error)
    return res.status(500).json({
      error: 'Failed to delete account',
      message: error.message
    })
  }
})

// 测试 OpenAI Console 账户连通性
router.post('/openai-console-accounts/:id/test', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const testResult = await openaiConsoleAccountService.testAccount(id)
    
    return res.json({
      success: testResult.success,
      data: testResult
    })
  } catch (error) {
    logger.error(`❌ Failed to test OpenAI Console account ${req.params.id}:`, error)
    return res.status(500).json({
      error: 'Failed to test account',
      message: error.message
    })
  }
})

// 批量更新 OpenAI Console 账户状态
router.post('/openai-console-accounts/batch-update-status', authenticateAdmin, async (req, res) => {
  try {
    const { accountIds, status } = req.body
    
    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid accountIds. Must be a non-empty array'
      })
    }
    
    if (!['active', 'inactive', 'error'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be "active", "inactive" or "error"'
      })
    }
    
    const results = []
    const errors = []
    
    for (const accountId of accountIds) {
      try {
        await openaiConsoleAccountService.updateAccount(accountId, {
          status,
          isActive: status === 'active' ? 'true' : 'false'
        })
        results.push(accountId)
      } catch (error) {
        errors.push({ accountId, error: error.message })
      }
    }
    
    return res.json({
      success: errors.length === 0,
      data: {
        updated: results,
        failed: errors
      }
    })
  } catch (error) {
    logger.error('❌ Failed to batch update OpenAI Console accounts:', error)
    return res.status(500).json({
      error: 'Failed to batch update',
      message: error.message
    })
  }
})

module.exports = router