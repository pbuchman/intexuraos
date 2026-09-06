export interface MessageDigestDeliveryAuthorizationIdentity {
  userId: string;
  definitionId: string;
  runId: string;
  idempotencyKey: string;
  payloadDigest: string;
  ownerDigest: string;
}

export interface MessageDigestDeliveryAuthorizationClient {
  acquire(input: MessageDigestDeliveryAuthorizationIdentity): Promise<
    | {
        ok: true;
        disposition: 'authorized';
        fence: number;
        expiresAt: string;
      }
    | { ok: true; disposition: 'denied' | 'busy' }
    | { ok: false; code: 'invalid_request' | 'unavailable' | 'invalid_response' }
  >;
  release(
    input: MessageDigestDeliveryAuthorizationIdentity & { fence: number }
  ): Promise<
    { ok: true } | { ok: false; code: 'invalid_request' | 'unavailable' | 'invalid_response' }
  >;
}
