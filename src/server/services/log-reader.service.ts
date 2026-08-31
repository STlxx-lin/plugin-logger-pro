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

// 粗筛灾难性回溯特征：量词直接作用于内部已含量词的分组，如 (a+)+、(\d*)*、(?:a+)*
const DANGEROUS_REGEX_PATTERN = /\((?:[^()\\]|\\.)*[+*][^()]*\)[+*{]|\((?:[^()\\]|\\.)*\{\d+,?\d*\}[^()]*\)[+*{]/;

// 单次读取日志的时间预算（毫秒），防止恶意正则或超大文件长时间占用事件循环
const MAX_SCAN_MS = 10_000;

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

  /**
   * 统一解析并校验日志文件路径：resolve 后必须严格位于日志根目录内
   * （含路径分隔符边界，防止 "logs" 前缀匹配 "logs-evil" 兄弟目录绕过）
   */
  private resolveSafeLogPath(fileName: string): string {
    const basePath = this.getLogBasePath();
    const resolved = path.resolve(basePath, typeof fileName === 'string' ? fileName : '');
    if (resolved === basePath || !resolved.startsWith(basePath + path.sep)) {
      throw new Error(`Log file not found: ${fileName}`);
    }
    return resolved;
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

  async readLogLines(options: ReadLogOptions): Promise<{ lines: string[]; totalMatched: number; totalSize: number; truncated?: boolean }> {
    const targetFile = this.resolveSafeLogPath(options.fileName);

    if (!fs.existsSync(targetFile)) {
      throw new Error(`Log file not found: ${options.fileName}`);
    }

    const stat = await fsp.stat(targetFile);
    const maxLines = options.lines && options.lines > 0 ? Math.min(options.lines, 5000) : 500;
    const keyword = options.keyword?.trim().slice(0, 200);
    const level = options.level?.trim().toUpperCase();

    let regex: RegExp | null = null;
    if (keyword) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        if (options.isRegex && !DANGEROUS_REGEX_PATTERN.test(keyword)) {
          regex = new RegExp(keyword, 'i');
        } else {
          // 非正则模式、用户正则命中灾难性回溯特征或编译失败时，一律降级为字面量搜索（防 ReDoS）
          regex = new RegExp(escaped, 'i');
        }
      } catch {
        regex = new RegExp(escaped, 'i');
      }
    }

    return new Promise<{ lines: string[]; totalMatched: number; totalSize: number; truncated?: boolean }>((resolve, reject) => {
      const fileStream = fs.createReadStream(targetFile, { encoding: 'utf-8' });
      const rl = readline.createInterface({
        input: fileStream as any,
        crlfDelay: Infinity,
      });

      const collectedLines: string[] = [];
      let totalMatched = 0;
      let linesScanned = 0;
      let truncated = false;
      const scanStart = Date.now();

      rl.on('line', (rawLine: string) => {
        linesScanned++;
        // 时间预算：达到上限立即停止扫描，返回已收集结果
        if ((linesScanned & 511) === 0 && Date.now() - scanStart > MAX_SCAN_MS) {
          truncated = true;
          rl.close();
          return;
        }
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
          // 单行探针截断：限制单次正则回溯的输入规模
          const probe = line.length > 4096 ? line.slice(0, 4096) : line;
          if (!regex.test(probe)) {
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
          truncated: truncated || undefined,
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
    const targetFile = this.resolveSafeLogPath(options.fileName);

    if (!fs.existsSync(targetFile)) {
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
    const targetFile = this.resolveSafeLogPath(fileName);

    if (!fs.existsSync(targetFile)) {
      throw new Error(`Log file not found: ${fileName}`);
    }

    await fsp.truncate(targetFile, 0);
    return true;
  }

  async deleteFile(fileName: string): Promise<boolean> {
    const targetFile = this.resolveSafeLogPath(fileName);

    if (!fs.existsSync(targetFile)) {
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
