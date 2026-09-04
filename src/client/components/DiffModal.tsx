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
  Table,
  Image,
  Tooltip,
} from 'antd';
import {
  SearchOutlined,
  CodeOutlined,
  AppstoreOutlined,
  TableOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  PaperClipOutlined,
  CalendarOutlined,
  LinkOutlined,
  FilePdfOutlined,
  FileExcelOutlined,
  FileWordOutlined,
  FileZipOutlined,
  FileImageOutlined,
  FileOutlined,
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

// 内置系统字段字典与国际化映射
const I18N_TITLE_DICT: Record<string, string> = {
  id: 'ID',
  ID: 'ID',
  'Created at': '创建时间',
  'Updated at': '更新时间',
  'Created by': '创建人',
  'Updated by': '更新人',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  createdById: '创建人 ID',
  updatedById: '更新人 ID',
};

/**
 * 解析字段标题，支持 {{t("...")}} 占位符及系统内置别名
 */
function parseI18nTitle(rawTitle: any, fieldKey = ''): string {
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return I18N_TITLE_DICT[fieldKey] || fieldKey;
  }
  const match = rawTitle.match(/\{\{\s*t\(\s*["'](.*?)["']\s*\)\s*\}\}/);
  if (match && match[1]) {
    const key = match[1];
    return I18N_TITLE_DICT[key] || key;
  }
  return I18N_TITLE_DICT[rawTitle] || rawTitle;
}

/**
 * 递归清洗数据，彻底解包 Sequelize Model 实例及历史脏数据
 */
function cleanDataDeep(data: any, isRoot = true): any {
  if (data === null || data === undefined) return null;

  // 1. 处理 Date 实例
  if (data instanceof Date || (typeof data === 'object' && Object.prototype.toString.call(data) === '[object Date]')) {
    return isNaN(data.getTime()) ? null : data.toISOString();
  }

  // 2. 如果包含 toJSON 方法
  if (typeof data === 'object' && typeof data.toJSON === 'function') {
    return cleanDataDeep(data.toJSON(), isRoot);
  }

  // 3. 如果包含 dataValues 属性
  if (typeof data === 'object' && data.dataValues && typeof data.dataValues === 'object') {
    return cleanDataDeep(data.dataValues, isRoot);
  }

  // 4. 处理包裹层如 { data: ... } 结构
  if (typeof data === 'object' && !Array.isArray(data) && data.data !== undefined && data.id === undefined) {
    return cleanDataDeep(data.data, isRoot);
  }

  // 5. 数组处理：仅在最顶层且包含单条完整模型时解包，关联子表/附件数组保留数组形态
  if (Array.isArray(data)) {
    if (isRoot && data.length === 1 && typeof data[0] === 'object' && data[0] !== null && ('id' in data[0] || 'dataValues' in data[0])) {
      return cleanDataDeep(data[0], false);
    }
    return data.map((item) => cleanDataDeep(item, false));
  }

  // 6. 纯对象处理
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    // 兼容历史脏结构（例如对象只有一个键名为 '0'）
    if (keys.length === 1 && keys[0] === '0') {
      return cleanDataDeep(data['0'], false);
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
      clean[key] = cleanDataDeep(val, false);
    }
    return clean;
  }

  return data;
}

/**
 * 识别是否为 ISO 8601 日期时间格式字符串
 */
function isIsoDateString(val: any): boolean {
  if (typeof val !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/.test(val.trim());
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (!bytes || isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 获取文件类型图标
 */
function getFileIcon(filename = '', mimetype = '') {
  const lower = (filename || mimetype).toLowerCase();
  if (lower.includes('pdf')) return <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />;
  if (lower.includes('xls') || lower.includes('csv') || lower.includes('sheet'))
    return <FileExcelOutlined style={{ color: '#52c41a', fontSize: 16 }} />;
  if (lower.includes('doc') || lower.includes('word'))
    return <FileWordOutlined style={{ color: '#1677ff', fontSize: 16 }} />;
  if (lower.includes('zip') || lower.includes('rar') || lower.includes('tar') || lower.includes('7z'))
    return <FileZipOutlined style={{ color: '#faad14', fontSize: 16 }} />;
  if (lower.includes('png') || lower.includes('jpg') || lower.includes('jpeg') || lower.includes('image') || lower.includes('gif'))
    return <FileImageOutlined style={{ color: '#13c2c2', fontSize: 16 }} />;
  return <FileOutlined style={{ color: '#8c8c8c', fontSize: 16 }} />;
}

/**
 * 判断是否为附件对象
 */
function isAttachmentItem(obj: any): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Boolean(
    (obj.url && typeof obj.url === 'string') ||
    (obj.filename && typeof obj.filename === 'string') ||
    (obj.extname && typeof obj.extname === 'string') ||
    (obj.mimetype && typeof obj.mimetype === 'string')
  );
}

/**
 * 单个附件卡片组件
 */
const SingleAttachmentCard: React.FC<{ item: any; type?: 'old' | 'new' | 'neutral' }> = ({ item, type = 'neutral' }) => {
  const fileName = item.title || item.filename || item.name || '未命名附件';
  const fileUrl = item.url || '';
  const isImg =
    (item.mimetype && item.mimetype.startsWith('image/')) ||
    /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName) ||
    /\.(png|jpe?g|gif|webp|svg)$/i.test(fileUrl);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        background: type === 'old' ? '#fff2f0' : type === 'new' ? '#f6ffed' : '#f5f5f5',
        border: '1px solid',
        borderColor: type === 'old' ? '#ffa39e' : type === 'new' ? '#b7eb8f' : '#d9d9d9',
        borderRadius: 6,
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {isImg && fileUrl ? (
        <Image
          src={fileUrl}
          width={28}
          height={28}
          style={{ objectFit: 'cover', borderRadius: 4, display: 'block' }}
          preview={{ mask: false }}
          fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'></svg>"
        />
      ) : (
        getFileIcon(fileName, item.mimetype)
      )}

      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: '#1677ff',
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'inline-block',
              }}
              title={fileName}
            >
              {fileName}
            </a>
          ) : (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: '#262626',
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'inline-block',
              }}
              title={fileName}
            >
              {fileName}
            </span>
          )}
          {fileUrl && (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#8c8c8c', fontSize: 11 }}>
              <LinkOutlined />
            </a>
          )}
        </div>
        {(item.size || item.extname) && (
          <span style={{ fontSize: 10, color: '#8c8c8c' }}>
            {item.extname ? String(item.extname).toUpperCase() : ''}{' '}
            {item.size ? `(${formatFileSize(Number(item.size))})` : ''}
          </span>
        )}
      </div>
    </div>
  );
};




/**
 * 复杂对象与关联子表智能可视化渲染组件
 */
const ComplexDataViewer: React.FC<{ value: any; isDiff?: boolean; type?: 'old' | 'new' | 'neutral' }> = ({
  value,
  isDiff = false,
  type = 'neutral',
}) => {
  const [viewMode, setViewMode] = useState<'visual' | 'json'>('visual');

  if (value === null || value === undefined) {
    return <span style={{ color: '#bfbfbf', fontStyle: 'italic' }}>(空 / null)</span>;
  }

  if (typeof value === 'boolean') {
    return <Tag color={value ? 'green' : 'red'}>{String(value)}</Tag>;
  }

  // 标量字符串与日期检测
  if (typeof value === 'string') {
    if (isIsoDateString(value)) {
      const d = new Date(value);
      const formatted = isNaN(d.getTime()) ? value : d.toLocaleString();
      return (
        <Space size={6} style={{ verticalAlign: 'middle' }}>
          <CalendarOutlined style={{ color: '#1677ff' }} />
          <span style={{ fontWeight: 500, color: '#262626' }}>{formatted}</span>
          <Tooltip title={`原始值: ${value}`}>
            <Tag style={{ fontSize: 10, padding: '0 4px', color: '#8c8c8c', cursor: 'help' }}>ISO</Tag>
          </Tooltip>
        </Space>
      );
    }
    return <span style={{ wordBreak: 'break-all', fontWeight: 500 }}>{value}</span>;
  }

  if (typeof value !== 'object') {
    return <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 500 }}>{String(value)}</span>;
  }

  // 单个附件对象识别
  if (isAttachmentItem(value)) {
    return <SingleAttachmentCard item={value} type={type} />;
  }

  // 数组结构（标签列表、附件列表、关联子表格等）
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: '#bfbfbf', fontStyle: 'italic' }}>[] (空数组)</span>;
    }

    // 附件数组
    if (value.every((item) => isAttachmentItem(item))) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>
            <PaperClipOutlined style={{ marginRight: 4 }} /> 共 {value.length} 个附件
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {value.map((att, idx) => (
              <SingleAttachmentCard key={idx} item={att} type={type} />
            ))}
          </div>
        </div>
      );
    }

    // 简单标量数组（如 ['VIP', '供应商'] 或 [1, 2, 3]）
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

    // 仅包含 ID 的关联记录集合
    const onlyHasIds = value.every(
      (item) => typeof item === 'object' && item && Object.keys(item).filter((k) => k !== 'id' && k !== 'ID' && k !== 'key').length === 0
    );

    if (onlyHasIds) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>📦 包含 {value.length} 条关联 ID</div>
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

    // 复合多字段子表格数组 (Sub-Table)
    const allObjKeys = Array.from(
      new Set(
        value.flatMap((item) => (typeof item === 'object' && item ? Object.keys(item) : []))
      )
    ).filter((k) => !k.startsWith('_'));

    const columns = [
      {
        title: '#',
        key: '_index',
        width: 45,
        render: (_: any, __: any, index: number) => <span style={{ color: '#8c8c8c', fontSize: 11 }}>{index + 1}</span>,
      },
      ...allObjKeys.slice(0, 8).map((colKey) => ({
        title: <span style={{ fontSize: 11 }}>{parseI18nTitle(colKey, colKey)}</span>,
        dataIndex: colKey,
        key: colKey,
        ellipsis: true,
        render: (cellVal: any) => {
          if (cellVal === null || cellVal === undefined) return <span style={{ color: '#bfbfbf' }}>-</span>;
          if (typeof cellVal === 'object') return <span style={{ color: '#1677ff' }}>[Object]</span>;
          return <span style={{ fontSize: 12 }}>{String(cellVal)}</span>;
        },
      })),
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontSize: 11, color: '#8c8c8c' }}>
            <TableOutlined style={{ marginRight: 4 }} /> 子表格 (共 {value.length} 行)
          </span>
          <Button
            size="small"
            type="text"
            icon={viewMode === 'visual' ? <CodeOutlined /> : <TableOutlined />}
            onClick={() => setViewMode(viewMode === 'visual' ? 'json' : 'visual')}
            style={{ fontSize: 11, height: 20, padding: '0 4px' }}
          >
            {viewMode === 'visual' ? 'JSON' : '表格'}
          </Button>
        </div>

        {viewMode === 'json' ? (
          <pre style={{ margin: 0, padding: 8, background: 'rgba(0,0,0,0.03)', borderRadius: 4, fontSize: 11, maxHeight: 180, overflow: 'auto' }}>
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : (
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
            <Table
              size="small"
              bordered={false}
              pagination={false}
              columns={columns}
              dataSource={value.map((item, idx) => ({ ...item, _key: idx }))}
              rowKey="_key"
              scroll={{ x: 'max-content', y: 160 }}
              style={{ fontSize: 11 }}
            />
          </div>
        )}
      </div>
    );
  }

  // 纯复杂对象结构
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <span style={{ color: '#bfbfbf', fontStyle: 'italic' }}>{} (空对象)</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          type="text"
          icon={viewMode === 'visual' ? <CodeOutlined /> : <AppstoreOutlined />}
          onClick={() => setViewMode(viewMode === 'visual' ? 'json' : 'visual')}
          style={{ fontSize: 11, height: 20, padding: '0 4px' }}
        >
          {viewMode === 'visual' ? 'JSON' : '卡片'}
        </Button>
      </div>
      {viewMode === 'json' ? (
        <pre style={{ margin: 0, padding: 8, background: 'rgba(0,0,0,0.03)', borderRadius: 4, fontSize: 11, maxHeight: 180, overflow: 'auto' }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {entries.map(([k, v]: [string, any]) => (
            <Tag key={k} style={{ margin: 0, padding: '2px 6px' }}>
              <span style={{ color: '#8c8c8c' }}>{parseI18nTitle(k, k)}: </span>
              <span>
                {v === null || v === undefined
                  ? 'null'
                  : typeof v === 'object'
                  ? isIsoDateString(v)
                    ? new Date(v).toLocaleString()
                    : JSON.stringify(v)
                  : String(v)}
              </span>
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
    const fieldTitle = parseI18nTitle(fieldsMap[key]?.title, key);
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
      width={960}
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
                    const rawFieldTitle = fieldsMap[key]?.title || key;
                    const fieldTitle = parseI18nTitle(rawFieldTitle, key);
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
                  const fieldTitle = parseI18nTitle(fieldsMap[key]?.title || key, key);
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
                  const fieldTitle = parseI18nTitle(fieldsMap[key]?.title || key, key);
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
