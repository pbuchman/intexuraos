/**
 * Fastify integration that opens an `AsyncLocalStorage`-backed
 * {@link RequestContext} for every inbound request BEFORE any user
 * route handler runs.
 *
 * Plan §3 (docs/plans/2026-04-24-INT-1538-observability-unification.md).
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RequestContext } from '@intexuraos/common-core';
import { runWithRequestContext } from '@intexuraos/common-core';

/** Standard inbound `x-request-id` header (lower-case to match Node http normalisation). */
export const X_REQUEST_ID = 'x-request-id';
/** Standard inbound `x-correlation-id` header. */
export const X_CORRELATION_ID = 'x-correlation-id';

/**
 * Resolve a single header value from a Fastify request, returning the
 * first non-empty string if the header is an array, otherwise the
 * raw string, otherwise `undefined`.
 */
function readHeader(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name];
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === 'string' && first.length > 0) {
      return first;
    }
  }
  return undefined;
}

/**
 * Build a {@link RequestContext} from inbound headers. Generates a UUID for
 * the request id when no `x-request-id` is supplied. Preserves the upstream
 * `x-request-id` as `parentId` whenever the inbound request already carries
 * one (cross-service chains).
 */
export function buildRequestContext(request: FastifyRequest): RequestContext {
  const inboundRequestId = readHeader(request, X_REQUEST_ID);
  const requestId = inboundRequestId ?? randomUUID();
  const correlationId = readHeader(request, X_CORRELATION_ID) ?? requestId;

  const ctx: RequestContext = {
    requestId,
    correlationId,
  };

  if (inboundRequestId !== undefined) {
    ctx.parentId = inboundRequestId;
  }

  return ctx;
}

/**
 * Register an `onRequest` hook that opens a {@link RequestContext} for the
 * remainder of the request lifecycle.
 *
 * Subsequent hooks, route handlers, downstream HTTP clients and Pub/Sub
 * publishers can read the active context via `getRequestContext()` /
 * `getRequestId()` from `@intexuraos/common-core`.
 *
 * Internally uses {@link AsyncLocalStorage.run} via `runWithRequestContext`,
 * invoking the Fastify `done()` callback inside the runner so the entire
 * request handler chain inherits the bound store.
 *
 * **Registration order matters.** Fastify executes `onRequest` hooks in the
 * order they are registered. Call `registerRequestContext(app)` BEFORE any
 * other hook (or plugin) that needs to read the context — in particular
 * before route registration and before the `logIncomingRequest()` helper
 * from `@intexuraos/common-http` is invoked inside any route handler. If
 * registered after another hook that reads `getRequestContext()`, the read
 * will return `undefined`.
 *
 * @example
 * ```ts
 * import Fastify from 'fastify';
 * import { registerRequestContext } from '@intexuraos/http-server';
 *
 * const app = Fastify({ ... });
 * registerRequestContext(app);          // 1) bind the context first
 * await app.register(intexuraFastifyPlugin); // 2) then standard plugins
 * await app.register(myRoutes);              // 3) then routes
 * ```
 */
export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    const ctx = buildRequestContext(request);
    runWithRequestContext(ctx, () => {
      done();
    });
  });
}
