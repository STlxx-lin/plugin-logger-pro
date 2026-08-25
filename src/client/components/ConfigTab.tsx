import React, { useState, useEffect } from 'react';
import {
  Form,
  Card,
  Radio,
  Switch,
  InputNumber,
  Input,
  Select,
  Button,
  Space,
  Divider,
  message,
  Popconfirm,
  Row,
  Col,
  Alert,
  Table,
  Tag,
  Statistic,
  Progress,
  Tooltip,
} from 'antd';
import {
  SaveOutlined,
  ClearOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  HddOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';

export const ConfigTab: React.FC = () => {
  const api = useAPIClient();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleanLoading, setCleanLoading] = useState(false);
  const [collectionsList, setCollectionsList] = useState<any[]>([]);

  // 存储与数据占用分析状态
  const [statsLoading, setStatsLoading] = useState(false);
  const [storageStats, setStorageStats] = useState<any>(null);

  // 1. 获取配置与 Collections
  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const [configRes, colRes] = await Promise.all([
        api.request({ url: 'loggerPro:getConfigs' }),
        api.request({ url: 'loggerPro:getCollections' }),
      ]);

      const configs = configRes?.data?.data || configRes?.data || {};
      setCollectionsList(colRes?.data?.data || colRes?.data || []);

      let auditCols: string[] = [];
      try {
        auditCols = configs.audit_collections ? JSON.parse(configs.audit_collections) : [];
      } catch {}

      form.setFieldsValue({
        logger_level: configs.logger_level || 'info',
        sql_logging: configs.sql_logging === 'true',
        slow_query_enabled: configs.slow_query_enabled === 'true',
        slow_query_threshold_ms: Number(configs.slow_query_threshold_ms) || 500,
        request_logging: configs.request_logging === 'true',
        audit_log_enabled: configs.audit_log_enabled === 'true',
        audit_record_diff: configs.audit_record_diff === 'true',
        audit_collections: auditCols,
        retention_days: Number(configs.retention_days) || 15,
        max_disk_size_mb: Number(configs.max_disk_size_mb) || 2048,
        auto_clean_enabled: configs.auto_clean_enabled === 'true',
        auto_clean_cron: configs.auto_clean_cron || '0 2 * * *',
      });
    } catch (err: any) {
      message.error(`加载配置失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 2. 获取插件存储空间占用统计
  const fetchStorageStats = async () => {
    setStatsLoading(true);
    try {
      const res = await api.request({ url: 'loggerPro:getPluginStorageStats' });
      const data = res?.data?.data || res?.data;
      if (data) {
        setStorageStats(data);
      }
    } catch {} finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchStorageStats();
  }, []);

  // 3. 保存配置
  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        logger_level: values.logger_level,
        sql_logging: String(values.sql_logging),
        slow_query_enabled: String(values.slow_query_enabled),
        slow_query_threshold_ms: String(values.slow_query_threshold_ms),
        request_logging: String(values.request_logging),
        audit_log_enabled: String(values.audit_log_enabled),
        audit_record_diff: String(values.audit_record_diff),
        audit_collections: JSON.stringify(values.audit_collections || []),
        retention_days: String(values.retention_days),
        max_disk_size_mb: String(values.max_disk_size_mb),
        auto_clean_enabled: String(values.auto_clean_enabled),
        auto_clean_cron: values.auto_clean_cron,
      };

      await api.request({
        url: 'loggerPro:updateConfigs',
        method: 'post',
        data: payload,
      });

      message.success('配置已保存并立即热生效！');
      fetchStorageStats();
    } catch (err: any) {
      message.error(`保存配置失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 4. 手动清理过期日志文件
  const handleCleanNow = async () => {
    setCleanLoading(true);
    try {
      const res = await api.request({
        url: 'loggerPro:cleanLogs',
        method: 'post',
      });
      const data = res?.data?.data || res?.data || {};
      message.success(`清理完成！共删除 ${data.deletedCount} 个文件，释放空间 ${data.freedFormatted}`);
      fetchStorageStats();
    } catch (err: any) {
      message.error(`清理失败: ${err.message}`);
    } finally {
      setCleanLoading(false);
    }
  };

  // 5. 清空某张数据表
  const handleCleanTable = async (collectionName: string) => {
    try {
      await api.request({
        url: 'loggerPro:cleanTableData',
        params: { collectionName },
      });
      message.success(`已清空数据表 ${collectionName}`);
      fetchStorageStats();
    } catch (err: any) {
      message.error(`清空失败: ${err.message}`);
    }
  };

  // 6. 打包下载所有日志
  const handleDownloadAll = () => {
    const rawBase = (api as any).baseURL || (api as any).axios?.defaults?.baseURL || '';
    const downloadUrl = rawBase ? `${rawBase}/loggerPro:downloadArchive` : '/api/loggerPro:downloadArchive';
    window.open(downloadUrl, '_blank');
  };

  // 数据库表表格列定义
  const tableColumns = [
    {
      title: '数据表名称 / 功能',
      dataIndex: 'title',
      key: 'title',
      render: (text: string, rec: any) => (
        <div>
          <strong>{text}</strong>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>{rec.collection}</div>
        </div>
      ),
    },
    {
      title: '当前记录行数',
      dataIndex: 'count',
      key: 'count',
      render: (val: number) => <Tag color="blue">{val.toLocaleString()} 行</Tag>,
    },
    {
      title: '预估占用空间',
      dataIndex: 'estimatedFormatted',
      key: 'estimatedFormatted',
      render: (val: string) => <span style={{ fontWeight: 600, color: '#595959' }}>{val}</span>,
    },
    {
      title: '空间维护操作',
      key: 'action',
      render: (_: any, rec: any) => (
        rec.count > 0 && rec.collection !== 'logger_configs' && rec.collection !== 'logger_alert_rules' ? (
          <Popconfirm
            title={`确定清空「${rec.title}」的所有数据？`}
            description="清空后历史数据不可恢复，请谨慎操作。"
            onConfirm={() => handleCleanTable(rec.collection)}
            okText="确定清空"
            cancelText="取消"
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              清空数据
            </Button>
          </Popconfirm>
        ) : (
          <span style={{ color: '#bfbfbf', fontSize: 12 }}>-</span>
        )
      ),
    },
  ];

  return (
    <div style={{ padding: '4px 0' }}>
      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Row gutter={[16, 16]}>
          {/* 🌟 核心新卡片：插件数据与存储空间占用分析 */}
          <Col xs={24}>
            <Card
              size="small"
              bordered
              style={{
                backgroundColor: '#ffffff',
                borderLeft: '4px solid #1890ff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              }}
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space>
                    <HddOutlined style={{ color: '#1890ff', fontSize: 16 }} />
                    <strong style={{ fontSize: 14 }}>📊 插件数据与存储空间占用分析 (Plugin Storage & Data Usage)</strong>
                  </Space>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={statsLoading}
                    onClick={fetchStorageStats}
                  >
                    刷新统计
                  </Button>
                </div>
              }
            >
              {/* 3 个总览卡片 */}
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={8}>
                  <Card size="small" style={{ backgroundColor: '#f0f5ff', borderColor: '#adc6ff' }}>
                    <Statistic
                      title={<span style={{ color: '#1d39c4' }}><FileTextOutlined /> 日志文件磁盘占用</span>}
                      value={storageStats?.fileStats?.totalSizeFormatted || '0 B'}
                      suffix={<span style={{ fontSize: 12, color: '#595959' }}>({storageStats?.fileStats?.totalFiles || 0} 个文件)</span>}
                      valueStyle={{ color: '#1d39c4', fontWeight: 600 }}
                    />
                    <div style={{ marginTop: 8, fontSize: 11, color: '#595959' }}>
                      请求: {storageStats?.fileStats?.categories?.requestLogs?.formatted || '0 B'} | 系统: {storageStats?.fileStats?.categories?.systemLogs?.formatted || '0 B'} | SQL: {storageStats?.fileStats?.categories?.sqlLogs?.formatted || '0 B'}
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={8}>
                  <Card size="small" style={{ backgroundColor: '#f6ffed', borderColor: '#b7eb8f' }}>
                    <Statistic
                      title={<span style={{ color: '#237804' }}><DatabaseOutlined /> 数据库表数据占用</span>}
                      value={storageStats?.dbStats?.estimatedSizeFormatted || '0 B'}
                      suffix={<span style={{ fontSize: 12, color: '#595959' }}>({(storageStats?.dbStats?.totalRows || 0).toLocaleString()} 行)</span>}
                      valueStyle={{ color: '#237804', fontWeight: 600 }}
                    />
                    <div style={{ marginTop: 8, fontSize: 11, color: '#595959' }}>
                      含审计记录、AI 诊断历史、告警日志等 5 张核心业务表
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={8}>
                  <Card size="small" style={{ backgroundColor: '#f9f0ff', borderColor: '#d3adf7' }}>
                    <Statistic
                      title={<span style={{ color: '#531dab' }}><HddOutlined /> 插件总体空间占用</span>}
                      value={storageStats?.totalSizeFormatted || '0 B'}
                      valueStyle={{ color: '#531dab', fontWeight: 600 }}
                    />
                    <div style={{ marginTop: 8, fontSize: 11, color: '#595959' }}>
                      磁盘配额上限: {form.getFieldValue('max_disk_size_mb') || 2048} MB
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* 数据库表占用表格 */}
              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 8, fontWeight: 600, color: '#262626', fontSize: 13 }}>
                  🗄️ 插件数据表明细与空间释放:
                </div>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="collection"
                  dataSource={storageStats?.dbStats?.tables || []}
                  columns={tableColumns}
                />
              </div>
            </Card>
          </Col>

          {/* 1. 基础日志输出与级别控制 */}
          <Col xs={24} md={12}>
            <Card size="small" title="基础输出控制 (Basic Logging)" bordered style={{ height: '100%' }}>
              <Form.Item
                name="logger_level"
                label="全局最低日志输出级别"
                tooltip="低于该级别的日志将直接被忽略，不会写入磁盘，以此大幅降低磁盘 I/O。"
              >
                <Radio.Group buttonStyle="solid">
                  <Radio.Button value="debug">DEBUG</Radio.Button>
                  <Radio.Button value="info">INFO</Radio.Button>
                  <Radio.Button value="warn">WARN</Radio.Button>
                  <Radio.Button value="error">ERROR</Radio.Button>
                </Radio.Group>
              </Form.Item>

              <Divider style={{ margin: '12px 0' }} />

              <Row gutter={[16, 12]}>
                <Col span={12}>
                  <Form.Item
                    name="request_logging"
                    label="开启 HTTP 请求生命周期日志"
                    valuePropName="checked"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col span={12}>
                  <Form.Item
                    name="sql_logging"
                    label="开启 Sequelize SQL 详细执行日志"
                    valuePropName="checked"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* 2. 慢查询监控配置 */}
          <Col xs={24} md={12}>
            <Card size="small" title="慢查询捕获 (Slow Query Monitor)" bordered style={{ height: '100%' }}>
              <Row gutter={[16, 12]}>
                <Col span={12}>
                  <Form.Item
                    name="slow_query_enabled"
                    label="开启慢查询自动捕获"
                    valuePropName="checked"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col span={12}>
                  <Form.Item
                    name="slow_query_threshold_ms"
                    label="慢查询判定阈值 (毫秒)"
                    tooltip="执行时间超出此阈值的 SQL 将被独立标记并记录到 slow-query 日志中。"
                  >
                    <InputNumber min={50} max={60000} step={100} style={{ width: '100%' }} suffix="ms" />
                  </Form.Item>
                </Col>
              </Row>

              <Alert
                type="info"
                showIcon
                message="开启慢查询监控后，系统会自动在仪表盘展示 Top 慢查询与执行频次分布。"
                style={{ marginTop: 8 }}
              />
            </Card>
          </Col>

          {/* 3. 数据变更审计配置 */}
          <Col xs={24}>
            <Card size="small" title="操作与变更审计 (Audit Log Configuration)" bordered>
              <Row gutter={[16, 12]}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="audit_log_enabled"
                    label="开启全链路操作审计"
                    valuePropName="checked"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={8}>
                  <Form.Item
                    name="audit_record_diff"
                    label="记录数据变更前后字段差异 (Diff)"
                    valuePropName="checked"
                    tooltip="启用后将在更新和删除操作时记录 Before/After 变更快照。"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={8}>
                  <Form.Item
                    name="audit_collections"
                    label="指定重点审计的数据表"
                    tooltip="留空则默认审计除系统元数据外的所有业务表。"
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="全部业务数据表 (默认)"
                      style={{ width: '100%' }}
                      options={collectionsList.map((c) => ({
                        label: `${c.title || c.name} (${c.name})`,
                        value: c.name,
                      }))}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* 4. 存储生命周期与自动归档清理 */}
          <Col xs={24}>
            <Card size="small" title="日志生命周期与自动清理 (Retention & Auto-Clean)" bordered>
              <Row gutter={[16, 12]}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="retention_days"
                    label="日志保留天数"
                    tooltip="超出保留天数的日志文件将被自动清理。设置为 0 表示永不过期。"
                  >
                    <InputNumber min={0} max={365} style={{ width: '100%' }} suffix="天" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={8}>
                  <Form.Item
                    name="max_disk_size_mb"
                    label="日志磁盘占用上限"
                    tooltip="当日志总大小超出此限额时，自动清理最早的历史日志文件"
                  >
                    <InputNumber min={100} max={102400} step={500} style={{ width: '100%' }} suffix="MB" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={8}>
                  <Form.Item
                    name="auto_clean_enabled"
                    label="定时自动清理"
                    valuePropName="checked"
                    tooltip="是否开启后台定时自动清理任务"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    name="auto_clean_cron"
                    label="自动清理定时表达式 (Cron)"
                    tooltip="标准 5 段 Cron 表达式，默认每天凌晨 2:00 (0 2 * * *)"
                  >
                    <Input placeholder="0 2 * * *" style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item label="手动运维操作">
                    <Space wrap>
                      <Popconfirm
                        title="立即执行过期与超限日志清理？"
                        description="将立即扫描并清理超出保留天数或磁盘配额的历史日志。"
                        onConfirm={handleCleanNow}
                        okText="立即清理"
                        cancelText="取消"
                      >
                        <Button icon={<ClearOutlined />} loading={cleanLoading}>
                          立即手动清理日志
                        </Button>
                      </Popconfirm>

                      <Button icon={<DownloadOutlined />} onClick={handleDownloadAll}>
                        打包下载全部日志 (.tar.gz)
                      </Button>
                    </Space>
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* 底部保存提交 */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={fetchConfigs}>
            重置更改
          </Button>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} size="large">
            保存配置
          </Button>
        </div>
      </Form>
    </div>
  );
};
