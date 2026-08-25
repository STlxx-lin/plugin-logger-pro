import React, { useState, useEffect } from 'react';
import {
  Drawer,
  Spin,
  Button,
  Input,
  Select,
  Card,
  Space,
  Tag,
  message,
  Typography,
  Row,
  Col,
  Tabs,
  List,
  Popconfirm,
  Badge,
  Empty,
  Divider,
  Descriptions,
} from 'antd';
import {
  RobotOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  ApiOutlined,
  HistoryOutlined,
  DeleteOutlined,
  ReloadOutlined,
  EyeOutlined,
  ClockCircleOutlined,
  ClearOutlined,
  DeploymentUnitOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';

const { TextArea } = Input;
const LOCAL_STORAGE_AI_RECORDS = 'nocobase_logger_ai_analysis_history';

export interface AILogAnalysisDrawerProps {
  visible: boolean;
  onClose: () => void;
  initialLogText?: string;
  context?: {
    reqId?: string;
    method?: string;
    path?: string;
    statusCode?: number;
    durationMs?: number;
    username?: string;
    ip?: string;
    collectionName?: string;
    actionName?: string;
    sqlQueries?: string[];
    timelineCount?: number;
    [key: string]: any;
  };
}

export const AILogAnalysisDrawer: React.FC<AILogAnalysisDrawerProps> = ({
  visible,
  onClose,
  initialLogText = '',
  context,
}) => {
  const api = useAPIClient();
  const [activeTab, setActiveTab] = useState<'analyze' | 'history'>('analyze');
  const [logText, setLogText] = useState(initialLogText);
  const [loading, setLoading] = useState(false);

  // 1. 已配置的 AI 员工列表
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('system-error-expert');

  // 2. 已配置的 LLM 服务列表
  const [llmServices, setLlmServices] = useState<any[]>([]);
  const [selectedLLMKey, setSelectedLLMKey] = useState<string>('');

  // 3. 当前诊断结果
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // 4. 历史记录数据
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState<number>(0);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [viewingRecord, setViewingRecord] = useState<any>(null);

  // 获取后台已配置的 AI 员工列表
  const fetchEmployees = async () => {
    try {
      const res = await api.request({ url: 'loggerPro:getAIEmployees' });
      const list = res?.data?.data || res?.data || [];
      if (Array.isArray(list) && list.length > 0) {
        setEmployees(list);
        setSelectedEmployee((prev) => prev || list[0].name);
      }
    } catch {}
  };

  // 获取后台已配置的 LLM 服务列表
  const fetchLLMServices = async () => {
    try {
      const res = await api.request({ url: 'loggerPro:getLLMServices' });
      const list = res?.data?.data || res?.data || [];
      if (Array.isArray(list) && list.length > 0) {
        setLlmServices(list);
        setSelectedLLMKey((prev) => {
          if (prev) return prev;
          const first = list[0];
          const modelVal = first?.enabledModels?.[0]?.value || 'default';
          return `${first.llmService}:${modelVal}`;
        });
      }
    } catch {}
  };

  // 读取本地备用历史记录
  const getLocalRecords = (): any[] => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_AI_RECORDS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  // 写入本地备用历史记录
  const saveLocalRecord = (record: any) => {
    try {
      const list = getLocalRecords();
      const updated = [record, ...list.filter((r) => r.id !== record.id)].slice(0, 50);
      localStorage.setItem(LOCAL_STORAGE_AI_RECORDS, JSON.stringify(updated));
    } catch {}
  };

  // 获取历史记录列表 (结合后端数据库与本地双保险)
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await api.request({
        url: 'loggerPro:getAIAnalysisHistory',
        params: { page: 1, pageSize: 50 },
      });
      const data = res?.data?.data || res?.data;
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        setHistoryRecords(data.rows);
        setHistoryTotal(data.count || data.rows.length);
      } else {
        const localList = getLocalRecords();
        setHistoryRecords(localList);
        setHistoryTotal(localList.length);
      }
    } catch {
      const localList = getLocalRecords();
      setHistoryRecords(localList);
      setHistoryTotal(localList.length);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setActiveTab('analyze');
      setViewingRecord(null);
      fetchEmployees();
      fetchLLMServices();
      fetchHistory();
      setLogText(initialLogText);
      setAnalysisResult(null);
    }
  }, [visible, initialLogText]);

  // 执行 AI 诊断
  const handleAnalyze = async () => {
    if (!logText || !logText.trim()) {
      message.warning('请输入或提供错误日志文本进行分析');
      return;
    }

    setLoading(true);
    setAnalysisResult(null);

    let llmSelection: any = undefined;
    if (selectedLLMKey) {
      const parts = selectedLLMKey.split(':');
      llmSelection = {
        llmService: parts[0],
        model: parts.slice(1).join(':'),
      };
    }

    try {
      const res = await api.request({
        url: 'loggerPro:analyzeErrorLog',
        method: 'post',
        data: {
          logText: logText.trim(),
          employeeName: selectedEmployee,
          llmSelection,
          context,
        },
      });

      const data = res?.data?.data || res?.data;
      setAnalysisResult(data);

      if (data?.success) {
        // 保存本地快照作为保底
        saveLocalRecord({
          id: data.id || `rec_${Date.now()}`,
          analyzerName: data.analyzerName || 'AI 诊断专家',
          employeeName: selectedEmployee,
          llmService: llmSelection?.llmService || 'Dashscope',
          model: llmSelection?.model || 'default',
          logSummary: (logText.trim().split(/\r?\n/)[0] || '').slice(0, 150),
          logText: logText.trim(),
          analysisReport: data.analysisReport,
          durationMs: data.durationMs || 0,
          createdAt: new Date().toISOString(),
        });

        message.success('🎉 AI 错误日志诊断分析完成，已保存至历史记录！');
        fetchHistory();
      } else {
        message.error('AI 诊断遇到异常，请查看返回报告');
      }
    } catch (err: any) {
      message.error(`AI 诊断失败: ${err.message || '网络异常'}`);
    } finally {
      setLoading(false);
    }
  };

  // 删除单条历史
  const handleDeleteRecord = async (id: number | string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.request({
        url: 'loggerPro:deleteAIAnalysisRecord',
        params: { id },
      });
    } catch {}

    // 同步清理本地缓存
    try {
      const list = getLocalRecords();
      const updated = list.filter((r) => String(r.id) !== String(id));
      localStorage.setItem(LOCAL_STORAGE_AI_RECORDS, JSON.stringify(updated));
    } catch {}

    message.success('已删除该条诊断记录');
    if (viewingRecord?.id === id) {
      setViewingRecord(null);
    }
    fetchHistory();
  };

  // 清空所有历史
  const handleClearHistory = async () => {
    try {
      await api.request({
        url: 'loggerPro:clearAIAnalysisHistory',
        method: 'post',
      });
    } catch {}

    try {
      localStorage.removeItem(LOCAL_STORAGE_AI_RECORDS);
    } catch {}

    message.success('历史诊断记录已全部清空');
    setHistoryRecords([]);
    setHistoryTotal(0);
    setViewingRecord(null);
  };

  // 载入历史记录到诊断页面重新分析
  const handleLoadHistoryToAnalyze = (rec: any) => {
    setLogText(rec.logText || '');
    if (rec.employeeName) setSelectedEmployee(rec.employeeName);
    if (rec.llmService) setSelectedLLMKey(`${rec.llmService}:${rec.model || 'default'}`);
    setViewingRecord(null);
    setActiveTab('analyze');
    message.info('已将历史日志载入诊断工作台');
  };

  const handleCopyReport = (reportText?: string) => {
    const content = reportText || analysisResult?.analysisReport || viewingRecord?.analysisReport;
    if (content) {
      navigator.clipboard.writeText(content);
      message.success('诊断报告已复制到剪贴板');
    }
  };

  // 简易 Markdown 渲染
  const renderMarkdown = (content: string) => {
    if (!content) return null;
    const lines = content.split('\n');
    return (
      <div style={{ lineHeight: '24px', fontSize: 13, color: '#262626' }}>
        {lines.map((line, idx) => {
          if (line.startsWith('### ')) {
            return (
              <h3 key={idx} style={{ marginTop: 16, marginBottom: 8, color: '#722ed1', fontWeight: 600 }}>
                {line.replace('### ', '')}
              </h3>
            );
          }
          if (line.startsWith('#### ')) {
            return (
              <h4 key={idx} style={{ marginTop: 12, marginBottom: 6, color: '#262626', fontWeight: 600 }}>
                {line.replace('#### ', '')}
              </h4>
            );
          }
          if (line.startsWith('- ')) {
            return (
              <div key={idx} style={{ marginLeft: 12, marginBottom: 4 }}>
                • <span dangerouslySetInnerHTML={{ __html: formatInlineCode(line.replace('- ', '')) }} />
              </div>
            );
          }
          if (line.startsWith('```')) {
            return null;
          }
          if (line.trim()) {
            return (
              <p key={idx} style={{ marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: formatInlineCode(line) }} />
            );
          }
          return <div key={idx} style={{ height: 6 }} />;
        })}
      </div>
    );
  };

  const formatInlineCode = (str: string) => {
    return str
      .replace(/`([^`]+)`/g, '<code style="color: #c41d7f; background: #fff0f6; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px;">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  };

  // 构建 AI 员工下拉选项
  const employeeOptions = employees.map((e) => ({
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <RobotOutlined style={{ color: '#722ed1' }} />
        <span>{e.title}</span>
      </div>
    ),
    value: e.name,
  }));

  // 构建 LLM 服务下拉选项
  const llmOptions = llmServices.map((s) => {
    const models = s.enabledModels || [];
    if (models.length === 1 && models[0].value === 'default') {
      return {
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ApiOutlined style={{ color: '#1890ff' }} />
            <span>{s.llmServiceTitle}</span>
          </div>
        ),
        value: `${s.llmService}:default`,
      };
    }

    return {
      label: `🌐 ${s.llmServiceTitle}`,
      options: models.map((m: any) => ({
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ApiOutlined style={{ color: '#1890ff' }} />
            <span>{m.label || m.value}</span>
          </div>
        ),
        value: `${s.llmService}:${m.value}`,
      })),
    };
  });

  return (
    <Drawer
      title={
        <Space align="center" style={{ width: '100%' }}>
          <RobotOutlined style={{ color: '#722ed1', fontSize: 18 }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>AI 错误日志智能诊断 (AI Error Diagnostics)</span>
        </Space>
      }
      open={visible}
      onClose={onClose}
      width={880}
      extra={
        <Space size="middle" align="center">
          {(analysisResult || viewingRecord) && (
            <Button
              icon={<CopyOutlined />}
              onClick={() => handleCopyReport()}
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              复制诊断报告
            </Button>
          )}
          <Button
            onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            关闭
          </Button>
          {activeTab === 'analyze' && (
            <Button
              type="primary"
              style={{
                backgroundColor: '#722ed1',
                borderColor: '#722ed1',
                display: 'inline-flex',
                alignItems: 'center',
              }}
              icon={<ThunderboltOutlined />}
              loading={loading}
              onClick={handleAnalyze}
            >
              ⚡ 开始 AI 诊断
            </Button>
          )}
        </Space>
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={(key: any) => {
          setActiveTab(key);
          if (key === 'history') fetchHistory();
        }}
        items={[
          {
            key: 'analyze',
            label: (
              <Space>
                <ThunderboltOutlined />
                <span>智能诊断分析</span>
              </Space>
            ),
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 1. 选择 AI 员工与 LLM 服务 */}
                <Card size="small" bordered style={{ backgroundColor: '#f9f0ff', borderColor: '#d3adf7' }}>
                  <Row gutter={[16, 12]}>
                    <Col xs={24} sm={12}>
                      <div style={{ marginBottom: 6, fontWeight: 600, color: '#391085' }}>
                        🤖 选择已配置的 AI 员工:
                      </div>
                      <Select
                        value={selectedEmployee}
                        onChange={setSelectedEmployee}
                        style={{ width: '100%' }}
                        options={employeeOptions}
                        placeholder="选择 AI 员工"
                      />
                    </Col>

                    <Col xs={24} sm={12}>
                      <div style={{ marginBottom: 6, fontWeight: 600, color: '#391085' }}>
                        🧠 选择已配置的 LLM 服务:
                      </div>
                      <Select
                        value={selectedLLMKey}
                        onChange={setSelectedLLMKey}
                        style={{ width: '100%' }}
                        options={llmOptions}
                        placeholder="选择 LLM 服务"
                      />
                    </Col>
                  </Row>
                </Card>

                {/* 🌟 显式展示全链路追踪绑定上下文卡片 */}
                {context && (context.reqId || context.path) && (
                  <Card
                    size="small"
                    style={{
                      backgroundColor: '#e6f7ff',
                      borderColor: '#91d5ff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Space>
                        <DeploymentUnitOutlined style={{ color: '#1890ff', fontSize: 16 }} />
                        <strong style={{ color: '#0050b3', fontSize: 13 }}>
                          🌐 已深度绑定全链路追踪上下文 (Trace Context Attached)
                        </strong>
                      </Space>
                      {context.reqId && (
                        <Tag color="blue" style={{ fontFamily: 'monospace', margin: 0 }}>
                          ReqId: {context.reqId}
                        </Tag>
                      )}
                    </div>
                    <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }} bordered style={{ backgroundColor: '#ffffff' }}>
                      <Descriptions.Item label="请求接口">
                        <Tag color="green">{context.method || 'GET'}</Tag>
                        <code>{context.path || '-'}</code>
                      </Descriptions.Item>
                      <Descriptions.Item label="请求状态">
                        <Tag color={(context as any).statusCode && (context as any).statusCode < 400 ? 'success' : 'error'}>
                          HTTP {(context as any).statusCode || 200}
                        </Tag>
                        {(context as any).durationMs !== undefined && (
                          <span style={{ fontSize: 12, color: '#8c8c8c' }}> ({(context as any).durationMs}ms)</span>
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="操作用户">
                        <span>{(context as any).username || '系统访问'}</span>
                        {(context as any).ip && <span style={{ fontSize: 11, color: '#8c8c8c' }}> ({(context as any).ip})</span>}
                      </Descriptions.Item>
                      <Descriptions.Item label="关联模块/动作">
                        <span>{context.collectionName || '-'}{context.actionName ? ` : ${context.actionName}` : ''}</span>
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )}

                {/* 2. 待诊断错误日志输入/预览 */}
                <Card
                  size="small"
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Space>
                        <CodeOutlined style={{ color: '#ff4d4f' }} />
                        <strong>待分析的错误日志 / 调用堆栈 (Error Log & Stacktrace)</strong>
                      </Space>
                      <Button size="small" type="link" onClick={() => setLogText('')}>
                        清空
                      </Button>
                    </div>
                  }
                >
                  <TextArea
                    rows={7}
                    value={logText}
                    onChange={(e) => setLogText(e.target.value)}
                    placeholder="粘贴错误日志行或异常调用堆栈..."
                    style={{
                      backgroundColor: '#141414',
                      color: '#ff7875',
                      fontFamily: 'Consolas, Monaco, monospace',
                      fontSize: 12,
                      borderRadius: 6,
                    }}
                  />
                </Card>

                {/* 3. AI 诊断报告 */}
                <Spin spinning={loading} tip="AI 正在深度解析日志堆栈并生成根因分析...">
                  {analysisResult ? (
                    <Card
                      size="small"
                      bordered
                      style={{
                        backgroundColor: '#ffffff',
                        borderLeft: '4px solid #722ed1',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      }}
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Space>
                            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                            <strong>诊断分析报告 ({analysisResult.analyzerName})</strong>
                          </Space>
                          <Space>
                            <Tag color="cyan">⏱️ 诊断耗时: {analysisResult.durationMs} ms</Tag>
                            <Tag color="green">💾 已自动归档至历史记录</Tag>
                          </Space>
                        </div>
                      }
                    >
                      {renderMarkdown(analysisResult.analysisReport)}
                    </Card>
                  ) : (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: '48px 24px',
                        color: '#8c8c8c',
                        border: '1px dashed #d9d9d9',
                        borderRadius: 8,
                        backgroundColor: '#fafafa',
                      }}
                    >
                      <RobotOutlined style={{ fontSize: 42, color: '#722ed1', marginBottom: 16 }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#262626', marginBottom: 6 }}>
                        准备就绪，等待诊断
                      </div>
                      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 16 }}>
                        点击下方【⚡ 立即开始 AI 诊断】按钮，使用已配置的 Dashscope 与 AI 员工进行分析
                      </div>
                      <Button
                        type="primary"
                        style={{ backgroundColor: '#722ed1', borderColor: '#722ed1' }}
                        icon={<ThunderboltOutlined />}
                        size="large"
                        onClick={handleAnalyze}
                      >
                        ⚡ 立即开始 AI 诊断
                      </Button>
                    </div>
                  )}
                </Spin>
              </div>
            ),
          },
          {
            key: 'history',
            label: (
              <Space>
                <HistoryOutlined />
                <span>AI 诊断历史记录</span>
                {historyTotal > 0 && <Badge count={historyTotal} style={{ backgroundColor: '#722ed1' }} />}
              </Space>
            ),
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 顶部工具栏 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <span style={{ fontSize: 13, color: '#595959' }}>
                      共保存了 <strong>{historyTotal}</strong> 条 AI 诊断分析记录
                    </span>
                  </Space>
                  <Space size="middle">
                    <Button icon={<ReloadOutlined />} onClick={fetchHistory} loading={historyLoading}>
                      刷新
                    </Button>
                    {historyRecords.length > 0 && (
                      <Popconfirm
                        title="确定清空所有 AI 诊断历史记录？"
                        description="清空后将无法找回历史分析记录，确定继续？"
                        onConfirm={handleClearHistory}
                        okText="确定清空"
                        cancelText="取消"
                      >
                        <Button danger icon={<ClearOutlined />}>
                          清空全部记录
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                </div>

                {/* 历史报告详情弹层/卡片 */}
                {viewingRecord ? (
                  <Card
                    size="small"
                    style={{
                      backgroundColor: '#ffffff',
                      borderLeft: '4px solid #722ed1',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    }}
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space>
                          <RobotOutlined style={{ color: '#722ed1' }} />
                          <strong>历史诊断详情: {viewingRecord.analyzerName}</strong>
                        </Space>
                        <Space size="small">
                          <Button icon={<CopyOutlined />} onClick={() => handleCopyReport(viewingRecord.analysisReport)}>
                            复制报告
                          </Button>
                          <Button
                            type="primary"
                            style={{ backgroundColor: '#722ed1', borderColor: '#722ed1' }}
                            icon={<ThunderboltOutlined />}
                            onClick={() => handleLoadHistoryToAnalyze(viewingRecord)}
                          >
                            载入重新诊断
                          </Button>
                          <Popconfirm
                            title="确定删除此条诊断记录？"
                            onConfirm={(e: any) => handleDeleteRecord(viewingRecord.id, e)}
                            okText="删除"
                            cancelText="取消"
                          >
                            <Button danger icon={<DeleteOutlined />}>
                              删除此条
                            </Button>
                          </Popconfirm>
                          <Button onClick={() => setViewingRecord(null)}>
                            返回列表
                          </Button>
                        </Space>
                      </div>
                    }
                  >
                    <div style={{ marginBottom: 12, padding: '8px 12px', backgroundColor: '#fafafa', borderRadius: 4, fontSize: 12 }}>
                      <Space size="middle" wrap>
                        <span><ClockCircleOutlined /> <strong>诊断时间:</strong> {new Date(viewingRecord.createdAt).toLocaleString()}</span>
                        <span>⏱️ <strong>耗时:</strong> {viewingRecord.durationMs} ms</span>
                        <span>🌐 <strong>服务:</strong> <Tag color="blue">{viewingRecord.llmService}</Tag></span>
                      </Space>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#595959', marginBottom: 4 }}>
                        📄 原始错误日志片段:
                      </div>
                      <pre
                        style={{
                          backgroundColor: '#141414',
                          color: '#ff7875',
                          padding: 8,
                          borderRadius: 4,
                          fontSize: 11,
                          maxHeight: 120,
                          overflowY: 'auto',
                          margin: 0,
                        }}
                      >
                        {viewingRecord.logText}
                      </pre>
                    </div>

                    <Divider style={{ margin: '12px 0' }} />

                    <div>
                      {renderMarkdown(viewingRecord.analysisReport)}
                    </div>
                  </Card>
                ) : (
                  <Spin spinning={historyLoading}>
                    {historyRecords.length === 0 ? (
                      <Empty description="暂无 AI 诊断历史记录，去开始一次诊断吧！" style={{ padding: 48 }} />
                    ) : (
                      <List
                        dataSource={historyRecords}
                        renderItem={(rec) => (
                          <List.Item
                            key={rec.id}
                            style={{
                              padding: '12px 16px',
                              marginBottom: 10,
                              backgroundColor: '#ffffff',
                              border: '1px solid #f0f0f0',
                              borderRadius: 8,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                            }}
                            onClick={() => setViewingRecord(rec)}
                            actions={[
                              <Button
                                size="middle"
                                type="link"
                                icon={<EyeOutlined />}
                                onClick={() => setViewingRecord(rec)}
                              >
                                查看报告
                              </Button>,
                              <Popconfirm
                                title="确定删除此条诊断记录？"
                                onConfirm={(e: any) => handleDeleteRecord(rec.id, e)}
                                okText="删除"
                                cancelText="取消"
                              >
                                <Button
                                  size="middle"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  删除
                                </Button>
                              </Popconfirm>,
                            ]}
                          >
                            <List.Item.Meta
                              avatar={<RobotOutlined style={{ fontSize: 24, color: '#722ed1', marginTop: 4 }} />}
                              title={
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 600, color: '#262626' }}>{rec.analyzerName}</span>
                                  <Tag color="blue">{rec.llmService || 'Dashscope'}</Tag>
                                  <Tag color="cyan">⏱️ {rec.durationMs || 0}ms</Tag>
                                  <span style={{ fontSize: 11, color: '#8c8c8c', marginLeft: 'auto' }}>
                                    <ClockCircleOutlined /> {new Date(rec.createdAt).toLocaleString()}
                                  </span>
                                </div>
                              }
                              description={
                                <div style={{ marginTop: 4 }}>
                                  <code
                                    style={{
                                      backgroundColor: '#fff0f6',
                                      color: '#c41d7f',
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      fontSize: 11,
                                      display: 'inline-block',
                                      maxWidth: '100%',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {rec.logSummary || rec.logText?.slice(0, 100) || '系统错误诊断'}
                                  </code>
                                </div>
                              }
                            />
                          </List.Item>
                        )}
                      />
                    )}
                  </Spin>
                )}
              </div>
            ),
          },
        ]}
      />
    </Drawer>
  );
};
