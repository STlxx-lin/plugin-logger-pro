import { useApp as useAppV2 } from '@nocobase/client-v2';

/**
 * V2 现代客户端环境下的 useAPIClient (从 useApp().apiClient 获取)
 */
export function useAPIClient(): any {
  try {
    if (typeof useAppV2 === 'function') {
      const app = useAppV2();
      if (app?.apiClient) {
        return app.apiClient;
      }
    }
  } catch {}

  if (typeof window !== 'undefined' && (window as any).nocobase?.apiClient) {
    return (window as any).nocobase.apiClient;
  }

  return {
    request: async (opts: any) => {
      console.warn('[LoggerPro] Fallback V2 APIClient called:', opts);
      return {};
    },
  };
}

export default useAPIClient;
