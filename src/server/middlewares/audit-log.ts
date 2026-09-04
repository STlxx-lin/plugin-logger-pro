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
    let recordId: any =
      action.params?.filterByTk ||
      action.params?.values?.id ||
      (typeof action.params?.filter === 'object' && action.params.filter?.id) ||
      ctx.params?.id ||
      null;

    const isUpdateAction =
      actionName === 'update' ||
      actionName === 'set' ||
      actionName === 'toggle' ||
      actionName === 'batchUpdate' ||
      method === 'PUT' ||
      method === 'PATCH';
    const isDestroyAction = actionName === 'destroy' || actionName === 'batchDestroy' || method === 'DELETE';
    const isCreateAction = actionName === 'create' || actionName === 'batchCreate' || actionName === 'firstOrCreate';

    // 如果是更新或删除操作，尝试获取修改前快照
    if (recordDiff && collectionName && (isUpdateAction || isDestroyAction)) {
      try {
        const repo = app.db.getRepository(collectionName);
        if (repo) {
          const collection = app.db.getCollection(collectionName);
          const submittedValues = action.params?.values || {};
          const appendsToLoad: string[] = [];

          if (collection) {
            for (const key of Object.keys(submittedValues)) {
              const field = collection.getField(key);
              if (
                field &&
                (field.type === 'hasMany' ||
                  field.type === 'belongsToMany' ||
                  field.type === 'hasOne' ||
                  field.type === 'belongsTo' ||
                  field.type === 'array' ||
                  field.type === 'attachment' ||
                  field.type === 'attachments')
              ) {
                appendsToLoad.push(key);
              }
            }
          }

          const findOptions: any = {
            appends: appendsToLoad.length > 0 ? appendsToLoad : undefined,
          };

          if (recordId) {
            beforeData = await repo.findOne({ ...findOptions, filterByTk: recordId });
          } else if (action.params?.filter) {
            beforeData = await repo.findOne({ ...findOptions, filter: action.params.filter });
          }
          if (beforeData) {
            beforeData = normalizeModelData(beforeData);
            if (!recordId && beforeData?.id) {
              recordId = beforeData.id;
            }
          }
        }
      } catch (err) {
        // 快照获取失败不阻断主业务流程
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
      let diffKeys = new Set<string>();

      if (recordDiff && !errorOccurred) {
        // 尝试从响应体获取变更后的数据并标准化
        const rawResponseBody = ctx.body?.data !== undefined && ctx.body.id === undefined ? ctx.body.data : ctx.body;
        const normalizedResponseBody = normalizeModelData(rawResponseBody);

        if (isCreateAction) {
          afterData = normalizedResponseBody;
        } else if (isUpdateAction) {
          afterData = normalizedResponseBody;

          // 若响应体中未包含完整的记录字段（例如只返回受影响行数），尝试按 ID 重新查询最新快照
          const effectiveRecordId = recordId || afterData?.id;
          if (
            (!afterData || typeof afterData !== 'object' || Object.keys(afterData).length <= 2) &&
            collectionName &&
            effectiveRecordId
          ) {
            try {
              const repo = app.db.getRepository(collectionName);
              if (repo) {
                const refreshed = await repo.findOne({ filterByTk: effectiveRecordId });
                if (refreshed) {
                  afterData = normalizeModelData(refreshed);
                }
              }
            } catch {}
          }
        }

        // 若执行前未能提取 recordId，从变更后数据中补全
        if (!recordId && afterData?.id) {
          recordId = afterData.id;
        }

        // 计算字段差异
        if (beforeData || afterData) {
          const diffResult = computeFieldDiff(beforeData, afterData);
          diffData = diffResult.diffData;
          diffKeys = diffResult.diffKeys;
          beforeData = diffResult.normalizedBefore;
          afterData = diffResult.normalizedAfter;
        }
      }

      // 如果开启了零差异跳过，且为更新操作但无任何业务字段变化，直接跳过保存
      const zeroDiffSkip = configService.getBoolean(CONFIG_KEYS.AUDIT_ZERO_DIFF_SKIP, true);
      if (zeroDiffSkip && isUpdateAction) {
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

      // 异步存储瘦身后审计日志
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

/**
 * 标准化与解包 Sequelize Model 实例及响应体数据：
 * 1. 处理 Sequelize Model 实例（.toJSON(), .dataValues, .get({ plain: true }))
 * 2. 解包单元素数组 [Model] -> Model
 * 3. 剥离 Sequelize 内部状态（以 _ 开头的属性、uniqno、isNewRecord 等）
 */
function normalizeModelData(data: any, isRoot = true): any {
  if (data === null || data === undefined) return null;

  // 1. 处理 Date 实例或日期对象
  if (data instanceof Date || (typeof data === 'object' && Object.prototype.toString.call(data) === '[object Date]')) {
    return isNaN(data.getTime()) ? null : data.toISOString();
  }

  // 2. 如果包含 toJSON 方法（如 Sequelize Model / Dayjs / Moment 等）
  if (typeof data === 'object' && typeof data.toJSON === 'function') {
    return normalizeModelData(data.toJSON(), isRoot);
  }

  // 3. 如果是 Sequelize Model 且包含 dataValues
  if (typeof data === 'object' && data.dataValues && typeof data.dataValues === 'object') {
    return normalizeModelData(data.dataValues, isRoot);
  }

  // 4. 处理包裹层如 { data: ... } 结构
  if (typeof data === 'object' && !Array.isArray(data) && data.data !== undefined && data.id === undefined) {
    return normalizeModelData(data.data, isRoot);
  }

  // 5. 处理数组结构：仅在最顶层且包含单条完整模型时解包，深层关联数组/附件数组保留数组形态
  if (Array.isArray(data)) {
    if (isRoot && data.length === 1 && typeof data[0] === 'object' && data[0] !== null && ('id' in data[0] || 'dataValues' in data[0])) {
      return normalizeModelData(data[0], false);
    }
    return data.map((item) => normalizeModelData(item, false));
  }

  // 6. 纯对象处理：剔除 Sequelize 内部私有属性并递归清洗所有属性值
  if (typeof data === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (
        key.startsWith('_') ||
        key === 'uniqno' ||
        key === 'isNewRecord' ||
        key === 'isMaster' ||
        typeof val === 'function'
      ) {
        continue;
      }
      clean[key] = normalizeModelData(val, false);
    }
    return clean;
  }

  return data;
}

/**
 * 对比前置与后置数据差异
 */
function computeFieldDiff(before: any, after: any) {
  const normalizedBefore = normalizeModelData(before);
  const normalizedAfter = normalizeModelData(after);

  const diffData: Record<string, any> = {};
  const diffKeys = new Set<string>();

  if (!normalizedBefore && !normalizedAfter) {
    return { diffData: null, diffKeys, normalizedBefore: null, normalizedAfter: null };
  }

  if (
    normalizedBefore &&
    typeof normalizedBefore === 'object' &&
    !Array.isArray(normalizedBefore) &&
    normalizedAfter &&
    typeof normalizedAfter === 'object' &&
    !Array.isArray(normalizedAfter)
  ) {
    const allKeys = new Set([...Object.keys(normalizedBefore), ...Object.keys(normalizedAfter)]);
    for (const k of allKeys) {
      if (k === 'updatedAt' || k === 'createdAt' || k.startsWith('_')) continue;

      const bRaw = normalizedBefore[k];
      const aRaw = normalizedAfter[k];

      const bNorm = bRaw === undefined ? null : bRaw;
      const aNorm = aRaw === undefined ? null : aRaw;

      const bStr = JSON.stringify(bNorm);
      const aStr = JSON.stringify(aNorm);

      if (bStr !== aStr) {
        diffKeys.add(k);
        diffData[k] = {
          old: sanitizeAndTruncate(bNorm),
          new: sanitizeAndTruncate(aNorm),
        };
      }
    }
  }

  return {
    diffData: Object.keys(diffData).length > 0 ? diffData : null,
    diffKeys,
    normalizedBefore,
    normalizedAfter,
  };
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
  if (Array.isArray(data)) {
    return data.map((item) => extractLeanData(item, diffKeys));
  }

  const res: Record<string, any> = {};
  const keepKeys = new Set(['id', 'createdAt', 'updatedAt', ...(diffKeys ? Array.from(diffKeys) : [])]);

  // 如果没有指定 diffKeys（如新增或全量快照），限制最多保留前 20 个非空字段
  const keysToExtract = diffKeys && diffKeys.size > 0 ? Array.from(keepKeys) : Object.keys(data).slice(0, 20);

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
