import React, { createContext, useContext } from 'react';

export interface LoggerProContextValue {
  api: any;
}

export const LoggerProContext = createContext<LoggerProContextValue | null>(null);

export const useLoggerProAPI = (): any => {
  const ctx = useContext(LoggerProContext);
  if (ctx?.api) {
    return ctx.api;
  }

  // 兜底尝试从 window 上的全局单例获取
  if (typeof window !== 'undefined' && (window as any).nocobase?.apiClient) {
    return (window as any).nocobase.apiClient;
  }

  return {
    request: async (opts: any) => {
      console.warn('[LoggerPro] Fallback APIClient called:', opts);
      return {};
    },
  };
};

export default LoggerProContext;
