/**
 * TraceId utilities for distributed tracing.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 2367-2415)
 *
 * TraceId enables end-to-end request tracing across service boundaries.
 */

import { randomUUID } from 'node:crypto';

export const TRACE_ID_HEADER = 'X-Trace-Id';

/**
 * Extract traceId from headers, or generate a new one.
 *
 * @param headers - HTTP headers object (case-insensitive lookup)
 * @returns Existing traceId or newly generated UUID
 */
export function extractOrGenerateTraceId(
  headers: Record<string, string | string[] | undefined>
): string {
  const existing = headers[TRACE_ID_HEADER.toLowerCase()] ?? headers[TRACE_ID_HEADER];

  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }

  if (Array.isArray(existing) && existing.length > 0 && existing[0] !== undefined) {
    return existing[0];
  }

  return randomUUID();
}

/**
 * Create headers object with traceId.
 *
 * @param traceId - The trace ID to include in headers
 * @returns Headers object with X-Trace-Id set
 */
export function traceIdHeaders(traceId: string): Record<string, string> {
  return { [TRACE_ID_HEADER]: traceId };
}
