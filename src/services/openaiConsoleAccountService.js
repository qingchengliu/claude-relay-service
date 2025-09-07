const { v4: uuidv4 } = require('uuid')
const redisClient = require('../models/redis')
const logger = require('../utils/logger')
const crypto = require('crypto')
const axios = require('axios')
const config = require('../../config/config')

class OpenAIConsoleAccountService {
  constructor() {
    this.algorithm = 'aes-256-cbc'
    this.encryptionKey = config.security.encryptionKey
    this.initializationVector = crypto.randomBytes(16)
  }

  /**
   * 加密敏感数据
   */
  encrypt(text) {
    if (!text) return ''
    try {
      const cipher = crypto.createCipheriv(
        this.algorithm,
        Buffer.from(this.encryptionKey, 'hex'),
        this.initializationVector
      )
      let encrypted = cipher.update(text, 'utf8', 'hex')
      encrypted += cipher.final('hex')
      return this.initializationVector.toString('hex') + ':' + encrypted
    } catch (error) {
      logger.error('❌ Encryption error:', error)
      throw new Error('Failed to encrypt data')
    }
  }

  /**
   * 解密敏感数据
   */
  decrypt(text) {
    if (!text) return ''
    try {
      const textParts = text.split(':')
      const iv = Buffer.from(textParts.shift(), 'hex')
      const encryptedText = textParts.join(':')
      const decipher = crypto.createDecipheriv(
        this.algorithm,
        Buffer.from(this.encryptionKey, 'hex'),
        iv
      )
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    } catch (error) {
      logger.error('❌ Decryption error:', error)
      throw new Error('Failed to decrypt data')
    }
  }

  /**
   * 创建新的 OpenAI Console 账户
   */
  async createAccount(accountData) {
    try {
      const accountId = uuidv4()
      const now = new Date().toISOString()

      // 加密敏感信息
      const encryptedToken = accountData.apiKey ? this.encrypt(accountData.apiKey) : ''

      const account = {
        id: accountId,
        name: accountData.name || 'OpenAI Console Account',
        description: accountData.description || '',
        baseUrl: accountData.baseUrl || 'https://api.openai.com',
        responsesPath: accountData.responsesPath || '/v1/responses',
        authType: accountData.authType || 'Bearer', // Bearer 或 x-api-key
        apiKey: encryptedToken,
        headers: JSON.stringify(accountData.headers || {}),
        proxy: JSON.stringify(accountData.proxy || null),
        isActive: 'true',
        priority: accountData.priority || 50,
        supportedModels: JSON.stringify(accountData.supportedModels || []),
        createdAt: now,
        updatedAt: now,
        lastUsedAt: '',
        status: 'active',
        accountType: 'openai-console'
      }

      // 存储到 Redis
      const key = `openai_console:account:${accountId}`
      await redisClient.client.hset(key, account)

      logger.info(`✅ Created OpenAI Console account: ${accountId}`)
      return { ...account, id: accountId, apiKey: accountData.apiKey } // 返回未加密的 apiKey
    } catch (error) {
      logger.error('❌ Failed to create OpenAI Console account:', error)
      throw error
    }
  }

  /**
   * 获取所有 OpenAI Console 账户
   */
  async getAllAccounts() {
    try {
      const keys = await redisClient.client.keys('openai_console:account:*')
      const accounts = []

      for (const key of keys) {
        const accountData = await redisClient.client.hgetall(key)
        if (accountData && Object.keys(accountData).length > 0) {
          // 解密敏感信息但不返回
          accounts.push({
            ...accountData,
            apiKey: '***masked***',
            headers: JSON.parse(accountData.headers || '{}'),
            proxy: JSON.parse(accountData.proxy || 'null'),
            supportedModels: JSON.parse(accountData.supportedModels || '[]')
          })
        }
      }

      return accounts
    } catch (error) {
      logger.error('❌ Failed to get OpenAI Console accounts:', error)
      return []
    }
  }

  /**
   * 获取单个账户信息
   */
  async getAccount(accountId) {
    try {
      const key = `openai_console:account:${accountId}`
      const accountData = await redisClient.client.hgetall(key)

      if (!accountData || Object.keys(accountData).length === 0) {
        return null
      }

      // 解密 API Key
      const decryptedApiKey = accountData.apiKey ? this.decrypt(accountData.apiKey) : ''

      return {
        ...accountData,
        apiKey: decryptedApiKey,
        headers: JSON.parse(accountData.headers || '{}'),
        proxy: JSON.parse(accountData.proxy || 'null'),
        supportedModels: JSON.parse(accountData.supportedModels || '[]')
      }
    } catch (error) {
      logger.error(`❌ Failed to get OpenAI Console account ${accountId}:`, error)
      return null
    }
  }

  /**
   * 更新账户信息
   */
  async updateAccount(accountId, updateData) {
    try {
      const key = `openai_console:account:${accountId}`
      const currentData = await redisClient.client.hgetall(key)

      if (!currentData || Object.keys(currentData).length === 0) {
        throw new Error('Account not found')
      }

      // 准备更新数据
      const updates = {
        updatedAt: new Date().toISOString()
      }

      // 处理各个字段的更新
      if (updateData.name !== undefined) updates.name = updateData.name
      if (updateData.description !== undefined) updates.description = updateData.description
      if (updateData.baseUrl !== undefined) updates.baseUrl = updateData.baseUrl
      if (updateData.responsesPath !== undefined) updates.responsesPath = updateData.responsesPath
      if (updateData.authType !== undefined) updates.authType = updateData.authType
      if (updateData.apiKey !== undefined) {
        updates.apiKey = this.encrypt(updateData.apiKey)
      }
      if (updateData.headers !== undefined) {
        updates.headers = JSON.stringify(updateData.headers)
      }
      if (updateData.proxy !== undefined) {
        updates.proxy = JSON.stringify(updateData.proxy)
      }
      if (updateData.isActive !== undefined) {
        updates.isActive = String(updateData.isActive)
      }
      if (updateData.priority !== undefined) {
        updates.priority = updateData.priority
      }
      if (updateData.supportedModels !== undefined) {
        updates.supportedModels = JSON.stringify(updateData.supportedModels)
      }
      if (updateData.status !== undefined) {
        updates.status = updateData.status
      }

      // 更新 Redis
      await redisClient.client.hset(key, updates)

      logger.info(`✅ Updated OpenAI Console account: ${accountId}`)
      return await this.getAccount(accountId)
    } catch (error) {
      logger.error(`❌ Failed to update OpenAI Console account ${accountId}:`, error)
      throw error
    }
  }

  /**
   * 删除账户
   */
  async deleteAccount(accountId) {
    try {
      const key = `openai_console:account:${accountId}`
      const result = await redisClient.client.del(key)

      if (result > 0) {
        logger.info(`✅ Deleted OpenAI Console account: ${accountId}`)
        return true
      }

      return false
    } catch (error) {
      logger.error(`❌ Failed to delete OpenAI Console account ${accountId}:`, error)
      throw error
    }
  }

  /**
   * 测试账户连通性
   */
  async testAccount(accountId) {
    try {
      const account = await this.getAccount(accountId)
      if (!account) {
        throw new Error('Account not found')
      }

      const url = account.baseUrl + account.responsesPath
      const headers = {
        ...account.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }

      // 设置认证头
      if (account.authType === 'Bearer') {
        headers.Authorization = `Bearer ${account.apiKey}`
      } else if (account.authType === 'x-api-key') {
        headers['x-api-key'] = account.apiKey
      }

      // 最小测试 payload
      const testPayload = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
        stream: false
      }

      // 配置请求选项
      const requestConfig = {
        method: 'POST',
        url,
        headers,
        data: testPayload,
        timeout: 10000,
        validateStatus: (status) => status < 500
      }

      // 添加代理配置
      if (account.proxy && account.proxy.host) {
        const { HttpsProxyAgent } = require('https-proxy-agent')
        const { SocksProxyAgent } = require('socks-proxy-agent')

        let proxyUrl
        if (account.proxy.type === 'socks5') {
          proxyUrl = `socks5://${account.proxy.auth ? account.proxy.auth + '@' : ''}${account.proxy.host}:${account.proxy.port}`
          requestConfig.httpsAgent = new SocksProxyAgent(proxyUrl)
        } else {
          proxyUrl = `http://${account.proxy.auth ? account.proxy.auth + '@' : ''}${account.proxy.host}:${account.proxy.port}`
          requestConfig.httpsAgent = new HttpsProxyAgent(proxyUrl)
        }
      }

      const response = await axios(requestConfig)

      // 更新账户状态
      await this.updateAccount(accountId, {
        status: response.status < 400 ? 'active' : 'error',
        lastUsedAt: new Date().toISOString()
      })

      return {
        success: response.status < 400,
        status: response.status,
        message: response.status < 400 ? 'Connection successful' : `Error: ${response.status}`,
        response: response.data
      }
    } catch (error) {
      logger.error(`❌ Failed to test OpenAI Console account ${accountId}:`, error)

      // 更新账户状态
      await this.updateAccount(accountId, {
        status: 'error'
      })

      return {
        success: false,
        message: error.message,
        error: error.response?.data || error.message
      }
    }
  }

  /**
   * 获取可用的账户（用于路由调度）
   */
  async getAvailableAccounts() {
    try {
      const accounts = await this.getAllAccounts()
      const availableAccounts = []

      for (const account of accounts) {
        if (account.isActive === 'true' && account.status === 'active') {
          // 获取完整的账户信息（包括解密的 API Key）
          const fullAccount = await this.getAccount(account.id)
          if (fullAccount) {
            availableAccounts.push(fullAccount)
          }
        }
      }

      // 按优先级排序
      availableAccounts.sort((a, b) => (b.priority || 0) - (a.priority || 0))

      return availableAccounts
    } catch (error) {
      logger.error('❌ Failed to get available OpenAI Console accounts:', error)
      return []
    }
  }

  /**
   * 更新账户最后使用时间
   */
  async updateLastUsedTime(accountId) {
    try {
      const key = `openai_console:account:${accountId}`
      await redisClient.client.hset(key, 'lastUsedAt', new Date().toISOString())
    } catch (error) {
      logger.error(`❌ Failed to update last used time for account ${accountId}:`, error)
    }
  }

  /**
   * 检查模型支持
   */
  isModelSupported(account, model) {
    if (!account.supportedModels || account.supportedModels.length === 0) {
      return true // 如果没有配置，默认支持所有模型
    }
    return account.supportedModels.includes(model)
  }
}

module.exports = new OpenAIConsoleAccountService()