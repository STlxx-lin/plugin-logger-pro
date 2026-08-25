import { Application } from '@nocobase/server';
import { getLoggerFilePath } from '@nocobase/logger';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import readline from 'readline';

export interface LogFileInfo {
  name: string;
  relativePath: string;
  size?: number;
  sizeBytes: number;
  sizeFormatted: string;
  mtime: Date;
  category: string;
}

export interface ReadLogOptions {
  fileName: string;
  lines?: number;
  keyword?: string;
  level?: string;
  isRegex?: boolean;
  reverse?: boolean;
}

export interface TailLogOptions {
  fileName: string;
  offsetBytes?: number;
  maxBytes?: number;
}

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\x1B\[[0-9;]*[a-zA-Z]/g;

function cleanAnsi(str: string): string {
  return str ? str.replace(ANSI_REGEX, '') : '';
}

export class LogReaderService {
  private app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  getLogBasePath(): string {
    return getLoggerFilePath(this.app.name || 'main');
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private detectCategory(fileName: string): string {
    if (fileName.startsWith('system_error')) return 'Error';
    if (fileName.startsWith('system')) return 'System';
    if (fileName.startsWith('sql')) return 'SQL';
    if (fileName.startsWith('request')) return 'Request';
    return 'Custom';
  }

  async listFiles(): Promise<LogFileInfo[]> {
    const basePath = this.getLogBasePath();
    const result: LogFileInfo[] = [];

    const scanDir = async (currentDir: string, relativeDir = '') => {
      try {
        const entries = await fsp.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          const relPath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
          if (entry.isDirectory()) {
            await scanDir(fullPath, relPath);
          } else if (entry.isFile() && entry.name.endsWith('.log')) {
            const stat = await fsp.stat(fullPath);
            result.push({
              name: entry.name,
              relativePath: relPath.replace(/\\/g, '/'),
              size: stat.size,
              sizeBytes: stat.size,
              sizeFormatted: this.formatBytes(stat.size),
              mtime: stat.mtime,
              category: this.detectCategory(entry.name),
            });
          }
        }
      } catch (err) {
        this.app.logger?.warn?.(`[LoggerPro] Scan log dir error: ${err.message}`);
      }
    };

    await scanDir(basePath);
    // 按最后修改时间降序排序
    return result.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  async readLogLines(options: ReadLogOptions): Promise<{ lines: string[]; totalMatched: number; totalSize: number }> {
    const basePath = this.getLogBasePath();
    const safeRel = path.normalize(options.fileName).replace(/^(\.\.(\/|\\|$))+/, '');
    const targetFile = path.resolve(basePath, safeRel);

    if (!targetFile.startsWith(basePath) || !fs.existsSync(targetFile)) {
      throw new Error(`Log file not found: ${options.fileName}`);
    }

    const stat = await fsp.stat(targetFile);
    const maxLines = options.lines && options.lines > 0 ? Math.min(options.lines, 5000) : 500;
    const keyword = options.keyword?.trim();
    const level = options.level?.trim().toUpperCase();

    let regex: RegExp | null = null;
    if (keyword) {
      try {
        regex = options.isRegex ? new RegExp(keyword, 'i') : new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      } catch {
        regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
    }

    return new Promise<{ lines: string[]; totalMatched: number; totalSize: number }>((resolve, reject) => {
      const fileStream = fs.createReadStream(targetFile, { encoding: 'utf-8' });
      const rl = readline.createInterface({
        input: fileStream as any,
        crlfDelay: Infinity,
      });

      const collectedLines: string[] = [];
      let totalMatched = 0;

      rl.on('line', (rawLine: string) => {
        const line = cleanAnsi(rawLine);
        if (!line.trim()) return;

        let isMatch = true;

        if (level && level !== 'ALL') {
          const lineUpper = line.toUpperCase();
          if (
            !lineUpper.includes(`[${level}]`) &&
            !lineUpper.includes(`"${level}"`) &&
            !lineUpper.includes(` ${level} `) &&
            !lineUpper.includes(`level="${level.toLowerCase()}"`)
          ) {
            isMatch = false;
          }
        }

        if (isMatch && regex) {
          if (!regex.test(line)) {
            isMatch = false;
          }
        }

        if (isMatch) {
          totalMatched++;
          collectedLines.push(line);
          if (collectedLines.length > maxLines * 2) {
            collectedLines.splice(0, maxLines);
          }
        }
      });

      rl.on('close', () => {
        const finalLines = collectedLines.slice(-maxLines);
        if (options.reverse) {
          finalLines.reverse();
        }
        resolve({
          lines: finalLines,
          totalMatched,
          totalSize: stat.size,
        });
      });

      rl.on('error', (err) => {
        reject(err);
      });
      fileStream.on('error', (err) => {
        reject(err);
      });
    });
  }

  async tailLog(options: TailLogOptions): Promise<{ lines: string[]; newOffset: number; hasMore: boolean; fileSize: number }> {
    const basePath = this.getLogBasePath();
    const safeRel = path.normalize(options.fileName).replace(/^(\.\.(\/|\\|$))+/, '');
    const targetFile = path.resolve(basePath, safeRel);

    if (!targetFile.startsWith(basePath) || !fs.existsSync(targetFile)) {
      throw new Error(`Log file not found: ${options.fileName}`);
    }

    const stat = await fsp.stat(targetFile);
    const fileSize = stat.size;
    const maxBytes = options.maxBytes || 256 * 1024; // 每次最多读取 256KB
    let offset = options.offsetBytes || 0;

    // 文件如果被清空或轮转，导致 offset 大于当前大小，重置 offset 为 0
    if (offset > fileSize) {
      offset = 0;
    }

    // 如果初始 offset 为 0 且文件较大，读取最后 64KB
    if (offset === 0 && fileSize > 64 * 1024) {
      offset = fileSize - 64 * 1024;
    }

    const bytesToRead = Math.min(fileSize - offset, maxBytes);
    if (bytesToRead <= 0) {
      return { lines: [], newOffset: fileSize, hasMore: false, fileSize };
    }

    const buffer = Buffer.alloc(bytesToRead);
    const fd = await fsp.open(targetFile, 'r');
    try {
      await fd.read(buffer, 0, bytesToRead, offset);
    } finally {
      await fd.close();
    }

    const content = buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).map(cleanAnsi).filter((l) => l.trim().length > 0);
    const newOffset = offset + bytesToRead;

    return {
      lines,
      newOffset,
      hasMore: newOffset < fileSize,
      fileSize,
    };
  }

  async clearFile(fileName: string): Promise<boolean> {
    const basePath = this.getLogBasePath();
    const safeRel = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
    const targetFile = path.resolve(basePath, safeRel);

    if (!targetFile.startsWith(basePath) || !fs.existsSync(targetFile)) {
      throw new Error(`Log file not found: ${fileName}`);
    }

    await fsp.truncate(targetFile, 0);
    return true;
  }

  async deleteFile(fileName: string): Promise<boolean> {
    const basePath = this.getLogBasePath();
    const safeRel = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
    const targetFile = path.resolve(basePath, safeRel);

    if (!targetFile.startsWith(basePath) || !fs.existsSync(targetFile)) {
      throw new Error(`Log file not found: ${fileName}`);
    }

    try {
      await fsp.unlink(targetFile);
    } catch (err: any) {
      // 在 Windows 下若文件正在写入(EBUSY/EPERM)，降级为清空内容
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        await fsp.truncate(targetFile, 0);
      } else {
        throw err;
      }
    }
    return true;
  }
}
