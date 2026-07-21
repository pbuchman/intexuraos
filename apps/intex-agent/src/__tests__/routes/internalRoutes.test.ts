import Fastify, { type FastifyInstance } from 'fastify';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInternalRoutes } from '../../routes/internalRoutes.js';

const internalAuthToken = 'test-internal-auth-token';
const signedEnvelope = {
  version: 1 as const,
  kind: 'matrix_corpus_ingest' as const,
  ingestReceiptId: 'receipt_1',
  leaseFence: '7',
  payloadDigest: 'a'.repeat(64),
  attestation: 'e30.e30.AA',
};
const ordinaryEvent = {
  type: 'intex.message.ingest' as const,
  userId: 'user_1',
  messageId: 'message_1',
  text: 'ordinary fixture',
  sourceType: 'whatsapp_text',
  timestamp: '2026-07-20T10:00:00.000Z',
};

function push(event: unknown): Readonly<{
  message: Readonly<{ data: string; messageId: string }>;
}> {
  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString('base64'),
      messageId: 'pubsub_1',
    },
  };
}

describe('internal Intex message route', () => {
  let app: FastifyInstance;
  const handleOrdinary = vi.fn().mockResolvedValue({ sessionId: 'session_1' });
  const verifyAttestation = vi.fn().mockResolvedValue({
    ok: true,
    claims: { kind: 'matrix_corpus_ingest' },
  });
  const acceptVerifiedIngest = vi.fn().mockResolvedValue({
    accepted: true,
    state: 'not_ready',
    correlationCount: 1,
  });

  async function start(enabled: boolean | null = true): Promise<void> {
    app = Fastify({ logger: false });
    await app.register(intexuraFastifyPlugin);
    await app.register(
      createInternalRoutes({
        handleOrdinary,
        matrixCorpus:
          enabled === null ? null : { enabled, verifyAttestation, acceptVerifiedIngest },
      })
    );
    await app.ready();
  }

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = internalAuthToken;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  it('preserves ordinary direct and From-authenticated Pub/Sub behavior byte-for-byte', async () => {
    await start();

    const direct = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: ordinaryEvent,
    });
    const pubsub = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { from: 'noreply@google.com' },
      payload: push(ordinaryEvent),
    });

    expect(direct.statusCode).toBe(202);
    expect(direct.json().data).toEqual({ accepted: true, sessionId: 'session_1' });
    expect(pubsub.statusCode).toBe(202);
    expect(pubsub.json().data).toEqual({ accepted: true, sessionId: 'session_1' });
    expect(handleOrdinary).toHaveBeenNthCalledWith(1, ordinaryEvent);
    expect(handleOrdinary).toHaveBeenNthCalledWith(2, ordinaryEvent);
    expect(verifyAttestation).not.toHaveBeenCalled();
  });

  it('requires Pub/Sub provenance internal auth and JWS before evaluation acceptance', async () => {
    await start();

    for (const headers of [
      { from: 'noreply@google.com' },
      { 'x-internal-auth': internalAuthToken },
      {},
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/intex-agent/messages',
        headers,
        payload: push(signedEnvelope),
      });
      expect(response.statusCode).toBe(401);
    }
    expect(verifyAttestation).not.toHaveBeenCalled();
    expect(acceptVerifiedIngest).not.toHaveBeenCalled();
    expect(handleOrdinary).not.toHaveBeenCalled();

    verifyAttestation.mockResolvedValueOnce({ ok: false, code: 'INVALID_SIGNATURE' });
    const invalid = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { from: 'noreply@google.com', 'x-internal-auth': internalAuthToken },
      payload: push(signedEnvelope),
    });
    expect(invalid.statusCode).toBe(400);
    expect(acceptVerifiedIngest).not.toHaveBeenCalled();

    const direct = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { 'x-internal-auth': internalAuthToken },
      payload: signedEnvelope,
    });
    expect(direct.statusCode).toBe(400);
  });

  it('ends a verified evaluation as not-ready before the ordinary handler', async () => {
    await start();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { from: 'noreply@google.com', 'x-internal-auth': internalAuthToken },
      payload: push(signedEnvelope),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().data).toEqual({
      accepted: true,
      state: 'not_ready',
      correlationCount: 1,
    });
    expect(verifyAttestation).toHaveBeenCalledWith(signedEnvelope);
    expect(acceptVerifiedIngest).toHaveBeenCalledWith({ kind: 'matrix_corpus_ingest' });
    expect(handleOrdinary).not.toHaveBeenCalled();
  });

  it('returns a retryable status while the original Matrix provider call is still active', async () => {
    acceptVerifiedIngest.mockResolvedValueOnce({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
    await start();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/intex-agent/messages',
      headers: { from: 'noreply@google.com', 'x-internal-auth': internalAuthToken },
      payload: push(signedEnvelope),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().data).toEqual({
      accepted: false,
      state: 'retry',
      correlationCount: 1,
    });
  });

  it.each([false, null])(
    'rejects a disabled evaluation before verification or persistence (%s)',
    async (enabled) => {
      await start(enabled);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/intex-agent/messages',
        headers: { from: 'noreply@google.com', 'x-internal-auth': internalAuthToken },
        payload: push(signedEnvelope),
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().data).toEqual({
        accepted: false,
        state: 'rejected',
        correlationCount: 0,
      });
      expect(verifyAttestation).not.toHaveBeenCalled();
      expect(acceptVerifiedIngest).not.toHaveBeenCalled();
      expect(handleOrdinary).not.toHaveBeenCalled();
    }
  );
});
