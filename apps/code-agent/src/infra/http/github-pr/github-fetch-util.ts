/**
 * Private fetch wrapper for the GitHub PR HTTP client.
 *
 * Centralizes timeout handling, auth + content headers, JSON body
 * serialization, and NETWORK_ERROR mapping so the endpoint modules
 * can focus on request shape and response parsing.
 *
 * This module is intentionally NOT re-exported from any barrel — it
 * is an implementation detail of the GitHub PR client only.
 */

import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type { GitHubPRClientError } from '../../../domain/ports/gitHubPRClient.js';

export const GITHUB_API = 'https://api.github.com';

export interface GitHubPRHttpClientConfig {
  timeoutMs: number;
}

export interface GithubRequestInit {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  token: string;
  /** JSON-serialized into the request body when present. */
  body?: unknown;
  /** Overrides the default AbortSignal.timeout(config.timeoutMs) when provided. */
  signal?: AbortSignal;
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function mapErrorStatus(status: number, context: string): GitHubPRClientError {
  if (status === 401 || status === 403) {
    return {
      code: 'UNAUTHORIZED',
      message: `GitHub API returned ${String(status)}: unauthorized or forbidden`,
    };
  }
  if (status === 404) {
    return { code: 'NOT_FOUND', message: context };
  }
  if (status === 429) {
    return { code: 'RATE_LIMITED', message: 'GitHub API rate limit exceeded' };
  }
  return { code: 'API_ERROR', message: `GitHub API returned ${String(status)}` };
}

export function parseNextPageUrl(linkHeader: string | null): string | null {
  if (linkHeader === null) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return match?.[1] ?? null;
}

export function ensureString(
  value: unknown,
  field: string
): Result<string, GitHubPRClientError> {
  if (typeof value !== 'string') {
    return err({ code: 'API_ERROR', message: `GitHub API response missing ${field}` });
  }
  return ok(value);
}

/**
 * Performs a GitHub REST API request with shared auth/header/timeout/error
 * handling. Returns ok(response) for any HTTP response (including non-2xx);
 * the caller is responsible for inspecting `response.ok` / `response.status`
 * and mapping the status via `mapErrorStatus` when needed. Fetch-level
 * failures (DNS, connection refused, timeout) surface as NETWORK_ERROR.
 */
export async function fetchGitHub(
  url: string,
  init: GithubRequestInit,
  config: GitHubPRHttpClientConfig
): Promise<Result<Response, GitHubPRClientError>> {
  try {
    const requestInit: RequestInit = {
      method: init.method,
      headers: githubHeaders(init.token),
      signal: init.signal ?? AbortSignal.timeout(config.timeoutMs),
    };
    if (init.body !== undefined) {
      requestInit.body = JSON.stringify(init.body);
    }

    const response = await fetch(url, requestInit);
    return ok(response);
  } catch (error) {
    return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
  }
}
