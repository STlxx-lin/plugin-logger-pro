import React, { useState, useEffect } from 'react';
import {
  Card,
  Input,
  Button,
  Space,
  Table,
  Tag,
  Row,
  Col,
  Empty,
  Spin,
  Alert,
  Descriptions,
  Timeline,
  Collapse,
  message,
  Typography,
} from 'antd';
import {
  DeploymentUnitOutlined,
  SearchOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  ApiOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';

const { Text } = Typography;

export const TraceTab: React.FC = () => {
  const api = useAPIClient();
  const [reqIdInput, setReqIdInput] = useState('');
  const [currentReqId, setCurrentReqId] = useState<string | null>(null);

  // 最近请求列表
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentTraces, setRecentTraces] = useState<any[]>([]);

  // 当前请求追踪数据
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceData, setTraceData] = useState<any>(null);

  // 加载最近请求
  const fetchRecentTraces = async () => {
    setRecentLoading(true);
    try {
      const res = await api.request({
        url: 'loggerPro:getRecentTraces',
        params: { limit: 20 },
      });
      const list = res?.data?.data || res?.data || [];
      setRecentTraces(list);
      // 如果还没有选中的 reqId，且最近列表有数据，默认选中第一条
      if (!currentReqId && list.length > 0) {
        handleSelectReqId(list[0].reqId);
      }
    } catch {} finally {
      setRecentLoading(false);
    }
  };

  // 获取特定 reqId 的全链路详情
  const fetchTraceDetail = async (id: string) => {
    if (!id.trim()) return;
    setTraceLoading(true);
    setCurrentReqId(id.trim());
    try {
      const res = await api.request({
        url: 'loggerPro:getTrace',
        params: { reqId: id.trim() },
      });
      setTraceData(res?.data?.data || res?.data || null);
    } catch (err: any) {
      message.error(`获取全链路追踪数据失败: ${err.message}`);
      setTraceData(null);
    } finally {
      setTraceLoading(false);
    }
  };

  useEffect(() => {
    fetchRecentTraces();
  }, []);

  const handleSearch = () => {
    if (!reqIdInput.trim()) {
      message.warning('请输入要追踪的 Request ID (reqId)');
      return;
    }
    fetchTraceDetail(reqIdInput.trim());
  };

  const handleSelectReqId = (id?: string) => {
    if (!id || !id.trim()) {
      message.warning('该请求未包含有效的 Request ID');
      return;
    }
    setReqIdInput(id.trim());
    fetchTraceDetail(id.trim());
  };

  const getMethodColor = (method?: string) => {
    const m = (method || '').toUpperCase();
    if (m === 'GET') return 'blue';
    if (m === 'POST') return 'green';
    if (m === 'PUT' || m === 'PATCH') return 'orange';
    if (m === 'DELETE') return 'red';
    return 'default';
  };

  const getTimelineIcon = (type: string) => {
    switch (type) {
      case 'inbound':
        return <ApiOutlined style={{ fontSize: 16, color: '#1890ff' }} />;
      case 'sql':
        return <DatabaseOutlined style={{ fontSize: 16, color: '#722ed1' }} />;
      case 'audit':
        return <CheckCircleOutlined style={{ fontSize: 16, color: '#fa8c16' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ fontSize: 16, color: '#ff4d4f' }} />;
      case 'outbound':
        return <ClockCircleOutlined style={{ fontSize: 16, color: '#52c41a' }} />;
      default:
        return <FileTextOutlined style={{ fontSize: 14, color: '#8c8c8c' }} />;
    }
  };

  const getTimelineColor = (type: string) => {
    switch (type) {
      case 'inbound':
        return 'blue';
      case 'sql':
        return '#722ed1';
      case 'audit':
        return 'orange';
      case 'error':
        return 'red';
      case 'outbound':
        return 'green';
      default:
        return 'gray';
    }
  };

  const summary = traceData?.summary || {};
  const timeline = traceData?.timeline || [];
  const rawLogs = traceData?.rawLogs || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1. 顶部搜索栏 */}
      <Card bordered size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Space size="middle" style={{ flex: 1, maxWidth: 600 }}>
            <Input
              prefix={<DeploymentUnitOutlined style={{ color: '#1890ff' }} />}
              placeholder="输入或粘贴请求 ID (如: 744b19de-4e87-44d9-9ce9-1c97240d8f09)"
              value={reqIdInput}
              onChange={(e) => setReqIdInput(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={traceLoading}>
              追踪请求
            </Button>
          </Space>

          <Button icon={<ReloadOutlined />} onClick={fetchRecentTraces} loading={recentLoading}>
            刷新最近请求
          </Button>
        </div>
      </Card>

      {/* 2. 主体左右分栏 */}
      <Row gutter={16}>
        {/* 左侧：最近请求点选列表 */}
        <Col xs={24} lg={8}>
          <Card
            bordered
            size="small"
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <ClockCircleOutlined style={{ color: '#1890ff' }} />
                  <strong>最近 API 请求列表</strong>
                </Space>
                <span style={{ fontSize: 12, color: '#8c8c8c' }}>点击快速追踪</span>
              </div>
            }
            bodyStyle={{ padding: 0 }}
          >
            <Table
              rowKey="reqId"
              size="small"
              loading={recentLoading}
              dataSource={recentTraces}
              pagination={{ pageSize: 8, size: 'small', showTotal: (t) => `共 ${t} 条` }}
              rowClassName={(r) => (r.reqId === currentReqId ? 'ant-table-row-selected' : '')}
              onRow={(record) => ({
                onClick: () => handleSelectReqId(record.reqId),
                style: { cursor: 'pointer' },
              })}
              columns={[
                {
                  title: '请求信息',
                  dataIndex: 'path',
                  render: (path, r) => (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <Tag color={getMethodColor(r.method)} style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                          {r.method}
                        </Tag>
                        <span style={{ fontWeight: 600, fontSize: 12, color: '#262626' }}>
                          {r.collectionName || path || '-'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace' }}>
                        {r.reqId?.slice(0, 16)}...
                      </div>
                    </div>
                  ),
                },
                {
                  title: '状态/耗时',
                  dataIndex: 'statusCode',
                  width: 90,
                  render: (code, r) => (
                    <div style={{ textAlign: 'right' }}>
                      <Tag color={code < 400 ? 'green' : 'red'} style={{ margin: 0, fontSize: 10 }}>
                        {code}
                      </Tag>
                      <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
                        {r.durationMs || 0}ms
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        {/* 右侧：全链路生命周期瀑布流 */}
        <Col xs={24} lg={16}>
          <Spin spinning={traceLoading}>
            {currentReqId && traceData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* A. 请求概要 */}
                <Card size="small" bordered style={{ backgroundColor: '#fafafa' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Space wrap>
                      {summary.method && (
                        <Tag color={getMethodColor(summary.method)} style={{ fontWeight: 600, fontSize: 13 }}>
                          {summary.method}
                        </Tag>
                      )}
                      <code style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>{summary.path || '(无对应路径)'}</code>
                      {summary.statusCode !== undefined && (
                        <Tag color={summary.statusCode < 400 ? 'success' : 'error'} style={{ fontWeight: 600 }}>
                          HTTP {summary.statusCode}
                        </Tag>
                      )}
                      {summary.durationMs !== undefined && (
                        <Tag color={summary.durationMs > 1000 ? 'red' : summary.durationMs > 500 ? 'orange' : 'cyan'}>
                          ⏱️ {summary.durationMs} ms
                        </Tag>
                      )}
                    </Space>
                  </div>

                  <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
                    <Descriptions.Item label="ReqId" span={3}>
                      <Text copyable style={{ fontSize: 12, fontFamily: 'monospace' }}>{currentReqId}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="操作用户">{summary.username || 'Anonymous'}</Descriptions.Item>
                    <Descriptions.Item label="客户端 IP">{summary.ip || '-'}</Descriptions.Item>
                    <Descriptions.Item label="目标数据表">{summary.collectionName || '-'}</Descriptions.Item>
                    <Descriptions.Item label="操作动作">{summary.actionName || '-'}</Descriptions.Item>
                    <Descriptions.Item label="发起时间" span={2}>
                      {summary.startTime ? new Date(summary.startTime).toLocaleString() : '-'}
                    </Descriptions.Item>
                  </Descriptions>

                  {summary.errorMessage && (
                    <Alert
                      type="error"
                      showIcon
                      message="异常报错信息"
                      description={summary.errorMessage}
                      style={{ marginTop: 12 }}
                    />
                  )}
                </Card>

                {/* B. 时序瀑布流 */}
                <Card
                  size="small"
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <DeploymentUnitOutlined style={{ color: '#1890ff' }} />
                      <strong>全生命周期时序瀑布流 (Trace Timeline)</strong>
                      <Tag color="blue">{timeline.length} 个事件节点</Tag>
                    </div>
                  }
                >
                  {timeline.length > 0 ? (
                    <Timeline style={{ marginTop: 16 }}>
                      {timeline.map((event: any, idx: number) => (
                        <Timeline.Item
                          key={idx}
                          dot={getTimelineIcon(event.type)}
                          color={getTimelineColor(event.type)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <span style={{ fontWeight: 600, fontSize: 13, color: '#262626' }}>{event.title}</span>
                              {event.durationMs !== undefined && (
                                <Tag color="purple" style={{ marginLeft: 8, fontSize: 11 }}>
                                  {event.durationMs} ms
                                </Tag>
                              )}
                            </div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{event.time}</span>
                          </div>

                          {event.detail && (
                            <div style={{ marginTop: 6 }}>
                              {event.type === 'sql' ? (
                                <pre
                                  style={{
                                    backgroundColor: '#141414',
                                    color: '#9cdcfe',
                                    padding: '8px 12px',
                                    borderRadius: 4,
                                    fontFamily: 'Consolas, Monaco, monospace',
                                    fontSize: 12,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all',
                                    margin: 0,
                                  }}
                                >
                                  {event.detail}
                                </pre>
                              ) : event.type === 'error' ? (
                                <pre
                                  style={{
                                    backgroundColor: '#fff1f0',
                                    color: '#cf1322',
                                    padding: '8px 12px',
                                    borderRadius: 4,
                                    fontSize: 12,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all',
                                    margin: 0,
                                    border: '1px solid #ffa39e',
                                  }}
                                >
                                  {event.detail}
                                </pre>
                              ) : (
                                <div style={{ fontSize: 12, color: '#595959' }}>{event.detail}</div>
                              )}
                            </div>
                          )}

                          {event.extra && Object.keys(event.extra).length > 0 && (
                            <Collapse ghost size="small" style={{ marginTop: 6 }}>
                              <Collapse.Panel header="查看关联参数与快照数据" key="1">
                                <pre
                                  style={{
                                    backgroundColor: '#f5f5f5',
                                    padding: 8,
                                    borderRadius: 4,
                                    fontSize: 11,
                                    maxHeight: 200,
                                    overflow: 'auto',
                                    margin: 0,
                                  }}
                                >
                                  {JSON.stringify(event.extra, null, 2)}
                                </pre>
                              </Collapse.Panel>
                            </Collapse>
                          )}
                        </Timeline.Item>
                      ))}
                    </Timeline>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 24, color: '#8c8c8c' }}>
                      未检索到与该 ReqId 相关的详细时序节点
                    </div>
                  )}
                </Card>

                {/* C. 原始文本日志 */}
                <Card
                  size="small"
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileTextOutlined style={{ color: '#52c41a' }} />
                      <strong>关联原始文本日志 (Raw Logs)</strong>
                      <Tag color="green">{rawLogs.length} 行</Tag>
                    </div>
                  }
                >
                  {rawLogs.length > 0 ? (
                    <div
                      style={{
                        backgroundColor: '#1e1e1e',
                        color: '#d4d4d4',
                        padding: 12,
                        borderRadius: 6,
                        fontFamily: 'Consolas, Monaco, monospace',
                        fontSize: 12,
                        lineHeight: '20px',
                        maxHeight: 300,
                        overflow: 'auto',
                      }}
                    >
                      {rawLogs.map((log: any, idx: number) => {
                        let levelColor = '#4ec9b0';
                        if (log.level === 'error') levelColor = '#f14c4c';
                        else if (log.level === 'warn') levelColor = '#cca700';
                        else if (log.level === 'debug') levelColor = '#569cd6';

                        return (
                          <div key={idx} style={{ marginBottom: 6, wordBreak: 'break-all' }}>
                            <span style={{ color: '#858585', marginRight: 8 }}>[{log.file}]</span>
                            <span style={{ color: levelColor, marginRight: 8, fontWeight: 600 }}>
                              [{log.level?.toUpperCase()}]
                            </span>
                            <span>{log.line}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 16, color: '#8c8c8c', fontSize: 12 }}>
                      暂未在近期日志文件中匹配到关联行
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <Card bordered style={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="请在上方输入 Request ID，或点击左侧最近请求列表查看全链路生命周期追踪" />
              </Card>
            )}
          </Spin>
        </Col>
      </Row>
    </div>
  );
};
