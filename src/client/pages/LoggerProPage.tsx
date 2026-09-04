import React, { useState } from 'react';
import { Card, Tabs } from 'antd';
import {
  DashboardOutlined,
  CodeOutlined,
  AuditOutlined,
  SettingOutlined,
  BellOutlined,
  DeploymentUnitOutlined,
} from '@ant-design/icons';
import { DashboardTab } from '../components/DashboardTab';
import { LogConsoleTab } from '../components/LogConsoleTab';
import { AuditLogTab } from '../components/AuditLogTab';
import { TraceTab } from '../components/TraceTab';
import { ConfigTab } from '../components/ConfigTab';
import { AlertTab } from '../components/AlertTab';
import { LoggerProContext } from '../context/LoggerProContext';

export interface LoggerProPageProps {
  api?: any;
}

export const LoggerProPage: React.FC<LoggerProPageProps> = ({ api }) => {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <LoggerProContext.Provider value={{ api }}>
      <div style={{ padding: '20px 24px', background: '#f0f2f5', minHeight: '100%' }}>
        <Card
          bordered={false}
          style={{
            boxShadow: '0 1px 4px rgba(0,21,41,.08)',
            borderRadius: 8,
          }}
          bodyStyle={{ padding: '16px 24px 24px' }}
        >
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 4px 0', fontSize: 20, fontWeight: 600, color: '#1f1f1f' }}>
            📜 日志与审计管理 Pro (Logger Pro)
          </h2>
          <p style={{ margin: 0, color: '#8c8c8c', fontSize: 13 }}>
            企业级系统运行日志控制台、动态日志配置、用户操作审计跟踪、数据变更 Diff 对比及多渠道异常告警体系。
          </p>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          type="line"
          size="large"
          items={[
            {
              key: 'dashboard',
              label: (
                <span>
                  <DashboardOutlined /> 运维概览
                </span>
              ),
              children: <DashboardTab />,
            },
            {
              key: 'console',
              label: (
                <span>
                  <CodeOutlined /> 日志控制台
                </span>
              ),
              children: <LogConsoleTab />,
            },
            {
              key: 'audit',
              label: (
                <span>
                  <AuditOutlined /> 操作审计
                </span>
              ),
              children: <AuditLogTab />,
            },
            {
              key: 'trace',
              label: (
                <span>
                  <DeploymentUnitOutlined /> 全链路追踪
                </span>
              ),
              children: <TraceTab />,
            },
            {
              key: 'config',
              label: (
                <span>
                  <SettingOutlined /> 日志配置
                </span>
              ),
              children: <ConfigTab />,
            },
            {
              key: 'alert',
              label: (
                <span>
                  <BellOutlined /> 异常告警
                </span>
              ),
              children: <AlertTab />,
            },
          ]}
        />
      </Card>
    </div>
    </LoggerProContext.Provider>
  );
};

export default LoggerProPage;
