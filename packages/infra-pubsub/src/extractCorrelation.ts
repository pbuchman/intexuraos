/**
 * Extract a RequestContext from inbound Pub/Sub message attributes.
 *
 * Reads `x-request-id`, `x-correlation-id`, and `traceparent` (W3C Trace Context).
 * Generates a fresh UUID when `x-request-id` is absent or empty so consumers
 * always have a non-empty correlation surface to log.
 */
import { randomUUID } from 'node:crypto';
import type { RequestContext } from './requestContextShim.js';

export type PubSubAttributes = Record<string, string> | null | undefined;

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function extractCorrelation(attributes: PubSubAttributes): RequestContext {
  const attrs: Record<string, string> = attributes ?? {};

  const rawRequestId = attrs['x-request-id'];
  const requestId = rawRequestId !== undefined && rawRequestId !== '' ? rawRequestId : randomUUID();

  const rawCorrelationId = attrs['x-correlation-id'];
  const correlationId =
    rawCorrelationId !== undefined && rawCorrelationId !== '' ? rawCorrelationId : requestId;

  const traceparent = attrs['traceparent'];
  let traceId: string | undefined;
  let parentId: string | undefined;
  if (traceparent !== undefined) {
    const match = TRACEPARENT_RE.exec(traceparent);
    if (match !== null) {
      traceId = match[1];
      parentId = match[2];
    }
  }

  return {
    requestId,
    correlationId,
    ...(traceId !== undefined ? { traceId } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
  };
}
