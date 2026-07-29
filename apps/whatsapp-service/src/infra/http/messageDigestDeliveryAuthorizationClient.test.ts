import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageDigestDeliveryAuthorizationClient } from './messageDigestDeliveryAuthorizationClient.js';
import type {
  MessageDigestDeliveryAuthorizationClient,
  MessageDigestDeliveryAuthorizationIdentity,
} from '../../domain/whatsapp/ports/messageDigestDeliveryAuthorization.js';

const request = vi.hoisted(() => vi.fn());

vi.mock('@intexuraos/internal-clients', async () => {
  const actual = await vi.importActual('@intexuraos/internal-clients');
  return {
    ...actual,
    createInternalHttpClient: vi.fn(() => ({ request })),
  };
});

describe('messageDigestDeliveryAuthorizationClient', () => {
  beforeEach(() => {
    request.mockReset();
  });

  it('acquires the exact private authorization with the dedicated caller role', async () => {
    request.mockResolvedValue({
      ok: true,
      value: {
        disposition: 'authorized',
        fence: 3,
        expiresAt: '2026-07-27T12:02:00.000Z',
      },
    });
    const client = createClient();

    await expect(client.acquire(identity())).resolves.toEqual({
      ok: true,
      disposition: 'authorized',
      fence: 3,
      expiresAt: '2026-07-27T12:02:00.000Z',
    });
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/internal/message-digests/delivery-authorizations/acquire',
      body: identity(),
      extraHeaders: {
        'x-internal-caller-role': 'whatsapp_message_digest_delivery',
      },
      privateRequest: true,
      skipSentry: true,
    });
  });

  it.each(['denied', 'busy'] as const)('preserves the safe %s disposition', async (disposition) => {
    request.mockResolvedValue({ ok: true, value: { disposition } });
    await expect(createClient().acquire(identity())).resolves.toEqual({
      ok: true,
      disposition,
    });
  });

  it('fails closed for transport errors, malformed responses, and invalid local input', async () => {
    request.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'private transport detail' },
    });
    await expect(createClient().acquire(identity())).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });

    request.mockResolvedValueOnce({ ok: true, value: { disposition: 'authorized', fence: 0 } });
    await expect(createClient().acquire(identity())).resolves.toEqual({
      ok: false,
      code: 'invalid_response',
    });

    await expect(
      createClient().acquire({ ...identity(), idempotencyKey: 'message-digest:mdr_other_001' })
    ).resolves.toEqual({ ok: false, code: 'invalid_request' });
    await expect(
      createClient().acquire({ ...identity(), payloadDigest: 'not-a-digest' })
    ).resolves.toEqual({ ok: false, code: 'invalid_request' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases the exact acquired fence and treats only a valid envelope as success', async () => {
    request.mockResolvedValueOnce({ ok: true, value: { disposition: 'released' } });
    const client = createClient();
    await expect(client.release({ ...identity(), fence: 3 })).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/internal/message-digests/delivery-authorizations/release',
      body: { ...identity(), fence: 3 },
      extraHeaders: {
        'x-internal-caller-role': 'whatsapp_message_digest_delivery',
      },
      privateRequest: true,
      skipSentry: true,
    });

    request.mockResolvedValueOnce({ ok: true, value: { disposition: 'unexpected' } });
    await expect(client.release({ ...identity(), fence: 3 })).resolves.toEqual({
      ok: false,
      code: 'invalid_response',
    });
  });

  it('fails release closed before transport and when transport is unavailable', async () => {
    const client = createClient();

    await expect(client.release({ ...identity(), fence: 0 })).resolves.toEqual({
      ok: false,
      code: 'invalid_request',
    });
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'private transport detail' },
    });
    await expect(client.release({ ...identity(), fence: 3 })).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});

function createClient(): MessageDigestDeliveryAuthorizationClient {
  return createMessageDigestDeliveryAuthorizationClient({
    baseUrl: 'https://message-digest.internal',
    internalAuthToken: 'synthetic-internal-token',
    logger: { warn: vi.fn() },
  });
}

function identity(): MessageDigestDeliveryAuthorizationIdentity {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    idempotencyKey: 'message-digest:mdr_run_001',
    payloadDigest: 'a'.repeat(64),
    ownerDigest: 'd'.repeat(64),
  };
}
