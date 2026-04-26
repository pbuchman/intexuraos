/**
 * Per-request trace context backed by AsyncLocalStorage.
 *
 * Stores the current `requestId` so deeply-nested code (use cases, infra
 * adapters, internal HTTP clients) can access it without it being threaded
 * explicitly through every function signature.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface TraceStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<TraceStore>();

/**
 * Run `fn` inside a new ALS scope where `getCurrentRequestId()` returns
 * the supplied `requestId`. The scope is automatically torn down when
 * `fn` resolves (or rejects).
 */
export function runWithRequestId<T>(
  requestId: string,
  fn: () => Promise<T> | T
): Promise<T> | T {
  return storage.run({ requestId }, fn);
}

/**
 * Get the requestId associated with the current ALS scope, or `undefined`
 * when called outside any scope.
 */
export function getCurrentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Imperatively bind `requestId` to the current async context using
 * `AsyncLocalStorage.enterWith`. Used by the Fastify plugin's `onRequest`
 * hook because Fastify's hook machinery already provides a per-request
 * async context — wrapping the rest of the lifecycle in a callback would
 * complicate the plugin shape.
 */
export function setCurrentRequestId(requestId: string): void {
  storage.enterWith({ requestId });
}
