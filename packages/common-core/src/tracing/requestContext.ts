/**
 * Request context primitive backed by AsyncLocalStorage.
 *
 * Provides a per-request scope that carries the inbound request id,
 * correlation id, and (when active) the OpenTelemetry trace context.
 * Every Fastify handler MUST be wrapped in `runWithRequestContext` so
 * downstream calls (loggers, internal HTTP clients, Pub/Sub publishers)
 * can read the current `requestId` without threading it through every
 * function signature.
 *
 * Plan §3 (docs/plans/2026-04-24-INT-1538-observability-unification.md).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request correlation context propagated through async work.
 */
export interface RequestContext {
  /** Inbound `x-request-id` (or generated UUID at the HTTP edge). */
  requestId: string;
  /** Equal to `requestId` at the HTTP edge; preserved across hops. */
  correlationId: string;
  /** OpenTelemetry trace id when an active span exists. */
  traceId?: string;
  /** Upstream `x-request-id` for cross-service chains. */
  parentId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with `ctx` as the active `RequestContext`.
 *
 * The context is visible to any synchronous or asynchronous code reachable
 * from `fn`, including `await`-ed continuations.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Return the active `RequestContext`, or `undefined` if no context is in scope.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Convenience accessor for the active request id.
 *
 * @returns The active request id, or `undefined` if no context is in scope.
 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
