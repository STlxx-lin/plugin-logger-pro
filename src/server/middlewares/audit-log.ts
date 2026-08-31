import { Context, Next } from '@nocobase/actions';
import { Application } from '@nocobase/server';
import { LogConfigService } from '../services/log-config.service';
import { AlertService } from '../services/alert.service';
import { CONFIG_KEYS, ALERT_RULE_TYPES } from '../constants';

export function createAuditLogMiddleware(app: Application, configService: LogConfigService, alertService: AlertService) {
  // 排除系统内部高频操作及插件管理/迁移相关资源，防止 SQLite 锁争用死锁与冗余日志
  const EXCLUDED_COLLECTIONS = new Set([
    'logger_audit_logs',
    'logger_alert_logs',
    'logger_configs',
    'logger_alert_rules',
    'logger_ai_records',
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

  const AUDITED_ACTIONS = new Set([
    'create',
    'update',
    'destroy',
    'set',
    'add',
    'remove',
    'toggle',
    'batchCreate',
    'batchUpdate',
    'batchDestroy',
  ]);

  // 本插件自身（loggerPro/logger 资源）的破坏性或写类 action：
  // 原先被资源级排除导致高危操作无审计留痕，此处强制纳入审计，且不受用户排除规则影响
  const SELF_AUDITED_ACTIONS = new Set([
    'clearFile',
    'deleteFile',
    'download',
    'cleanLogs',
    'updateConfigs',
    'testAlert',
    'cleanTableData',
    'cleanExpiredAuditLogs',
    'cleanBatch',
    'deleteAIAnalysisRecord',
    'clearAIAnalysisHistory',
    'collect',
  ]);

  return async function auditLogMiddleware(ctx: Context, next: Next) {
    const enabled = configService.getBoolean(CONFIG_KEYS.AUDIT_LOG_ENABLED, true);
    if (!enabled) {
      return next();
    }

    const action = ctx.action;
    if (!action) {
      return next();
    }

    const resourceName = action.resourceName || (action as any).collectionName || '';
    const collectionName = (action as any).collectionName || action.resourceName || '';
    const actionName = action.actionName || '';
    const method = ctx.method?.toUpperCase() || 'GET';

    // 本插件自身的破坏性/写类 action 强制留痕：绕过排除规则 1~5（含只读 POST 过滤与用户排除配置）
    const isSelfAudit =
      (resourceName === 'loggerPro' || resourceName === 'logger') && SELF_AUDITED_ACTIONS.has(actionName);

    // 1. 排除系统内置核心集合与插件管理接口
    if (
      !isSelfAudit &&
      (resourceName === 'pm' ||
        resourceName === 'applicationPlugins' ||
        actionName === 'enable' ||
        actionName === 'disable' ||
        actionName === 'install' ||
        actionName === 'add' ||
        (collectionName && EXCLUDED_COLLECTIONS.has(collectionName)) ||
        (resourceName && EXCLUDED_COLLECTIONS.has(resourceName)))
    ) {
      return next();
    }

    // 2. 检查用户自定义排除数据表与操作动作
    if (!isSelfAudit) {
      const userExcludeCollections: string[] = configService.getJson(CONFIG_KEYS.AUDIT_EXCLUDE_COLLECTIONS, []);
      if (
        userExcludeCollections.length > 0 &&
        (userExcludeCollections.includes(collectionName) || userExcludeCollections.includes(resourceName))
      ) {
        return next();
      }

      const userExcludeActions: string[] = configService.getJson(CONFIG_KEYS.AUDIT_EXCLUDE_ACTIONS, []);
      if (userExcludeActions.length > 0 && actionName && userExcludeActions.includes(actionName)) {
        return next();
      }

      // 3. 智能过滤只读类 POST 请求（如 list*, get*, check*, sync*, count*, unread* 等）
      const ignoreReadonlyPost = configService.getBoolean(CONFIG_KEYS.AUDIT_IGNORE_READONLY_POST, true);
      if (ignoreReadonlyPost && method === 'POST') {
        const isReadonlyName =
          /^(list|get|find|check|sync|count|unread|search|query|export|download|filter|paginate)/i.test(actionName) ||
          /(List|Count|Meta|Mine|ByUser|Enabled|Accessible|Check|Counts|Info)$/i.test(actionName);
        if (isReadonlyName) {
          return next();
        }
      }

      // 4. 检查是否配置了特定数据表白名单（若配置了白名单，则仅审计白名单中的表）
      const allowedCollections: string[] = configService.getJson(CONFIG_KEYS.AUDIT_COLLECTIONS, []);
      if (allowedCollections.length > 0 && collectionName && !allowedCollections.includes(collectionName)) {
        return next();
      }
    }

    // 5. 仅对写操作或核心审计 action 进行记录（自审计 action 无论如何都记录）
    const isWriteMethod = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    const isAuditedAction = actionName ? AUDITED_ACTIONS.has(actionName) : false;

    if (!isSelfAudit && !isWriteMethod && !isAuditedAction) {
      return next();
    }

    const startTime = Date.now();
    const recordDiff = configService.getBoolean(CONFIG_KEYS.AUDIT_RECORD_DIFF, true);

    let beforeData: any = null;
    const recordId = action.params?.filterByTk || action.params?.values?.id;

    // 如果是更新或删除操作，尝试获取修改前快照
    if (
      recordDiff &&
      collectionName &&
      recordId &&
      (actionName === 'update' || actionName === 'destroy' || method === 'PUT' || method === 'DELETE')
    ) {
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
      const diffKeys = new Set<string>();

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

        // 计算字段差异，并记录产生差异的 key
        if (beforeData && afterData && typeof beforeData === 'object' && typeof afterData === 'object') {
          diffData = {};
          const allKeys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)]);
          for (const k of allKeys) {
            if (k === 'updatedAt' || k === 'createdAt') continue;
            const bVal = JSON.stringify(beforeData[k]);
            const aVal = JSON.stringify(afterData[k]);
            if (bVal !== aVal) {
              diffKeys.add(k);
              diffData[k] = {
                old: sanitizeAndTruncate(beforeData[k]),
                new: sanitizeAndTruncate(afterData[k]),
              };
            }
          }
        }
      }

      // 如果开启了零差异跳过，且为更新操作但无任何业务字段变化，直接跳过保存
      const zeroDiffSkip = configService.getBoolean(CONFIG_KEYS.AUDIT_ZERO_DIFF_SKIP, true);
      if (zeroDiffSkip && (actionName === 'update' || method === 'PUT' || method === 'PATCH')) {
        if (beforeData && afterData && diffKeys.size === 0) {
          return;
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

      // 异步存储瘦身后审计日志（仅存储差异相关快照与截断后参数，瘦身 80%~95%）
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
        beforeData: beforeData ? extractLeanData(beforeData, diffKeys) : null,
        afterData: afterData ? extractLeanData(afterData, diffKeys) : null,
        diff: diffData,
        statusCode,
        durationMs,
        errorMessage: errorOccurred ? errorOccurred.message || String(errorOccurred) : null,
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

// 敏感字段脱敏：归一化（小写、去分隔符）后片段匹配，覆盖 apiKey/api_key/clientSecret/Password 等常见变体
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'privatekey',
  'authorization',
  'credential',
  'apikey',
  'accesskey',
];

function isSensitiveKey(key: string): boolean {
  const normalized = String(key).toLowerCase().replace(/[\s_-]/g, '');
  return SENSITIVE_KEY_FRAGMENTS.some((frag) => normalized.includes(frag));
}

/**
 * 智能截断与脱敏（过滤超长文本、富文本、Base64 与密码）
 */
function sanitizeAndTruncate(val: any, maxStrLen = 300, depth = 0): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number' || typeof val === 'boolean') return val;

  if (typeof val === 'string') {
    // 识别 Base64 图片或超长 DataURL
    if (val.startsWith('data:image/') || (val.length > 500 && /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(val.slice(0, 100)))) {
      return `[Base64 Media Data (${val.length} chars)]`;
    }
    // 普通长字符串截断
    if (val.length > maxStrLen) {
      return `${val.slice(0, maxStrLen)}... [Total ${val.length} chars]`;
    }
    return val;
  }

  if (depth > 3) return '[Object/Array]';

  if (Array.isArray(val)) {
    if (val.length > 10) {
      const sliced = val.slice(0, 10).map((item) => sanitizeAndTruncate(item, maxStrLen, depth + 1));
      sliced.push(`... [Total ${val.length} items]`);
      return sliced;
    }
    return val.map((item) => sanitizeAndTruncate(item, maxStrLen, depth + 1));
  }

  if (typeof val === 'object') {
    const res: Record<string, any> = {};
    for (const key of Object.keys(val)) {
      if (isSensitiveKey(key)) {
        res[key] = '******';
      } else {
        res[key] = sanitizeAndTruncate(val[key], maxStrLen, depth + 1);
      }
    }
    return res;
  }

  return val;
}

/**
 * 提取精简快照数据：若有变更 key 集合，仅保留产生差异的字段和核心标识，杜绝冗余存储整表字段
 */
function extractLeanData(data: any, diffKeys?: Set<string>): any {
  if (!data || typeof data !== 'object') return data;

  const res: Record<string, any> = {};
  const keepKeys = new Set(['id', 'createdAt', 'updatedAt', ...(diffKeys ? Array.from(diffKeys) : [])]);

  // 如果没有指定 diffKeys（如新增或全量快照），限制最多保留前 15 个非空字段
  const keysToExtract = diffKeys && diffKeys.size > 0 ? Array.from(keepKeys) : Object.keys(data).slice(0, 15);

  for (const k of keysToExtract) {
    if (k in data) {
      if (isSensitiveKey(k)) {
        res[k] = '******';
      } else {
        res[k] = sanitizeAndTruncate(data[k]);
      }
    }
  }

  return res;
}

/**
 * 对请求参数 params 进行精简与脱敏
 */
function sanitizeParams(params: any): any {
  if (!params || typeof params !== 'object') return params;
  return sanitizeAndTruncate(params, 300);
}
