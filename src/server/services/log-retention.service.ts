import { Application } from '@nocobase/server';
import { getLoggerFilePath } from '@nocobase/logger';
import { LogConfigService } from './log-config.service';
import { CONFIG_KEYS } from '../constants';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import stream from 'stream';
import tar from 'tar-fs';
import zlib from 'zlib';
import { CronJob } from 'cron';

export class LogRetentionService {
  private app: Application;
  private configService: LogConfigService;
  private cronJob: CronJob | null = null;

  constructor(app: Application, configService: LogConfigService) {
    this.app = app;
    this.configService = configService;
  }

  getLogBasePath(): string {
    return getLoggerFilePath(this.app.name || 'main');
  }

  startScheduler() {
    this.stopScheduler();

    const enabled = this.configService.getBoolean(CONFIG_KEYS.AUTO_CLEAN_ENABLED, true);
    if (!enabled) return;

    const cronExp = this.configService.get(CONFIG_KEYS.AUTO_CLEAN_CRON, '0 2 * * *');

    try {
      this.cronJob = new CronJob(cronExp, async () => {
        this.app.logger?.info?.('[LoggerPro] Auto clean log task started...');
        try {
          const result = await this.cleanLogs();
          this.app.logger?.info?.(`[LoggerPro] Auto clean log completed: deleted ${result.deletedCount} files, freed ${result.freedFormatted}`);
        } catch (err) {
          this.app.logger?.error?.(`[LoggerPro] Auto clean log failed: ${err.message}`);
        }
      });
      this.cronJob.start();
    } catch (err) {
      this.app.logger?.warn?.(`[LoggerPro] Failed to start log retention cron job: ${err.message}`);
    }
  }

  stopScheduler() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  async cleanLogs(): Promise<{ deletedCount: number; freedBytes: number; freedFormatted: string; details: string[] }> {
    const basePath = this.getLogBasePath();
    const retentionDays = this.configService.getNumber(CONFIG_KEYS.RETENTION_DAYS, 15);
    const maxDiskMb = this.configService.getNumber(CONFIG_KEYS.MAX_DISK_SIZE_MB, 2048);
    const maxDiskBytes = maxDiskMb * 1024 * 1024;

    const now = Date.now();
    const expireMs = retentionDays * 24 * 60 * 60 * 1000;

    let deletedCount = 0;
    let freedBytes = 0;
    const details: string[] = [];

    // 1. 扫描所有日志文件
    const fileList: { fullPath: string; relName: string; size: number; mtimeMs: number }[] = [];

    const scan = async (dir: string, rel = '') => {
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relName = rel ? path.join(rel, entry.name) : entry.name;
          if (entry.isDirectory()) {
            await scan(fullPath, relName);
          } else if (entry.isFile()) {
            const stat = await fsp.stat(fullPath);
            fileList.push({ fullPath, relName, size: stat.size, mtimeMs: stat.mtimeMs });
          }
        }
      } catch (err) {
        this.app.logger?.warn?.(`[LoggerPro] Clean scan error: ${err.message}`);
      }
    };

    await scan(basePath);

    // 2. 按过期天数清理
    const remainingFiles: typeof fileList = [];
    for (const file of fileList) {
      const ageMs = now - file.mtimeMs;
      if (retentionDays > 0 && ageMs > expireMs) {
        try {
          await fsp.unlink(file.fullPath);
          deletedCount++;
          freedBytes += file.size;
          details.push(`Expired: ${file.relName} (${(file.size / 1024).toFixed(1)} KB)`);
        } catch (err: any) {
          if (err.code === 'EBUSY' || err.code === 'EPERM') {
            await fsp.truncate(file.fullPath, 0);
            deletedCount++;
            freedBytes += file.size;
            details.push(`Expired (Truncated): ${file.relName}`);
          } else {
            this.app.logger?.warn?.(`[LoggerPro] Failed to delete expired file ${file.relName}: ${err.message}`);
          }
        }
      } else {
        remainingFiles.push(file);
      }
    }

    // 3. 检查总磁盘容量限制
    let currentTotalSize = remainingFiles.reduce((acc, f) => acc + f.size, 0);
    if (maxDiskBytes > 0 && currentTotalSize > maxDiskBytes) {
      // 按最旧的文件排在前
      remainingFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);

      for (const file of remainingFiles) {
        if (currentTotalSize <= maxDiskBytes) break;
        try {
          await fsp.unlink(file.fullPath);
          deletedCount++;
          freedBytes += file.size;
          currentTotalSize -= file.size;
          details.push(`Over-quota: ${file.relName} (${(file.size / 1024).toFixed(1)} KB)`);
        } catch (err: any) {
          if (err.code === 'EBUSY' || err.code === 'EPERM') {
            await fsp.truncate(file.fullPath, 0);
            deletedCount++;
            freedBytes += file.size;
            currentTotalSize -= file.size;
            details.push(`Over-quota (Truncated): ${file.relName}`);
          } else {
            this.app.logger?.warn?.(`[LoggerPro] Failed to delete quota exceeded file ${file.relName}: ${err.message}`);
          }
        }
      }
    }

    return {
      deletedCount,
      freedBytes,
      freedFormatted: this.formatBytes(freedBytes),
      details,
    };
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  async createArchiveStream(fileNames?: string[]): Promise<stream.Readable> {
    const basePath = this.getLogBasePath();
    let entries: string[] = [];

    if (fileNames && fileNames.length > 0) {
      entries = fileNames.map((f) => {
        const safe = path.normalize(f).replace(/^(\.\.(\/|\\|$))+/, '');
        return safe;
      });
    } else {
      // 全部日志文件
      const allFiles: string[] = [];
      const scan = async (dir: string, rel = '') => {
        const list = await fsp.readdir(dir, { withFileTypes: true });
        for (const item of list) {
          const relName = rel ? path.join(rel, item.name) : item.name;
          if (item.isDirectory()) {
            await scan(path.join(dir, item.name), relName);
          } else if (item.isFile() && (item.name.endsWith('.log') || item.name.endsWith('.txt'))) {
            allFiles.push(relName.replace(/\\/g, '/'));
          }
        }
      };
      await scan(basePath);
      entries = allFiles;
    }

    if (entries.length === 0) {
      throw new Error('No log files available for archive.');
    }

    const passthrough = new stream.PassThrough();
    const gz = zlib.createGzip();

    const tarPack = tar.pack(basePath, {
      entries,
    });

    tarPack.on('error', (err) => {
      gz.emit('error', err);
    });

    tarPack.pipe(gz).pipe(passthrough);

    return passthrough;
  }

  // 统计本插件的所有数据与存储占用 (日志文件 + 数据库表)
  async getPluginStorageStats() {
    const basePath = this.getLogBasePath();

    // 1. 日志文件占用统计
    let totalFiles = 0;
    let totalFileBytes = 0;
    const catStats = {
      requestLogs: { count: 0, sizeBytes: 0, formatted: '0 B' },
      systemLogs: { count: 0, sizeBytes: 0, formatted: '0 B' },
      sqlLogs: { count: 0, sizeBytes: 0, formatted: '0 B' },
      otherLogs: { count: 0, sizeBytes: 0, formatted: '0 B' },
    };

    const scanFiles = async (dir: string) => {
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanFiles(fullPath);
          } else if (entry.isFile()) {
            const stat = await fsp.stat(fullPath);
            totalFiles++;
            totalFileBytes += stat.size;

            const name = entry.name.toLowerCase();
            if (name.startsWith('request')) {
              catStats.requestLogs.count++;
              catStats.requestLogs.sizeBytes += stat.size;
            } else if (name.startsWith('system')) {
              catStats.systemLogs.count++;
              catStats.systemLogs.sizeBytes += stat.size;
            } else if (name.startsWith('sql')) {
              catStats.sqlLogs.count++;
              catStats.sqlLogs.sizeBytes += stat.size;
            } else {
              catStats.otherLogs.count++;
              catStats.otherLogs.sizeBytes += stat.size;
            }
          }
        }
      } catch {}
    };

    await scanFiles(basePath);

    catStats.requestLogs.formatted = this.formatBytes(catStats.requestLogs.sizeBytes);
    catStats.systemLogs.formatted = this.formatBytes(catStats.systemLogs.sizeBytes);
    catStats.sqlLogs.formatted = this.formatBytes(catStats.sqlLogs.sizeBytes);
    catStats.otherLogs.formatted = this.formatBytes(catStats.otherLogs.sizeBytes);

    // 2. 数据库数据表占用统计
    const tableDefinitions = [
      { collection: 'logger_audit_logs', title: '全链路操作审计记录', avgBytesPerRow: 600 },
      { collection: 'logger_ai_records', title: 'AI 错误日志诊断记录', avgBytesPerRow: 2500 },
      { collection: 'logger_alert_logs', title: '告警通知发送记录', avgBytesPerRow: 500 },
      { collection: 'logger_alert_rules', title: '智能告警规则', avgBytesPerRow: 400 },
      { collection: 'logger_configs', title: '日志系统配置', avgBytesPerRow: 300 },
    ];

    let totalDbRows = 0;
    let totalDbBytes = 0;
    const tablesResult: Array<{
      collection: string;
      title: string;
      count: number;
      estimatedSizeBytes: number;
      estimatedFormatted: string;
    }> = [];

    for (const def of tableDefinitions) {
      let count = 0;
      try {
        const repo = this.app.db.getRepository(def.collection);
        if (repo) {
          count = await repo.count();
        }
      } catch {}

      const estBytes = count * def.avgBytesPerRow;
      totalDbRows += count;
      totalDbBytes += estBytes;

      tablesResult.push({
        collection: def.collection,
        title: def.title,
        count,
        estimatedSizeBytes: estBytes,
        estimatedFormatted: this.formatBytes(estBytes),
      });
    }

    const totalSizeBytes = totalFileBytes + totalDbBytes;

    return {
      fileStats: {
        totalFiles,
        totalSizeBytes: totalFileBytes,
        totalSizeFormatted: this.formatBytes(totalFileBytes),
        categories: catStats,
      },
      dbStats: {
        totalRows: totalDbRows,
        estimatedSizeBytes: totalDbBytes,
        estimatedSizeFormatted: this.formatBytes(totalDbBytes),
        tables: tablesResult,
      },
      totalSizeBytes,
      totalSizeFormatted: this.formatBytes(totalSizeBytes),
    };
  }

  // 清空指定表数据以释放空间
  async cleanTableData(collectionName: string) {
    const repo = this.app.db.getRepository(collectionName);
    if (!repo) {
      throw new Error(`Collection ${collectionName} not found`);
    }
    await repo.destroy({ truncate: true });
    return { success: true, message: `已清空数据表 ${collectionName}` };
  }
}
