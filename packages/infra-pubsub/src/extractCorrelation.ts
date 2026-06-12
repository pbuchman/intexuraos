/**
 * Extract a RequestContext from inbound Pub/Sub message attributes.
 *
 * Reads `x-request-id` and `x-correlation-id`.
 * Generates a fresh UUID when `x-request-id` is absent or empty so consumers
 * always have a non-empty correlation surface to log.
 */
import { randomUUID } from 'node:crypto';
import type { RequestContext } from './requestContextShim.js';

export type InboundPubSubAttributes = Record<string, string> | null | undefined;

export function extractCorrelation(attributes: InboundPubSubAttributes): RequestContext {
  const attrs: Record<string, string> = attributes ?? {};

  const rawRequestId = attrs['x-request-id'];
  const requestId = rawRequestId !== undefined && rawRequestId !== '' ? rawRequestId : randomUUID();

  const rawCorrelationId = attrs['x-correlation-id'];
  const correlationId =
    rawCorrelationId !== undefined && rawCorrelationId !== '' ? rawCorrelationId : requestId;

  return {
    requestId,
    correlationId,
  };
}
