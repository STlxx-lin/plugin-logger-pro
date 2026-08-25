export const PLUGIN_NAME = 'logger-pro';
export const RESOURCE_NAME = 'loggerPro';
export const COMPAT_RESOURCE_NAME = 'logger';

export const CONFIG_KEYS = {
  LOGGER_LEVEL: 'logger_level',
  SQL_LOGGING: 'sql_logging',
  SLOW_QUERY_ENABLED: 'slow_query_enabled',
  SLOW_QUERY_THRESHOLD_MS: 'slow_query_threshold_ms',
  REQUEST_LOGGING: 'request_logging',
  REQUEST_IGNORE_PATTERNS: 'request_ignore_patterns',
  AUDIT_LOG_ENABLED: 'audit_log_enabled',
  AUDIT_RECORD_DIFF: 'audit_record_diff',
  AUDIT_COLLECTIONS: 'audit_collections',
  RETENTION_DAYS: 'retention_days',
  MAX_DISK_SIZE_MB: 'max_disk_size_mb',
  AUTO_CLEAN_ENABLED: 'auto_clean_enabled',
  AUTO_CLEAN_CRON: 'auto_clean_cron',
};

export const DEFAULT_CONFIGS = {
  [CONFIG_KEYS.LOGGER_LEVEL]: 'info',
  [CONFIG_KEYS.SQL_LOGGING]: 'true',
  [CONFIG_KEYS.SLOW_QUERY_ENABLED]: 'true',
  [CONFIG_KEYS.SLOW_QUERY_THRESHOLD_MS]: '500',
  [CONFIG_KEYS.REQUEST_LOGGING]: 'true',
  [CONFIG_KEYS.REQUEST_IGNORE_PATTERNS]: '["/api/loggerPro/*", "/api/logger/*", "/static/*", "/favicon.ico"]',
  [CONFIG_KEYS.AUDIT_LOG_ENABLED]: 'true',
  [CONFIG_KEYS.AUDIT_RECORD_DIFF]: 'true',
  [CONFIG_KEYS.AUDIT_COLLECTIONS]: '[]', // 空代表开启所有数据表
  [CONFIG_KEYS.RETENTION_DAYS]: '15',
  [CONFIG_KEYS.MAX_DISK_SIZE_MB]: '2048',
  [CONFIG_KEYS.AUTO_CLEAN_ENABLED]: 'true',
  [CONFIG_KEYS.AUTO_CLEAN_CRON]: '0 2 * * *', // 每天凌晨2点自动清理
};

export const ALERT_RULE_TYPES = {
  ERROR_LOG: 'error_log',
  STATUS_5XX: 'status_5xx',
  SLOW_SQL: 'slow_sql',
  KEYWORD: 'keyword',
} as const;

export const ALERT_CHANNELS = {
  WECOM: 'wecom',
  DINGTALK: 'dingtalk',
  FEISHU: 'feishu',
  CUSTOM_WEBHOOK: 'custom_webhook',
  NOTIFICATION_MANAGER: 'notification_manager',
} as const;
