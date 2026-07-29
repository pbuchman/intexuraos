import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import {
  acquireMessageDigestDeliveryAuthorization,
  releaseMessageDigestDeliveryAuthorization,
} from './authorizeMessageDigestDelivery.js';

const NOW = '2026-07-27T12:00:00.000Z';
const OWNER_DIGEST = 'd'.repeat(64);
const PAYLOAD_DIGEST = 'a'.repeat(64);

describe('Message Digest delivery authorization', () => {
  it('acquires a bounded durable lease for the exact delivery identity', async () => {
    const claimDeliveryAuthorization = vi.fn<MessageDigestStore['claimDeliveryAuthorization']>(
      async (input) => ({
        ok: true,
        disposition: 'acquired',
        fence: 3,
        expiresAt: input.expiresAt,
      })
    );

    await expect(
      acquireMessageDigestDeliveryAuthorization(acquireInput(), {
        store: { claimDeliveryAuthorization },
        now: () => NOW,
      })
    ).resolves.toEqual({
      ok: true,
      disposition: 'authorized',
      fence: 3,
      expiresAt: '2026-07-27T12:02:00.000Z',
    });
    expect(claimDeliveryAuthorization).toHaveBeenCalledWith({
      ...acquireInput(),
      now: NOW,
      expiresAt: '2026-07-27T12:02:00.000Z',
    });
  });

  it('uses the service-owned clock when no clock dependency is injected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const claimDeliveryAuthorization = vi.fn<MessageDigestStore['claimDeliveryAuthorization']>(
      async (input) => ({
        ok: true,
        disposition: 'acquired',
        fence: 4,
        expiresAt: input.expiresAt,
      })
    );
    const releaseDeliveryAuthorization = vi
      .fn<MessageDigestStore['releaseDeliveryAuthorization']>()
      .mockResolvedValue({ ok: true });

    try {
      await expect(
        acquireMessageDigestDeliveryAuthorization(acquireInput(), {
          store: { claimDeliveryAuthorization },
        })
      ).resolves.toEqual({
        ok: true,
        disposition: 'authorized',
        fence: 4,
        expiresAt: '2026-07-27T12:02:00.000Z',
      });
      await expect(
        releaseMessageDigestDeliveryAuthorization(
          { ...acquireInput(), fence: 4 },
          { store: { releaseDeliveryAuthorization } }
        )
      ).resolves.toEqual({ ok: true, disposition: 'released' });
      expect(releaseDeliveryAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({ now: NOW })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('derives a fresh service-owned deadline for every same-owner renewal attempt', async () => {
    const claimDeliveryAuthorization = vi.fn<MessageDigestStore['claimDeliveryAuthorization']>(
      async (input) => ({
        ok: true,
        disposition: 'existing',
        fence: 5,
        expiresAt: input.expiresAt,
      })
    );
    const times = ['2026-07-27T12:00:00.000Z', '2026-07-27T12:01:30.000Z'];
    const now = vi.fn(() => times.shift() ?? NOW);

    await acquireMessageDigestDeliveryAuthorization(acquireInput(), {
      store: { claimDeliveryAuthorization },
      now,
    });
    await expect(
      acquireMessageDigestDeliveryAuthorization(acquireInput(), {
        store: { claimDeliveryAuthorization },
        now,
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'authorized',
      fence: 5,
      expiresAt: '2026-07-27T12:03:30.000Z',
    });
    expect(claimDeliveryAuthorization.mock.calls[1]?.[0]).toMatchObject({
      now: '2026-07-27T12:01:30.000Z',
      expiresAt: '2026-07-27T12:03:30.000Z',
    });
  });

  it.each([
    { ...acquireInput(), userId: ' ' },
    { ...acquireInput(), definitionId: 'definition-private' },
    { ...acquireInput(), runId: 'run-private' },
    { ...acquireInput(), idempotencyKey: 'message-digest:mdr_other_001' },
    { ...acquireInput(), ownerDigest: 'not-a-digest' },
    { ...acquireInput(), payloadDigest: 'not-a-digest' },
  ])('rejects an invalid acquire envelope without touching storage', async (input) => {
    const claimDeliveryAuthorization = vi.fn();
    await expect(
      acquireMessageDigestDeliveryAuthorization(input, {
        store: { claimDeliveryAuthorization } as never,
        now: () => NOW,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(claimDeliveryAuthorization).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_FOUND', 'denied'],
    ['NOT_AUTHORIZED', 'denied'],
    ['LEASE_BUSY', 'busy'],
  ] as const)('maps store acquire %s to %s', async (code, disposition) => {
    const claimDeliveryAuthorization = vi.fn(async () => ({ ok: false as const, code }));
    await expect(
      acquireMessageDigestDeliveryAuthorization(acquireInput(), {
        store: { claimDeliveryAuthorization } as never,
        now: () => NOW,
      })
    ).resolves.toEqual({ ok: true, disposition });
  });

  it('releases the exact owner/fence and makes stale release outcomes non-enumerating', async () => {
    const releaseDeliveryAuthorization = vi
      .fn<MessageDigestStore['releaseDeliveryAuthorization']>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, code: 'LEASE_LOST' });
    const dependencies = {
      store: { releaseDeliveryAuthorization },
      now: (): string => NOW,
    };

    await expect(
      releaseMessageDigestDeliveryAuthorization(
        { ...acquireInput(), fence: 3 },
        dependencies
      )
    ).resolves.toEqual({ ok: true, disposition: 'released' });
    await expect(
      releaseMessageDigestDeliveryAuthorization(
        { ...acquireInput(), fence: 3 },
        dependencies
      )
    ).resolves.toEqual({ ok: true, disposition: 'ignored' });
    expect(releaseDeliveryAuthorization).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_run_001',
      payloadDigest: PAYLOAD_DIGEST,
      ownerDigest: OWNER_DIGEST,
      fence: 3,
      now: NOW,
    });
  });

  it.each([
    {
      name: 'malformed identity',
      input: { ...acquireInput(), userId: ' ', fence: 3 },
      now: (): string => NOW,
    },
    {
      name: 'invalid service time',
      input: { ...acquireInput(), fence: 3 },
      now: (): string => 'not-a-timestamp',
    },
    {
      name: 'malformed payload digest',
      input: { ...acquireInput(), payloadDigest: 'not-a-digest', fence: 3 },
      now: (): string => NOW,
    },
    {
      name: 'non-integer fence',
      input: { ...acquireInput(), fence: 1.5 },
      now: (): string => NOW,
    },
    {
      name: 'non-positive fence',
      input: { ...acquireInput(), fence: 0 },
      now: (): string => NOW,
    },
  ])('rejects a release with $name without touching storage', async ({ input, now }) => {
    const releaseDeliveryAuthorization = vi.fn();

    await expect(
      releaseMessageDigestDeliveryAuthorization(input, {
        store: { releaseDeliveryAuthorization } as never,
        now,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(releaseDeliveryAuthorization).not.toHaveBeenCalled();
  });
});

function acquireInput(): {
  userId: string;
  definitionId: string;
  runId: string;
  idempotencyKey: string;
  payloadDigest: string;
  ownerDigest: string;
} {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    idempotencyKey: 'message-digest:mdr_run_001',
    payloadDigest: PAYLOAD_DIGEST,
    ownerDigest: OWNER_DIGEST,
  };
}
