/**
 * HTTP client helper for E2E tests.
 *
 * Provides axios instance configured for code-agent API.
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';

/**
 * Create a configured axios instance for E2E testing.
 *
 * Uses environment variables for configuration:
 * - E2E_API_URL: Base URL of code-agent (default: http://localhost:8128)
 * - E2E_AUTH_TOKEN: Auth token for requests
 */
export function createTestClient(): AxiosInstance {
  const baseURL = process.env['E2E_API_URL'] ?? 'http://localhost:8128';

  const token = process.env['E2E_AUTH_TOKEN'];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add auth token if provided
  if (token !== undefined && token !== '') {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add internal auth header for internal endpoints
  const internalToken = process.env['E2E_INTERNAL_AUTH_TOKEN'];
  if (internalToken !== undefined && internalToken !== '') {
    headers['X-Internal-Auth'] = internalToken;
  }

  const client = axios.create({
    baseURL,
    headers,
    // Don't throw on non-2xx - tests need to inspect error responses
    validateStatus: () => true,
  });

  return client;
}

/**
 * Extract error message from Axios error.
 */
export function getAxiosErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<unknown>;
    if (axiosError.response?.data !== undefined && typeof axiosError.response.data === 'object') {
      const data = axiosError.response.data as { error?: string; message?: string };
      return data.error ?? data.message ?? JSON.stringify(data);
    }
    return axiosError.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

/**
 * Type for CodeTask API response.
 */
export interface CodeTask {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: 'opus' | 'auto' | 'glm';
  workerLocation: 'mac' | 'vm';
  repository: string;
  baseBranch: string;
  traceId: string;
  status: 'dispatched' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: string;
  updatedAt: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearFallback?: boolean;
  result?: {
    prUrl?: string;
    branch: string;
    commits: number;
    summary: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: 'success' | 'conflict' | 'skipped';
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
  };
  completedAt?: string;
  dispatchedAt?: string;
}

/**
 * Type for task submission response.
 */
export interface SubmitTaskResponse {
  status: 'submitted' | 'duplicate';
  codeTaskId: string;
  resourceUrl?: string;
  existingTaskId?: string;
}

/**
 * Type for cancel task response.
 */
export interface CancelTaskResponse {
  status: 'cancelled';
  error?: string;
}
