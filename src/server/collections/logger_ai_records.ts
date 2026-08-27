import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'logger_ai_records',
  title: 'AI 日志诊断记录',
  indexes: [
    { fields: ['createdAt'] },
    { fields: ['employeeName'] },
  ],
  fields: [
    {
      name: 'analyzerName',
      type: 'string',
      comment: '诊断专家与模型名称',
    },
    {
      name: 'employeeName',
      type: 'string',
      comment: 'AI 员工标识',
    },
    {
      name: 'llmService',
      type: 'string',
      comment: 'LLM 服务标识',
    },
    {
      name: 'model',
      type: 'string',
      comment: '模型标识',
    },
    {
      name: 'logSummary',
      type: 'string',
      comment: '错误摘要',
    },
    {
      name: 'logText',
      type: 'text',
      comment: '原始错误日志或调用堆栈',
    },
    {
      name: 'context',
      type: 'json',
      comment: '关联请求上下文',
    },
    {
      name: 'analysisReport',
      type: 'text',
      comment: 'AI 诊断 Markdown 报告全文',
    },
    {
      name: 'durationMs',
      type: 'integer',
      comment: '诊断耗时 (ms)',
    },
  ],
});
