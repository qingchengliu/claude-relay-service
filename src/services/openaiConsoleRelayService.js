const axios = require('axios')
const logger = require('../utils/logger')
const { PassThrough } = require('stream')
const openaiConsoleAccountService = require('./openaiConsoleAccountService')

class OpenAIConsoleRelayService {
  constructor() {
    this.baseHeaders = {
      'User-Agent': 'Claude-Relay-Service/1.0',
      Accept: 'text/event-stream,application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      'OpenAI-Beta': 'responses=experimental'
    }

    // 需要过滤的请求头
    this.filteredRequestHeaders = new Set([
      'authorization',
      'x-api-key',
      'host',
      'content-length',
      'connection',
      'proxy-authorization',
      'content-encoding',
      'transfer-encoding',
      'te',
      'trailer',
      'upgrade'
    ])

    // 需要透传的响应头
    this.allowedResponseHeaders = new Set([
      'openai-version',
      'x-request-id',
      'openai-processing-ms',
      'x-chatgpt-account-id',
      'x-ratelimit-limit-requests',
      'x-ratelimit-remaining-requests',
      'x-ratelimit-reset-requests'
    ])
  }

  /**
   * 构建请求头
   */
  buildRequestHeaders(account, originalHeaders) {
    const headers = { ...this.baseHeaders }

    // 设置认证头
    if (account.authType === 'Bearer') {
      headers.Authorization = `Bearer ${account.apiKey}`
    } else if (account.authType === 'x-api-key') {
      headers['x-api-key'] = account.apiKey
    }

    // 透传某些原始请求头
    if (originalHeaders['session_id']) {
      headers['session_id'] = originalHeaders['session_id']
    }
    if (originalHeaders['content-type']) {
      headers['Content-Type'] = originalHeaders['content-type']
    }

    // 添加账户配置的自定义头
    if (account.headers && typeof account.headers === 'object') {
      Object.assign(headers, account.headers)
    }

    return headers
  }

  /**
   * 构建响应头
   */
  buildResponseHeaders(upstreamHeaders) {
    const headers = {}

    // 只透传允许的响应头
    for (const [key, value] of Object.entries(upstreamHeaders)) {
      const lowerKey = key.toLowerCase()
      if (this.allowedResponseHeaders.has(lowerKey)) {
        headers[key] = value
      }
    }

    return headers
  }

  /**
   * 创建代理配置
   */
  createProxyConfig(account) {
    if (!account.proxy || !account.proxy.host) {
      return null
    }

    const { HttpsProxyAgent } = require('https-proxy-agent')
    const { SocksProxyAgent } = require('socks-proxy-agent')

    let proxyUrl
    if (account.proxy.type === 'socks5') {
      const auth = account.proxy.auth || ''
      proxyUrl = `socks5://${auth ? auth + '@' : ''}${account.proxy.host}:${account.proxy.port}`
      return new SocksProxyAgent(proxyUrl)
    } else {
      const auth = account.proxy.auth || ''
      proxyUrl = `http://${auth ? auth + '@' : ''}${account.proxy.host}:${account.proxy.port}`
      return new HttpsProxyAgent(proxyUrl)
    }
  }

  /**
   * 转发非流式请求
   */
  async relayNonStreaming(account, requestBody, originalHeaders) {
    try {
      const url = account.baseUrl + account.responsesPath
      const headers = this.buildRequestHeaders(account, originalHeaders)

      const requestConfig = {
        method: 'POST',
        url,
        headers,
        data: requestBody,
        timeout: 60000,
        validateStatus: null
      }

      // 添加代理配置
      const proxyAgent = this.createProxyConfig(account)
      if (proxyAgent) {
        requestConfig.httpsAgent = proxyAgent
      }

      logger.info(`🔄 Forwarding non-streaming request to OpenAI Console: ${url}`)
      const response = await axios(requestConfig)

      // 构建响应
      const responseHeaders = this.buildResponseHeaders(response.headers)
      
      // 记录使用情况
      if (response.data && response.data.usage) {
        await this.recordUsage(account.id, response.data.usage, requestBody.model)
      }

      return {
        status: response.status,
        headers: responseHeaders,
        data: response.data
      }
    } catch (error) {
      logger.error('❌ OpenAI Console relay error (non-streaming):', error)
      throw this.handleError(error)
    }
  }

  /**
   * 转发流式请求
   */
  async relayStreaming(account, requestBody, originalHeaders) {
    const url = account.baseUrl + account.responsesPath
    const headers = this.buildRequestHeaders(account, originalHeaders)
    const stream = new PassThrough()

    try {
      const requestConfig = {
        method: 'POST',
        url,
        headers,
        data: requestBody,
        responseType: 'stream',
        timeout: 60000,
        validateStatus: null
      }

      // 添加代理配置
      const proxyAgent = this.createProxyConfig(account)
      if (proxyAgent) {
        requestConfig.httpsAgent = proxyAgent
      }

      logger.info(`🔄 Forwarding streaming request to OpenAI Console: ${url}`)
      const response = await axios(requestConfig)

      // 构建响应头
      const responseHeaders = this.buildResponseHeaders(response.headers)
      responseHeaders['content-type'] = 'text/event-stream'
      responseHeaders['cache-control'] = 'no-cache'
      responseHeaders['connection'] = 'keep-alive'

      // 处理流式数据
      let usage = null
      let buffer = ''

      response.data.on('data', (chunk) => {
        try {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.trim() === '') {
              stream.write('\n')
              continue
            }

            // 转发原始 SSE 行
            stream.write(line + '\n')

            // 解析 usage 数据
            if (line.startsWith('event: response.done') || line.startsWith('event: response.completed')) {
              // 查找下一个 data 行中的 usage
              const dataLineIndex = lines.indexOf(line) + 1
              if (dataLineIndex < lines.length) {
                const dataLine = lines[dataLineIndex]
                if (dataLine.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(dataLine.substring(6))
                    if (data.usage) {
                      usage = data.usage
                    }
                  } catch (e) {
                    // 忽略解析错误
                  }
                }
              }
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6))
                if (data.usage) {
                  usage = data.usage
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        } catch (error) {
          logger.error('❌ Error processing stream chunk:', error)
        }
      })

      response.data.on('end', async () => {
        try {
          // 处理缓冲区中剩余的数据
          if (buffer.trim()) {
            stream.write(buffer)
            
            // 检查最后的数据是否包含 usage
            if (buffer.startsWith('data: ')) {
              try {
                const data = JSON.parse(buffer.substring(6))
                if (data.usage) {
                  usage = data.usage
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }

          stream.end()

          // 记录使用情况
          if (usage) {
            await this.recordUsage(account.id, usage, requestBody.model)
          }

          logger.info('✅ OpenAI Console streaming completed')
        } catch (error) {
          logger.error('❌ Error in stream end handler:', error)
          stream.end()
        }
      })

      response.data.on('error', (error) => {
        logger.error('❌ OpenAI Console stream error:', error)
        const errorEvent = this.formatSSEError(error)
        stream.write(errorEvent)
        stream.end()
      })

      return {
        status: response.status,
        headers: responseHeaders,
        stream
      }
    } catch (error) {
      logger.error('❌ OpenAI Console relay error (streaming):', error)
      const errorEvent = this.formatSSEError(error)
      stream.write(errorEvent)
      stream.end()
      
      return {
        status: error.response?.status || 500,
        headers: { 'content-type': 'text/event-stream' },
        stream
      }
    }
  }

  /**
   * 主转发方法
   */
  async relay(account, requestBody, originalHeaders) {
    // 更新账户最后使用时间
    await openaiConsoleAccountService.updateLastUsedTime(account.id)

    if (requestBody.stream) {
      return await this.relayStreaming(account, requestBody, originalHeaders)
    } else {
      return await this.relayNonStreaming(account, requestBody, originalHeaders)
    }
  }

  /**
   * 记录使用情况
   */
  async recordUsage(accountId, usage, model) {
    try {
      const redisClient = require('../models/redis')
      
      // 记录账户级别的使用统计
      await redisClient.incrementAccountUsage(
        accountId,
        usage.total_tokens || 0,
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0,
        usage.cache_creation_input_tokens || 0,
        usage.cache_read_input_tokens || 0,
        model || 'unknown',
        false
      )

      logger.info(`📊 Recorded usage for OpenAI Console account ${accountId}:`, usage)
    } catch (error) {
      logger.error('❌ Failed to record usage:', error)
    }
  }

  /**
   * 格式化 SSE 错误事件
   */
  formatSSEError(error) {
    const errorData = {
      error: {
        type: error.response?.status === 429 ? 'rate_limit_error' : 'api_error',
        message: error.response?.data?.error?.message || error.message || 'Internal server error',
        code: error.response?.status || 500
      }
    }

    return `event: error\ndata: ${JSON.stringify(errorData)}\n\n`
  }

  /**
   * 处理错误
   */
  handleError(error) {
    if (error.response) {
      // 透传上游错误
      const customError = new Error(error.response.data?.error?.message || error.message)
      customError.status = error.response.status
      customError.data = error.response.data
      return customError
    } else if (error.code === 'ECONNREFUSED') {
      const customError = new Error('OpenAI Console service unavailable')
      customError.status = 503
      return customError
    } else if (error.code === 'ETIMEDOUT') {
      const customError = new Error('Request timeout')
      customError.status = 504
      return customError
    } else {
      const customError = new Error('Internal relay error')
      customError.status = 500
      return customError
    }
  }
}

module.exports = new OpenAIConsoleRelayService()