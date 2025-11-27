const path = require('path')
const fs = require('fs')
const config = require('../config/config')
const logger = require('../src/utils/logger')

class PluginLoader {
  constructor() {
    this.plugins = new Map()
    this.hooks = {}
  }

  init(app) {
    if (!config.plugins?.enabled) {
      logger.info('🔌 Plugin system disabled')
      return
    }

    global.pluginHooks = this.hooks
    this.loadPlugins(app)
  }

  loadPlugins(app) {
    const pluginsDir = path.join(__dirname)
    const pluginDirs = fs
      .readdirSync(pluginsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    for (const pluginName of pluginDirs) {
      try {
        const pluginPath = path.join(pluginsDir, pluginName)
        const plugin = require(pluginPath)

        if (plugin.init && this.shouldLoadPlugin(pluginName)) {
          plugin.init(app, this.hooks)
          this.plugins.set(pluginName, plugin)
          logger.success(`✅ Plugin loaded: ${pluginName}`)
        }
      } catch (error) {
        logger.error(`❌ Failed to load plugin ${pluginName}:`, error)
      }
    }
  }

  shouldLoadPlugin(pluginName) {
    const pluginConfig = config.plugins?.[pluginName]
    return pluginConfig?.enabled !== false
  }

  getHooks() {
    return this.hooks
  }
}

module.exports = new PluginLoader()
