// utf-8
const config = require('../../config/config')
const logger = require('../utils/logger')

// 将版本号字符串规范化为数字数组，例如 '1.0.120-beta' -> [1,0,120]
function normalizeVersion(ver) {
  if (!ver || typeof ver !== 'string') {
    return []
  }
  const match = ver.match(/(\d+(?:\.\d+)*)/)
  const core = match ? match[1] : ''
  return core
    .split('.')
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0)
}

// a < b => true；a >= b => false
function isVersionLess(a, b) {
  const va = normalizeVersion(a)
  const vb = normalizeVersion(b)
  const len = Math.max(va.length, vb.length)
  for (let i = 0; i < len; i++) {
    const ai = va[i] ?? 0
    const bi = vb[i] ?? 0
    if (ai < bi) {
      return true
    }
    if (ai > bi) {
      return false
    }
  }
  return false
}

function extractClaudeCliVersion(userAgent) {
  if (!userAgent) {
    return null
  }
  // 兼容：claude-cli/1.0.110 (external, cli)
  const m = userAgent.match(/(^|\s)claude-cli\/([^\s\)]+)(\s|\)|$)/i)
  return m ? m[2] : null
}

// 中间件：拦截 Claude Code CLI 低版本请求
function claudeCliVersionCheck(req, res, next) {
  try {
    const ua = req.headers['user-agent'] || ''
    // 严格匹配官方 CLI 的 UA 格式，避免误伤 browser-fallback 等场景
    const claudeCodePattern = /^claude-cli\/[\d\.]+([-\w]*)?\s+\(external,\s*cli\)$/i
    if (!claudeCodePattern.test(ua)) {
      return next()
    }

    const minVersion = (config.claudeCli && config.claudeCli.minVersion) || '2.0.0'
    const current = extractClaudeCliVersion(ua)

    if (!current) {
      // 未能解析版本，放行但记录一次日志
      logger.warn(`⚠️ 无法解析 Claude CLI 版本，UA: "${ua}"`)
      return next()
    }

    if (isVersionLess(current, minVersion)) {
      logger.security(
        `🚫 拒绝低版本 Claude CLI 请求: 当前 ${current} < 最低 ${minVersion} | ${req.method} ${req.originalUrl}`
      )
      return res.status(500).json({
        error: `请在terminal运行claude update命令进行升级,当前 ${current} < 最低 ${minVersion}`
      })
    }

    return next()
  } catch (err) {
    logger.error('Claude CLI 版本校验中间件异常:', err)
    // 发生异常不阻断请求，避免影响正常流量
    return next()
  }
}

module.exports = { claudeCliVersionCheck }
