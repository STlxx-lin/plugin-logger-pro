import { Context, Next } from '@nocobase/actions';
import { Application } from '@nocobase/server';
import { LogConfigService } from '../services/log-config.service';
import { AlertService } from '../services/alert.service';
import { CONFIG_KEYS, ALERT_RULE_TYPES } from '../constants';

export function createAuditLogMiddleware(app: Application, configService: LogConfigService, alertService: AlertService) {
  // 排除系统内部高频操作及插件管理/迁移相关资源，防止 SQLite 锁争用死锁
  const EXCLUDED_COLLECTIONS = new Set([
    'logger_audit_logs',
    'logger_alert_logs',
    'logger_configs',
    'logger_alert_rules',
    'loggerPro',
    'logger',
    'pm',
    'applicationPlugins',
    'app',
    'migrations',
    'uiSchemas',
    'uiSchemaTemplates',
    'desktopRoutes',
    'themeConfig',
    'dataSources',
    'roles',
  ]);

  const AUDITED_ACTIONS = new Set(['create', 'update', 'destroy', 'set', 'add', 'remove', 'toggle', 'batchCreate', 'batchUpdate', 'batchDestroy']);

  return async function auditLogMiddleware(ctx: Context, next: Next) {
    const enabled = configService.getBoolean(CONFIG_KEYS.AUDIT_LOG_ENABLED, true);
    if (!enabled) {
      return next();
    }

    const action = ctx.action;
    if (!action) {
      return next();
    }

    const resourceName = action.resourceName || (action as any).collectionName;
    const collectionName = (action as any).collectionName || action.resourceName;
    const actionName = action.actionName;

    // 排除插件管理与系统内部接口
    if (
      resourceName === 'pm' ||
      resourceName === 'applicationPlugins' ||
      actionName === 'enable' ||
      actionName === 'disable' ||
      actionName === 'install' ||
      actionName === 'add' ||
      (collectionName && EXCLUDED_COLLECTIONS.has(collectionName)) ||
      (resourceName && EXCLUDED_COLLECTIONS.has(resourceName))
    ) {
      return next();
    }

    // 检查是否配置了特定数据表白名单
    const allowedCollections: string[] = configService.getJson(CONFIG_KEYS.AUDIT_COLLECTIONS, []);
    if (allowedCollections.length > 0 && collectionName && !allowedCollections.includes(collectionName)) {
      return next();
    }

    // 仅对写操作或自定义 action 进行审计
    const method = ctx.method?.toUpperCase() || 'GET';
    const isWriteMethod = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    const isAuditedAction = actionName ? AUDITED_ACTIONS.has(actionName) : false;

    if (!isWriteMethod && !isAuditedAction) {
      return next();
    }

    const startTime = Date.now();
    const recordDiff = configService.getBoolean(CONFIG_KEYS.AUDIT_RECORD_DIFF, true);

    let beforeData: any = null;
    const recordId = action.params?.filterByTk || action.params?.values?.id;

    // 如果是更新或删除操作，尝试获取修改前快照
    if (recordDiff && collectionName && recordId && (actionName === 'update' || actionName === 'destroy' || method === 'PUT' || method === 'DELETE')) {
      try {
        const repo = app.db.getRepository(collectionName);
        if (repo) {
          beforeData = await repo.findOne({ filterByTk: recordId });
          if (beforeData && typeof beforeData.toJSON === 'function') {
            beforeData = beforeData.toJSON();
          }
        }
      } catch (err) {
        // 快照获取失败不阻断流程
      }
    }

    let errorOccurred: any = null;

    try {
      await next();
    } catch (err) {
      errorOccurred = err;
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;
      const statusCode = ctx.status || (errorOccurred ? 500 : 200);
      const currentUser = ctx.state?.currentUser;

      let afterData: any = null;
      let diffData: any = null;

      if (recordDiff && !errorOccurred) {
        // 如果是创建或更新，尝试获取变更后的数据
        if (actionName === 'create' || method === 'POST') {
          afterData = ctx.body?.data || ctx.body;
        } else if (actionName === 'update' || method === 'PUT' || method === 'PATCH') {
          if (collectionName && recordId) {
            try {
              const repo = app.db.getRepository(collectionName);
              if (repo) {
                const refreshed = await repo.findOne({ filterByTk: recordId });
                if (refreshed && typeof refreshed.toJSON === 'function') {
                  afterData = refreshed.toJSON();
                }
              }
            } catch {}
          }
        }

        // 计算字段差异
        if (beforeData && afterData && typeof beforeData === 'object' && typeof afterData === 'object') {
          diffData = {};
          const allKeys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)]);
          for (const k of allKeys) {
            if (k === 'updatedAt' || k === 'createdAt') continue;
            const bVal = JSON.stringify(beforeData[k]);
            const aVal = JSON.stringify(afterData[k]);
            if (bVal !== aVal) {
              diffData[k] = {
                old: beforeData[k],
                new: afterData[k],
              };
            }
          }
        }
      }

      // 提取客户端真实 IP
      const ip =
        ctx.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
        ctx.headers['x-real-ip']?.toString() ||
        ctx.ip ||
        ctx.socket?.remoteAddress ||
        '127.0.0.1';

      const userAgent = ctx.headers['user-agent'] || '';
      const reqId =
        (ctx as any).reqId ||
        ctx.state?.reqId ||
        ctx.get?.('x-request-id') ||
        ctx.headers?.['x-request-id'] ||
        (ctx.res as any)?.getHeader?.('x-request-id') ||
        '';

      // 异步存储审计日志
      const auditPayload = {
        reqId: reqId ? String(reqId) : null,
        userId: currentUser?.id || null,
        userUsername: currentUser?.username || currentUser?.email || 'Anonymous',
        userNickname: currentUser?.nickname || currentUser?.username || '访客',
        ip,
        userAgent,
        method,
        path: ctx.path,
        collectionName: collectionName || '',
        actionName: actionName || method,
        recordId: recordId ? String(recordId) : null,
        params: sanitizeParams(action.params),
        beforeData: beforeData ? sanitizeData(beforeData) : null,
        afterData: afterData ? sanitizeData(afterData) : null,
        diff: diffData,
        statusCode,
        durationMs,
        errorMessage: errorOccurred ? (errorOccurred.message || String(errorOccurred)) : null,
      };

      saveAuditLog(app, auditPayload).catch((e) => {
        app.logger?.warn?.(`[LoggerPro] Save audit log error: ${e.message}`);
      });

      // 告警检测
      if (statusCode >= 500 || errorOccurred) {
        alertService.checkAndTrigger(ALERT_RULE_TYPES.STATUS_5XX, {
          title: `[HTTP ${statusCode}] 接口请求发生服务端异常`,
          message: errorOccurred ? errorOccurred.message : `Status Code: ${statusCode}`,
          statusCode,
          durationMs,
          path: ctx.path,
          method,
          ip,
          user: currentUser?.username || 'Anonymous',
          stack: errorOccurred?.stack,
        });
      }
    }
  };
}

async function saveAuditLog(app: Application, payload: any) {
  const repo = app.db.getRepository('logger_audit_logs');
  if (repo) {
    await repo.create({ values: payload });
  }
}

function sanitizeParams(params: any) {
  if (!params || typeof params !== 'object') return params;
  const clone = { ...params };
  if (clone.values && typeof clone.values === 'object') {
    clone.values = { ...clone.values };
    if (clone.values.password) clone.values.password = '******';
    if (clone.values.secret) clone.values.secret = '******';
    if (clone.values.token) clone.values.token = '******';
  }
  return clone;
}

function sanitizeData(data: any) {
  if (!data || typeof data !== 'object') return data;
  const clone = { ...data };
  if (clone.password) clone.password = '******';
  if (clone.secret) clone.secret = '******';
  if (clone.token) clone.token = '******';
  return clone;
}
