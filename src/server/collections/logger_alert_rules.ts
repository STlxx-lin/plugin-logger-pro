import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'logger_alert_rules',
  title: '异常告警规则',
  fields: [
    {
      name: 'name',
      type: 'string',
      comment: '规则名称',
    },
    {
      name: 'type',
      type: 'string',
      comment: '规则触发类型 (error_log / status_5xx / slow_sql / keyword)',
    },
    {
      name: 'condition',
      type: 'json',
      comment: '触发条件参数',
    },
    {
      name: 'channelType',
      type: 'string',
      comment: '通知渠道类型',
    },
    {
      name: 'channelConfig',
      type: 'json',
      comment: '渠道配置详情',
    },
    {
      name: 'silenceMinutes',
      type: 'integer',
      defaultValue: 5,
      comment: '告警静默周期(分钟)',
    },
    {
      name: 'enabled',
      type: 'boolean',
      defaultValue: true,
      comment: '是否启用',
    },
    {
      name: 'lastTriggeredAt',
      type: 'date',
      comment: '最近一次触发时间',
    },
  ],
});
