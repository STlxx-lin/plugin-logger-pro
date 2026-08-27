import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'logger_audit_logs',
  title: '操作审计日志',
  indexes: [
    { fields: ['createdAt'] },
    { fields: ['userUsername'] },
    { fields: ['collectionName'] },
    { fields: ['actionName'] },
    { fields: ['reqId'] },
    { fields: ['statusCode'] },
  ],
  fields: [
    {
      name: 'reqId',
      type: 'string',
      comment: '请求唯一追踪ID (Trace ID)',
    },
    {
      name: 'userId',
      type: 'bigInt',
      comment: '操作用户ID',
    },
    {
      name: 'userUsername',
      type: 'string',
      comment: '操作用户名',
    },
    {
      name: 'userNickname',
      type: 'string',
      comment: '操作用户昵称',
    },
    {
      name: 'ip',
      type: 'string',
      comment: '客户端IP',
    },
    {
      name: 'userAgent',
      type: 'text',
      comment: '客户端User-Agent',
    },
    {
      name: 'method',
      type: 'string',
      comment: '请求HTTP Method',
    },
    {
      name: 'path',
      type: 'string',
      comment: '请求路径',
    },
    {
      name: 'collectionName',
      type: 'string',
      comment: '目标数据表',
    },
    {
      name: 'actionName',
      type: 'string',
      comment: '操作动作 (create/update/destroy/custom)',
    },
    {
      name: 'recordId',
      type: 'string',
      comment: '目标记录ID',
    },
    {
      name: 'params',
      type: 'json',
      comment: '操作请求参数',
    },
    {
      name: 'beforeData',
      type: 'json',
      comment: '修改前数据快照',
    },
    {
      name: 'afterData',
      type: 'json',
      comment: '修改后数据快照',
    },
    {
      name: 'diff',
      type: 'json',
      comment: '变更差异对比',
    },
    {
      name: 'statusCode',
      type: 'integer',
      comment: '响应HTTP状态码',
    },
    {
      name: 'durationMs',
      type: 'integer',
      comment: '执行耗时(毫秒)',
    },
    {
      name: 'errorMessage',
      type: 'text',
      comment: '异常错误信息',
    },
  ],
});
