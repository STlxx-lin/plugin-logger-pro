import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'logger_configs',
  title: '日志运行时配置',
  fields: [
    {
      name: 'key',
      type: 'string',
      unique: true,
      comment: '配置键名',
    },
    {
      name: 'value',
      type: 'text',
      comment: '配置值',
    },
    {
      name: 'description',
      type: 'string',
      comment: '配置描述说明',
    },
  ],
});
