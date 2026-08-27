import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'logger_alert_logs',
  title: '告警发送记录',
  indexes: [
    { fields: ['createdAt'] },
    { fields: ['ruleId'] },
    { fields: ['status'] },
  ],
  fields: [
    {
      name: 'ruleId',
      type: 'bigInt',
      comment: '关联规则ID',
    },
    {
      name: 'ruleName',
      type: 'string',
      comment: '告警规则名称',
    },
    {
      name: 'channelType',
      type: 'string',
      comment: '通知渠道类型',
    },
    {
      name: 'title',
      type: 'string',
      comment: '告警标题',
    },
    {
      name: 'content',
      type: 'text',
      comment: '告警内容明细',
    },
    {
      name: 'status',
      type: 'string',
      comment: '发送状态 (success / failed)',
    },
    {
      name: 'errorMsg',
      type: 'text',
      comment: '发送失败错误信息',
    },
  ],
});
