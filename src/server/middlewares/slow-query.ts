import { Application } from '@nocobase/server';
import { LogConfigService } from '../services/log-config.service';
import { AlertService } from '../services/alert.service';
import { DashboardService } from '../services/dashboard.service';
import { CONFIG_KEYS, ALERT_RULE_TYPES } from '../constants';

export function setupSlowQueryMonitor(
  app: Application,
  configService: LogConfigService,
  alertService: AlertService,
  dashboardService: DashboardService,
) {
  try {
    const sequelize = app.db?.sequelize;
    if (!sequelize) return;

    const queryStartTimes = new WeakMap<any, number>();

    sequelize.addHook('beforeQuery', (options: any, query: any) => {
      if (options) {
        queryStartTimes.set(options, Date.now());
      }
    });

    sequelize.addHook('afterQuery', (options: any, query: any) => {
      if (!options) return;
      const startTime = queryStartTimes.get(options);
      if (!startTime) return;

      const durationMs = Date.now() - startTime;
      const threshold = configService.getNumber(CONFIG_KEYS.SLOW_QUERY_THRESHOLD_MS, 500);
      const isSlowQueryEnabled = configService.getBoolean(CONFIG_KEYS.SLOW_QUERY_ENABLED, true);

      if (isSlowQueryEnabled && durationMs >= threshold) {
        let sqlText = '';
        if (typeof options?.sql === 'string' && options.sql) {
          sqlText = options.sql;
        } else if (typeof query?.sql === 'string' && query.sql) {
          sqlText = query.sql;
        } else if (typeof query?.query === 'string' && query.query) {
          sqlText = query.query;
        } else if (typeof query === 'string' && query) {
          sqlText = query;
        } else if (typeof options?.query === 'string' && options.query) {
          sqlText = options.query;
        } else if (typeof options?.originalQuery === 'string' && options.originalQuery) {
          sqlText = options.originalQuery;
        } else if (typeof options?.raw === 'string' && options.raw) {
          sqlText = options.raw;
        } else if (options?.type && options?.model?.name) {
          sqlText = `${options.type} FROM ${options.model.name}`;
        } else {
          sqlText = 'SQL Query';
        }

        // 过滤内部元数据或探测查询
        if (sqlText.includes('logger_configs') || sqlText.includes('logger_audit_logs') || sqlText.includes('logger_alert_logs')) {
          return;
        }

        dashboardService.recordSlowQuery({
          sql: sqlText,
          durationMs,
          time: new Date(),
        });

        // 触发慢查询告警
        alertService.checkAndTrigger(ALERT_RULE_TYPES.SLOW_SQL, {
          title: `[慢 SQL 告警] 执行耗时 ${durationMs}ms 超过阈值 (${threshold}ms)`,
          message: `执行 SQL 耗时达 ${durationMs}ms`,
          sql: sqlText,
          durationMs,
        });
      }
    });
  } catch (err) {
    app.logger?.warn?.(`[LoggerPro] Failed to setup slow query monitor: ${err.message}`);
  }
}
