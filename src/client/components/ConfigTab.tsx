import React, { useState, useEffect, useRef } from 'react';
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
  Modal,
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
  LoadingOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useLoggerProAPI } from '../context/LoggerProContext';

export const ConfigTab: React.FC = () => {
  const api = useLoggerProAPI();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleanLoading, setCleanLoading] = useState(false);
  const [collectionsList, setCollectionsList] = useState<any[]>([]);

  // 存储与数据占用分析状态
  const [statsLoading, setStatsLoading] = useState(false);
  const [storageStats, setStorageStats] = useState<any>(null);

  // 删除进度弹窗状态
  const [progressVisible, setProgressVisible] = useState(false);
  const [progressTitle, setProgressTitle] = useState('');
  const [totalToClean, setTotalToClean] = useState(0);
  const [cleanedCount, setCleanedCount] = useState(0);
  const [remainingCount, setRemainingCount] = useState(0);
  const [cleanStatus, setCleanStatus] = useState<'running' | 'completed' | 'error' | 'stopped'>('running');
  const [cleanErrorMsg, setCleanErrorMsg] = useState('');
  const cancelCleanRef = useRef(false);

  // 系统预置集合与常用数据表中文映射
  const systemCollectionMap: Record<string, string> = {
    auth: '用户身份与认证',
    roles: '角色与权限控制',
    uiSchemas: '界面区块 Schema 配置',
    uiSchemaTemplates: '区块 UI 模板配置',
    desktopRoutes: '桌面端路由与菜单',
    themeConfig: '主题与界面外观配置',
    dataSources: '数据源连接与配置',
    environmentVariables: '系统环境变量',
    systemSettings: '系统全局核心设置',
    applicationPlugins: '应用插件管理与状态',
    migrations: '数据库版本迁移记录',
    workflow: '工作流引擎核心表',
    flowModels: '流程设计模型',
    aiConversations: 'AI 会话与交互历史',
    aiEmployees: 'AI 智能员工与助手',
    attachments: '附件与文件存储表',
    logger_audit_logs: '操作审计记录表',
    logger_alert_logs: '告警通知发送记录',
    logger_configs: '日志系统配置表',
    logger_alert_rules: '智能告警规则表',
    logger_ai_records: 'AI 诊断记录表',
  };

  // 排除数据表候选选项（带丰富中文标注）
  const excludeCollectionOptions = React.useMemo(() => {
    const existing = new Set<string>();
    const options: Array<{ label: string; value: string }> = [];

    for (const c of collectionsList) {
      existing.add(c.name);
      const zh = systemCollectionMap[c.name] || c.title || c.name;
      options.push({
        label: `${zh} (${c.name})`,
        value: c.name,
      });
    }

    for (const [key, zh] of Object.entries(systemCollectionMap)) {
      if (!existing.has(key)) {
        options.push({
          label: `${zh} (${key})`,
          value: key,
        });
      }
    }

    return options;
  }, [collectionsList]);

  // 排除操作动作候选选项（全中文详细标注）
  const excludeActionOptions = [
    { label: 'syncCookies (Cookie 会话心跳同步)', value: 'syncCookies' },
    { label: 'unreadCounts (未读消息与提醒轮询)', value: 'unreadCounts' },
    { label: 'listByUser (用户与员工列表拉取)', value: 'listByUser' },
    { label: 'listMeta (集合元数据动态查询)', value: 'listMeta' },
    { label: 'listAccessible (可访问菜单与路由查询)', value: 'listAccessible' },
    { label: 'listMine (我的待办工作流任务)', value: 'listMine' },
    { label: 'check (权限与状态常规校验)', value: 'check' },
    { label: 'getLang (系统多语言词包获取)', value: 'getLang' },
    { label: 'getInfo (应用与环境信息查询)', value: 'getInfo' },
    { label: 'getConfigs (日志与插件配置读取)', value: 'getConfigs' },
    { label: 'getCollections (数据表与模型列表获取)', value: 'getCollections' },
    { label: 'dashboard (仪表盘运行状态获取)', value: 'dashboard' },
    { label: 'getFile (文件与附件预览读取)', value: 'getFile' },
    { label: 'list (基础列表只读数据查询)', value: 'list' },
    { label: 'get (基础单条只读数据查询)', value: 'get' },
    { label: 'count (数据总量统计)', value: 'count' },
    { label: 'find (数据检索查询)', value: 'find' },
    { label: 'findOne (单条数据检索)', value: 'findOne' },
  ];

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
      let auditExcludeCols: string[] = [];
      let auditExcludeActs: string[] = [];
      try {
        auditCols = configs.audit_collections ? JSON.parse(configs.audit_collections) : [];
      } catch {}
      try {
        auditExcludeCols = configs.audit_exclude_collections
          ? JSON.parse(configs.audit_exclude_collections)
          : [
              'auth',
              'roles',
              'uiSchemas',
              'uiSchemaTemplates',
              'desktopRoutes',
              'themeConfig',
              'dataSources',
              'environmentVariables',
              'systemSettings',
              'applicationPlugins',
              'migrations',
            ];
      } catch {}
      try {
        auditExcludeActs = configs.audit_exclude_actions
          ? JSON.parse(configs.audit_exclude_actions)
          : ['syncCookies', 'unreadCounts', 'listByUser', 'listMeta', 'listAccessible', 'listMine', 'check'];
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
        audit_exclude_collections: auditExcludeCols,
        audit_exclude_actions: auditExcludeActs,
        audit_ignore_readonly_post: configs.audit_ignore_readonly_post !== 'false',
        audit_zero_diff_skip: configs.audit_zero_diff_skip !== 'false',
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
        audit_exclude_collections: JSON.stringify(values.audit_exclude_collections || []),
        audit_exclude_actions: JSON.stringify(values.audit_exclude_actions || []),
        audit_ignore_readonly_post: String(values.audit_ignore_readonly_post),
        audit_zero_diff_skip: String(values.audit_zero_diff_skip),
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

  // 5. 启动带实时进度条的分批极速清理
  const startCleanWithProgress = async (collectionName: string, days?: number) => {
    cancelCleanRef.current = false;
    setCleanStatus('running');
    setCleanErrorMsg('');
    setProgressVisible(true);

    const isExpired = Boolean(days && Number(days) > 0);
    const modeTitle = isExpired
      ? `清理「${collectionName}」${days} 天前历史数据`
      : `清空「${collectionName}」全部数据`;
    setProgressTitle(modeTitle);

    const queryParams: Record<string, any> = { collectionName };
    if (isExpired) {
      queryParams.days = Number(days);
    }

    try {
      // 1. 获取待清理记录总数
      const totalRes = await api.request({
        url: 'loggerPro:getCleanTotalCount',
        params: queryParams,
      });
      const total = Number(totalRes?.data?.data?.totalCount ?? totalRes?.data?.totalCount ?? 0);
      setTotalToClean(total);
      setCleanedCount(0);
      setRemainingCount(total);

      if (total === 0) {
        if (!isExpired) {
          // 清空模式下做一次兜底清空
          await api.request({
            url: 'loggerPro:cleanTableData',
            params: { collectionName },
            data: { collectionName },
          });
        }
        setCleanStatus('completed');
        message.success(`${modeTitle} 已完成！`);
        fetchStorageStats();
        return;
      }

      // 2. 分批流式循环清理（每批 20,000 条极速清除）
      let currentRemaining = total;
      const batchLimit = 20000;

      while (currentRemaining > 0 && !cancelCleanRef.current) {
        const batchRes = await api.request({
          url: 'loggerPro:cleanBatch',
          params: { ...queryParams, limit: batchLimit },
          data: { ...queryParams, limit: batchLimit },
        });

        const newRemaining = Number(
          batchRes?.data?.data?.remainingCount ?? batchRes?.data?.remainingCount ?? 0
        );

        // 如果后端记录数未发生变化（例如全量清空已完毕），尝试兜底结束
        if (newRemaining >= currentRemaining) {
          if (!isExpired) {
            await api.request({
              url: 'loggerPro:cleanTableData',
              params: { collectionName },
              data: { collectionName },
            });
          }
          setCleanedCount(total);
          setRemainingCount(0);
          break;
        }

        currentRemaining = newRemaining;
        const currentCleaned = Math.max(total - currentRemaining, 0);
        setCleanedCount(currentCleaned);
        setRemainingCount(currentRemaining);

        if (currentRemaining <= 0) break;
      }

      if (cancelCleanRef.current) {
        setCleanStatus('stopped');
        message.warning('已暂停清理，已处理的数据已生效');
      } else {
        setCleanStatus('completed');
        message.success(`${modeTitle} 完成！`);
      }

      fetchStorageStats();
    } catch (err: any) {
      setCleanStatus('error');
      setCleanErrorMsg(err.message || '清理异常中断');
      message.error(`清理异常: ${err.message}`);
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
          <Space size="small">
            {rec.collection === 'logger_audit_logs' && (
              <Popconfirm
                title="清理 15 天前旧数据"
                description="将保留最近 15 天内的审计记录，物理清理 15 天前的历史数据以释放空间。"
                onConfirm={() => startCleanWithProgress('logger_audit_logs', 15)}
                okText="立即清理"
                cancelText="取消"
              >
                <Button size="small" type="link">
                  清理15天前数据
                </Button>
              </Popconfirm>
            )}
            <Popconfirm
              title={`确定清空「${rec.title}」的所有数据？`}
              description="清空后历史数据不可恢复，请谨慎操作。"
              onConfirm={() => startCleanWithProgress(rec.collection)}
              okText="确定清空"
              cancelText="取消"
            >
              <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                清空全部
              </Button>
            </Popconfirm>
          </Space>
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
            <Card size="small" title="操作与变更审计配置 (Audit Trail Configuration)" bordered>
              <Row gutter={[16, 12]}>
                <Col xs={24} md={6}>
                  <Form.Item
                    name="audit_log_enabled"
                    label="开启全链路操作审计"
                    valuePropName="checked"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={6}>
                  <Form.Item
                    name="audit_record_diff"
                    label="记录变更前/后快照与Diff对比"
                    valuePropName="checked"
                    tooltip="启用后将在更新和删除时自动记录字段变更前后对比，并自动瘦身超长文本与Base64媒体。"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={6}>
                  <Form.Item
                    name="audit_ignore_readonly_post"
                    label="智能过滤只读/心跳 POST (推荐)"
                    valuePropName="checked"
                    tooltip="自动过滤以 list/get/find/check/sync/count/unread 等命名的只读心跳请求，防止审计表被系统轮询刷屏暴涨。"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={6}>
                  <Form.Item
                    name="audit_zero_diff_skip"
                    label="忽略无字段变动的更新 (推荐)"
                    valuePropName="checked"
                    tooltip="当修改前与修改后数据完全一致时，自动跳过审计存储，避免产生空更新冗余日志。"
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    name="audit_exclude_collections"
                    label="排除审计的数据表/集合 (Exclude Collections)"
                    tooltip="配置在此列表中的数据表变更将不会被记录。可勾选系统表或手动输入自定义集合名称。"
                  >
                    <Select
                      mode="tags"
                      allowClear
                      placeholder="选择或输入排除的数据表名称"
                      style={{ width: '100%' }}
                      options={excludeCollectionOptions}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    name="audit_exclude_actions"
                    label="排除审计的操作动作 (Exclude Actions)"
                    tooltip="配置在此列表中的 Action 操作将直接跳过审计记录，已为您预设常用只读与心跳动作中文说明。"
                  >
                    <Select
                      mode="tags"
                      allowClear
                      placeholder="选择或输入需要忽略的 Action 操作名称"
                      style={{ width: '100%' }}
                      options={excludeActionOptions}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24}>
                  <Form.Item
                    name="audit_collections"
                    label="重点审计白名单 (选填)"
                    tooltip="留空则采用排除黑名单模式（审计除排除表外的所有业务表）；若指定了白名单，则仅审计白名单中的数据表。"
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="全部业务数据表 (默认模式，通过上方排除项进行精细控制)"
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

      {/* 数据清理与清空实时进度弹窗 */}
      <Modal
        title={
          <Space>
            {cleanStatus === 'running' && <LoadingOutlined style={{ color: '#1890ff' }} />}
            {cleanStatus === 'completed' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
            {cleanStatus === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
            <span style={{ fontWeight: 600 }}>{progressTitle || '数据清理进度'}</span>
          </Space>
        }
        open={progressVisible}
        closable={cleanStatus !== 'running'}
        maskClosable={false}
        footer={[
          cleanStatus === 'running' && (
            <Button
              key="cancel"
              danger
              onClick={() => {
                cancelCleanRef.current = true;
              }}
            >
              暂停 / 中止清理
            </Button>
          ),
          cleanStatus !== 'running' && (
            <Button
              key="close"
              type="primary"
              onClick={() => {
                setProgressVisible(false);
              }}
            >
              完成并关闭
            </Button>
          ),
        ].filter(Boolean)}
        width={560}
      >
        <div style={{ padding: '12px 0' }}>
          {/* 进度条 */}
          <div style={{ marginBottom: 20 }}>
            <Progress
              percent={
                totalToClean > 0
                  ? Math.min(Math.round((cleanedCount / totalToClean) * 100), 100)
                  : cleanStatus === 'completed'
                  ? 100
                  : 0
              }
              status={
                cleanStatus === 'completed'
                  ? 'success'
                  : cleanStatus === 'error'
                  ? 'exception'
                  : cleanStatus === 'stopped'
                  ? 'normal'
                  : 'active'
              }
              strokeColor={{
                '0%': '#1890ff',
                '100%': '#52c41a',
              }}
              strokeWidth={12}
            />
          </div>

          {/* 核心指标看板 */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: '#f5f5f5' }}>
                <Statistic
                  title="待清理总量"
                  value={totalToClean}
                  formatter={(val) => Number(val).toLocaleString() + ' 行'}
                  valueStyle={{ fontSize: 16, fontWeight: 600 }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: '#f6ffed', borderColor: '#b7eb8f' }}>
                <Statistic
                  title="已成功清理"
                  value={cleanedCount}
                  formatter={(val) => Number(val).toLocaleString() + ' 行'}
                  valueStyle={{ fontSize: 16, fontWeight: 600, color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: '#e6f7ff', borderColor: '#91d5ff' }}>
                <Statistic
                  title="剩余待处理"
                  value={remainingCount}
                  formatter={(val) => Number(val).toLocaleString() + ' 行'}
                  valueStyle={{ fontSize: 16, fontWeight: 600, color: '#1890ff' }}
                />
              </Card>
            </Col>
          </Row>

          {/* 提示信息 */}
          {cleanStatus === 'running' && (
            <Alert
              message="正在分批极速清理中..."
              description="系统采用 20,000 条/批次流水线式清除，零主线程阻塞，请稍候。"
              type="info"
              showIcon
            />
          )}

          {cleanStatus === 'completed' && (
            <Alert
              message="数据清理已全部完成！"
              description={`共释放历史审计记录 ${cleanedCount.toLocaleString()} 行，空间统计数据已自动刷新。`}
              type="success"
              showIcon
            />
          )}

          {cleanStatus === 'stopped' && (
            <Alert
              message="清理操作已由用户手动中止"
              description={`已处理的 ${cleanedCount.toLocaleString()} 行数据已成功释放。`}
              type="warning"
              showIcon
            />
          )}

          {cleanStatus === 'error' && (
            <Alert
              message="清理过程中遇到异常"
              description={cleanErrorMsg || '网络或数据库繁忙，请稍后重试。'}
              type="error"
              showIcon
            />
          )}
        </div>
      </Modal>
    </div>
  );
};
