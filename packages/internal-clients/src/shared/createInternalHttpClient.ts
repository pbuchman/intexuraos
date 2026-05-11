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

import { unwrapEnvelope } from './envelope.js';
import { sendInternalRequest } from './request.js';

type LogFn = (obj: object, msg?: string) => void;
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
  timeoutMs?: number | undefined;
  requestId?: string | undefined;
  extraHeaders?: Record<string, string> | undefined;
}

export type InternalHttpClientError =
  | { code: 'TIMEOUT'; message: string }
  | { code: 'NETWORK_ERROR'; message: string }
  | {
      code: 'API_ERROR';
      message: string;
      status: number;
      statusText: string;
      rawText: string;
      body: unknown;
    }
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
      const transport = await sendInternalRequest({
        baseUrl,
        path: args.path,
        method: args.method,
        token: cfg.token,
        logger: cfg.logger,
        headers: args.extraHeaders,
        ...(args.body !== undefined ? { jsonBody: args.body } : {}),
        timeoutMs,
        requestId: args.requestId,
      });

      if (!transport.ok) {
        return { ok: false, error: transport.error };
      }

      const { response, body } = transport;
      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}`,
            status: response.status,
            statusText: response.statusText,
            rawText: transport.rawText,
            body,
          },
        };
      }

      const envelope = unwrapEnvelope<T>(body);
      if (envelope.ok) {
        return { ok: true, value: envelope.value };
      }
      return { ok: false, error: envelope.error };
    },
  };
}
