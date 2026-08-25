import { Application } from '@nocobase/server';
import { LogReaderService } from './log-reader.service';
import { Op } from 'sequelize';

export class DashboardService {
  private app: Application;
  private readerService: LogReaderService;
  private slowQueriesCache: any[] = [];

  constructor(app: Application, readerService: LogReaderService) {
    this.app = app;
    this.readerService = readerService;
  }

  recordSlowQuery(item: { sql: string; durationMs: number; time: Date; error?: string }) {
    this.slowQueriesCache.unshift(item);
    if (this.slowQueriesCache.length > 50) {
      this.slowQueriesCache.pop();
    }
  }

  async getOverview() {
    const auditRepo = this.app.db.getRepository('logger_audit_logs');
    const alertRepo = this.app.db.getRepository('logger_alert_logs');

    // 1. 获取日志文件列表与总大小
    const files = await this.readerService.listFiles();
    const totalSizeBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);

    // 2. 今日起始时间
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // 3. 统计今日审计日志与错误
    let todayAuditCount = 0;
    let todayErrorCount = 0;
    let todayAlertCount = 0;
    let totalAuditCount = 0;

    if (auditRepo) {
      totalAuditCount = await auditRepo.count();
      todayAuditCount = await auditRepo.count({
        filter: {
          createdAt: {
            $gte: startOfToday,
          },
        },
      });

      todayErrorCount = await auditRepo.count({
        filter: {
          createdAt: {
            $gte: startOfToday,
          },
          statusCode: {
            $gte: 400,
          },
        },
      });
    }

    if (alertRepo) {
      todayAlertCount = await alertRepo.count({
        filter: {
          createdAt: {
            $gte: startOfToday,
          },
        },
      });
    }

    // 4. 近 7 天趋势数据
    const trendDays: { date: string; requests: number; errors: number; audits: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);

      const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;

      let dayAudits = 0;
      let dayErrors = 0;

      if (auditRepo) {
        dayAudits = await auditRepo.count({
          filter: {
            createdAt: {
              $gte: dayStart,
              $lte: dayEnd,
            },
          },
        });

        dayErrors = await auditRepo.count({
          filter: {
            createdAt: {
              $gte: dayStart,
              $lte: dayEnd,
            },
            statusCode: {
              $gte: 400,
            },
          },
        });
      }

      trendDays.push({
        date: dateStr,
        requests: dayAudits,
        errors: dayErrors,
        audits: dayAudits,
      });
    }

    // 5. 日志分类占比
    const categoryMap: Record<string, number> = {};
    for (const file of files) {
      categoryMap[file.category] = (categoryMap[file.category] || 0) + file.sizeBytes;
    }

    const categoryStats = Object.entries(categoryMap).map(([name, value]) => ({
      name,
      value,
      formatted: (value / (1024 * 1024)).toFixed(2) + ' MB',
    }));

    // 6. 活跃用户 Top 5
    let topUsers: { username: string; count: number }[] = [];
    if (auditRepo) {
      try {
        const results = await auditRepo.find({
          fields: ['userUsername'],
          filter: {
            createdAt: {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
          limit: 1000,
        });
        const userCounts: Record<string, number> = {};
        for (const item of results) {
          const name = item.userUsername || 'Anonymous';
          userCounts[name] = (userCounts[name] || 0) + 1;
        }
        topUsers = Object.entries(userCounts)
          .map(([username, count]) => ({ username, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      } catch (err) {
        // ignore
      }
    }

    // 7. 高频操作模块 Top 5
    let topCollections: { collection: string; count: number }[] = [];
    if (auditRepo) {
      try {
        const results = await auditRepo.find({
          fields: ['collectionName'],
          filter: {
            createdAt: {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
          limit: 1000,
        });
        const colCounts: Record<string, number> = {};
        for (const item of results) {
          if (item.collectionName) {
            colCounts[item.collectionName] = (colCounts[item.collectionName] || 0) + 1;
          }
        }
        topCollections = Object.entries(colCounts)
          .map(([collection, count]) => ({ collection, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      } catch (err) {
        // ignore
      }
    }

    return {
      summary: {
        totalLogFiles: files.length,
        totalDiskBytes: totalSizeBytes,
        totalDiskFormatted: (totalSizeBytes / (1024 * 1024)).toFixed(2) + ' MB',
        todayAuditCount,
        todayErrorCount,
        todayAlertCount,
        totalAuditCount,
      },
      trend: trendDays,
      categoryStats,
      topSlowQueries: this.slowQueriesCache.slice(0, 10),
      topUsers,
      topCollections,
    };
  }
}
