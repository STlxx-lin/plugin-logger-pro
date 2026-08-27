import React, { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Input,
  Select,
  Button,
  Space,
  Tag,
  Modal,
  Drawer,
  message,
  Tooltip,
  Spin,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  DiffOutlined,
  EyeOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExportOutlined,
  DeploymentUnitOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';
import { DiffModal } from './DiffModal';
import { AuditLogExportDrawer } from './AuditLogExportDrawer';
import { TraceDrawer } from './TraceDrawer';

export const AuditLogTab: React.FC = () => {
  const api = useAPIClient();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // 筛选字段
  const [username, setUsername] = useState('');
  const [collectionName, setCollectionName] = useState<string | undefined>(undefined);
  const [actionName, setActionName] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  // 导出抽屉
  const [exportDrawerVisible, setExportDrawerVisible] = useState(false);

  // 全链路追踪抽屉
  const [traceReqId, setTraceReqId] = useState<string | null>(null);
  const [traceDrawerVisible, setTraceDrawerVisible] = useState(false);

  // 差异对比弹窗
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [diffModalVisible, setDiffModalVisible] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);

  // 详情抽屉（查看 Params / Error）
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // 系统全部 Collections 列表
  const [collectionsList, setCollectionsList] = useState<any[]>([]);

  // 1. 获取系统数据表列表
  const fetchCollections = async () => {
    try {
      const res = await api.request({ url: 'loggerPro:getCollections' });
      setCollectionsList(res?.data?.data || res?.data || []);
    } catch {}
  };

  // 2. 加载审计日志列表 (字段瘦身优化：不加载大体积快照字段，彻底避免 MySQL 内存排序溢出)
  const fetchAuditLogs = async (currentPage = page, currentPageSize = pageSize) => {
    setLoading(true);
    try {
      const filter: any = {};
      if (username.trim()) {
        filter['userUsername'] = { $includes: username.trim() };
      }
      if (collectionName) {
        filter['collectionName'] = collectionName;
      }
      if (actionName) {
        filter['actionName'] = actionName;
      }
      if (statusFilter === 'success') {
        filter['statusCode'] = { $lt: 400 };
      } else if (statusFilter === 'error') {
        filter['statusCode'] = { $gte: 400 };
      }

      const res = await api.request({
        url: 'logger_audit_logs:list',
        params: {
          page: currentPage,
          pageSize: currentPageSize,
          filter,
          sort: ['-createdAt'],
          fields: [
            'id',
            'createdAt',
            'userUsername',
            'userNickname',
            'collectionName',
            'actionName',
            'recordId',
            'path',
            'method',
            'ip',
            'statusCode',
            'durationMs',
            'reqId',
          ],
        },
      });

      const items = res?.data?.data || [];
      const count = res?.data?.meta?.count || items.length;
      setData(items);
      setTotal(count);
    } catch (err: any) {
      message.error(`加载审计日志失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 3. 打开 Diff 对比弹窗 (按需异步获取完整快照)
  const handleOpenDiff = async (record: any) => {
    setSelectedRecord(record);
    setDiffModalVisible(true);
    if (!record.diff && !record.beforeData && !record.afterData) {
      setDiffLoading(true);
      try {
        const res = await api.request({
          url: 'logger_audit_logs:get',
          params: { filterByTk: record.id },
        });
        const fullRecord = res?.data?.data || res?.data || record;
        setSelectedRecord(fullRecord);
      } catch (err: any) {
        message.error(`获取变更详情失败: ${err.message}`);
      } finally {
        setDiffLoading(false);
      }
    }
  };

  // 4. 打开详情抽屉 (按需异步获取完整参数及错误)
  const handleOpenDrawer = async (record: any) => {
    setDrawerRecord(record);
    setDrawerVisible(true);
    if (!record.params && !record.errorMessage && !record.userAgent) {
      setDrawerLoading(true);
      try {
        const res = await api.request({
          url: 'logger_audit_logs:get',
          params: { filterByTk: record.id },
        });
        const fullRecord = res?.data?.data || res?.data || record;
        setDrawerRecord(fullRecord);
      } catch (err: any) {
        message.error(`获取报文详情失败: ${err.message}`);
      } finally {
        setDrawerLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchCollections();
  }, []);

  useEffect(() => {
    fetchAuditLogs(page, pageSize);
  }, [page, pageSize, collectionName, actionName, statusFilter]);

  const handleSearch = () => {
    setPage(1);
    fetchAuditLogs(1, pageSize);
  };

  const handleReset = () => {
    setUsername('');
    setCollectionName(undefined);
    setActionName(undefined);
    setStatusFilter(undefined);
    setPage(1);
    fetchAuditLogs(1, pageSize);
  };

  const getActionTagColor = (act: string) => {
    switch (act) {
      case 'create':
        return 'green';
      case 'update':
        return 'blue';
      case 'destroy':
        return 'red';
      default:
        return 'cyan';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 顶部搜索过滤栏 */}
      <Card size="small" bordered>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <Space wrap>
            <Input
              placeholder="操作人用户名"
              style={{ width: 160 }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
            />

            <Select
              placeholder="目标数据表"
              style={{ width: 180 }}
              value={collectionName}
              onChange={(v) => setCollectionName(v)}
              allowClear
              showSearch
              filterOption={(input, option: any) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={collectionsList.map((c) => ({
                label: `${c.title} (${c.name})`,
                value: c.name,
              }))}
            />

            <Select
              placeholder="操作动作"
              style={{ width: 130 }}
              value={actionName}
              onChange={(v) => setActionName(v)}
              allowClear
              options={[
                { label: '创建 (create)', value: 'create' },
                { label: '更新 (update)', value: 'update' },
                { label: '删除 (destroy)', value: 'destroy' },
              ]}
            />

            <Select
              placeholder="执行状态"
              style={{ width: 110 }}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              allowClear
              options={[
                { label: '全部状态', value: undefined },
                { label: '成功 (<400)', value: 'success' },
                { label: '失败 (>=400)', value: 'error' },
              ]}
            />

            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
              查询
            </Button>
            <Button onClick={handleReset}>重置</Button>
          </Space>

          <Space>
            <Button
              type="primary"
              ghost
              icon={<ExportOutlined />}
              onClick={() => setExportDrawerVisible(true)}
            >
              导出审计日志
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => fetchAuditLogs()} loading={loading}>
              刷新
            </Button>
          </Space>
        </div>
      </Card>

      {/* 审计日志数据表格 */}
      <Card bordered bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={data}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['15', '30', '50', '100'],
            showTotal: (t) => `共 ${t} 条审计记录`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          columns={[
            {
              title: '操作时间',
              dataIndex: 'createdAt',
              width: 170,
              render: (t) => new Date(t).toLocaleString(),
            },
            {
              title: '操作人',
              dataIndex: 'userUsername',
              width: 140,
              render: (u, r) => (
                <div>
                  <span style={{ fontWeight: 500 }}>{u || 'Anonymous'}</span>
                  {r.userNickname && <div style={{ fontSize: 12, color: '#8c8c8c' }}>{r.userNickname}</div>}
                </div>
              ),
            },
            {
              title: '目标模块 / 数据表',
              dataIndex: 'collectionName',
              width: 160,
              render: (c) => <code style={{ color: '#0958d9' }}>{c || '-'}</code>,
            },
            {
              title: '操作类型',
              dataIndex: 'actionName',
              width: 110,
              render: (act) => <Tag color={getActionTagColor(act)}>{act}</Tag>,
            },
            {
              title: '请求信息',
              dataIndex: 'path',
              render: (path, r) => (
                <div style={{ fontSize: 12 }}>
                  <Tag>{r.method}</Tag>
                  <span style={{ color: '#595959' }}>{path}</span>
                </div>
              ),
            },
            {
              title: '客户端 IP',
              dataIndex: 'ip',
              width: 130,
              render: (ip) => <span style={{ fontSize: 12 }}>{ip}</span>,
            },
            {
              title: '状态 / 耗时',
              width: 120,
              render: (_, r) => {
                const isOk = r.statusCode < 400;
                return (
                  <Space direction="vertical" size={2}>
                    <Tag icon={isOk ? <CheckCircleOutlined /> : <CloseCircleOutlined />} color={isOk ? 'success' : 'error'}>
                      {r.statusCode || 200}
                    </Tag>
                    <span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.durationMs ?? 0} ms</span>
                  </Space>
                );
              },
            },
            {
              title: '操作',
              width: 190,
              render: (_, r) => (
                <Space size={4}>
                  <Button
                    size="small"
                    type="link"
                    icon={<DeploymentUnitOutlined />}
                    onClick={() => {
                      setTraceReqId(r.reqId);
                      setTraceDrawerVisible(true);
                    }}
                  >
                    追踪
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    icon={<DiffOutlined />}
                    onClick={() => handleOpenDiff(r)}
                  >
                    Diff
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    icon={<EyeOutlined />}
                    onClick={() => handleOpenDrawer(r)}
                  >
                    详情
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* Diff 对比弹窗 */}
      <DiffModal
        visible={diffModalVisible}
        onClose={() => {
          setDiffModalVisible(false);
          setSelectedRecord(null);
        }}
        record={selectedRecord}
        loading={diffLoading}
      />

      {/* 参数与错误详情抽屉 */}
      <Drawer
        title="🔍 审计日志详细报文"
        placement="right"
        width={560}
        onClose={() => {
          setDrawerVisible(false);
          setDrawerRecord(null);
        }}
        open={drawerVisible}
      >
        <Spin spinning={drawerLoading}>
          {drawerRecord && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {drawerRecord.errorMessage && (
                <div>
                  <h4 style={{ color: '#ff4d4f', fontWeight: 600 }}>❌ 异常错误信息</h4>
                  <pre style={{ background: '#fff1f0', padding: 12, borderRadius: 6, color: '#cf1322', whiteSpace: 'pre-wrap' }}>
                    {drawerRecord.errorMessage}
                  </pre>
                </div>
              )}

              <div>
                <h4 style={{ fontWeight: 600 }}>📦 请求参数 (Params / Values)</h4>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
                  {JSON.stringify(drawerRecord.params, null, 2) || '(空)'}
                </pre>
              </div>

              <div>
                <h4 style={{ fontWeight: 600 }}>🌐 客户端 User-Agent</h4>
                <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, fontSize: 12, color: '#595959', wordBreak: 'break-all' }}>
                  {drawerRecord.userAgent || '-'}
                </div>
              </div>
            </div>
          )}
        </Spin>
      </Drawer>
      {/* 审计日志导出抽屉 */}
      <AuditLogExportDrawer
        visible={exportDrawerVisible}
        onClose={() => setExportDrawerVisible(false)}
        collections={collectionsList}
      />
      {/* 全链路请求追踪抽屉 */}
      <TraceDrawer
        visible={traceDrawerVisible}
        reqId={traceReqId}
        onClose={() => setTraceDrawerVisible(false)}
      />
    </div>
  );
};
