import type { IntexIncomingMessage } from '../../domain/ports/incomingMessageHandler.js';

interface PubSubPushBody {
  message?: {
    data?: string;
    messageId?: string;
  };
}

export function decodeIntexMessageIngestPush(body: unknown): IntexIncomingMessage {
  const data = extractData(body);
  const decoded = decodeJson(data);
  const eventType = extractEventType(decoded);
  if (eventType !== 'intex.message.ingest') {
    throw new Error('Expected intex.message.ingest event');
  }

  return toIntexIncomingMessage(decoded);
}

function extractData(body: unknown): string {
  if (body === null || typeof body !== 'object') {
    throw new Error('Invalid Pub/Sub push body');
  }

  const pushBody = body as PubSubPushBody;
  if (typeof pushBody.message?.data !== 'string') {
    throw new Error('Invalid Pub/Sub push body');
  }

  return pushBody.message.data;
}

function decodeJson(data: string): unknown {
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as unknown;
  } catch {
    throw new Error('Invalid Pub/Sub message JSON');
  }
}

function toIntexIncomingMessage(value: unknown): IntexIncomingMessage {
  /* v8 ignore start -- upstream: prior check in extractEventType validates decoded object values, so this defensive guard is unreachable @preserve */
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid intex.message.ingest event');
  }
  /* v8 ignore stop @preserve */

  const event = value as Record<string, unknown>;
  const type = requiredString(event, 'type');
  const userId = requiredString(event, 'userId');
  const messageId = requiredString(event, 'messageId');
  const text = requiredString(event, 'text');
  const sourceType = requiredString(event, 'sourceType');
  const timestamp = requiredString(event, 'timestamp');
  const whatsappSender = optionalString(event, 'whatsappSender');

  return {
    type: type as IntexIncomingMessage['type'],
    userId,
    messageId,
    text,
    sourceType,
    timestamp,
    ...(whatsappSender !== undefined ? { whatsappSender } : {}),
  };
}

function extractEventType(value: unknown): string | null {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid intex.message.ingest event');
  }

  const type = (value as Record<string, unknown>)['type'];
  return typeof type === 'string' ? type : null;
}

function requiredString(event: Record<string, unknown>, key: string): string {
  const value = event[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid intex.message.ingest event: ${key} must be a string`);
  }
  return value;
}

function optionalString(event: Record<string, unknown>, key: string): string | undefined {
  const value = event[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid intex.message.ingest event: ${key} must be a string`);
  }
  return value;
}
