import { Application } from '@nocobase/server';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
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

  // 获取最近的 Trace 请求列表供前端快捷点选
  async getRecentTraces(limit = 30) {
    const list: any[] = [];
    const seenReqIds = new Set<string>();

    // 1. 优先从审计日志表读取具有 reqId 的记录
    try {
      const repo = this.app.db.getRepository('logger_audit_logs');
      if (repo) {
        const records = await repo.find({
          sort: ['-createdAt'],
          limit: 50,
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
        }
      }
    } catch {}

    // 2. 从最近的 request 日志文件中补充提取
    try {
      const basePath = this.readerService.getLogBasePath();
      const filesInfo = await this.readerService.listFiles();
      const reqFiles = filesInfo.filter((f) => f.name.startsWith('request')).slice(0, 3);

      for (const fileInfo of reqFiles) {
        const absPath = path.join(basePath, fileInfo.relativePath);
        if (!fs.existsSync(absPath)) continue;

        try {
          const content = await fsp.readFile(absPath, 'utf8');
          const lines = content.split(/\r?\n/).reverse();

          for (const line of lines) {
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
        } catch {}
        if (list.length >= limit) break;
      }
    } catch {}

    return list.slice(0, limit);
  }

  // 跨日志文件搜索与审计表聚合
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
    let auditRecord: any = null;

    // 1. 从审计日志表检索该请求的上下文信息
    try {
      const repo = this.app.db.getRepository('logger_audit_logs');
      if (repo) {
        auditRecord = await repo.findOne({
          filter: { reqId: cleanReqId },
        });
      }
    } catch {}

    // 2. 从最近日志文件中并发检索包含该 reqId 的所有日志行
    const rawLogs: Array<{ file: string; line: string; time?: string; level?: string }> = [];
    try {
      const basePath = this.readerService.getLogBasePath();
      const filesInfo = await this.readerService.listFiles();
      // 取最近前 15 个日志文件
      const recentFiles = filesInfo.slice(0, 15);

      for (const fileInfo of recentFiles) {
        const absPath = path.join(basePath, fileInfo.relativePath);
        if (!fs.existsSync(absPath)) continue;

        try {
          const content = await fsp.readFile(absPath, 'utf8');
          if (!content.includes(cleanReqId)) continue;

          const lines = content.split(/\r?\n/);
          for (const rawLine of lines) {
            if (rawLine.includes(cleanReqId)) {
              const cleaned = this.cleanAnsi(rawLine).trim();
              if (cleaned) {
                const timeInfo = this.extractTime(cleaned);
                let level = 'info';
                if (/\[error\]|level=error/i.test(cleaned)) level = 'error';
                else if (/\[warn\]|level=warn/i.test(cleaned)) level = 'warn';
                else if (/\[debug\]|level=debug/i.test(cleaned)) level = 'debug';

                rawLogs.push({
                  file: fileInfo.name,
                  line: cleaned,
                  time: timeInfo?.timeStr,
                  level,
                });
              }
            }
          }
        } catch {}
      }
    } catch {}

    // 3. 构建 Summary
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

    // 4. 构建 Timeline 瀑布流事件
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

        // 提取耗时（如 : 15ms）
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

    return {
      reqId: cleanReqId,
      found,
      summary,
      timeline,
      rawLogs,
    };
  }
}
