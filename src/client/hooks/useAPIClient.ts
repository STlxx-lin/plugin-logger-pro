import { useAPIClient as useAPIClientV1, useApp as useAppV1 } from '@nocobase/client';

/**
 * V1 客户端环境下的 useAPIClient
 */
export function useAPIClient(): any {
  try {
    if (typeof useAPIClientV1 === 'function') {
      const api = useAPIClientV1();
      if (api) return api;
    }
  } catch {}

  try {
    if (typeof useAppV1 === 'function') {
      const app = useAppV1();
      if (app?.apiClient) return app.apiClient;
    }
  } catch {}

  if (typeof window !== 'undefined' && (window as any).nocobase?.apiClient) {
    return (window as any).nocobase.apiClient;
  }

  return {
    request: async (opts: any) => {
      console.warn('[LoggerPro] Fallback V1 APIClient called:', opts);
      return {};
    },
  };
}

export default useAPIClient;
