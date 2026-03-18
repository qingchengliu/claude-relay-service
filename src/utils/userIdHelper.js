/**
 * User ID Helper
 *
 * 统一处理 metadata.user_id 的两种格式：
 * - 旧格式（字符串）: user_{64hex}_account_{uuid?}_session_{uuid}
 * - 新格式（JSON）: {"device_id":"xxx","account_uuid":"","session_id":"xxx"}
 */

const LEGACY_PATTERN = /^user_([a-fA-F0-9]{64})_account_(.*?)_session_([\w-]+)$/

/**
 * 解析 user_id，兼容旧字符串格式和新 JSON 格式
 * @param {string} userId
 * @returns {{ deviceId: string, accountUuid: string, sessionId: string, isJson: boolean, raw: string } | null}
 */
function parseUserId(userId) {
  if (typeof userId !== 'string' || !userId.trim()) {
    return null
  }

  // JSON 格式（以 '{' 开头）
  if (userId.charAt(0) === '{') {
    try {
      const obj = JSON.parse(userId)
      if (obj && typeof obj.device_id === 'string' && typeof obj.session_id === 'string') {
        return {
          deviceId: obj.device_id,
          accountUuid: typeof obj.account_uuid === 'string' ? obj.account_uuid : '',
          sessionId: obj.session_id,
          isJson: true,
          raw: userId
        }
      }
    } catch {
      // not valid JSON
    }
    return null
  }

  // 旧格式: user_{64hex}_account_{accountUuid?}_session_{uuid}
  const legacyMatch = userId.match(LEGACY_PATTERN)
  if (legacyMatch) {
    return {
      deviceId: legacyMatch[1],
      accountUuid: legacyMatch[2],
      sessionId: legacyMatch[3],
      isJson: false,
      raw: userId
    }
  }

  return null
}

/**
 * 校验 user_id 是否为合法格式（旧格式或新 JSON 格式）
 * @param {string} userId
 * @returns {boolean}
 */
function isValidUserId(userId) {
  return parseUserId(userId) !== null
}

/**
 * 从 user_id 中提取 session_id
 * @param {string} userId
 * @returns {string|null}
 */
function extractSessionId(userId) {
  const parsed = parseUserId(userId)
  return parsed ? parsed.sessionId : null
}

/**
 * 从 user_id 中提取 device_id
 * @param {string} userId
 * @returns {string|null}
 */
function extractDeviceId(userId) {
  const parsed = parseUserId(userId)
  return parsed ? parsed.deviceId : null
}

/**
 * 替换 user_id 中的 device_id，保持原格式（JSON 输入输出 JSON，字符串输入输出字符串）
 * @param {string} userId
 * @param {string} newDeviceId
 * @returns {string|null}
 */
function replaceDeviceId(userId, newDeviceId) {
  const parsed = parseUserId(userId)
  if (!parsed) {
    return null
  }

  if (parsed.isJson) {
    const obj = JSON.parse(parsed.raw)
    obj.device_id = newDeviceId
    return JSON.stringify(obj)
  }

  return `user_${newDeviceId}_account_${parsed.accountUuid}_session_${parsed.sessionId}`
}

/**
 * 替换 user_id 中的 session_id，保持原格式
 * @param {string} userId
 * @param {string} newSessionId
 * @returns {string|null}
 */
function replaceSessionId(userId, newSessionId) {
  const parsed = parseUserId(userId)
  if (!parsed) {
    return null
  }

  if (parsed.isJson) {
    const obj = JSON.parse(parsed.raw)
    obj.session_id = newSessionId
    return JSON.stringify(obj)
  }

  return `user_${parsed.deviceId}_account_${parsed.accountUuid}_session_${newSessionId}`
}

module.exports = {
  parseUserId,
  isValidUserId,
  extractSessionId,
  extractDeviceId,
  replaceDeviceId,
  replaceSessionId
}
