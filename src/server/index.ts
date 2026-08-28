import { Plugin, PluginManager } from '@nocobase/server';
import path from 'path';
import { LogConfigService } from './services/log-config.service';
import { LogReaderService } from './services/log-reader.service';
import { LogRetentionService } from './services/log-retention.service';
import { AlertService } from './services/alert.service';
import { DashboardService } from './services/dashboard.service';
import { AuditExportService } from './services/audit-export.service';
import { TraceService } from './services/trace.service';
import { AIAnalyzerService } from './services/ai-analyzer.service';
import { createAuditLogMiddleware } from './middlewares/audit-log';
import { setupSlowQueryMonitor } from './middlewares/slow-query';
import { createLoggerProResource } from './actions/logger-pro';
import { createCompatLoggerResource } from './actions/compat-logger';

function ensurePluginEnvironment() {
  if (!process.env.NODE_MODULES_PATH) {
    process.env.NODE_MODULES_PATH = path.resolve(process.cwd(), 'node_modules');
  }
  if (PluginManager) {
    const parsedNames = (PluginManager as any).parsedNames || ((PluginManager as any).parsedNames = {});
    parsedNames['logger-pro'] = {
      name: 'logger-pro',
      packageName: '@nocobase/plugin-logger-pro',
    };
    parsedNames['@nocobase/plugin-logger-pro'] = {
      name: 'logger-pro',
      packageName: '@nocobase/plugin-logger-pro',
    };
  }
}

ensurePluginEnvironment();

export class PluginLoggerProServer extends Plugin {
  public configService!: LogConfigService;
  public readerService!: LogReaderService;
  public retentionService!: LogRetentionService;
  public alertService!: AlertService;
  public dashboardService!: DashboardService;
  public auditExportService!: AuditExportService;
  public traceService!: TraceService;
  public aiAnalyzerService!: AIAnalyzerService;

  static async staticImport() {
    ensurePluginEnvironment();
  }

  async beforeLoad() {
    this.db.import({
      directory: path.resolve(__dirname, 'collections'),
    });
  }

  async load() {
    // 1. 初始化各业务服务
    this.configService = new LogConfigService(this.app);
    this.readerService = new LogReaderService(this.app);
    this.retentionService = new LogRetentionService(this.app, this.configService);
    this.alertService = new AlertService(this.app);
    this.dashboardService = new DashboardService(this.app, this.readerService);
    this.auditExportService = new AuditExportService(this.app);
    this.traceService = new TraceService(this.app, this.readerService);
    this.aiAnalyzerService = new AIAnalyzerService(this.app);

    // 2. 注册资源接口
    this.app.resource(
      createLoggerProResource(
        this.readerService,
        this.configService,
        this.retentionService,
        this.alertService,
        this.dashboardService,
        this.auditExportService,
        this.traceService,
        this.aiAnalyzerService,
      ),
    );

    // 注册兼容原版 logger 的资源
    this.app.resource(
      createCompatLoggerResource(this.readerService, this.retentionService),
    );

    // 3. 注册 ACL 权限片段
    this.app.acl.registerSnippet({
      name: `pm.${this.name}.loggerPro`,
      actions: ['loggerPro:*', 'logger_audit_logs:*', 'logger_configs:*', 'logger_alert_rules:*', 'logger_alert_logs:*', 'logger_ai_records:*'],
    });

    this.app.acl.registerSnippet({
      name: `pm.${this.name}.logger`,
      actions: ['logger:*'],
    });

    // 4. 挂载操作审计中间件
    this.app.resourcer.use(
      createAuditLogMiddleware(this.app, this.configService, this.alertService),
      { tag: 'audit-log' },
    );

    // 5. 挂载慢查询监控
    setupSlowQueryMonitor(
      this.app,
      this.configService,
      this.alertService,
      this.dashboardService,
    );

    // 6. 数据库就绪后初始化配置与调度器
    this.app.on('afterStart', async () => {
      await this.ensureDatabaseIndexes();
      await this.configService.init();
      this.retentionService.startScheduler();
    });
  }

  private async ensureDatabaseIndexes() {
    try {
      const qi = this.db.sequelize.getQueryInterface();
      const auditTable = this.db.getCollection('logger_audit_logs')?.model?.tableName || 'logger_audit_logs';
      const alertLogTable = this.db.getCollection('logger_alert_logs')?.model?.tableName || 'logger_alert_logs';

      const safeAddIndex = async (table: string, fields: string[], name: string) => {
        try {
          const indexes: any = await qi.showIndex(table).catch(() => []);
          const exists = Array.isArray(indexes) && indexes.some((idx: any) => idx?.name === name || idx?.name === `idx_${name}`);
          if (!exists) {
            await qi.addIndex(table, fields, { name }).catch(() => {});
          }
        } catch (e) {}
      };

      await safeAddIndex(auditTable, ['created_at'], 'idx_audit_created_at');
      await safeAddIndex(auditTable, ['user_username'], 'idx_audit_username');
      await safeAddIndex(auditTable, ['collection_name'], 'idx_audit_collection');
      await safeAddIndex(auditTable, ['action_name'], 'idx_audit_action');
      await safeAddIndex(auditTable, ['status_code'], 'idx_audit_status');
      await safeAddIndex(alertLogTable, ['created_at'], 'idx_alert_created_at');
    } catch (err) {}
  }

  async install() {
  }

  async afterEnable() {
    await this.ensureDatabaseIndexes();
    if (this.configService) {
      await this.configService.init();
      this.retentionService.startScheduler();
    }
  }

  async afterDisable() {
    if (this.retentionService) {
      this.retentionService.stopScheduler();
    }
  }

  async remove() {
    if (this.retentionService) {
      this.retentionService.stopScheduler();
    }
  }
}

export default PluginLoggerProServer;
