const crypto = require('crypto')

/**
 * 生成随机十六进制字符串
 * @param {number} bytes - 字节数
 * @returns {string} 十六进制字符串
 */
function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

/**
 * 生成 Claude Code 风格的会话字符串
 * @returns {string} 会话字符串，格式: user_{64位hex}_account__session_{uuid}
 */
function generateSessionString() {
  const hex64 = randomHex(32) // 32 bytes => 64 hex characters
  const uuid = crypto.randomUUID()
  return `user_${hex64}_account__session_${uuid}`
}

/**
 * 生成新版 Claude Code 风格的 JSON 会话字符串
 * @returns {string} JSON格式的会话字符串
 */
function generateSessionJson() {
  const hex64 = randomHex(32)
  const uuid = crypto.randomUUID()
  return JSON.stringify({ device_id: hex64, account_uuid: '', session_id: uuid })
}

/**
 * 生成 Claude 测试请求体
 * @param {string} model - 模型名称
 * @param {object} options - 可选配置
 * @param {boolean} options.stream - 是否流式（默认false）
 * @returns {object} 测试请求体
 */
function createClaudeTestPayload(model = 'claude-sonnet-4-5-20250929', options = {}) {
  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'hi',
            cache_control: {
              type: 'ephemeral'
            }
          }
        ]
      }
    ],
    system: [
      {
        type: 'text',
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        cache_control: {
          type: 'ephemeral'
        }
      }
    ],
    metadata: {
      user_id: generateSessionString()
    },
    max_tokens: 21333,
    temperature: 1
  }

  if (options.stream) {
    payload.stream = true
  }

  return payload
}

/**
 * 发送流式测试请求并处理SSE响应
 * @param {object} options - 配置选项
 * @param {string} options.apiUrl - API URL
 * @param {string} options.authorization - Authorization header值
 * @param {object} options.responseStream - Express响应流
 * @param {object} [options.payload] - 请求体（默认使用createClaudeTestPayload）
 * @param {object} [options.proxyAgent] - 代理agent
 * @param {number} [options.timeout] - 超时时间（默认30000）
 * @param {object} [options.extraHeaders] - 额外的请求头
 * @returns {Promise<void>}
 */
async function sendStreamTestRequest(options) {
  const axios = require('axios')
  const logger = require('./logger')

  const {
    apiUrl,
    authorization,
    responseStream,
    payload = createClaudeTestPayload('claude-sonnet-4-5-20250929', { stream: true }),
    proxyAgent = null,
    timeout = 30000,
    extraHeaders = {}
  } = options

  const sendSSE = (type, data = {}) => {
    if (!responseStream.destroyed && !responseStream.writableEnded) {
      try {
        responseStream.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
      } catch {
        // ignore
      }
    }
  }

  const endTest = (success, error = null) => {
    if (!responseStream.destroyed && !responseStream.writableEnded) {
      try {
        responseStream.write(
          `data: ${JSON.stringify({ type: 'test_complete', success, error: error || undefined })}\n\n`
        )
        responseStream.end()
      } catch {
        // ignore
      }
    }
  }

  // 设置响应头
  if (!responseStream.headersSent) {
    responseStream.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
  }

  sendSSE('test_start', { message: 'Test started' })

  const requestConfig = {
    method: 'POST',
    url: apiUrl,
    data: payload,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'User-Agent': 'claude-cli/2.0.52 (external, cli)',
      authorization,
      ...extraHeaders
    },
    timeout,
    responseType: 'stream',
    validateStatus: () => true
  }

  if (proxyAgent) {
    requestConfig.httpAgent = proxyAgent
    requestConfig.httpsAgent = proxyAgent
    requestConfig.proxy = false
  }

  try {
    const response = await axios(requestConfig)
    logger.debug(`🌊 Test response status: ${response.status}`)

    // 处理非200响应
    if (response.status !== 200) {
      return new Promise((resolve) => {
        const chunks = []
        response.data.on('data', (chunk) => chunks.push(chunk))
        response.data.on('end', () => {
          const errorData = Buffer.concat(chunks).toString()
          let errorMsg = `API Error: ${response.status}`
          try {
            const json = JSON.parse(errorData)
            errorMsg = json.message || json.error?.message || json.error || errorMsg
          } catch {
            if (errorData.length < 200) {
              errorMsg = errorData || errorMsg
            }
          }
          endTest(false, errorMsg)
          resolve()
        })
        response.data.on('error', (err) => {
          endTest(false, err.message)
          resolve()
        })
      })
    }

    // 处理成功的流式响应
    return new Promise((resolve) => {
      let buffer = ''

      response.data.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue
          }
          const jsonStr = line.substring(5).trim()
          if (!jsonStr || jsonStr === '[DONE]') {
            continue
          }

          try {
            const data = JSON.parse(jsonStr)

            if (data.type === 'content_block_delta' && data.delta?.text) {
              sendSSE('content', { text: data.delta.text })
            }
            if (data.type === 'message_stop') {
              sendSSE('message_stop')
            }
            if (data.type === 'error' || data.error) {
              const errMsg = data.error?.message || data.message || data.error || 'Unknown error'
              sendSSE('error', { error: errMsg })
            }
          } catch {
            // ignore parse errors
          }
        }
      })

      response.data.on('end', () => {
        if (!responseStream.destroyed && !responseStream.writableEnded) {
          endTest(true)
        }
        resolve()
      })

      response.data.on('error', (err) => {
        endTest(false, err.message)
        resolve()
      })
    })
  } catch (error) {
    logger.error('❌ Stream test request failed:', error.message)
    endTest(false, error.message)
  }
}

module.exports = {
  randomHex,
  generateSessionString,
  generateSessionJson,
  createClaudeTestPayload,
  sendStreamTestRequest
}
