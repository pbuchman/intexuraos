import { useCallback } from 'react';
import { useAuth } from '@/context';
import { apiRequest, ApiError } from '@/services/apiClient';

interface UseApiClientResult {
  request: <T>(baseUrl: string, path: string, options?: RequestOptions) => Promise<T>;
  isAuthenticated: boolean;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export function useApiClient(): UseApiClientResult {
  const { getAccessToken, isAuthenticated } = useAuth();

  const request = useCallback(
    async <T>(baseUrl: string, path: string, options?: RequestOptions): Promise<T> => {
      const token = await getAccessToken();
      return await apiRequest<T>(baseUrl, path, token, options ?? {});
    },
    [getAccessToken]
  );

  return { request, isAuthenticated };
}

export { ApiError };
