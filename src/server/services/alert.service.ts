import { Application } from '@nocobase/server';
import crypto from 'crypto';
import { ALERT_CHANNELS, ALERT_RULE_TYPES } from '../constants';

export interface AlertContext {
  title?: string;
  message?: string;
  level?: string;
  statusCode?: number;
  durationMs?: number;
  sql?: string;
  path?: string;
  method?: string;
  ip?: string;
  user?: string;
  stack?: string;
  extra?: Record<string, any>;
}

export class AlertService {
  private app: Application;
  private silenceCache: Map<number, number> = new Map(); // ruleId -> timestamp

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Webhook URL 安全校验：
   * 1. 仅允许 http/https 协议（阻断 file://、gopher:// 等危险协议）；
   * 2. 封禁云厂商元数据端点（服务端请求伪造的最高价值目标）。
   * 注意：自建内网接收端属合法场景，故默认不封禁私网网段。
   */
  private assertSafeWebhookUrl(rawUrl: string) {
    if (!rawUrl || typeof rawUrl !== 'string') return;
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid webhook URL: ${rawUrl.slice(0, 100)}`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error(`Webhook URL protocol not allowed: ${u.protocol}`);
    }
    const host = u.hostname.toLowerCase();
    const blockedEndpoints = [
      '169.254.169.254', // AWS/阿里云/华为云等元数据
      '100.100.100.200', // 阿里云 ECS 元数据
      'metadata.google.internal', // GCP 元数据
      'metadata', // 通用元数据主机名
      'fd00:ec2::254', // AWS IPv6 元数据
    ];
    if (blockedEndpoints.includes(host)) {
      throw new Error(`Webhook URL points to a blocked metadata endpoint: ${host}`);
    }
  }

  async testAlert(ruleData: any): Promise<{ success: boolean; error?: string }> {
    const testContext: AlertContext = {
      title: `[测试告警] ${ruleData.name || 'Logger Pro Alert Rule Test'}`,
      message: '这是一条来自 NocoBase Logger Pro 的连通性测试告警信息，如果收到说明告警渠道配置正常。',
      level: 'TEST',
      statusCode: 200,
      path: '/api/loggerPro:testAlert',
      method: 'POST',
      ip: '127.0.0.1',
      user: 'Admin',
    };

    try {
      await this.sendToChannel(ruleData.channelType, ruleData.channelConfig, testContext);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async checkAndTrigger(type: string, context: AlertContext) {
    try {
      const ruleRepo = this.app.db.getRepository('logger_alert_rules');
      if (!ruleRepo) return;

      const rules = await ruleRepo.find({
        filter: {
          type,
          enabled: true,
        },
      });

      if (!rules || rules.length === 0) return;

      for (const rule of rules) {
        if (!this.matchCondition(rule, type, context)) {
          continue;
        }

        // 防风暴限流检查
        const now = Date.now();
        const silenceMs = (rule.silenceMinutes || 5) * 60 * 1000;
        const lastTriggered = this.silenceCache.get(rule.id) || (rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).getTime() : 0);

        if (now - lastTriggered < silenceMs) {
          continue;
        }

        this.silenceCache.set(rule.id, now);
        // 异步更新数据库与发送，不阻塞主流程
        this.dispatchAlert(rule, context).catch((e) => {
          // ignore
        });
      }
    } catch (err: any) {
      // 若表尚未建立或数据库迁移中，静默跳过，避免控制台刷屏
      if (err.message && (err.message.includes('no such table') || err.message.includes("doesn't exist"))) {
        return;
      }
      this.app.logger?.warn?.(`[LoggerPro] checkAndTrigger error: ${err.message}`);
    }
  }

  private matchCondition(rule: any, type: string, context: AlertContext): boolean {
    const condition = rule.condition || {};

    if (type === ALERT_RULE_TYPES.KEYWORD) {
      const keyword = condition.keyword?.trim();
      if (!keyword) return false;
      const targetStr = `${context.message || ''} ${context.title || ''} ${context.stack || ''}`;
      return targetStr.toLowerCase().includes(keyword.toLowerCase());
    }

    if (type === ALERT_RULE_TYPES.SLOW_SQL) {
      const threshold = Number(condition.thresholdMs) || 1000;
      return (context.durationMs || 0) >= threshold;
    }

    if (type === ALERT_RULE_TYPES.STATUS_5XX) {
      const code = context.statusCode || 0;
      return code >= 500 && code <= 599;
    }

    if (type === ALERT_RULE_TYPES.ERROR_LOG) {
      return (context.level || '').toUpperCase() === 'ERROR';
    }

    return true;
  }

  private async dispatchAlert(rule: any, context: AlertContext) {
    const ruleRepo = this.app.db.getRepository('logger_alert_rules');
    const logRepo = this.app.db.getRepository('logger_alert_logs');

    await ruleRepo.update({
      filterByTk: rule.id,
      values: { lastTriggeredAt: new Date() },
    });

    let status = 'success';
    let errorMsg = '';

    try {
      await this.sendToChannel(rule.channelType, rule.channelConfig, context);
    } catch (err) {
      status = 'failed';
      errorMsg = err.message;
    }

    if (logRepo) {
      await logRepo.create({
        values: {
          ruleId: rule.id,
          ruleName: rule.name,
          channelType: rule.channelType,
          title: context.title || `[告警] ${rule.name}`,
          content: context.message || JSON.stringify(context),
          status,
          errorMsg,
        },
      });
    }
  }

  private async sendToChannel(channelType: string, config: any, context: AlertContext) {
    // 发起任何出站请求前先校验 webhook 目标（notification-manager 走系统内部通道，不适用）
    if (channelType !== ALERT_CHANNELS.NOTIFICATION_MANAGER) {
      this.assertSafeWebhookUrl(config?.webhookUrl);
    }

    const title = context.title || '【NocoBase 系统异常告警】';
    const timeStr = new Date().toLocaleString();
    const markdownContent = [
      `### 🚨 ${title}`,
      `> **告警时间**: ${timeStr}`,
      context.level ? `> **日志级别**: \`${context.level}\`` : '',
      context.path ? `> **请求路径**: \`${context.method || 'GET'} ${context.path}\`` : '',
      context.statusCode ? `> **状态码**: \`${context.statusCode}\`` : '',
      context.durationMs ? `> **耗时**: \`${context.durationMs} ms\`` : '',
      context.ip ? `> **来源 IP**: \`${context.ip}\`` : '',
      context.user ? `> **操作人**: \`${context.user}\`` : '',
      context.sql ? `> **SQL 语句**:\n\`\`\`sql\n${context.sql}\n\`\`\`` : '',
      context.message ? `> **错误详情**:\n${context.message}` : '',
      context.stack ? `> **堆栈信息**:\n\`\`\`text\n${context.stack.slice(0, 500)}\n\`\`\`` : '',
    ]
      .filter(Boolean)
      .join('\n');

    switch (channelType) {
      case ALERT_CHANNELS.WECOM: {
        const webhookUrl = config?.webhookUrl;
        if (!webhookUrl) throw new Error('WeCom webhookUrl is required.');
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
              content: markdownContent,
            },
          }),
        });
        const json: any = await res.json();
        if (json.errcode !== 0) {
          throw new Error(`WeCom API error: [${json.errcode}] ${json.errmsg}`);
        }
        break;
      }

      case ALERT_CHANNELS.DINGTALK: {
        let webhookUrl = config?.webhookUrl;
        if (!webhookUrl) throw new Error('DingTalk webhookUrl is required.');
        const secret = config?.secret;
        if (secret) {
          const timestamp = Date.now();
          const stringToSign = `${timestamp}\n${secret}`;
          const sign = encodeURIComponent(
            crypto.createHmac('sha256', secret).update(stringToSign).digest('base64'),
          );
          webhookUrl += `${webhookUrl.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${sign}`;
        }
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
              title: title,
              text: markdownContent,
            },
          }),
        });
        const json: any = await res.json();
        if (json.errcode !== 0) {
          throw new Error(`DingTalk API error: [${json.errcode}] ${json.errmsg}`);
        }
        break;
      }

      case ALERT_CHANNELS.FEISHU: {
        const webhookUrl = config?.webhookUrl;
        if (!webhookUrl) throw new Error('Feishu webhookUrl is required.');
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msg_type: 'interactive',
            card: {
              header: {
                title: { tag: 'plain_text', content: `🚨 ${title}` },
                template: 'red',
              },
              elements: [
                {
                  tag: 'markdown',
                  content: markdownContent,
                },
              ],
            },
          }),
        });
        const json: any = await res.json();
        if (json.code !== 0 && json.StatusCode !== 0) {
          throw new Error(`Feishu API error: [${json.code || json.StatusCode}] ${json.msg || json.StatusMessage}`);
        }
        break;
      }

      case ALERT_CHANNELS.CUSTOM_WEBHOOK: {
        const webhookUrl = config?.webhookUrl;
        if (!webhookUrl) throw new Error('Custom webhookUrl is required.');
        const method = (config?.method || 'POST').toUpperCase();
        const headers = config?.headers ? (typeof config.headers === 'string' ? JSON.parse(config.headers) : config.headers) : { 'Content-Type': 'application/json' };
        await fetch(webhookUrl, {
          method,
          headers,
          body: JSON.stringify({
            title,
            time: timeStr,
            context,
            content: markdownContent,
          }),
        });
        break;
      }

      case ALERT_CHANNELS.NOTIFICATION_MANAGER: {
        // 联动系统 notification manager
        const channelId = config?.channelId;
        const notificationPlugin = (this.app as any).pm?.get?.('@nocobase/plugin-notification-manager');
        if (notificationPlugin && (notificationPlugin as any).sendNotification) {
          await (notificationPlugin as any).sendNotification({
            channelId,
            title,
            content: markdownContent,
          });
        } else {
          this.app.logger?.warn?.('[LoggerPro] notification-manager plugin is not loaded or does not support sendNotification.');
        }
        break;
      }

      default:
        throw new Error(`Unsupported alert channel type: ${channelType}`);
    }
  }
}
