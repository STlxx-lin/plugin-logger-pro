import React, { useState, useEffect } from 'react';
import {
  Modal,
  Table,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Card,
  Statistic,
  Row,
  Col,
  Alert,
  Tooltip,
} from 'antd';
import {
  DeleteOutlined,
  ClearOutlined,
  DownloadOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useLoggerProAPI } from '../context/LoggerProContext';

interface LogFileManagerModalProps {
  visible: boolean;
  onClose: () => void;
  onFilesChanged?: () => void;
}

export const LogFileManagerModal: React.FC<LogFileManagerModalProps> = ({
  visible,
  onClose,
  onFilesChanged,
}) => {
  const api = useLoggerProAPI();
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<any[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [cleaning, setCleaning] = useState(false);

  // 加载文件列表
  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await api.request({ url: 'loggerPro:files' });
      const list = res?.data?.data || res?.data || [];
      setFiles(list);
    } catch (err: any) {
      message.error(`加载文件列表失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      fetchFiles();
      setSelectedRowKeys([]);
    }
  }, [visible]);

  // 计算总大小与总数
  const totalSizeBytes = files.reduce((acc, f) => acc + (f.sizeBytes !== undefined ? f.sizeBytes : f.size || 0), 0);
  const totalSizeMb = (totalSizeBytes / (1024 * 1024)).toFixed(2);

  // 清空单个文件
  const handleClearSingle = async (fileName: string) => {
    try {
      await api.request({
        url: 'loggerPro:clearFile',
        method: 'post',
        data: { fileName },
      });
      message.success(`已成功清空日志: ${fileName}`);
      fetchFiles();
      onFilesChanged?.();
    } catch (err: any) {
      message.error(`清空失败: ${err.message}`);
    }
  };

  // 删除单个文件
  const handleDeleteSingle = async (fileName: string) => {
    try {
      await api.request({
        url: 'loggerPro:deleteFile',
        method: 'post',
        data: { fileName },
      });
      message.success(`已删除文件: ${fileName}`);
      fetchFiles();
      onFilesChanged?.();
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`);
    }
  };

  // 批量删除选中的文件
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    setLoading(true);
    try {
      let successCount = 0;
      for (const key of selectedRowKeys) {
        await api.request({
          url: 'loggerPro:deleteFile',
          method: 'post',
          data: { fileName: String(key) },
        });
        successCount++;
      }
      message.success(`成功删除 ${successCount} 个日志文件`);
      setSelectedRowKeys([]);
      fetchFiles();
      onFilesChanged?.();
    } catch (err: any) {
      message.error(`批量删除出错: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 批量清空选中的文件
  const handleBatchClear = async () => {
    if (selectedRowKeys.length === 0) return;
    setLoading(true);
    try {
      let successCount = 0;
      for (const key of selectedRowKeys) {
        await api.request({
          url: 'loggerPro:clearFile',
          method: 'post',
          data: { fileName: String(key) },
        });
        successCount++;
      }
      message.success(`成功清空 ${successCount} 个日志文件`);
      setSelectedRowKeys([]);
      fetchFiles();
      onFilesChanged?.();
    } catch (err: any) {
      message.error(`批量清空出错: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 立即执行保留策略全局清理
  const handleCleanPolicyNow = async () => {
    setCleaning(true);
    try {
      const res = await api.request({
        url: 'loggerPro:cleanLogs',
        method: 'post',
      });
      const data = res?.data?.data || res?.data || {};
      message.success(
        `清理完成！已清理 ${data.deletedCount || 0} 个过期/超额日志文件，释放磁盘空间 ${data.freedFormatted || '0 B'}`
      );
      fetchFiles();
      onFilesChanged?.();
    } catch (err: any) {
      message.error(`清理失败: ${err.message}`);
    } finally {
      setCleaning(false);
    }
  };

  // 批量下载
  const handleBatchDownload = () => {
    if (selectedRowKeys.length === 0) {
      // 下载全部
      window.open('/api/loggerPro:download', '_blank');
    } else {
      const query = selectedRowKeys.map((k) => `files=${encodeURIComponent(String(k))}`).join('&');
      window.open(`/api/loggerPro:download?${query}`, '_blank');
    }
  };

  const columns = [
    {
      title: '日志文件路径',
      dataIndex: 'relativePath',
      key: 'relativePath',
      render: (text: string, record: any) => {
        const name = text || record.name;
        let tagColor = 'blue';
        let typeName = '运行日志';
        if (name.includes('error')) {
          tagColor = 'red';
          typeName = '错误日志';
        } else if (name.includes('request')) {
          tagColor = 'green';
          typeName = '请求日志';
        } else if (name.includes('sql')) {
          tagColor = 'purple';
          typeName = 'SQL日志';
        }

        return (
          <Space>
            <FileTextOutlined style={{ color: '#1890ff' }} />
            <span style={{ fontWeight: 500 }}>{name}</span>
            <Tag color={tagColor} style={{ fontSize: 11 }}>
              {typeName}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: '文件大小',
      dataIndex: 'sizeFormatted',
      key: 'sizeFormatted',
      width: 120,
      render: (text: string, record: any) => (
        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{text || `${(record.size / 1024).toFixed(1)} KB`}</span>
      ),
    },
    {
      title: '最后修改时间',
      dataIndex: 'mtime',
      key: 'mtime',
      width: 180,
      render: (text: string) => <span style={{ color: '#595959', fontSize: 12 }}>{text ? new Date(text).toLocaleString() : '-'}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: any) => {
        const fileName = record.relativePath || record.name;
        return (
          <Space size="small">
            <Tooltip title="清空文件内容保留文件节点">
              <Popconfirm
                title={`确定清空日志文件 ${fileName} 吗？`}
                description="清空后日志内容将归零，不可恢复。"
                onConfirm={() => handleClearSingle(fileName)}
                okText="确认清空"
                cancelText="取消"
              >
                <Button type="link" size="small" icon={<ClearOutlined />} style={{ color: '#fa8c16' }}>
                  清空
                </Button>
              </Popconfirm>
            </Tooltip>

            <Tooltip title="直接从磁盘删除该日志文件">
              <Popconfirm
                title={`确定永久删除文件 ${fileName} 吗？`}
                description="删除后文件将从存储中彻底移除。"
                onConfirm={() => handleDeleteSingle(fileName)}
                okText="确认删除"
                cancelText="取消"
              >
                <Button type="link" size="small" icon={<DeleteOutlined />} danger>
                  删除
                </Button>
              </Popconfirm>
            </Tooltip>

            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => window.open(`/api/loggerPro:download?files=${encodeURIComponent(fileName)}`, '_blank')}
            >
              下载
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderOpenOutlined style={{ color: '#1890ff', fontSize: 18 }} />
          <span>日志文件清理与存储管理</span>
        </div>
      }
      open={visible}
      onCancel={onClose}
      width={900}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 概览统计与快捷清理卡片 */}
        <Row gutter={16}>
          <Col span={8}>
            <Card size="small" style={{ background: '#fafafa' }}>
              <Statistic title="日志文件总数" value={files.length} suffix="个" />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" style={{ background: '#fafafa' }}>
              <Statistic title="当前磁盘占用" value={totalSizeMb} suffix="MB" valueStyle={{ color: '#1890ff' }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" style={{ background: '#fafafa', display: 'flex', alignItems: 'center', height: '100%' }}>
              <Tooltip title="按照日志配置中设定的保留天数和磁盘配额，立即清除所有过期和超额的历史日志">
                <Button
                  type="primary"
                  danger
                  icon={<ThunderboltOutlined />}
                  loading={cleaning}
                  onClick={handleCleanPolicyNow}
                  style={{ width: '100%', height: 36 }}
                >
                  ⚡ 一键策略清理
                </Button>
              </Tooltip>
            </Card>
          </Col>
        </Row>

        {/* 批量操作工具栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Popconfirm
              title={`确定批量删除选中的 ${selectedRowKeys.length} 个文件？`}
              disabled={selectedRowKeys.length === 0}
              onConfirm={handleBatchDelete}
              okText="确认删除"
              cancelText="取消"
            >
              <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0} loading={loading}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>

            <Popconfirm
              title={`确定批量清空选中的 ${selectedRowKeys.length} 个文件内容？`}
              disabled={selectedRowKeys.length === 0}
              onConfirm={handleBatchClear}
              okText="确认清空"
              cancelText="取消"
            >
              <Button icon={<ClearOutlined />} disabled={selectedRowKeys.length === 0} loading={loading}>
                批量清空 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>

            <Button icon={<DownloadOutlined />} onClick={handleBatchDownload}>
              {selectedRowKeys.length > 0 ? `打包下载选中 (${selectedRowKeys.length})` : '打包下载全部日志'}
            </Button>
          </Space>

          <Button icon={<ReloadOutlined />} onClick={fetchFiles} loading={loading}>
            刷新列表
          </Button>
        </div>

        {/* 文件表格 */}
        <Table
          size="small"
          rowKey={(record) => record.relativePath || record.name}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={columns}
          dataSource={files}
          loading={loading}
          pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 个日志文件` }}
        />
      </div>
    </Modal>
  );
};

export default LogFileManagerModal;
