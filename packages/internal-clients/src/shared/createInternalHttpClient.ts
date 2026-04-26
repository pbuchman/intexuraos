/**
 * Thin facade for service-to-service HTTP calls in IntexuraOS.
 *
 * Centralises the cross-cutting concerns every internal client needs:
 *  - sets `x-internal-auth` from a static token,
 *  - propagates an `x-request-id` from AsyncLocalStorage (or an explicit
 *    override) so tracing follows the call,
 *  - times out via `AbortController` (default 30s, per-call override),
 *  - unwraps the standard `{ success, data?, error? }` envelope into a
 *    structural Result via `unwrapEnvelope`,
 *  - maps fetch failure modes into a tagged `InternalHttpClientError`.
 *
 * The shape is intentionally narrow — callers higher up in the stack add
 * type-safe wrappers for specific endpoints; this module never grows
 * service-specific logic.
 */

import { getCurrentRequestId } from '@intexuraos/common-http';
import { unwrapEnvelope } from './envelope.js';

type LogFn = (obj: unknown, msg?: string) => void;
export interface InternalHttpClientLogger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
}

export interface InternalHttpClientConfig {
  baseUrl: string;
  token: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export interface InternalHttpClientRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  timeoutMs?: number;
  requestId?: string;
  extraHeaders?: Record<string, string>;
}

export type InternalHttpClientError =
  | { code: 'TIMEOUT'; message: string }
  | { code: 'NETWORK_ERROR'; message: string }
  | { code: 'API_ERROR'; message: string; status?: number }
  | { code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE'; message: string };

export type InternalHttpClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: InternalHttpClientError };

export interface InternalHttpClient {
  request<T>(args: InternalHttpClientRequest): Promise<InternalHttpClientResult<T>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createInternalHttpClient(cfg: InternalHttpClientConfig): InternalHttpClient {
  // Strip any trailing slashes so callers don't accidentally double-slash
  // when joining the path. (`'https://svc//'` + `'/foo'` → `'https://svc/foo'`.)
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  return {
    async request<T>(args: InternalHttpClientRequest): Promise<InternalHttpClientResult<T>> {
      const timeoutMs = args.timeoutMs ?? cfg.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      const headers: Record<string, string> = {
        'x-internal-auth': cfg.token,
        ...(args.extraHeaders ?? {}),
      };
      if (args.body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      const requestId = args.requestId ?? getCurrentRequestId();
      if (requestId !== undefined) {
        headers['x-request-id'] = requestId;
      }

      const url = `${baseUrl}${args.path}`;
      try {
        const init: RequestInit = {
          method: args.method,
          headers,
          signal: controller.signal,
        };
        if (args.body !== undefined) {
          init.body = JSON.stringify(args.body);
        }
        const response = await fetch(url, init);
        if (!response.ok) {
          return {
            ok: false,
            error: {
              code: 'API_ERROR',
              message: `HTTP ${String(response.status)}`,
              status: response.status,
            },
          };
        }
        const body: unknown = await response.json();
        const envelope = unwrapEnvelope<T>(body);
        if (envelope.ok) {
          return { ok: true, value: envelope.value };
        }
        return { ok: false, error: envelope.error };
      } catch (err: unknown) {
        const error = err as { name?: string; message?: string };
        if (error.name === 'AbortError') {
          return {
            ok: false,
            error: {
              code: 'TIMEOUT',
              message: `Request exceeded ${String(timeoutMs)}ms`,
            },
          };
        }
        cfg.logger.warn({ url, err }, 'internal-client network error');
        return {
          ok: false,
          error: {
            code: 'NETWORK_ERROR',
            message: error.message ?? 'unknown',
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
