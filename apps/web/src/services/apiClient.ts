import type { ApiResponse } from '@/types';
import { newRequestId } from '@/services/requestId';

export type ConflictReason = 'duplicate' | 'active';

export interface ConflictErrorInfo {
  taskId: string;
  reason: ConflictReason;
}

/**
 * Parse a 409 CONFLICT error message to extract task ID and conflict reason.
 * Returns null if the message doesn't match any known conflict pattern.
 */
export function parseConflictError(message: string): ConflictErrorInfo | null {
  // Pattern 1: "Similar task submitted in last 5 minutes: {taskId}"
  const duplicatePattern = /Similar task submitted in last 5 minutes: (.+)/;
  const duplicateMatch = duplicatePattern.exec(message);
  if (duplicateMatch?.[1]) {
    return { taskId: duplicateMatch[1], reason: 'duplicate' };
  }

  // Pattern 2: "Active task already exists for this Linear issue: {taskId}"
  const activePattern = /Active task already exists for this Linear issue: (.+)/;
  const activeMatch = activePattern.exec(message);
  if (activeMatch?.[1]) {
    return { taskId: activeMatch[1], reason: 'active' };
  }

  // Unknown format - return null to fall back to generic error handling
  return null;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number; // Timeout in milliseconds (default: 30000ms)
  /**
   * Optional callback invoked when a request fails with HTTP 401. When
   * provided, the client awaits the new access token, swaps the
   * `Authorization` header, and retries the request exactly once. If the
   * second attempt also returns 401 (or any other failure), the error
   * propagates to the caller.
  */
  refreshToken?: () => Promise<string>;
  /** Optional caller-owned cancellation signal. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 30000;

function callerAbortedError(): ApiError {
  return new ApiError('ABORTED', 'Request was cancelled', 499);
}

function malformedResponseError(): ApiError {
  return new ApiError('MALFORMED_RESPONSE', 'Received an invalid response', 502);
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function awaitCallerAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(callerAbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(callerAbortedError());
    };
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error('Request failed'));
      }
    );
  });
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  options: RequestOptions = {}
): Promise<T> {
  return await performRequest<T>(baseUrl, path, accessToken, options, false);
}

async function performRequest<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  options: RequestOptions,
  retried: boolean
): Promise<T> {
  const { method = 'GET', body, headers = {}, timeout = DEFAULT_TIMEOUT_MS, refreshToken, signal } = options;

  if (isSignalAborted(signal)) {
    throw callerAbortedError();
  }

  // AbortController for timeout handling
  const controller = new AbortController();
  const abortFromCaller = (): void => {
    controller.abort();
  };
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  const url = `${baseUrl}${path}`;
  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Request-Id': newRequestId(),
    ...headers,
  };

  // Only set Content-Type for requests with a body
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const requestSignal =
    signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
  const fetchOptions: RequestInit = {
    method,
    headers: requestHeaders,
    signal: requestSignal,
    // Disable caching to always get fresh data
    cache: 'no-store',
  };

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    // Rethrow with clearer message for abort/timeout errors
    if (typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError') {
      if (isSignalAborted(signal)) {
        throw callerAbortedError();
      }
      throw new ApiError('TIMEOUT', 'Request timed out. Please check your connection and try again.', 408);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  // 401 silent-refresh retry: if a refreshToken callback is provided and this
  // is the first attempt, fetch a fresh token and retry exactly once. The
  // retry inherits the same `cache: 'no-store'` option set above.
  if (response.status === 401 && !retried && refreshToken !== undefined) {
    const newToken = await awaitCallerAbort(refreshToken(), signal);
    return await performRequest<T>(baseUrl, path, newToken, options, true);
  }

  // Handle 204 No Content - successful response with no body
  if (response.status === 204) {
    return undefined as T;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    const status = response.status;
    const message = status >= 502 && status <= 504
      ? 'Service is temporarily unavailable. Please try again in a moment.'
      : `Unexpected response from server (${String(status)})`;
    throw new ApiError('SERVICE_UNAVAILABLE', message, status);
  }

  // Validate response structure defensively
  const rawJson = json as Record<string, unknown>;
  if (!isPlainRecord(json) || !Object.hasOwn(rawJson, 'success') || typeof rawJson['success'] !== 'boolean') {
    // Some endpoints return Fastify's default error format without the `success` envelope
    const raw = json as Record<string, unknown>;
    if (!Object.hasOwn(raw, 'success') && typeof raw['message'] === 'string' && typeof raw['statusCode'] === 'number') {
      throw new ApiError(
        'UNKNOWN',
        raw['message'],
        raw['statusCode']
      );
    }
    throw malformedResponseError();
  }

  const data = json as unknown as ApiResponse<T>;

  if (data.success && !Object.hasOwn(json, 'data')) {
    throw malformedResponseError();
  }

  if (!data.success) {
    const error = rawJson['error'];
    if (
      !isPlainRecord(error)
      || !Object.hasOwn(error, 'code')
      || !Object.hasOwn(error, 'message')
      || typeof error['code'] !== 'string'
      || typeof error['message'] !== 'string'
      || (Object.hasOwn(error, 'details') && !isPlainRecord(error['details']))
    ) {
      throw malformedResponseError();
    }
    throw new ApiError(
      error['code'],
      error['message'],
      response.status,
      isPlainRecord(error['details']) ? error['details'] : undefined
    );
  }

  return data.data;
}
