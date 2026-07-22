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
import { setTimeout as delay } from 'node:timers/promises';

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
  /** Prefix used by an authenticated edge that rewrites to a service's private routes. */
  pathPrefix?: string;
  /** Supplies a short-lived edge Authorization value without persisting or logging it. */
  authorizationHeaderProvider?: () => Promise<string>;
}

export interface InternalHttpClientRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  timeoutMs?: number | undefined;
  requestId?: string | undefined;
  extraHeaders?: Record<string, string> | undefined;
  allowRawSuccess?: boolean | undefined;
  /** Preserve a successful response body for a stricter domain-owned envelope decoder. */
  responseMode?: 'envelope' | 'raw' | undefined;
  skipSentry?: boolean | undefined;
  /** Suppress route identifiers and raw transport errors for private control-plane calls. */
  privateRequest?: boolean | undefined;
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
  | { code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE'; message: string; body?: unknown };

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
  const pathPrefix = cfg.pathPrefix?.replace(/\/+$/, '');
  return {
    async request<T>(args: InternalHttpClientRequest): Promise<InternalHttpClientResult<T>> {
      const timeoutMs = args.timeoutMs ?? cfg.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const startedAt = Date.now();
      let authorizationHeaders: Record<string, string> = {};
      if (cfg.authorizationHeaderProvider !== undefined) {
        const authorizationTimeoutError = new Error('edge authorization deadline exceeded');
        const timeoutController = new AbortController();
        try {
          const authorizationTimeout = delay(Math.max(1, timeoutMs), undefined, {
            signal: timeoutController.signal,
            ref: false,
          }).then(() => {
            throw authorizationTimeoutError;
          });
          authorizationHeaders = {
            authorization: await Promise.race([
              cfg.authorizationHeaderProvider(),
              authorizationTimeout,
            ]),
          };
        } catch (error) {
          if (error === authorizationTimeoutError) {
            return {
              ok: false,
              error: { code: 'TIMEOUT', message: `Request exceeded ${String(timeoutMs)}ms` },
            };
          }
          return {
            ok: false,
            error: { code: 'NETWORK_ERROR', message: 'edge authorization unavailable' },
          };
        } finally {
          timeoutController.abort();
        }
      }
      const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt);
      if (remainingTimeoutMs <= 0) {
        return {
          ok: false,
          error: { code: 'TIMEOUT', message: `Request exceeded ${String(timeoutMs)}ms` },
        };
      }
      const requestPath =
        pathPrefix === undefined
          ? args.path
          : `${pathPrefix}${args.path.startsWith('/internal/') ? args.path.slice('/internal'.length) : args.path}`;
      const transport = await sendInternalRequest({
        baseUrl,
        path: requestPath,
        method: args.method,
        token: cfg.token,
        logger: cfg.logger,
        headers: { ...(args.extraHeaders ?? {}), ...authorizationHeaders },
        ...(args.body !== undefined ? { jsonBody: args.body } : {}),
        timeoutMs: remainingTimeoutMs,
        requestId: args.requestId,
        skipSentry: args.skipSentry,
        privateRequest: args.privateRequest,
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

      if (args.responseMode === 'raw') {
        return { ok: true, value: body as T };
      }

      const envelope = unwrapEnvelope<T>(body);
      if (envelope.ok) {
        return { ok: true, value: envelope.value };
      }
      if (
        args.allowRawSuccess === true &&
        body !== null &&
        typeof body === 'object' &&
        !('success' in body)
      ) {
        return { ok: true, value: body as T };
      }
      Object.defineProperty(envelope.error, 'body', {
        value: body,
        enumerable: false,
      });
      return { ok: false, error: envelope.error };
    },
  };
}
