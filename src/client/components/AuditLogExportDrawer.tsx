import React, { useState } from 'react';
import {
  Drawer,
  Form,
  Radio,
  Select,
  Input,
  Checkbox,
  Button,
  Space,
  Divider,
  Tag,
  message,
  Card,
  Row,
  Col,
} from 'antd';
import {
  ExportOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  CalendarOutlined,
  FilterOutlined,
  CheckSquareOutlined,
  CloseSquareOutlined,
} from '@ant-design/icons';
import { useLoggerProAPI } from '../context/LoggerProContext';

export interface AuditLogExportDrawerProps {
  visible: boolean;
  onClose: () => void;
  collections?: Array<{ name: string; title: string }>;
}

const EXPORT_FIELD_OPTIONS = [
  { label: '发生时间 (createdAt)', value: 'createdAt' },
  { label: '请求ID (reqId)', value: 'reqId' },
  { label: '操作用户名 (username)', value: 'username' },
  { label: '用户ID (userId)', value: 'userId' },
  { label: '客户端IP (ip)', value: 'ip' },
  { label: '请求方法 (method)', value: 'method' },
  { label: '请求路径 (path)', value: 'path' },
  { label: '数据表 (collectionName)', value: 'collectionName' },
  { label: '操作动作 (actionName)', value: 'actionName' },
  { label: '目标记录ID (recordId)', value: 'recordId' },
  { label: '状态码 (statusCode)', value: 'statusCode' },
  { label: '响应耗时 (durationMs)', value: 'durationMs' },
  { label: '变更字段摘要 (diffSummary)', value: 'diffSummary' },
  { label: '变更前快照 (previousData)', value: 'previousData' },
  { label: '变更后快照 (newData)', value: 'newData' },
];

const DEFAULT_FIELDS = [
  'createdAt',
  'username',
  'ip',
  'collectionName',
  'actionName',
  'recordId',
  'statusCode',
  'durationMs',
  'diffSummary',
];

export const AuditLogExportDrawer: React.FC<AuditLogExportDrawerProps> = ({
  visible,
  onClose,
  collections = [],
}) => {
  const api = useLoggerProAPI();
  const [form] = Form.useForm();
  const [exporting, setExporting] = useState(false);

  // 表单状态
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [timeRangeType, setTimeRangeType] = useState<string>('7d');
  const [selectedFields, setSelectedFields] = useState<string[]>(DEFAULT_FIELDS);

  // 全选/反选
  const handleSelectAll = () => {
    setSelectedFields(EXPORT_FIELD_OPTIONS.map((o) => o.value));
  };
  const handleSelectDefault = () => {
    setSelectedFields(DEFAULT_FIELDS);
  };
  const handleClearAll = () => {
    setSelectedFields([]);
  };

  // 执行导出
  const handleExport = async () => {
    if (selectedFields.length === 0) {
      message.warning('请至少勾选一个导出字段');
      return;
    }

    try {
      const values = await form.validateFields();
      setExporting(true);

      // 计算时间过滤条件
      const filter: any = {};
      const now = new Date();

      if (timeRangeType === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filter.createdAt = { $gte: start.toISOString() };
      } else if (timeRangeType === '7d') {
        const start = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
        filter.createdAt = { $gte: start.toISOString() };
      } else if (timeRangeType === '30d') {
        const start = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        filter.createdAt = { $gte: start.toISOString() };
      }

      // 用户名过滤
      if (values.username && values.username.trim()) {
        filter.username = { $includes: values.username.trim() };
      }

      // 数据表过滤
      if (values.collectionName) {
        filter.collectionName = values.collectionName;
      }

      // 动作过滤
      if (values.actionName) {
        filter.actionName = values.actionName;
      }

      // 状态码过滤
      if (values.statusFilter === '2xx') {
        filter.statusCode = { $gte: 200, $lt: 300 };
      } else if (values.statusFilter === 'error') {
        filter.statusCode = { $gte: 400 };
      }

      const res = await api.request({
        url: 'loggerPro:exportAuditLogs',
        method: 'post',
        data: {
          format,
          limit: values.limit || 10000,
          fields: selectedFields,
          filter,
        },
        responseType: 'blob',
      });

      const blob = new Blob([res.data], {
        type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel;charset=utf-8',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      a.download = `audit_logs_${dateTag}_${Date.now()}.${format === 'csv' ? 'csv' : 'xls'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      message.success('🎉 审计日志已成功生成并开始下载！');
      onClose();
    } catch (err: any) {
      message.error(`导出失败: ${err.message || '网络或数据处理异常'}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ExportOutlined style={{ color: '#1890ff' }} />
          <span>审计日志与操作记录导出 (Audit Log Export)</span>
        </div>
      }
      open={visible}
      onClose={onClose}
      width={600}
      extra={
        <Space>
          <Button onClick={onClose} disabled={exporting}>
            取消
          </Button>
          <Button
            type="primary"
            icon={<ExportOutlined />}
            loading={exporting}
            onClick={handleExport}
          >
            开始导出并下载
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          limit: 10000,
          statusFilter: 'all',
        }}
      >
        {/* 1. 导出格式 */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Form.Item label={<strong>📄 导出文件格式</strong>} style={{ marginBottom: 0 }}>
            <Radio.Group value={format} onChange={(e) => setFormat(e.target.value)} buttonStyle="solid">
              <Radio.Button value="xlsx">
                <Space>
                  <FileExcelOutlined style={{ color: '#52c41a' }} />
                  <span>Excel 表格 (.xls / .xlsx)</span>
                </Space>
              </Radio.Button>
              <Radio.Button value="csv">
                <Space>
                  <FileTextOutlined style={{ color: '#1890ff' }} />
                  <span>CSV 文件 (带 UTF-8 BOM)</span>
                </Space>
              </Radio.Button>
            </Radio.Group>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>
              {format === 'xlsx'
                ? '推荐日常审计与办公汇报使用，内置表头蓝色高亮与自适应列宽。'
                : '推荐大数据分析平台、SIEM 安全中心对接或大容量数据快速传输使用。'}
            </div>
          </Form.Item>
        </Card>

        {/* 2. 时间跨度范围 */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Form.Item label={<strong><CalendarOutlined /> 审计时间跨度</strong>} style={{ marginBottom: 0 }}>
            <Radio.Group
              value={timeRangeType}
              onChange={(e) => setTimeRangeType(e.target.value)}
              buttonStyle="solid"
              size="small"
            >
              <Radio.Button value="today">今日记录</Radio.Button>
              <Radio.Button value="7d">近 7 天</Radio.Button>
              <Radio.Button value="30d">近 30 天</Radio.Button>
              <Radio.Button value="all">全部历史时间</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Card>

        {/* 3. 数据过滤筛选条件 */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>
            <FilterOutlined /> 数据过滤条件 (可选)
          </div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="username" label="操作用户名">
                <Input placeholder="输入用户名模糊搜索" allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="collectionName" label="目标数据表">
                <Select
                  placeholder="选择特定数据表"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={collections.map((c) => ({
                    label: `${c.title} (${c.name})`,
                    value: c.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="actionName" label="操作动作类型">
                <Select placeholder="选择动作" allowClear>
                  <Select.Option value="create">创建 (create)</Select.Option>
                  <Select.Option value="update">更新 (update)</Select.Option>
                  <Select.Option value="destroy">删除 (destroy)</Select.Option>
                  <Select.Option value="get">查看 (get/list)</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="statusFilter" label="响应状态">
                <Select>
                  <Select.Option value="all">全部状态</Select.Option>
                  <Select.Option value="2xx">仅成功 (2xx)</Select.Option>
                  <Select.Option value="error">仅异常报错 (4xx / 5xx)</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="limit" label="最大导出记录上限" style={{ marginBottom: 0 }}>
                <Select>
                  <Select.Option value={1000}>1,000 条 (快速)</Select.Option>
                  <Select.Option value={5000}>5,000 条</Select.Option>
                  <Select.Option value={10000}>10,000 条 (标准合规)</Select.Option>
                  <Select.Option value={50000}>50,000 条 (最大)</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 4. 自定义导出字段 */}
        <Card size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong><CheckSquareOutlined /> 自定义导出字段 ({selectedFields.length}/{EXPORT_FIELD_OPTIONS.length})</strong>
            <Space size="small">
              <Button size="small" type="link" onClick={handleSelectAll}>
                全选
              </Button>
              <Button size="small" type="link" onClick={handleSelectDefault}>
                默认字段
              </Button>
              <Button size="small" type="link" danger onClick={handleClearAll}>
                清空
              </Button>
            </Space>
          </div>

          <Checkbox.Group
            value={selectedFields}
            onChange={(vals) => setSelectedFields(vals as string[])}
            style={{ width: '100%' }}
          >
            <Row gutter={[8, 8]}>
              {EXPORT_FIELD_OPTIONS.map((opt) => (
                <Col span={12} key={opt.value}>
                  <Checkbox value={opt.value}>{opt.label}</Checkbox>
                </Col>
              ))}
            </Row>
          </Checkbox.Group>
        </Card>
      </Form>
    </Drawer>
  );
};
