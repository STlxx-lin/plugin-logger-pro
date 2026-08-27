import { Application } from '@nocobase/server';
import { CONFIG_KEYS, DEFAULT_CONFIGS } from '../constants';

export class LogConfigService {
  private app: Application;
  private cache: Map<string, string> = new Map();

  constructor(app: Application) {
    this.app = app;
  }

  async init() {
    try {
      const repo = this.app.db.getRepository('logger_configs');
      if (!repo) return;

      const records = await repo.find();
      const existingKeys = new Set<string>();

      for (const rec of records) {
        this.cache.set(rec.key, rec.value);
        existingKeys.add(rec.key);
      }

      // 初始化默认配置
      const toCreate: Array<{ key: string; value: string; description: string }> = [];
      for (const [key, value] of Object.entries(DEFAULT_CONFIGS)) {
        if (!existingKeys.has(key)) {
          this.cache.set(key, value);
          toCreate.push({ key, value, description: `Default config for ${key}` });
        }
      }

      if (toCreate.length > 0) {
        await repo.createMany({ records: toCreate });
      }

      // 应用初始日志级别
      this.applyLogLevel(this.get(CONFIG_KEYS.LOGGER_LEVEL, 'info'));
    } catch (err: any) {
      if (err.message && (err.message.includes('no such table') || err.message.includes("doesn't exist"))) {
        return;
      }
      this.app.logger?.warn?.(`[LoggerPro] Failed to init log configs: ${err.message}`);
    }
  }

  get(key: string, defaultValue = ''): string {
    const val = this.cache.get(key);
    return val !== undefined && val !== null ? val : ((DEFAULT_CONFIGS as any)[key] ?? defaultValue);
  }

  getConfig(key?: string, defaultValue = ''): any {
    if (!key) {
      return this.getAll();
    }
    return this.get(key, defaultValue);
  }

  getBoolean(key: string, defaultValue = false): boolean {
    const defaultValStr = (DEFAULT_CONFIGS as any)[key] ?? (defaultValue ? 'true' : 'false');
    const val = this.get(key, defaultValStr);
    return val === 'true' || val === '1';
  }

  getNumber(key: string, defaultValue = 0): number {
    const defaultValNum = (DEFAULT_CONFIGS as any)[key] !== undefined ? Number((DEFAULT_CONFIGS as any)[key]) : defaultValue;
    const val = this.cache.get(key);
    if (val === undefined || val === null || val === '') return defaultValNum;
    const num = Number(val);
    return isNaN(num) ? defaultValNum : num;
  }

  getJson<T = any>(key: string, defaultValue: T = [] as any): T {
    try {
      const val = this.get(key);
      return val ? JSON.parse(val) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  async set(key: string, value: string, description?: string) {
    this.cache.set(key, value);
    const repo = this.app.db.getRepository('logger_configs');
    if (repo) {
      const existing = await repo.findOne({ filter: { key } });
      if (existing) {
        await repo.update({ filterByTk: existing.id, values: { value, ...(description ? { description } : {}) } });
      } else {
        await repo.create({ values: { key, value, description: description || '' } });
      }
    }

    if (key === CONFIG_KEYS.LOGGER_LEVEL) {
      this.applyLogLevel(value);
    }
  }

  async getAll(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [key, defVal] of Object.entries(DEFAULT_CONFIGS)) {
      result[key] = this.get(key, defVal);
    }
    return result;
  }

  async updateAll(values: Record<string, any>) {
    for (const [key, val] of Object.entries(values)) {
      const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
      await this.set(key, strVal);
    }
  }

  private applyLogLevel(level: string) {
    if (!level) return;
    try {
      const appLogger = this.app.logger;
      if (appLogger) {
        if ('level' in appLogger) {
          (appLogger as any).level = level;
        }
        if (Array.isArray((appLogger as any).transports)) {
          for (const transport of (appLogger as any).transports) {
            transport.level = level;
          }
        }
      }
    } catch (err) {
      this.app.logger?.warn?.(`[LoggerPro] Failed to apply log level: ${err.message}`);
    }
  }
}
