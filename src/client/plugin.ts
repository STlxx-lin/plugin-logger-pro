import { Plugin } from '@nocobase/client';
import { LoggerProPage } from './pages/LoggerProPage';

export class PluginLoggerProClient extends Plugin {
  async load() {
    if (this.app?.pluginSettingsManager) {
      this.app.pluginSettingsManager.add('logger-pro', {
        title: '日志管理 Pro',
        icon: 'FileTextOutlined',
        Component: LoggerProPage,
      });
    }
  }
}

export default PluginLoggerProClient;
