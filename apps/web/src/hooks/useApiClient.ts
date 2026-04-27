import { useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useAuth } from '@/context';
import { ApiError, apiRequest } from '@/services/apiClient';

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
  // Reach directly into Auth0 for a cache-bypassing silent refresh. The
  // wrapper in `useAuth()` only exposes a cached read; we need to force a
  // fresh token after a 401 to recover from token expiry without reloading.
  const { getAccessTokenSilently } = useAuth0();

  const request = useCallback(
    async <T>(baseUrl: string, path: string, options?: RequestOptions): Promise<T> => {
      const token = await getAccessToken();
      return await apiRequest<T>(baseUrl, path, token, {
        ...(options ?? {}),
        refreshToken: async (): Promise<string> => {
          return await getAccessTokenSilently({ cacheMode: 'off' });
        },
      });
    },
    [getAccessToken, getAccessTokenSilently]
  );

  return { request, isAuthenticated };
}

export { ApiError };
