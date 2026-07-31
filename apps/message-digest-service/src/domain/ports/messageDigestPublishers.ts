export type FrozenMessageDigestPayloadPublishResult =
  | { ok: true; messageId: string }
  | { ok: false; code: 'INVALID_PAYLOAD' | 'ACK_UNKNOWN' };

export interface FrozenMessageDigestPayloadPublisher {
  publish(payloadJson: string): Promise<FrozenMessageDigestPayloadPublishResult>;
}
