import React, { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Tag,
  Switch,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  message,
  Popconfirm,
  Drawer,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  SendOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  HistoryOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  NotificationOutlined,
} from '@ant-design/icons';
import { useLoggerProAPI } from '../context/LoggerProContext';

export const AlertTab: React.FC = () => {
  const api = useLoggerProAPI();
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<any[]>([]);

  // 模态框
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [modalForm] = Form.useForm();
  const [channelType, setChannelType] = useState<string>('wecom');
  const [ruleType, setRuleType] = useState<string>('error_log');

  // 测试发送状态
  const [testing, setTesting] = useState(false);

  // 历史记录抽屉
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 1. 获取告警规则
  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await api.request({
        url: 'logger_alert_rules:list',
        params: { sort: ['-createdAt'] },
      });
      setRules(res?.data?.data || []);
    } catch (err: any) {
      message.error(`加载告警规则失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 2. 加载告警历史
  const fetchHistoryLogs = async () => {
    setHistoryLoading(true);
    try {
      const res = await api.request({
        url: 'logger_alert_logs:list',
        params: { pageSize: 50, sort: ['-createdAt'] },
      });
      setHistoryLogs(res?.data?.data || []);
    } catch {}
    finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  // 打开创建/编辑弹窗
  const handleOpenModal = (rule?: any) => {
    setEditingRule(rule || null);
    if (rule) {
      setChannelType(rule.channelType);
      setRuleType(rule.type);
      modalForm.setFieldsValue({
        name: rule.name,
        type: rule.type,
        channelType: rule.channelType,
        silenceMinutes: rule.silenceMinutes || 5,
        enabled: rule.enabled !== false,
        // 条件展开
        keyword: rule.condition?.keyword,
        thresholdMs: rule.condition?.thresholdMs || 1000,
        // 渠道配置展开
        webhookUrl: rule.channelConfig?.webhookUrl,
        secret: rule.channelConfig?.secret,
        method: rule.channelConfig?.method || 'POST',
        channelId: rule.channelConfig?.channelId,
      });
    } else {
      setChannelType('wecom');
      setRuleType('error_log');
      modalForm.resetFields();
      modalForm.setFieldsValue({
        type: 'error_log',
        channelType: 'wecom',
        silenceMinutes: 5,
        enabled: true,
        thresholdMs: 1000,
        method: 'POST',
      });
    }
    setModalVisible(true);
  };

  // 保存规则
  const handleSaveRule = async (values: any) => {
    try {
      const condition: any = {};
      if (values.type === 'keyword') {
        condition.keyword = values.keyword;
      } else if (values.type === 'slow_sql') {
        condition.thresholdMs = values.thresholdMs;
      }

      const channelConfig: any = {
        webhookUrl: values.webhookUrl,
        secret: values.secret,
        method: values.method,
        channelId: values.channelId,
      };

      const payload = {
        name: values.name,
        type: values.type,
        condition,
        channelType: values.channelType,
        channelConfig,
        silenceMinutes: values.silenceMinutes,
        enabled: values.enabled,
      };

      if (editingRule) {
        await api.request({
          url: 'logger_alert_rules:update',
          params: { filterByTk: editingRule.id },
          method: 'post',
          data: payload,
        });
        message.success('告警规则已更新');
      } else {
        await api.request({
          url: 'logger_alert_rules:create',
          method: 'post',
          data: payload,
        });
        message.success('告警规则已创建');
      }

      setModalVisible(false);
      fetchRules();
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`);
    }
  };

  // 删除规则
  const handleDeleteRule = async (id: number) => {
    try {
      await api.request({
        url: 'logger_alert_rules:destroy',
        params: { filterByTk: id },
        method: 'post',
      });
      message.success('告警规则已删除');
      fetchRules();
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`);
    }
  };

  // 开关切换
  const handleToggleEnabled = async (rule: any, enabled: boolean) => {
    try {
      await api.request({
        url: 'logger_alert_rules:update',
        params: { filterByTk: rule.id },
        method: 'post',
        data: { enabled },
      });
      message.success(`规则已${enabled ? '启用' : '禁用'}`);
      fetchRules();
    } catch (err: any) {
      message.error(`更新状态失败: ${err.message}`);
    }
  };

  // 测试发送
  const handleTestAlert = async (ruleData: any) => {
    setTesting(true);
    try {
      const res = await api.request({
        url: 'loggerPro:testAlert',
        method: 'post',
        data: ruleData,
      });
      const data = res?.data?.data || res?.data || {};
      if (data.success) {
        message.success('🎉 测试告警发送成功！请检查接收端通知。');
      } else {
        message.error(`测试告警发送失败: ${data.error}`);
      }
    } catch (err: any) {
      message.error(`测试发送异常: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const getChannelTag = (type: string) => {
    switch (type) {
      case 'wecom':
        return <Tag color="blue">企业微信</Tag>;
      case 'dingtalk':
        return <Tag color="orange">钉钉机器人</Tag>;
      case 'feishu':
        return <Tag color="cyan">飞书机器人</Tag>;
      case 'custom_webhook':
        return <Tag color="purple">自定义 Webhook</Tag>;
      case 'notification_manager':
        return <Tag color="green">通知管理插件</Tag>;
      default:
        return <Tag>{type}</Tag>;
    }
  };

  const getRuleTypeTag = (type: string) => {
    switch (type) {
      case 'error_log':
        return <Tag color="red">ERROR 日志</Tag>;
      case 'status_5xx':
        return <Tag color="magenta">HTTP 5xx 异常</Tag>;
      case 'slow_sql':
        return <Tag color="gold">慢 SQL 超标</Tag>;
      case 'keyword':
        return <Tag color="geekblue">关键词匹配</Tag>;
      default:
        return <Tag>{type}</Tag>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 顶部操作工具栏 */}
      <Card size="small" bordered>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <span style={{ fontSize: 16, fontWeight: 600 }}>🔔 异常日志告警管理</span>
            <Tag color="processing">多渠道通知分发</Tag>
          </Space>

          <Space>
            <Button
              icon={<HistoryOutlined />}
              onClick={() => {
                fetchHistoryLogs();
                setHistoryDrawerVisible(true);
              }}
            >
              告警发送历史
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchRules} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
              新建告警规则
            </Button>
          </Space>
        </div>
      </Card>

      {/* 告警规则列表 */}
      <Card bordered bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rules}
          pagination={false}
          columns={[
            {
              title: '规则名称',
              dataIndex: 'name',
              render: (name, r) => (
                <div>
                  <span style={{ fontWeight: 600 }}>{name}</span>
                  {r.condition?.keyword && (
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>匹配: "{r.condition.keyword}"</div>
                  )}
                  {r.condition?.thresholdMs && (
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>阈值: &gt;={r.condition.thresholdMs}ms</div>
                  )}
                </div>
              ),
            },
            {
              title: '触发类型',
              dataIndex: 'type',
              render: (type) => getRuleTypeTag(type),
            },
            {
              title: '通知渠道',
              dataIndex: 'channelType',
              render: (ch) => getChannelTag(ch),
            },
            {
              title: '静默周期',
              dataIndex: 'silenceMinutes',
              render: (m) => `${m || 5} 分钟防风暴`,
            },
            {
              title: '最近触发',
              dataIndex: 'lastTriggeredAt',
              render: (t) => (t ? new Date(t).toLocaleString() : <span style={{ color: '#bfbfbf' }}>从未触发</span>),
            },
            {
              title: '启用状态',
              dataIndex: 'enabled',
              render: (enabled, r) => (
                <Switch
                  checked={enabled !== false}
                  onChange={(checked) => handleToggleEnabled(r, checked)}
                />
              ),
            },
            {
              title: '操作',
              render: (_, r) => (
                <Space>
                  <Button
                    size="small"
                    type="link"
                    icon={<SendOutlined />}
                    onClick={() => handleTestAlert(r)}
                  >
                    测试
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    icon={<EditOutlined />}
                    onClick={() => handleOpenModal(r)}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="确定删除此告警规则？"
                    onConfirm={() => handleDeleteRule(r.id)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: '暂无告警规则，点击右上角新建规则' }}
        />
      </Card>

      {/* 创建 / 编辑规则弹窗 */}
      <Modal
        title={editingRule ? '✏️ 编辑告警规则' : '➕ 新建告警规则'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => modalForm.submit()}
        width={680}
        destroyOnClose
      >
        <Form form={modalForm} layout="vertical" onFinish={handleSaveRule}>
          <Form.Item
            name="name"
            label="规则名称"
            rules={[{ required: true, message: '请输入规则名称' }]}
          >
            <Input placeholder="例如：核心业务 ERROR 级别实时告警" />
          </Form.Item>

          <Form.Item
            name="type"
            label="触发源条件"
            rules={[{ required: true, message: '请选择触发条件' }]}
          >
            <Select
              onChange={(v) => setRuleType(v)}
              options={[
                { label: '🔥 ERROR 日志级别触发 (发生系统错误时告警)', value: 'error_log' },
                { label: '🌐 HTTP 5xx 状态码触发 (接口返回服务端异常时告警)', value: 'status_5xx' },
                { label: '⏱️ 慢 SQL 超标触发 (数据库查询超出阈值时告警)', value: 'slow_sql' },
                { label: '🔍 关键词匹配触发 (日志包含特定关键字如 Deadlock/OutOfMemory 时告警)', value: 'keyword' },
              ]}
            />
          </Form.Item>

          {ruleType === 'keyword' && (
            <Form.Item
              name="keyword"
              label="匹配关键词"
              rules={[{ required: true, message: '请输入需要匹配的关键词' }]}
              tooltip="支持大小写不敏感匹配"
            >
              <Input placeholder="如：Deadlock、OutOfMemory、Timeout" />
            </Form.Item>
          )}

          {ruleType === 'slow_sql' && (
            <Form.Item
              name="thresholdMs"
              label="告警慢 SQL 耗时阈值 (毫秒)"
              rules={[{ required: true, message: '请输入阈值' }]}
            >
              <InputNumber min={100} max={60000} step={100} style={{ width: '100%' }} suffix="ms" />
            </Form.Item>
          )}

          <Form.Item
            name="channelType"
            label="通知渠道类型"
            rules={[{ required: true, message: '请选择通知渠道' }]}
          >
            <Select
              onChange={(v) => setChannelType(v)}
              options={[
                { label: '💬 企业微信机器人 Webhook', value: 'wecom' },
                { label: '🔔 钉钉机器人 Webhook (支持加签)', value: 'dingtalk' },
                { label: '🚀 飞书机器人 Webhook (Card/卡片)', value: 'feishu' },
                { label: '🌐 自定义通用 Webhook (POST JSON)', value: 'custom_webhook' },
                { label: '📨 联动系统通知管理插件 (Notification Manager)', value: 'notification_manager' },
              ]}
            />
          </Form.Item>

          {channelType !== 'notification_manager' && (
            <Form.Item
              name="webhookUrl"
              label="Webhook 地址 (URL)"
              rules={[{ required: true, message: '请输入 Webhook URL' }]}
            >
              <Input placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx" />
            </Form.Item>
          )}

          {channelType === 'dingtalk' && (
            <Form.Item
              name="secret"
              label="安全加签 Secret (选填)"
              tooltip="钉钉机器人开启加签安全设置时的 SEC 开头秘钥"
            >
              <Input.Password placeholder="SECxxxxxxxx" />
            </Form.Item>
          )}

          {channelType === 'notification_manager' && (
            <Form.Item
              name="channelId"
              label="通知渠道 ID / 标识"
              tooltip="系统 @nocobase/plugin-notification-manager 中配置的 Channel ID"
            >
              <Input placeholder="如：email-default 或 in-app-channel" />
            </Form.Item>
          )}

          <Form.Item
            name="silenceMinutes"
            label="告警静默周期 (防风暴)"
            tooltip="相同规则在指定周期内最多发送 1 次告警，避免错误频发引发消息刷屏"
          >
            <InputNumber min={1} max={1440} style={{ width: '100%' }} suffix="分钟" />
          </Form.Item>

          <Form.Item name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用规则" unCheckedChildren="暂不启用" defaultChecked />
          </Form.Item>
        </Form>
      </Modal>

      {/* 告警历史抽屉 */}
      <Drawer
        title="📜 告警发送历史记录"
        placement="right"
        width={680}
        onClose={() => setHistoryDrawerVisible(false)}
        open={historyDrawerVisible}
      >
        <Table
          rowKey="id"
          size="small"
          loading={historyLoading}
          dataSource={historyLogs}
          pagination={{ pageSize: 15 }}
          columns={[
            {
              title: '发送时间',
              dataIndex: 'createdAt',
              width: 160,
              render: (t) => new Date(t).toLocaleString(),
            },
            {
              title: '规则名称',
              dataIndex: 'ruleName',
              width: 140,
            },
            {
              title: '渠道',
              dataIndex: 'channelType',
              width: 100,
              render: (ch) => getChannelTag(ch),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (st, r) => (
                <Tag color={st === 'success' ? 'success' : 'error'}>
                  {st === 'success' ? '成功' : '失败'}
                </Tag>
              ),
            },
            {
              title: '告警标题 / 详情',
              dataIndex: 'title',
              render: (title, r) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{title}</div>
                  {r.errorMsg && <div style={{ color: '#ff4d4f', fontSize: 12 }}>{r.errorMsg}</div>}
                </div>
              ),
            },
          ]}
          locale={{ emptyText: '暂无告警记录' }}
        />
      </Drawer>
    </div>
  );
};
