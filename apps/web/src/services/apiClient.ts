import type { ApiErrorResponse, ApiResponse } from '@/types';

export type ConflictReason = 'duplicate' | 'active' | 'duplicate_approval';

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

  // Pattern 3: "Duplicate: {taskId}"
  const approvalPattern = /^Duplicate: (.+)/;
  const approvalMatch = approvalPattern.exec(message);
  if (approvalMatch?.[1]) {
    return { taskId: approvalMatch[1], reason: 'duplicate_approval' };
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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number; // Timeout in milliseconds (default: 30000ms)
}

const DEFAULT_TIMEOUT_MS = 30000;

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {}, timeout = DEFAULT_TIMEOUT_MS } = options;

  // AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  const url = `${baseUrl}${path}`;
  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...headers,
  };

  // Only set Content-Type for requests with a body
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const fetchOptions: RequestInit = {
    method,
    headers: requestHeaders,
    signal: controller.signal,
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
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Request timed out. Please check your connection and try again.', 408);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
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
  if (
    typeof json !== 'object' ||
    json === null ||
    !('success' in json)
  ) {
    // Some endpoints return Fastify's default error format without the `success` envelope
    const raw = json as Record<string, unknown>;
    if (typeof raw['message'] === 'string' && typeof raw['statusCode'] === 'number') {
      throw new ApiError(
        'UNKNOWN',
        raw['message'],
        raw['statusCode']
      );
    }
    throw new ApiError('UNKNOWN', 'Invalid response format', response.status);
  }

  const data = json as ApiResponse<T>;

  if (!data.success) {
    const errorResponse = json as Partial<ApiErrorResponse>;
    const error = errorResponse.error;
    if (error === undefined) {
      throw new ApiError('UNKNOWN', 'An unexpected error occurred', response.status);
    }
    throw new ApiError(error.code, error.message, response.status, error.details);
  }

  return data.data;
}
