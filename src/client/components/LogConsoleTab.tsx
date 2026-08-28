import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Card,
  Select,
  Input,
  Radio,
  Button,
  Space,
  Tag,
  Switch,
  message,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ClearOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SearchOutlined,
  VerticalAlignBottomOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  CalendarOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useLoggerProAPI } from '../context/LoggerProContext';
import { LogFileManagerModal } from './LogFileManagerModal';
import { AILogAnalysisDrawer } from './AILogAnalysisDrawer';

const getLogCategoryMeta = (filePath: string) => {
  const name = filePath.toLowerCase();
  if (name.includes('system_error')) {
    return { text: '系统异常', color: 'red' };
  }
  if (name.startsWith('system') || name.includes('/system.')) {
    return { text: '系统运行', color: 'blue' };
  }
  if (name.includes('request')) {
    return { text: 'API请求', color: 'green' };
  }
  if (name.includes('sql')) {
    return { text: 'SQL查询', color: 'purple' };
  }
  if (name.includes('workflow')) {
    return { text: '工作流', color: 'orange' };
  }
  if (name.includes('user-data-sync')) {
    return { text: '用户同步', color: 'cyan' };
  }
  if (name.includes('notification')) {
    return { text: '通知管理', color: 'magenta' };
  }
  if (name.includes('custom-request')) {
    return { text: '自定义请求', color: 'geekblue' };
  }
  if (name.includes('export')) {
    return { text: '数据导出', color: 'gold' };
  }
  return { text: '插件/业务', color: 'default' };
};

// 提取文件所属日期 (YYYY-MM-DD)
const extractFileDate = (file: any): string => {
  const filePath = file?.relativePath || file?.name || '';
  const match = filePath.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  if (file?.mtime) {
    const d = new Date(file.mtime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return '';
};

export const LogConsoleTab: React.FC = () => {
  const api = useLoggerProAPI();
  const [files, setFiles] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [lines, setLines] = useState<string[]>([]);
  const [totalMatched, setTotalMatched] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [fileManagerVisible, setFileManagerVisible] = useState(false);

  // 1. 生成按时间倒序的时间序列列表（有日志可点，无日志置灰禁用）
  const dateOptions = useMemo(() => {
    const dateCounts: Record<string, number> = {};
    for (const f of files) {
      const d = extractFileDate(f);
      if (d) {
        dateCounts[d] = (dateCounts[d] || 0) + 1;
      }
    }

    const today = new Date();
    const list: Array<{ dateStr: string; label: string; count: number; hasLogs: boolean }> = [];

    // 获取最早的日志日期，以生成完整时间序列
    const allLogDates = Object.keys(dateCounts).sort();
    const earliestTime = allLogDates.length > 0 ? new Date(allLogDates[0]).getTime() : today.getTime();
    const totalDays = Math.max(10, Math.ceil((today.getTime() - earliestTime) / (1000 * 3600 * 24)) + 1);

    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${day}`;

      const count = dateCounts[dateStr] || 0;
      const hasLogs = count > 0;

      let desc = '';
      if (i === 0) desc = ' (今天)';
      else if (i === 1) desc = ' (昨天)';
      else if (i === 2) desc = ' (前天)';

      list.push({
        dateStr,
        label: `${dateStr}${desc}`,
        count,
        hasLogs,
      });
    }

    return list;
  }, [files]);

  // 根据选中的日期筛选日志文件
  const filteredFiles = useMemo(() => {
    if (!selectedDate) return files;
    return files.filter((f) => extractFileDate(f) === selectedDate);
  }, [files, selectedDate]);

  // 过滤条件
  const [level, setLevel] = useState<string>('ALL');
  const [keyword, setKeyword] = useState<string>('');
  const [lineCount, setLineCount] = useState<number>(500);

  // AI 错误诊断
  const [aiDrawerVisible, setAiDrawerVisible] = useState<boolean>(false);
  const [aiLogText, setAiLogText] = useState<string>('');

  const handleOpenAIDiagnosis = (specificText?: string) => {
    if (typeof specificText === 'string' && specificText.trim()) {
      setAiLogText(specificText.trim());
      setAiDrawerVisible(true);
      return;
    }

    // 自动收集当前视图中的错误日志行
    const errorLines = lines.filter((l) => /\[error\]|Error:|stack=/i.test(l));
    if (errorLines.length > 0) {
      setAiLogText(errorLines.slice(-30).join('\n'));
    } else if (lines.length > 0) {
      setAiLogText(lines.slice(-20).join('\n'));
    } else {
      setAiLogText('（暂无日志行，请在上方选择包含报错的日志文件）');
    }
    setAiDrawerVisible(true);
  };

  // 实时 Tail 相关
  const [isTailing, setIsTailing] = useState<boolean>(false);
  const [tailOffset, setTailOffset] = useState<number>(0);
  const tailTimerRef = useRef<any>(null);
  const consoleBodyRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // 1. 获取日志文件列表
  const fetchFiles = async () => {
    try {
      const res = await api.request({ url: 'loggerPro:files' });
      const list = res?.data?.data || res?.data || [];
      setFiles(list);
      if (list.length > 0) {
        const dates = Array.from(new Set(list.map((f: any) => extractFileDate(f)).filter(Boolean))).sort().reverse();
        const latestDate = (dates[0] as string) || null;
        if (!selectedDate && latestDate) {
          setSelectedDate(latestDate);
        }
        if (!selectedFile) {
          const currentList = latestDate ? list.filter((f: any) => extractFileDate(f) === latestDate) : list;
          const defaultF = currentList.find((f: any) => f.name.startsWith('system.')) || currentList[0] || list[0];
          if (defaultF) {
            setSelectedFile(defaultF.relativePath || defaultF.name);
          }
        }
      }
    } catch (err: any) {
      message.error(`获取日志文件列表失败: ${err.message}`);
    }
  };

  // 2. 加载日志内容（静态批量加载）
  const fetchLogContent = async (fileToRead = selectedFile) => {
    if (!fileToRead) return;
    setLoading(true);
    try {
      const res = await api.request({
        url: 'loggerPro:readLines',
        params: {
          fileName: fileToRead,
          lines: lineCount,
          level: level !== 'ALL' ? level : undefined,
          keyword: keyword.trim() || undefined,
        },
      });
      const data = res?.data?.data || res?.data || {};
      const newLines = data.lines || [];
      setLines(newLines);
      setTotalMatched(data.totalMatched || newLines.length);
      setTailOffset(data.totalSize || 0);

      if (autoScroll && consoleBodyRef.current) {
        setTimeout(() => {
          if (consoleBodyRef.current) {
            consoleBodyRef.current.scrollTop = consoleBodyRef.current.scrollHeight;
          }
        }, 100);
      }
    } catch (err: any) {
      message.error(`读取日志失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 3. 增量 Tail 拉取
  const fetchTail = async () => {
    if (!selectedFile) return;
    try {
      const res = await api.request({
        url: 'loggerPro:tail',
        params: {
          fileName: selectedFile,
          offsetBytes: tailOffset,
        },
      });
      const data = res?.data?.data || res?.data || {};
      const newLines = data.lines || [];

      if (newLines.length > 0) {
        setLines((prev) => {
          const combined = [...prev, ...newLines];
          return combined.slice(-lineCount * 2); // 保持窗口
        });
        setTailOffset(data.newOffset || tailOffset);

        if (autoScroll && consoleBodyRef.current) {
          consoleBodyRef.current.scrollTop = consoleBodyRef.current.scrollHeight;
        }
      }
    } catch (err: any) {
      // tail 错误不弹打扰提示，静默记录
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  useEffect(() => {
    if (selectedFile) {
      fetchLogContent(selectedFile);
    }
  }, [selectedFile, level, lineCount]);

  // 管理 Tail 轮询定时器
  useEffect(() => {
    if (isTailing) {
      tailTimerRef.current = setInterval(() => {
        fetchTail();
      }, 1500);
    } else {
      if (tailTimerRef.current) {
        clearInterval(tailTimerRef.current);
        tailTimerRef.current = null;
      }
    }
    return () => {
      if (tailTimerRef.current) {
        clearInterval(tailTimerRef.current);
      }
    };
  }, [isTailing, selectedFile, tailOffset, autoScroll]);

  // 清空当前文件
  const handleClearFile = async () => {
    if (!selectedFile) return;
    try {
      await api.request({
        url: 'loggerPro:clearFile',
        method: 'post',
        data: { fileName: selectedFile },
      });
      message.success(`日志文件 ${selectedFile} 已清空`);
      setLines([]);
      setTailOffset(0);
      fetchFiles();
    } catch (err: any) {
      message.error(`清空失败: ${err.message}`);
    }
  };

  // 删除当前文件
  const handleDeleteFile = async () => {
    if (!selectedFile) return;
    try {
      await api.request({
        url: 'loggerPro:deleteFile',
        method: 'post',
        data: { fileName: selectedFile },
      });
      message.success(`日志文件 ${selectedFile} 已删除`);
      setLines([]);
      setSelectedFile('');
      fetchFiles();
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`);
    }
  };

  // 单文件下载
  const handleDownload = () => {
    if (!selectedFile) return;
    const downloadUrl = `/api/loggerPro:download?files=${encodeURIComponent(selectedFile)}`;
    window.open(downloadUrl, '_blank');
  };

  // 日志行语法着色高亮渲染
  const renderLogLine = (rawLine: string, index: number) => {
    const line = rawLine ? rawLine.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\[[0-9]{1,2}m/g, '') : '';
    let color = '#d4d4d4';
    let lineBg = 'transparent';

    const lineUpper = line.toUpperCase();
    if (lineUpper.includes('[ERROR]') || lineUpper.includes('"LEVEL":"ERROR"') || lineUpper.includes(' ERROR ')) {
      color = '#ff7875';
      lineBg = 'rgba(255, 77, 79, 0.1)';
    } else if (lineUpper.includes('[WARN]') || lineUpper.includes('"LEVEL":"WARN"') || lineUpper.includes(' WARN ')) {
      color = '#ffd666';
      lineBg = 'rgba(250, 173, 20, 0.08)';
    } else if (lineUpper.includes('[DEBUG]') || lineUpper.includes('"LEVEL":"DEBUG"')) {
      color = '#87e8de';
    } else if (lineUpper.includes('[INFO]') || lineUpper.includes('"LEVEL":"INFO"')) {
      color = '#bae7ff';
    }

    // 关键词高亮
    let contentNode: React.ReactNode = line;
    if (keyword.trim()) {
      const parts = line.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
      contentNode = parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <span key={i} style={{ background: '#fadb14', color: '#000', fontWeight: 'bold', padding: '0 2px', borderRadius: 2 }}>
            {part}
          </span>
        ) : (
          part
        ),
      );
    }

    return (
      <div
        key={index}
        style={{
          display: 'flex',
          padding: '2px 8px',
          backgroundColor: lineBg,
          lineHeight: '20px',
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          fontSize: 13,
          borderBottom: '1px solid #262626',
        }}
      >
        <span style={{ color: '#595959', width: 48, userSelect: 'none', textAlign: 'right', marginRight: 12 }}>
          {index + 1}
        </span>
        <span style={{ color, wordBreak: 'break-all', whiteSpace: 'pre-wrap', flex: 1 }}>{contentNode}</span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 顶部控制工具栏 */}
      <Card size="small" bordered>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          {/* 左侧：日期顺序选择、文件选择与级别 */}
          <Space wrap size="middle">
            {/* 1. 时间顺序选择器：支持输入筛选、有日志日期可选、无日志日期灰色禁用 */}
            <Space>
              <span style={{ fontWeight: 500 }}>日志日期:</span>
              <Select
                showSearch
                placeholder="输入搜索日期"
                filterOption={(input, option) => {
                  const val = String(option?.value || '').toLowerCase();
                  const label = String(option?.selectedLabel || '').toLowerCase();
                  const q = input.toLowerCase().trim();
                  return val.includes(q) || label.includes(q);
                }}
                style={{ minWidth: 220 }}
                popupMatchSelectWidth={false}
                dropdownStyle={{ minWidth: 290 }}
                optionLabelProp="selectedLabel"
                value={selectedDate || ''}
                onChange={(val) => {
                  const dStr = val || null;
                  setSelectedDate(dStr);
                  setIsTailing(false);
                  if (dStr) {
                    const matched = files.filter((f) => extractFileDate(f) === dStr);
                    if (matched.length > 0) {
                      const defaultF = matched.find((f: any) => f.name.startsWith('system.')) || matched[0];
                      setSelectedFile(defaultF.relativePath || defaultF.name);
                    }
                  } else if (files.length > 0) {
                    const defaultF = files.find((f: any) => f.name.startsWith('system.')) || files[0];
                    setSelectedFile(defaultF.relativePath || defaultF.name);
                  }
                }}
                options={[
                  {
                    label: (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                        <span style={{ fontWeight: 600 }}>📅 全部日期</span>
                        <Tag style={{ margin: 0, fontSize: 11 }}>{files.length} 个文件</Tag>
                      </div>
                    ),
                    selectedLabel: '📅 全部日期',
                    value: '',
                  },
                  ...dateOptions.map((item) => ({
                    label: (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          padding: '2px 0',
                          opacity: item.hasLogs ? 1 : 0.45,
                        }}
                      >
                        <span style={{ fontWeight: item.hasLogs ? 600 : 'normal' }}>
                          📅 {item.label}
                        </span>
                        {item.hasLogs ? (
                          <Tag color="blue" style={{ fontSize: 11, margin: 0, padding: '0 4px' }}>
                            {item.count} 个文件
                          </Tag>
                        ) : (
                          <span style={{ color: '#8c8c8c', fontSize: 12 }}>无日志</span>
                        )}
                      </div>
                    ),
                    selectedLabel: `📅 ${item.label}`,
                    value: item.dateStr,
                    disabled: !item.hasLogs, // 没有对应时间的日志文件则灰色无法点击！
                  })),
                ]}
              />
            </Space>

            {/* 2. 日志文件下拉框 (支持输入筛选 & 联动当前选中的日期) */}
            <Space>
              <span style={{ fontWeight: 500 }}>日志文件:</span>
              <Select
                showSearch
                placeholder="输入搜索日志文件"
                filterOption={(input, option) => {
                  const val = String(option?.value || '').toLowerCase();
                  const q = input.toLowerCase().trim();
                  return val.includes(q);
                }}
                style={{ minWidth: 340 }}
                popupMatchSelectWidth={false}
                dropdownStyle={{ minWidth: 480 }}
                optionLabelProp="selectedLabel"
                value={selectedFile}
                onChange={(val) => {
                  setSelectedFile(val);
                  setIsTailing(false);
                }}
                options={filteredFiles.map((f) => {
                  const filePath = f.relativePath || f.name;
                  const cat = getLogCategoryMeta(filePath);
                  return {
                    label: (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '2px 0' }}>
                        <Space style={{ flex: 1, overflow: 'hidden' }}>
                          <Tag color={cat.color} style={{ fontSize: 11, padding: '0 6px', margin: 0, fontWeight: 500 }}>
                            {cat.text}
                          </Tag>
                          <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {filePath}
                          </span>
                        </Space>
                        <span style={{ color: '#8c8c8c', fontSize: 12, fontFamily: 'monospace', flexShrink: 0 }}>
                          {f.sizeFormatted}
                        </span>
                      </div>
                    ),
                    selectedLabel: (
                      <Space size="small">
                        <Tag color={cat.color} style={{ fontSize: 11, padding: '0 4px', margin: 0 }}>
                          {cat.text}
                        </Tag>
                        <span>{filePath}</span>
                      </Space>
                    ),
                    value: filePath,
                  };
                })}
              />
            </Space>

            <Radio.Group value={level} onChange={(e) => setLevel(e.target.value)} buttonStyle="solid" size="small">
              <Radio.Button value="ALL">ALL</Radio.Button>
              <Radio.Button value="ERROR"><span style={{ color: '#ff4d4f' }}>ERROR</span></Radio.Button>
              <Radio.Button value="WARN"><span style={{ color: '#faad14' }}>WARN</span></Radio.Button>
              <Radio.Button value="INFO">INFO</Radio.Button>
              <Radio.Button value="DEBUG">DEBUG</Radio.Button>
            </Radio.Group>
          </Space>

          {/* 右侧：关键词检索与操作 */}
          <Space wrap>
            <Input
              placeholder="搜索关键词 (Enter检索)"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              style={{ width: 220 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => fetchLogContent()}
              allowClear
            />

            <Select
              size="small"
              value={lineCount}
              onChange={(v) => setLineCount(v)}
              options={[
                { label: '最新 100 行', value: 100 },
                { label: '最新 500 行', value: 500 },
                { label: '最新 1000 行', value: 1000 },
                { label: '最新 2000 行', value: 2000 },
              ]}
            />

            <Tooltip title={isTailing ? '暂停实时 Tail 轮询' : '开启实时 Tail (类似 tail -f)'}>
              <Button
                type={isTailing ? 'primary' : 'default'}
                danger={isTailing}
                icon={isTailing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                onClick={() => setIsTailing(!isTailing)}
              >
                {isTailing ? '暂停 Tail' : '实时 Tail'}
              </Button>
            </Tooltip>

            <Button icon={<ReloadOutlined />} onClick={() => fetchLogContent()} loading={loading}>
              刷新
            </Button>

            <Button icon={<DownloadOutlined />} onClick={handleDownload}>
              下载文件
            </Button>

            <Button
              type="primary"
              style={{ backgroundColor: '#722ed1', borderColor: '#722ed1' }}
              icon={<RobotOutlined />}
              onClick={() => handleOpenAIDiagnosis()}
            >
              AI 错误诊断
            </Button>

            <Button
              type="primary"
              icon={<FolderOpenOutlined />}
              onClick={() => setFileManagerVisible(true)}
            >
              日志清理与管理
            </Button>

            <Popconfirm
              title={`确定清空当前日志文件？`}
              description="清空后历史日志内容将归零，不可恢复。"
              disabled={!selectedFile}
              onConfirm={handleClearFile}
              okText="确认清空"
              cancelText="取消"
            >
              <Button icon={<ClearOutlined />} disabled={!selectedFile}>
                清空文件
              </Button>
            </Popconfirm>

            <Popconfirm
              title={`确定删除当前日志文件 (${selectedFile})？`}
              description="删除后该文件将彻底从磁盘移除。"
              disabled={!selectedFile}
              onConfirm={handleDeleteFile}
              okText="确认删除"
              cancelText="取消"
            >
              <Button icon={<DeleteOutlined />} danger disabled={!selectedFile}>
                删除文件
              </Button>
            </Popconfirm>
          </Space>
        </div>
      </Card>

      {/* 终端控制台主体 */}
      <div
        style={{
          background: '#141414',
          borderRadius: 8,
          border: '1px solid #303030',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          height: '68vh',
        }}
      >
        {/* 控制台顶部 Titlebar */}
        <div
          style={{
            background: '#1f1f1f',
            padding: '8px 16px',
            borderBottom: '1px solid #303030',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            color: '#a6a6a6',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
            <span style={{ marginLeft: 8, color: '#e6e6e6', fontWeight: 600 }}>
              💻 Console: {selectedFile || '无选中日志'}
            </span>
            {selectedFile && (
              <Tag color={getLogCategoryMeta(selectedFile).color} style={{ marginLeft: 4 }}>
                {getLogCategoryMeta(selectedFile).text}
              </Tag>
            )}
            {isTailing && (
              <Tag color="success" style={{ marginLeft: 4 }}>
                ● LIVE STREAMING
              </Tag>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span>匹配行数: <strong style={{ color: '#fff' }}>{lines.length}</strong> / {totalMatched}</span>
            <Space size="small">
              <span>自动滚屏:</span>
              <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
            </Space>
            <Button
              size="small"
              type="text"
              icon={<VerticalAlignBottomOutlined style={{ color: '#8c8c8c' }} />}
              onClick={() => {
                if (consoleBodyRef.current) {
                  consoleBodyRef.current.scrollTop = consoleBodyRef.current.scrollHeight;
                }
              }}
            >
              到底部
            </Button>
          </div>
        </div>

        {/* 控制台文本渲染区 */}
        <div
          ref={consoleBodyRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'auto',
            padding: '8px 0',
            backgroundColor: '#0d1117',
          }}
        >
          {lines.length > 0 ? (
            lines.map((line, idx) => renderLogLine(line, idx))
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#595959', fontSize: 14 }}>
              {loading ? '正在读取日志数据...' : '日志文件为空或未匹配到符合条件的日志行'}
            </div>
          )}
        </div>
      </div>

      {/* 日志文件清理与管理模态框 */}
      <LogFileManagerModal
        visible={fileManagerVisible}
        onClose={() => setFileManagerVisible(false)}
        onFilesChanged={() => {
          fetchFiles();
          if (selectedFile) {
            fetchLogContent(selectedFile);
          }
        }}
      />

      {/* AI 错误日志诊断抽屉 */}
      <AILogAnalysisDrawer
        visible={aiDrawerVisible}
        initialLogText={aiLogText}
        onClose={() => setAiDrawerVisible(false)}
      />
    </div>
  );
};
