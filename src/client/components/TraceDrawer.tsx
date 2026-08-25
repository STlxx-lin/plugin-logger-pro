import React, { useState, useEffect } from 'react';
import {
  Drawer,
  Spin,
  Alert,
  Card,
  Tag,
  Descriptions,
  Timeline,
  Collapse,
  Space,
  Button,
  message,
  Typography,
} from 'antd';
import {
  DeploymentUnitOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  ExclamationCircleOutlined,
  ApiOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';
import { AILogAnalysisDrawer } from './AILogAnalysisDrawer';

const { Text } = Typography;

export interface TraceDrawerProps {
  visible: boolean;
  reqId: string | null;
  onClose: () => void;
}

export const TraceDrawer: React.FC<TraceDrawerProps> = ({ visible, reqId, onClose }) => {
  const api = useAPIClient();
  const [loading, setLoading] = useState(false);
  const [traceData, setTraceData] = useState<any>(null);
  const [aiDrawerVisible, setAiDrawerVisible] = useState(false);

  const fetchTrace = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.request({
        url: 'loggerPro:getTrace',
        params: { reqId: id },
      });
      setTraceData(res?.data?.data || res?.data || null);
    } catch (err: any) {
      message.error(`获取全链路追踪数据失败: ${err.message}`);
      setTraceData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible && reqId) {
      fetchTrace(reqId);
    } else {
      setTraceData(null);
    }
  }, [visible, reqId]);

  const copyReqId = () => {
    if (reqId) {
      navigator.clipboard.writeText(reqId);
      message.success('ReqId 已复制到剪贴板');
    }
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
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <DeploymentUnitOutlined style={{ color: '#1890ff', fontSize: 18 }} />
            <span>全链路请求生命周期追踪 (Trace Timeline)</span>
          </Space>
          {reqId && (
            <Button size="small" icon={<CopyOutlined />} onClick={copyReqId}>
              复制 ReqId
            </Button>
          )}
        </div>
      }
      open={visible}
      onClose={onClose}
      width={780}
    >
      <Spin spinning={loading}>
        {reqId && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 1. 请求核心概要卡片 */}
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

                <Button
                  size="small"
                  type="primary"
                  style={{ backgroundColor: '#722ed1', borderColor: '#722ed1' }}
                  icon={<RobotOutlined />}
                  onClick={() => setAiDrawerVisible(true)}
                >
                  AI 根因诊断
                </Button>
              </div>

              <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
                <Descriptions.Item label="请求 ID (ReqId)" span={3}>
                  <Text copyable style={{ fontSize: 12, fontFamily: 'monospace' }}>{reqId}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="操作用户">{summary.username || 'Anonymous'}</Descriptions.Item>
                <Descriptions.Item label="客户端 IP">{summary.ip || '-'}</Descriptions.Item>
                <Descriptions.Item label="数据表/模块">{summary.collectionName || '-'}</Descriptions.Item>
                <Descriptions.Item label="操作动作">{summary.actionName || '-'}</Descriptions.Item>
                <Descriptions.Item label="发起时间" span={2}>
                  {summary.startTime ? new Date(summary.startTime).toLocaleString() : '-'}
                </Descriptions.Item>
              </Descriptions>

              {summary.errorMessage && (
                <Alert
                  type="error"
                  showIcon
                  message="请求执行异常报错"
                  description={summary.errorMessage}
                  style={{ marginTop: 12 }}
                />
              )}
            </Card>

            {/* 2. 时序瀑布流生命周期 */}
            <Card
              size="small"
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ClockCircleOutlined style={{ color: '#1890ff' }} />
                  <strong>时序事件瀑布流 (Timeline Events)</strong>
                  <Tag color="blue">{timeline.length} 个节点</Tag>
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

                      {/* 详细描述 */}
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
                            <div style={{ fontSize: 12, color: '#595959', lineHeight: '18px' }}>
                              {event.detail}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 附加快照展开 */}
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

            {/* 3. 关联的原始文本日志行 */}
            <Card
              size="small"
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileTextOutlined style={{ color: '#52c41a' }} />
                  <strong>跨文件关联原始文本日志 (Raw Logs)</strong>
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
        )}
      </Spin>

      {/* AI 错误与根因诊断抽屉 */}
      <AILogAnalysisDrawer
        visible={aiDrawerVisible}
        initialLogText={(() => {
          let text = `【全链路请求生命周期全景诊断】\n`;
          text += `- 接口路径: ${summary.method || 'GET'} ${summary.path || '-'}\n`;
          text += `- 请求状态: HTTP ${summary.statusCode ?? '-'} (耗时: ${summary.durationMs ?? '-'} ms)\n`;
          text += `- 请求 ID (ReqId): ${reqId}\n`;
          if (summary.username) text += `- 操作用户: ${summary.username} (客户端 IP: ${summary.ip || '-'})\n`;
          if (summary.collectionName) text += `- 关联数据表: ${summary.collectionName} (动作: ${summary.actionName || '-'})\n`;
          if (summary.errorMessage) text += `- 异常错误: ${summary.errorMessage}\n`;

          const sqlNodes = timeline.filter((t: any) => t.type === 'sql');
          if (sqlNodes.length > 0) {
            text += `\n【执行的 SQL 查询 (${sqlNodes.length} 条)】:\n` + sqlNodes.map((s: any, idx: number) => `${idx + 1}. [${s.time || ''}] ${s.detail}`).join('\n');
          }

          if (rawLogs && rawLogs.length > 0) {
            text += `\n\n【原始时序日志流转 (${rawLogs.length} 条)】:\n` + rawLogs.map((l: any) => `[${l.file}] [${l.level?.toUpperCase()}] ${l.line}`).join('\n');
          }

          return text;
        })()}
        context={{
          reqId: reqId || undefined,
          method: summary.method,
          path: summary.path,
          statusCode: summary.statusCode,
          durationMs: summary.durationMs,
          username: summary.username,
          ip: summary.ip,
          collectionName: summary.collectionName,
          actionName: summary.actionName,
          sqlQueries: timeline.filter((t: any) => t.type === 'sql').map((t: any) => t.detail),
          timelineCount: timeline.length,
        }}
        onClose={() => setAiDrawerVisible(false)}
      />
    </Drawer>
  );
};
