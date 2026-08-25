import React from 'react';
import { Modal, Tag, Descriptions, Empty } from 'antd';

interface DiffModalProps {
  visible: boolean;
  onClose: () => void;
  record: any;
}

export const DiffModal: React.FC<DiffModalProps> = ({ visible, onClose, record }) => {
  if (!record) return null;

  const diff = record.diff;
  const beforeData = record.beforeData;
  const afterData = record.afterData;

  const hasDiff = diff && typeof diff === 'object' && Object.keys(diff).length > 0;

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🛡️ 数据变更差异对比 (Diff View)</span>
          <Tag color="blue">{record.collectionName}</Tag>
          <Tag color="cyan">{record.actionName}</Tag>
          {record.recordId && <Tag>ID: {record.recordId}</Tag>}
        </div>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      <div style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="操作用户">{record.userUsername || 'Anonymous'} ({record.userNickname || '-'})</Descriptions.Item>
          <Descriptions.Item label="客户端 IP">{record.ip || '-'}</Descriptions.Item>
          <Descriptions.Item label="请求路径">{record.method} {record.path}</Descriptions.Item>
          <Descriptions.Item label="操作时间">{new Date(record.createdAt).toLocaleString()}</Descriptions.Item>
        </Descriptions>
      </div>

      {hasDiff ? (
        <div>
          <h4 style={{ marginBottom: 12, fontWeight: 600 }}>📝 变更字段明细：</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid #e8e8e8' }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', width: '25%' }}>字段名</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', width: '37.5%', color: '#cf1322' }}>变更前 (Old)</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', width: '37.5%', color: '#389e0d' }}>变更后 (New)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(diff).map(([key, value]: [string, any]) => (
                <tr key={key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}><code>{key}</code></td>
                  <td style={{ padding: '8px 12px', background: '#fff1f0', color: '#a8071a', wordBreak: 'break-all' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                      {typeof value?.old === 'object' ? JSON.stringify(value.old, null, 2) : String(value?.old ?? 'null')}
                    </pre>
                  </td>
                  <td style={{ padding: '8px 12px', background: '#f6ffed', color: '#237804', wordBreak: 'break-all' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                      {typeof value?.new === 'object' ? JSON.stringify(value.new, null, 2) : String(value?.new ?? 'null')}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : beforeData || afterData ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <h4 style={{ color: '#cf1322', fontWeight: 600 }}>原始快照 (Before)</h4>
            <pre style={{ background: '#fff1f0', padding: 12, borderRadius: 6, maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
              {JSON.stringify(beforeData, null, 2) || '(无)'}
            </pre>
          </div>
          <div>
            <h4 style={{ color: '#389e0d', fontWeight: 600 }}>提交快照 (After)</h4>
            <pre style={{ background: '#f6ffed', padding: 12, borderRadius: 6, maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
              {JSON.stringify(afterData, null, 2) || '(无)'}
            </pre>
          </div>
        </div>
      ) : (
        <Empty description="该操作未记录字段快照或无属性变更" />
      )}
    </Modal>
  );
};
