import { Plugin } from '@nocobase/client';
import { LoggerProPage } from './pages/LoggerProPage';

export class PluginLoggerProClient extends Plugin {
  async load() {
    const manager = this.app?.pluginSettingsManager as any;
    if (!manager) return;

    const title = '日志管理 Pro';
    const icon = 'FileTextOutlined';
    const menuKey = 'logger-pro';
    const pageName = `${menuKey}.index`;

    if (typeof manager.addMenuItem === 'function' && typeof manager.addPageTabItem === 'function') {
      manager.addMenuItem({
        key: menuKey,
        title,
        icon,
        aclSnippet: 'pm',
      });

      manager.addPageTabItem({
        menuKey,
        key: 'index',
        title,
        icon,
        aclSnippet: 'pm',
        Component: LoggerProPage,
      });

      const pluginNames = [
        this.options?.name,
        this.options?.packageName,
        'logger-pro',
        '@nocobase/plugin-logger-pro',
      ].filter(Boolean);

      [...new Set(pluginNames)].forEach((pluginName) => {
        manager.setPluginSettingsLink?.(pluginName, pageName);
      });
      return;
    }

    if (typeof manager.add === 'function') {
      manager.add(menuKey, {
        title,
        icon,
        aclSnippet: 'pm',
        Component: LoggerProPage,
      });
    }
  }
}

export default PluginLoggerProClient;

