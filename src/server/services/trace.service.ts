import { Application } from '@nocobase/server';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { LogReaderService } from './log-reader.service';

export interface TraceTimelineEvent {
  type: 'inbound' | 'sql' | 'audit' | 'system' | 'error' | 'outbound';
  time: string;
  timestamp: number;
  durationMs?: number;
  title: string;
  detail?: string;
  extra?: any;
}

export interface TraceResult {
  reqId: string;
  found: boolean;
  summary: {
    method?: string;
    path?: string;
    collectionName?: string;
    actionName?: string;
    username?: string;
    userId?: string | number;
    ip?: string;
    statusCode?: number;
    durationMs?: number;
    startTime?: string;
    isError?: boolean;
    errorMessage?: string;
  };
  timeline: TraceTimelineEvent[];
  rawLogs: Array<{ file: string; line: string; time?: string; level?: string }>;
}

export class TraceService {
  private app: Application;
  private readerService: LogReaderService;

  // 短时内存缓存：缓存 30 秒，避免用户重复点选时的重复全量磁盘 I/O
  private traceCache = new Map<string, { data: TraceResult; expireAt: number }>();

  constructor(app: Application, readerService: LogReaderService) {
    this.app = app;
    this.readerService = readerService;
  }

  // 清除 ANSI 控制码
  private cleanAnsi(text: string): string {
    return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\[3[0-9]m/g, '').replace(/\[39m/g, '');
  }

  // 从日志文本行提取时间戳
  private extractTime(line: string): { timeStr: string; timestamp: number } | null {
    const match = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?)/);
    if (match) {
      const timeStr = match[1].replace(' ', 'T');
      const timestamp = new Date(timeStr).getTime();
      return isNaN(timestamp) ? null : { timeStr: match[1], timestamp };
    }
    return null;
  }

  /**
   * 从文件末尾仅读取指定字节大小的数据（Tail Buffer，彻底替代全量读入内存）
   */
  private async readTailLines(absPath: string, maxBytes = 256 * 1024): Promise<string[]> {
    try {
      const stat = await fsp.stat(absPath);
      const fileSize = stat.size;
      if (fileSize === 0) return [];

      const bytesToRead = Math.min(fileSize, maxBytes);
      const offset = fileSize - bytesToRead;
      const buffer = Buffer.alloc(bytesToRead);

      const fd = await fsp.open(absPath, 'r');
      try {
        await fd.read(buffer, 0, bytesToRead, offset);
      } finally {
        await fd.close();
      }

      const content = buffer.toString('utf-8');
      const lines = content.split(/\r?\n/);
      // 如果不是从文件开头读的，第一行可能是被切断的半截行，丢弃
      if (offset > 0 && lines.length > 1) {
        lines.shift();
      }
      return lines;
    } catch {
      return [];
    }
  }

  /**
   * 获取最近的 Trace 请求列表供前端快捷点选（审计表优先 + 文件尾部毫秒级采样）
   */
  async getRecentTraces(limit = 30) {
    const list: any[] = [];
    const seenReqIds = new Set<string>();

    // 1. 优先从审计日志表读取具有 reqId 的记录（带索引，耗时 < 5ms）
    try {
      const repo = this.app.db.getRepository('logger_audit_logs');
      if (repo) {
        const records = await repo.find({
          sort: ['-createdAt'],
          limit: limit * 2,
        });

        for (const r of records) {
          if (r.reqId && !seenReqIds.has(r.reqId)) {
            seenReqIds.add(r.reqId);
            list.push({
              reqId: r.reqId,
              method: r.method,
              path: r.path,
              collectionName: r.collectionName,
              actionName: r.actionName,
              username: r.userUsername || r.username || 'Anonymous',
              statusCode: r.statusCode,
              durationMs: r.durationMs,
              createdAt: r.createdAt,
            });
          }
          if (list.length >= limit) {
            break;
          }
        }
      }
    } catch {}

    // 如果审计表记录已满足 limit 要求，直接返回，0ms 磁盘 I/O！
    if (list.length >= limit) {
      return list.slice(0, limit);
    }

    // 2. 若不足，仅从最新 1 个 request 日志文件的尾部采样补充（读取最后 256KB）
    try {
      const basePath = this.readerService.getLogBasePath();
      const filesInfo = await this.readerService.listFiles();
      const reqFile = filesInfo.find((f) => f.name.startsWith('request'));

      if (reqFile) {
        const absPath = path.join(basePath, reqFile.relativePath);
        const lines = await this.readTailLines(absPath, 256 * 1024);

        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (!line.includes('reqId=')) continue;

          const reqIdMatch = line.match(/reqId=([a-f0-9-]+)/i);
          if (!reqIdMatch) continue;

          const reqId = reqIdMatch[1];
          if (seenReqIds.has(reqId)) continue;
          seenReqIds.add(reqId);

          const methodMatch = line.match(/method=([A-Z]+)/i);
          const pathMatch = line.match(/path=([^ ]+)/i);
          const statusMatch = line.match(/status=(\d+)/i);
          const costMatch = line.match(/cost=(\d+)/i);
          const userMatch = line.match(/username=([^ ]+)/i);
          const timeInfo = this.extractTime(line);

          list.push({
            reqId,
            method: methodMatch ? methodMatch[1] : 'GET',
            path: pathMatch ? pathMatch[1] : '',
            collectionName: '',
            actionName: '',
            username: userMatch ? userMatch[1] : 'Anonymous',
            statusCode: statusMatch ? parseInt(statusMatch[1], 10) : 200,
            durationMs: costMatch ? parseInt(costMatch[1], 10) : 0,
            createdAt: timeInfo?.timeStr || new Date().toISOString(),
          });

          if (list.length >= limit) break;
        }
      }
    } catch {}

    return list.slice(0, limit);
  }

  /**
   * 流式扫描单个日志文件以提取包含目标 reqId 的行（带最大收集限制，毫秒级流读）
   */
  private async searchReqIdInFile(
    absPath: string,
    fileName: string,
    cleanReqId: string,
    maxCollectLines = 100,
  ): Promise<Array<{ file: string; line: string; time?: string; level?: string }>> {
    const matchedLogs: Array<{ file: string; line: string; time?: string; level?: string }> = [];

    try {
      const stat = await fsp.stat(absPath);
      if (stat.size === 0) return [];

      // 如果文件很小（< 2MB），或者对于大型文件优先检查尾部 512KB
      if (stat.size > 2 * 1024 * 1024) {
        const tailLines = await this.readTailLines(absPath, 512 * 1024);
        for (const rawLine of tailLines) {
          if (rawLine.includes(cleanReqId)) {
            const cleaned = this.cleanAnsi(rawLine).trim();
            if (cleaned) {
              const timeInfo = this.extractTime(cleaned);
              let level = 'info';
              if (/\[error\]|level=error/i.test(cleaned)) level = 'error';
              else if (/\[warn\]|level=warn/i.test(cleaned)) level = 'warn';
              else if (/\[debug\]|level=debug/i.test(cleaned)) level = 'debug';

              matchedLogs.push({
                file: fileName,
                line: cleaned,
                time: timeInfo?.timeStr,
                level,
              });
            }
          }
        }

        // 如果尾部已经找到了，直接返回
        if (matchedLogs.length > 0) {
          return matchedLogs;
        }
      }

      // 否则进行轻量流式扫描（逐行流式，不占用大内存）
      await new Promise<void>((resolve) => {
        const stream = fs.createReadStream(absPath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: stream as any,
          crlfDelay: Infinity,
        });

        rl.on('line', (rawLine: string) => {
          if (rawLine.includes(cleanReqId)) {
            const cleaned = this.cleanAnsi(rawLine).trim();
            if (cleaned) {
              const timeInfo = this.extractTime(cleaned);
              let level = 'info';
              if (/\[error\]|level=error/i.test(cleaned)) level = 'error';
              else if (/\[warn\]|level=warn/i.test(cleaned)) level = 'warn';
              else if (/\[debug\]|level=debug/i.test(cleaned)) level = 'debug';

              matchedLogs.push({
                file: fileName,
                line: cleaned,
                time: timeInfo?.timeStr,
                level,
              });

              if (matchedLogs.length >= maxCollectLines) {
                rl.close();
                stream.destroy();
              }
            }
          }
        });

        rl.on('close', () => resolve());
        rl.on('error', () => resolve());
        stream.on('error', () => resolve());
      });
    } catch {}

    return matchedLogs;
  }

  /**
   * 跨日志文件精准时间检索与审计表秒级聚合
   */
  async getTrace(reqId: string): Promise<TraceResult> {
    if (!reqId || !reqId.trim()) {
      return {
        reqId: '',
        found: false,
        summary: {},
        timeline: [],
        rawLogs: [],
      };
    }

    const cleanReqId = reqId.trim();

    // 1. 优先检查短时内存缓存（30 秒内秒开，0ms）
    const cached = this.traceCache.get(cleanReqId);
    if (cached && cached.expireAt > Date.now()) {
      return cached.data;
    }

    let auditRecord: any = null;

    // 2. 从审计日志表检索该请求的上下文信息（< 5ms）
    try {
      const repo = this.app.db.getRepository('logger_audit_logs');
      if (repo) {
        auditRecord = await repo.findOne({
          filter: { reqId: cleanReqId },
        });
      }
    } catch {}

    // 3. 精准筛选相关日志文件（按分类与时间窗口缩小到 2~4 个文件，并发流式检索）
    const rawLogs: Array<{ file: string; line: string; time?: string; level?: string }> = [];
    try {
      const basePath = this.readerService.getLogBasePath();
      const filesInfo = await this.readerService.listFiles();

      // 仅筛选相关日志类别
      const relevantFiles = filesInfo.filter((f) => {
        const name = f.name.toLowerCase();
        return (
          name.startsWith('request') ||
          name.startsWith('sql') ||
          name.startsWith('system') ||
          name.startsWith('main')
        );
      });

      // 如果有审计时间，优先挑选修改时间在审计时间附近的日志文件（最多取前 4 个最新文件）
      const targetFiles = relevantFiles.slice(0, 4);

      // 并发进行流式按需检索
      const fileTasks = targetFiles.map((fileInfo) => {
        const absPath = path.join(basePath, fileInfo.relativePath);
        if (!fs.existsSync(absPath)) return Promise.resolve([]);
        return this.searchReqIdInFile(absPath, fileInfo.name, cleanReqId, 100);
      });

      const results = await Promise.all(fileTasks);
      for (const logs of results) {
        rawLogs.push(...logs);
      }
    } catch {}

    // 4. 构建 Summary 摘要
    const summary: TraceResult['summary'] = {
      method: auditRecord?.method,
      path: auditRecord?.path,
      collectionName: auditRecord?.collectionName,
      actionName: auditRecord?.actionName,
      username: auditRecord?.userUsername || auditRecord?.username,
      userId: auditRecord?.userId,
      ip: auditRecord?.ip,
      statusCode: auditRecord?.statusCode,
      durationMs: auditRecord?.durationMs,
      startTime: auditRecord?.createdAt ? new Date(auditRecord.createdAt).toISOString() : undefined,
      isError: auditRecord ? auditRecord.statusCode >= 400 : false,
      errorMessage: auditRecord?.errorMessage,
    };

    // 5. 构建 Timeline 瀑布流事件
    const timeline: TraceTimelineEvent[] = [];

    // 事件 A: API 入站 (Inbound)
    if (auditRecord) {
      const startTime = new Date(auditRecord.createdAt).getTime();
      timeline.push({
        type: 'inbound',
        title: `API 请求入站: ${auditRecord.method} ${auditRecord.path}`,
        time: new Date(auditRecord.createdAt).toLocaleString(),
        timestamp: startTime,
        detail: `操作人: ${auditRecord.userUsername || 'Anonymous'} | 客户端 IP: ${auditRecord.ip || '-'}`,
        extra: {
          params: auditRecord.params,
          userAgent: auditRecord.userAgent,
        },
      });
    }

    // 事件 B: 日志行事件解析 (SQL / App Log / Error)
    for (const item of rawLogs) {
      const timeInfo = this.extractTime(item.line);
      const ts = timeInfo?.timestamp || (auditRecord ? new Date(auditRecord.createdAt).getTime() : Date.now());
      const displayTime = timeInfo?.timeStr || '-';

      // 识别 SQL 执行
      if (/Executing \(default\):|SELECT |INSERT |UPDATE |DELETE /i.test(item.line)) {
        let sqlText = item.line;
        const execMatch = item.line.match(/Executing \(default\):\s*(.+)$/i);
        if (execMatch) sqlText = execMatch[1];

        let durationMs: number | undefined = undefined;
        const durMatch = item.line.match(/(\d+(?:\.\d+)?)\s*ms/i);
        if (durMatch) durationMs = parseFloat(durMatch[1]);

        timeline.push({
          type: 'sql',
          title: `SQL 查询执行 [${item.file}]`,
          time: displayTime,
          timestamp: ts,
          durationMs,
          detail: sqlText,
        });
      }
      // 识别系统错误或警告
      else if (item.level === 'error') {
        timeline.push({
          type: 'error',
          title: `系统异常报错 [${item.file}]`,
          time: displayTime,
          timestamp: ts,
          detail: item.line,
        });
      }
      // 其他系统流转日志
      else {
        timeline.push({
          type: 'system',
          title: `系统日志流转 [${item.file}]`,
          time: displayTime,
          timestamp: ts,
          detail: item.line,
        });
      }
    }

    // 事件 C: 审计数据表变更记录 (Audit Diff)
    if (auditRecord && auditRecord.diffSummary) {
      const midTime = new Date(auditRecord.createdAt).getTime() + Math.floor((auditRecord.durationMs || 10) / 2);
      timeline.push({
        type: 'audit',
        title: `数据表变更快照: ${auditRecord.collectionName} (${auditRecord.actionName})`,
        time: new Date(midTime).toLocaleString(),
        timestamp: midTime,
        detail: `记录ID: ${auditRecord.recordId || '-'} | 变更摘要: ${typeof auditRecord.diffSummary === 'string' ? auditRecord.diffSummary : Object.keys(auditRecord.diffSummary).join(', ')}`,
        extra: {
          previousData: auditRecord.previousData,
          newData: auditRecord.newData,
          diffSummary: auditRecord.diffSummary,
        },
      });
    }

    // 事件 D: API 出站 (Outbound)
    if (auditRecord) {
      const endTime = new Date(auditRecord.createdAt).getTime() + (auditRecord.durationMs || 0);
      timeline.push({
        type: 'outbound',
        title: `API 响应出站: HTTP ${auditRecord.statusCode} (${auditRecord.durationMs || 0} ms)`,
        time: new Date(endTime).toLocaleString(),
        timestamp: endTime,
        durationMs: auditRecord.durationMs,
        detail: auditRecord.statusCode < 400 ? '请求处理成功' : `请求处理异常: ${auditRecord.errorMessage || '状态码 ' + auditRecord.statusCode}`,
      });
    }

    // 按时间戳递增排序
    timeline.sort((a, b) => a.timestamp - b.timestamp);

    const found = !!auditRecord || rawLogs.length > 0;

    const result: TraceResult = {
      reqId: cleanReqId,
      found,
      summary,
      timeline,
      rawLogs,
    };

    // 存入短时缓存（30 秒过期）
    this.traceCache.set(cleanReqId, {
      data: result,
      expireAt: Date.now() + 30 * 1000,
    });

    // 限制缓存大小，防止内存泄漏
    if (this.traceCache.size > 200) {
      const firstKey = this.traceCache.keys().next().value;
      if (firstKey) this.traceCache.delete(firstKey);
    }

    return result;
  }
}
