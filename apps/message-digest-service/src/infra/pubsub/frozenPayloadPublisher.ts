import type {
  FrozenMessageDigestPayloadPublisher,
  FrozenMessageDigestPayloadPublishResult,
} from '../../domain/ports/messageDigestPublishers.js';

export interface FrozenPayloadTopic {
  publishMessage(input: { data: Buffer }): Promise<string>;
}

export type FrozenPayloadPublishResult = FrozenMessageDigestPayloadPublishResult;

export type FrozenPayloadPublisher = FrozenMessageDigestPayloadPublisher;

export function createFrozenPayloadPublisher(topic: FrozenPayloadTopic): FrozenPayloadPublisher {
  return {
    async publish(payloadJson): Promise<FrozenPayloadPublishResult> {
      if (!isValidPayload(payloadJson)) return { ok: false, code: 'INVALID_PAYLOAD' };
      try {
        const messageId = await topic.publishMessage({ data: Buffer.from(payloadJson, 'utf8') });
        return messageId.trim() === ''
          ? { ok: false, code: 'ACK_UNKNOWN' }
          : { ok: true, messageId };
      } catch {
        return { ok: false, code: 'ACK_UNKNOWN' };
      }
    },
  };
}

function isValidPayload(payloadJson: string): boolean {
  if (payloadJson.length < 2 || payloadJson.length > 256_000) return false;
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
