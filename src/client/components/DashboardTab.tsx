import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Table, Progress, Button, Tag, Space, Alert, Empty, Modal, Tooltip, message } from 'antd';
import {
  LineChartOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  HddOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  UserOutlined,
  DatabaseOutlined,
  CopyOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';

export const DashboardTab: React.FC = () => {
  const api = useAPIClient();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [viewingSql, setViewingSql] = useState<{ sql: string; durationMs: number; time: string } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.request({
        url: 'loggerPro:dashboard',
      });
      setData(res?.data?.data || res?.data);
    } catch (err: any) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const summary = data?.summary || {};
  const trend = data?.trend || [];
  const categoryStats = data?.categoryStats || [];
  const topSlowQueries = data?.topSlowQueries || [];
  const topUsers = data?.topUsers || [];
  const topCollections = data?.topCollections || [];

  const maxTrendVal = Math.max(...trend.map((t: any) => Math.max(t.requests || 0, t.errors || 0)), 10);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 顶部操作区 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <span style={{ fontSize: 16, fontWeight: 600 }}>📊 运维与性能概览</span>
          <Tag color="processing">实时数据聚合</Tag>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
          刷新指标
        </Button>
      </div>

      {/* 统计指标卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <Card bordered hoverable style={{ background: 'linear-gradient(135deg, #e6f7ff 0%, #ffffff 100%)' }}>
            <Statistic
              title={<span style={{ fontWeight: 500 }}><LineChartOutlined /> 今日操作审计量</span>}
              value={summary.todayAuditCount ?? 0}
              valueStyle={{ color: '#1890ff', fontWeight: 'bold' }}
              suffix={<span style={{ fontSize: 13, color: '#8c8c8c' }}>/ 累计 {summary.totalAuditCount ?? 0}</span>}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered hoverable style={{ background: 'linear-gradient(135deg, #fff1f0 0%, #ffffff 100%)' }}>
            <Statistic
              title={<span style={{ fontWeight: 500 }}><ExclamationCircleOutlined /> 今日异常错误数</span>}
              value={summary.todayErrorCount ?? 0}
              valueStyle={{ color: summary.todayErrorCount > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}
              suffix={<span style={{ fontSize: 13, color: '#8c8c8c' }}>次</span>}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered hoverable style={{ background: 'linear-gradient(135deg, #f6ffed 0%, #ffffff 100%)' }}>
            <Statistic
              title={<span style={{ fontWeight: 500 }}><FileTextOutlined /> 今日告警触发</span>}
              value={summary.todayAlertCount ?? 0}
              valueStyle={{ color: summary.todayAlertCount > 0 ? '#faad14' : '#52c41a', fontWeight: 'bold' }}
              suffix={<span style={{ fontSize: 13, color: '#8c8c8c' }}>次</span>}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered hoverable style={{ background: 'linear-gradient(135deg, #f9f0ff 0%, #ffffff 100%)' }}>
            <Statistic
              title={<span style={{ fontWeight: 500 }}><HddOutlined /> 日志磁盘占用</span>}
              value={summary.totalDiskFormatted ?? '0 MB'}
              valueStyle={{ color: '#722ed1', fontWeight: 'bold' }}
              suffix={<span style={{ fontSize: 13, color: '#8c8c8c' }}>({summary.totalLogFiles ?? 0} 个文件)</span>}
            />
          </Card>
        </Col>
      </Row>

      {/* 近 7 天请求趋势与日志分类占比 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="📈 近 7 天请求量与异常走势" bordered>
            {trend.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontSize: 12 }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#1890ff', borderRadius: 2, marginRight: 4 }} /> 操作请求量</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#ff4d4f', borderRadius: 2, marginRight: 4 }} /> 异常错误量</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', height: 180, gap: 12, paddingBottom: 24, borderBottom: '1px solid #f0f0f0' }}>
                  {trend.map((item: any, idx: number) => {
                    const reqHeight = Math.max((item.requests / maxTrendVal) * 130, 6);
                    const errHeight = Math.max((item.errors / maxTrendVal) * 130, item.errors > 0 ? 6 : 0);
                    return (
                      <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', width: '100%', justifyContent: 'center' }}>
                          <div
                            title={`请求: ${item.requests}`}
                            style={{
                              width: '40%',
                              height: reqHeight,
                              background: '#1890ff',
                              borderRadius: '4px 4px 0 0',
                              transition: 'height 0.3s',
                            }}
                          />
                          <div
                            title={`错误: ${item.errors}`}
                            style={{
                              width: '40%',
                              height: errHeight,
                              background: '#ff4d4f',
                              borderRadius: '4px 4px 0 0',
                              transition: 'height 0.3s',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 11, color: '#8c8c8c', marginTop: 6 }}>{item.date}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <Empty description="暂无趋势数据" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="📁 日志分类磁盘分布" bordered>
            {categoryStats.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {categoryStats.map((item: any, idx: number) => {
                  const total = summary.totalDiskBytes || 1;
                  const percent = Math.round((item.value / total) * 100);
                  const colors = ['#1890ff', '#52c41a', '#faad14', '#ff4d4f', '#722ed1'];
                  const color = colors[idx % colors.length];
                  return (
                    <div key={idx}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                        <span style={{ fontWeight: 500 }}>{item.name} 日志</span>
                        <span style={{ color: '#8c8c8c' }}>{item.formatted} ({percent}%)</span>
                      </div>
                      <Progress percent={percent} strokeColor={color} showInfo={false} size="small" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty description="暂无分类数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 慢 SQL 与高频分析 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ClockCircleOutlined style={{ color: '#faad14' }} />
                <span>Top 慢 SQL 查询监控 (运行时捕获)</span>
              </div>
            }
            bordered
          >
            <Table
              size="small"
              rowKey={(r, idx) => String(idx)}
              dataSource={topSlowQueries}
              pagination={false}
              columns={[
                {
                  title: '耗时',
                  dataIndex: 'durationMs',
                  width: 90,
                  render: (v) => <Tag color={v > 1000 ? 'red' : 'orange'}>{v} ms</Tag>,
                },
                {
                  title: 'SQL 语句',
                  dataIndex: 'sql',
                  ellipsis: true,
                  render: (sql, record: any) => (
                    <Tooltip title={sql} placement="topLeft">
                      <span
                        style={{
                          cursor: 'pointer',
                          fontFamily: 'Consolas, Monaco, monospace',
                          fontSize: 12,
                          color: '#0958d9',
                        }}
                        onClick={() =>
                          setViewingSql({
                            sql: record.sql,
                            durationMs: record.durationMs,
                            time: record.time,
                          })
                        }
                      >
                        <code>{sql}</code>
                      </span>
                    </Tooltip>
                  ),
                },
                {
                  title: '发生时间',
                  dataIndex: 'time',
                  width: 110,
                  render: (t) => (t ? new Date(t).toLocaleTimeString() : '-'),
                },
                {
                  title: '操作',
                  key: 'action',
                  width: 70,
                  render: (_: any, record: any) => (
                    <Button
                      type="link"
                      size="small"
                      icon={<CodeOutlined />}
                      onClick={() =>
                        setViewingSql({
                          sql: record.sql,
                          durationMs: record.durationMs,
                          time: record.time,
                        })
                      }
                    >
                      详情
                    </Button>
                  ),
                },
              ]}
              locale={{ emptyText: '暂无慢 SQL 记录（系统运行流畅）' }}
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <UserOutlined style={{ color: '#1890ff' }} />
                <span>活跃操作榜单 (近 7 天)</span>
              </div>
            }
            bordered
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h5 style={{ margin: '0 0 8px 0', color: '#595959' }}>👤 活跃用户 Top 5</h5>
                <Space wrap direction="horizontal">
                  {topUsers.length > 0 ? (
                    topUsers.map((u: any, idx: number) => (
                      <Tag key={idx} color={idx === 0 ? 'gold' : 'blue'}>
                        {u.username}: <strong>{u.count}</strong> 次操作
                      </Tag>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>暂无操作记录</span>
                  )}
                </Space>
              </div>

              <div>
                <h5 style={{ margin: '0 0 8px 0', color: '#595959' }}><DatabaseOutlined /> 高频变更数据表 Top 5</h5>
                <Space wrap direction="horizontal">
                  {topCollections.length > 0 ? (
                    topCollections.map((c: any, idx: number) => (
                      <Tag key={idx} color="purple">
                        {c.collection}: <strong>{c.count}</strong> 次变更
                      </Tag>
                    ))
                  ) : (
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>暂无变更记录</span>
                  )}
                </Space>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
      {/* 慢 SQL 详情 Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClockCircleOutlined style={{ color: '#faad14' }} />
            <span>慢 SQL 查询详情</span>
            {viewingSql && (
              <Tag color={viewingSql.durationMs > 1000 ? 'red' : 'orange'}>
                耗时: {viewingSql.durationMs} ms
              </Tag>
            )}
          </div>
        }
        open={!!viewingSql}
        onCancel={() => setViewingSql(null)}
        width={720}
        footer={[
          <Button
            key="copy"
            icon={<CopyOutlined />}
            onClick={() => {
              if (viewingSql?.sql) {
                navigator.clipboard.writeText(viewingSql.sql);
                message.success('SQL 语句已复制到剪贴板');
              }
            }}
          >
            复制 SQL
          </Button>,
          <Button key="close" type="primary" onClick={() => setViewingSql(null)}>
            关闭
          </Button>,
        ]}
      >
        {viewingSql && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
              发生时间: {new Date(viewingSql.time).toLocaleString()}
            </div>
            <pre
              style={{
                backgroundColor: '#141414',
                color: '#d4d4d4',
                padding: 16,
                borderRadius: 6,
                fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                fontSize: 13,
                lineHeight: '22px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: '50vh',
                overflowY: 'auto',
                border: '1px solid #303030',
              }}
            >
              {viewingSql.sql}
            </pre>
          </div>
        )}
      </Modal>
    </div>
  );
};
