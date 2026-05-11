import { getRequestContext } from '@intexuraos/common-core';
import { getCurrentRequestId } from '@intexuraos/common-http';

export interface PropagationHeadersOptions {
  headers?: Record<string, string> | undefined;
  requestId?: string | undefined;
}

export function resolvePropagationHeaders(
  options: PropagationHeadersOptions = {}
): Record<string, string> {
  const headers = { ...(options.headers ?? {}) };
  const ctx = getRequestContext();

  const requestId = options.requestId ?? ctx?.requestId ?? getCurrentRequestId();
  if (
    (headers['x-request-id'] === undefined || headers['x-request-id'] === '') &&
    requestId !== undefined &&
    requestId !== ''
  ) {
    headers['x-request-id'] = requestId;
  }

  if (
    (headers['x-correlation-id'] === undefined || headers['x-correlation-id'] === '') &&
    ctx?.correlationId !== undefined
  ) {
    headers['x-correlation-id'] = ctx.correlationId;
  }

  return headers;
}
