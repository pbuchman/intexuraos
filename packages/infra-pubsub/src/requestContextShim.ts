// TODO(INT-1538-S2): delete this file once
// `packages/common-core/src/tracing/requestContext.ts` lands; replace the
// type-only re-export in index.ts with an import from common-core. The
// shim exists ONLY for parallel execution of S3 with S2.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  traceId?: string;
  parentId?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}
