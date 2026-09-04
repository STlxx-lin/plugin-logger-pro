import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  Tag,
  Descriptions,
  Empty,
  Spin,
  Radio,
  Input,
  Space,
  Button,
  Card,
} from 'antd';
import {
  SearchOutlined,
  CodeOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useLoggerProAPI } from '../context/LoggerProContext';

interface DiffModalProps {
  visible: boolean;
  onClose: () => void;
  record: any;
  loading?: boolean;
}

// 内存缓存数据表字段元数据，避免重复请求
const collectionFieldsCache = new Map<string, Record<string, { title: string; type?: string; uiSchema?: any }>>();

/**
 * 递归清洗数据，彻底解包 Sequelize Model 实例及历史脏数据
 */
function cleanDataDeep(data: any): any {
  if (data === null || data === undefined) return null;

  // 1. 如果包含 toJSON 方法
  if (typeof data === 'object' && typeof data.toJSON === 'function') {
    return cleanDataDeep(data.toJSON());
  }

  // 2. 如果包含 dataValues 属性
  if (typeof data === 'object' && data.dataValues && typeof data.dataValues === 'object') {
    return cleanDataDeep(data.dataValues);
  }

  // 3. 处理包裹层如 { data: ... } 结构
  if (typeof data === 'object' && !Array.isArray(data) && data.data !== undefined && data.id === undefined) {
    return cleanDataDeep(data.data);
  }

  // 4. 处理数组结构：单元素解包（若外层包装了单条记录），多元素递归清洗
  if (Array.isArray(data)) {
    if (data.length === 1 && typeof data[0] === 'object') {
      return cleanDataDeep(data[0]);
    }
    return data.map((item) => cleanDataDeep(item));
  }

  // 5. 纯对象处理
  if (typeof data === 'object') {
    // 检查是否为历史脏结构（例如对象只有一个键名为 '0'，其值为一个未解包的数组或对象）
    const keys = Object.keys(data);
    if (keys.length === 1 && keys[0] === '0') {
      return cleanDataDeep(data['0']);
    }

    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (
        key.startsWith('_') ||
        key === 'uniqno' ||
        key === 'isNewRecord' ||
        key === 'isMaster' ||
        typeof val === 'function'
      ) {
        continue;
      }
      clean[key] = cleanDataDeep(val);
    }
    return clean;
  }

  return data;
}

/**
 * 复杂对象与关联子表智能可视化渲染组件
 */
const ComplexDataViewer: React.FC<{ value: any; isDiff?: boolean; type?: 'old' | 'new' | 'neutral' }> = ({
  value,
  isDiff = false,
  type = 'neutral',
}) => {
  const [viewMode, setViewMode] = useState<'card' | 'json'>('card');

  if (value === null || value === undefined) {
    return <span style={{ color: '#bfbfbf', fontStyle: 'italic' }}>(空 / null)</span>;
  }

  if (typeof value === 'boolean') {
    return <Tag color={value ? 'green' : 'red'}>{String(value)}</Tag>;
  }

  if (typeof value !== 'object') {
    return <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 500 }}>{String(value)}</span>;
  }

  // 数组结构（多选标签、关联子表等）
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: '#bfbfbf', fontStyle: 'italic' }}>[] (空数组)</span>;
    }

    // 简单标量数组（字符串/数字）
    if (value.every((item) => typeof item !== 'object')) {
      return (
        <Space wrap size={[4, 4]}>
          {value.map((v, i) => (
            <Tag key={i} color={type === 'old' ? 'red' : type === 'new' ? 'green' : 'blue'}>
              {String(v)}
            </Tag>
          ))}
        </Space>
      );
    }

    // 关联子表对象数组
    const onlyHasIds = value.every(
      (item) => typeof item === 'object' && item && Object.keys(item).filter((k) => k !== 'id' && k !== 'ID' && k !== 'key').length === 0
    );

    if (onlyHasIds) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>📦 包含 {value.length} 条关联记录</div>
          <Space wrap size={[6, 6]}>
            {value.map((item: any, idx: number) => {
              const displayId = item.id || item.ID || item.key || item;
              return (
                <Tag
                  key={idx}
                  color={type === 'old' ? 'volcano' : type === 'new' ? 'green' : 'cyan'}
                  style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4 }}
                >
                  #{displayId}
                </Tag>
              );
            })}
          </Space>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontSize: 11, color: '#8c8c8c' }}>📦 包含 {value.length} 条关联记录</span>
          <Button
            size="small"
            type="text"
            icon={viewMode === 'card' ? <CodeOutlined /> : <AppstoreOutlined />}
            onClick={() => setViewMode(viewMode === 'card' ? 'json' : 'card')}
            style={{ fontSize: 11, height: 20, padding: '0 4px' }}
          >
            {viewMode === 'card' ? 'JSON' : '卡片'}
          </Button>
        </div>

        {viewMode === 'json' ? (
          <pre style={{ margin: 0, padding: 8, background: 'rgba(0,0,0,0.03)', borderRadius: 4, fontSize: 11, maxHeight: 180, overflow: 'auto' }}>
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {value.map((item: any, idx: number) => {
              if (typeof item !== 'object' || !item) {
                return <Tag key={idx}>{String(item)}</Tag>;
              }
              const displayId = item.id || item.ID || item.key;
              const otherProps = Object.entries(item).filter(([k]) => k !== 'id' && k !== 'ID' && k !== 'key');
              return (
                <Card
                  key={idx}
                  size="small"
                  style={{
                    fontSize: 12,
                    border: '1px solid',
                    borderColor: type === 'old' ? '#ffa39e' : type === 'new' ? '#b7eb8f' : '#d9d9d9',
                    background: type === 'old' ? '#fff2f0' : type === 'new' ? '#f6ffed' : '#fafafa',
                  }}
                  bodyStyle={{ padding: '6px 10px' }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    {displayId && <Tag color="cyan">#{displayId}</Tag>}
                    {otherProps.slice(0, 5).map(([k, v]: [string, any]) => (
                      <span key={k} style={{ fontSize: 12, marginRight: 6 }}>
                        <span style={{ color: '#8c8c8c' }}>{k}: </span>
                        <strong style={{ color: '#262626' }}>
                          {typeof v === 'object' ? (v ? '[Object]' : 'null') : String(v ?? '-')}
                        </strong>
                      </span>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 纯复杂对象
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          type="text"
          icon={viewMode === 'card' ? <CodeOutlined /> : <AppstoreOutlined />}
          onClick={() => setViewMode(viewMode === 'card' ? 'json' : 'card')}
          style={{ fontSize: 11, height: 20, padding: '0 4px' }}
        >
          {viewMode === 'card' ? 'JSON' : '卡片'}
        </Button>
      </div>
      {viewMode === 'json' ? (
        <pre style={{ margin: 0, padding: 8, background: 'rgba(0,0,0,0.03)', borderRadius: 4, fontSize: 11, maxHeight: 180, overflow: 'auto' }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(value).map(([k, v]: [string, any]) => (
            <Tag key={k} style={{ margin: 0, padding: '2px 6px' }}>
              <span style={{ color: '#8c8c8c' }}>{k}: </span>
              <span>{typeof v === 'object' ? JSON.stringify(v) : String(v ?? 'null')}</span>
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
};

export const DiffModal: React.FC<DiffModalProps> = ({ visible, onClose, record, loading = false }) => {
  const api = useLoggerProAPI();

  // 字段中文名称元数据
  const [fieldsMap, setFieldsMap] = useState<Record<string, { title: string; type?: string }>>({});
  const [fieldsLoading, setFieldsLoading] = useState(false);

  // 视图模式与搜索过滤
  const [viewMode, setViewMode] = useState<'diffOnly' | 'allFields'>('diffOnly');
  const [keyword, setKeyword] = useState('');

  // 获取数据表字段元数据
  useEffect(() => {
    if (!visible || !record?.collectionName) {
      setFieldsMap({});
      return;
    }

    const collName = record.collectionName;
    if (collectionFieldsCache.has(collName)) {
      setFieldsMap(collectionFieldsCache.get(collName) || {});
      return;
    }

    setFieldsLoading(true);
    api
      .request({
        url: 'loggerPro:getCollectionFields',
        params: { collectionName: collName },
      })
      .then((res: any) => {
        const data = res?.data?.data || res?.data || {};
        collectionFieldsCache.set(collName, data);
        setFieldsMap(data);
      })
      .catch(() => {})
      .finally(() => {
        setFieldsLoading(false);
      });
  }, [visible, record?.collectionName]);

  // 重置状态
  useEffect(() => {
    if (visible) {
      setViewMode('diffOnly');
      setKeyword('');
    }
  }, [visible]);

  // 核心数据解析与历史脏数据自愈计算
  const processedData = useMemo(() => {
    if (!record) return null;

    const rawBefore = cleanDataDeep(record.beforeData);
    const rawAfter = cleanDataDeep(record.afterData);
    const rawDiff = record.diff;

    const beforeObj: Record<string, any> = rawBefore && typeof rawBefore === 'object' && !Array.isArray(rawBefore) ? rawBefore : {};
    const afterObj: Record<string, any> = rawAfter && typeof rawAfter === 'object' && !Array.isArray(rawAfter) ? rawAfter : {};

    // 检查历史 diff 是否包含脏键 '0' 或需要重新对比
    const isDirtyDiff =
      rawDiff &&
      typeof rawDiff === 'object' &&
      ('0' in rawDiff || Object.keys(rawDiff).some((k) => typeof rawDiff[k]?.new === 'object' && 'dataValues' in (rawDiff[k]?.new || {})));

    const computedDiff: Record<string, { old: any; new: any }> = {};
    const allKeysSet = new Set<string>([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

    if (rawDiff && typeof rawDiff === 'object' && !isDirtyDiff && Object.keys(rawDiff).length > 0) {
      for (const [k, v] of Object.entries(rawDiff) as [string, any][]) {
        computedDiff[k] = {
          old: cleanDataDeep(v?.old),
          new: cleanDataDeep(v?.new),
        };
        allKeysSet.add(k);
      }
    } else {
      // 从 beforeObj 和 afterObj 自愈重算差异
      for (const k of allKeysSet) {
        if (k === 'updatedAt' || k === 'createdAt' || k.startsWith('_')) continue;

        const bVal = beforeObj[k];
        const aVal = afterObj[k];

        const bNorm = bVal === undefined ? null : bVal;
        const aNorm = aVal === undefined ? null : aVal;

        if (JSON.stringify(bNorm) !== JSON.stringify(aNorm)) {
          computedDiff[k] = {
            old: bNorm,
            new: aNorm,
          };
        }
      }
    }

    const changedKeys = Object.keys(computedDiff);
    const allKeys = Array.from(allKeysSet).filter((k) => !k.startsWith('_') && k !== 'createdAt' && k !== 'updatedAt');

    return {
      beforeObj,
      afterObj,
      diff: computedDiff,
      changedKeys,
      allKeys,
      hasDiff: changedKeys.length > 0,
      isCreate: record.actionName === 'create' || (!rawBefore && !!rawAfter),
      isDestroy: record.actionName === 'destroy' || (!!rawBefore && !rawAfter),
    };
  }, [record]);

  if (!record || !processedData) return null;

  const { beforeObj, afterObj, diff, changedKeys, allKeys, hasDiff, isCreate, isDestroy } = processedData;

  // 根据当前视图模式与搜索词筛选字段列表
  const displayFieldKeys = (viewMode === 'diffOnly' && hasDiff ? changedKeys : allKeys).filter((key) => {
    if (!keyword.trim()) return true;
    const kw = keyword.trim().toLowerCase();
    const fieldTitle = fieldsMap[key]?.title || '';
    const oldValStr = String(beforeObj[key] ?? diff[key]?.old ?? '');
    const newValStr = String(afterObj[key] ?? diff[key]?.new ?? '');

    return (
      key.toLowerCase().includes(kw) ||
      fieldTitle.toLowerCase().includes(kw) ||
      oldValStr.toLowerCase().includes(kw) ||
      newValStr.toLowerCase().includes(kw)
    );
  });

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>🛡️ 数据变更差异对比 (Diff View)</span>
          <Tag color="blue">{record.collectionName}</Tag>
          <Tag color="cyan">{record.actionName}</Tag>
          {record.recordId && <Tag color="purple">ID: {record.recordId}</Tag>}
        </div>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={920}
      styles={{ body: { maxHeight: '76vh', overflowY: 'auto', padding: '16px 20px' } }}
    >
      <Spin spinning={loading || fieldsLoading}>
        {/* 顶部元数据概览 */}
        <div style={{ marginBottom: 16 }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="操作用户">
              <span style={{ fontWeight: 500 }}>{record.userUsername || 'Anonymous'}</span> ({record.userNickname || '-'})
            </Descriptions.Item>
            <Descriptions.Item label="客户端 IP">{record.ip || '-'}</Descriptions.Item>
            <Descriptions.Item label="请求路径">
              <Tag>{record.method}</Tag> {record.path}
            </Descriptions.Item>
            <Descriptions.Item label="操作时间">{new Date(record.createdAt).toLocaleString()}</Descriptions.Item>
          </Descriptions>
        </div>

        {/* 顶部工具栏（视图切换与快速搜索） */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            background: '#fafafa',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #f0f0f0',
          }}
        >
          <Radio.Group
            size="small"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            buttonStyle="solid"
          >
            <Radio.Button value="diffOnly">
              <ExclamationCircleOutlined style={{ marginRight: 4 }} />
              仅看变更字段 ({changedKeys.length})
            </Radio.Button>
            <Radio.Button value="allFields">
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              查看全表字段 ({allKeys.length})
            </Radio.Button>
          </Radio.Group>

          <Input
            size="small"
            placeholder="搜索字段名/标题/属性值..."
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
        </div>

        {/* 表格主体 */}
        {hasDiff || viewMode === 'allFields' ? (
          <div>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                border: '1px solid #e8e8e8',
                tableLayout: 'fixed',
              }}
            >
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', width: '28%' }}>字段名 / 标题</th>
                  <th style={{ padding: '9px 12px', textAlign: 'left', width: '36%', color: '#cf1322' }}>
                    变更前 (Old)
                  </th>
                  <th style={{ padding: '9px 12px', textAlign: 'left', width: '36%', color: '#389e0d' }}>
                    变更后 (New)
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayFieldKeys.length > 0 ? (
                  displayFieldKeys.map((key) => {
                    const fieldMeta = fieldsMap[key];
                    const fieldTitle = fieldMeta?.title || key;
                    const isChanged = key in diff;

                    const oldVal = isChanged ? diff[key]?.old : beforeObj[key] ?? afterObj[key];
                    const newVal = isChanged ? diff[key]?.new : afterObj[key] ?? beforeObj[key];

                    return (
                      <tr
                        key={key}
                        style={{
                          borderBottom: '1px solid #f0f0f0',
                          background: isChanged ? undefined : '#fafafa',
                        }}
                      >
                        {/* 字段名与中文标题联合展示 */}
                        <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600, color: '#1f1f1f', fontSize: 13 }}>
                                {fieldTitle}
                              </span>
                              {isChanged && <Tag color="warning" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>变动</Tag>}
                            </div>
                            {fieldTitle !== key && (
                              <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                                <code style={{ fontSize: 11, background: '#f5f5f5', padding: '1px 4px', borderRadius: 3 }}>
                                  {key}
                                </code>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 变更前数据 */}
                        <td
                          style={{
                            padding: '8px 12px',
                            background: isChanged ? '#fff1f0' : 'transparent',
                            color: isChanged ? '#a8071a' : '#595959',
                            verticalAlign: 'top',
                            borderRight: '1px solid #f0f0f0',
                          }}
                        >
                          <ComplexDataViewer value={oldVal} isDiff={isChanged} type="old" />
                        </td>

                        {/* 变更后数据 */}
                        <td
                          style={{
                            padding: '8px 12px',
                            background: isChanged ? '#f6ffed' : 'transparent',
                            color: isChanged ? '#237804' : '#595959',
                            verticalAlign: 'top',
                          }}
                        >
                          <ComplexDataViewer value={newVal} isDiff={isChanged} type="new" />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} style={{ padding: 24, textAlign: 'center' }}>
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配的字段数据" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : isCreate && Object.keys(afterObj).length > 0 ? (
          <div>
            <div style={{ marginBottom: 8, color: '#389e0d', fontWeight: 600 }}>
              <CheckCircleOutlined style={{ marginRight: 6 }} /> 新增记录初始属性：
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid #e8e8e8' }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '32%' }}>字段名 / 标题</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '68%', color: '#389e0d' }}>新增初始值</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(afterObj).map(([key, val]: [string, any]) => {
                  const fieldTitle = fieldsMap[key]?.title || key;
                  return (
                    <tr key={key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#1f1f1f' }}>{fieldTitle}</div>
                        {fieldTitle !== key && <code style={{ fontSize: 11, color: '#8c8c8c' }}>{key}</code>}
                      </td>
                      <td style={{ padding: '8px 12px', background: '#f6ffed' }}>
                        <ComplexDataViewer value={val} type="new" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : isDestroy && Object.keys(beforeObj).length > 0 ? (
          <div>
            <div style={{ marginBottom: 8, color: '#cf1322', fontWeight: 600 }}>
              🗑️ 删除前历史属性：
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid #e8e8e8' }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '32%' }}>字段名 / 标题</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: '68%', color: '#cf1322' }}>历史属性值</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(beforeObj).map(([key, val]: [string, any]) => {
                  const fieldTitle = fieldsMap[key]?.title || key;
                  return (
                    <tr key={key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#1f1f1f' }}>{fieldTitle}</div>
                        {fieldTitle !== key && <code style={{ fontSize: 11, color: '#8c8c8c' }}>{key}</code>}
                      </td>
                      <td style={{ padding: '8px 12px', background: '#fff1f0' }}>
                        <ComplexDataViewer value={val} type="old" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty description={loading ? '正在加载数据快照...' : '该操作无任何字段属性变更记录'} />
        )}
      </Spin>
    </Modal>
  );
};

export default DiffModal;
