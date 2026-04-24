/**
 * Private fetch utility for linear-agent HTTP calls.
 *
 * Centralizes AbortController + timeout, header construction, JSON body
 * serialization, and envelope parsing. Returns a discriminated union so
 * callers can map to their own Result types with method-specific log messages
 * and error codes.
 *
 * NOT exported from any index — endpoint modules import directly.
 */

export type LinearFetchResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'http-error'; status: number; errorText: string }
  | { kind: 'invalid-body'; body: unknown }
  | { kind: 'timeout' }
  | { kind: 'network-error'; error: unknown };

export interface FetchLinearAgentOptions {
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  internalAuthToken: string;
  timeoutMs: number;
  userId?: string;
  body?: unknown;
  /** When true (default), `success: true` without `data` is invalid-body.
   *  When false, returns `{ kind: 'ok', data: undefined }`. */
  requireData?: boolean;
}

// Callers map each LinearFetchResult kind to their own error code / log level.
// Shapes differ per endpoint (404 → NOT_FOUND for some, 429 → RATE_LIMITED for
// others, log level varies), so no generic mapping helper lives here.
export function fetchLinearAgent<T>(
  options: FetchLinearAgentOptions & { requireData: false }
): Promise<LinearFetchResult<T | undefined>>;
export function fetchLinearAgent<T>(
  options: FetchLinearAgentOptions
): Promise<LinearFetchResult<T>>;
export async function fetchLinearAgent<T>(
  options: FetchLinearAgentOptions
): Promise<LinearFetchResult<T | undefined>> {
  const {
    url,
    method,
    internalAuthToken,
    timeoutMs,
    userId,
    body,
    requireData = true,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const headers: Record<string, string> = {
      'X-Internal-Auth': internalAuthToken,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (userId !== undefined) {
      headers['X-User-Id'] = userId;
    }

    const fetchInit: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body !== undefined) {
      fetchInit.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchInit);

    if (!response.ok) {
      const errorText = await response.text();
      return { kind: 'http-error', status: response.status, errorText };
    }

    const parsed = (await response.json()) as { success?: boolean; data?: unknown };

    if (parsed.success !== true) {
      return { kind: 'invalid-body', body: parsed };
    }

    if (parsed.data === undefined) {
      if (!requireData) {
        return { kind: 'ok', data: undefined };
      }
      return { kind: 'invalid-body', body: parsed };
    }

    return { kind: 'ok', data: parsed.data as T };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { kind: 'timeout' };
    }
    return { kind: 'network-error', error };
  } finally {
    clearTimeout(timeoutId);
  }
}
