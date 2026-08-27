const path = require('path');
const fs = require('fs');

if (!process.env.NODE_MODULES_PATH) {
  process.env.NODE_MODULES_PATH = path.resolve(process.cwd(), 'node_modules');
}

// 自动将插件内置的 dist/node_modules 注入到 module.paths，确保无论在任何生产容器中都能优先加载自带依赖
const bundledNodeModules = path.resolve(__dirname, 'dist/node_modules');
if (fs.existsSync(bundledNodeModules)) {
  if (!module.paths.includes(bundledNodeModules)) {
    module.paths.unshift(bundledNodeModules);
  }
}

try {
  const { PluginManager } = require('@nocobase/server');
  if (PluginManager) {
    const parsedNames = PluginManager.parsedNames || (PluginManager.parsedNames = {});
    parsedNames['logger-pro'] = {
      name: 'logger-pro',
      packageName: '@nocobase/plugin-logger-pro',
    };
    parsedNames['@nocobase/plugin-logger-pro'] = {
      name: 'logger-pro',
      packageName: '@nocobase/plugin-logger-pro',
    };
  }
} catch (e) {}

let plugin;
const distServerPath = path.resolve(__dirname, 'dist/server/index.js');
if (fs.existsSync(distServerPath)) {
  plugin = require(distServerPath);
} else {
  plugin = require('./src/server');
}

module.exports = plugin.default || plugin;
