/**
 * Tests for outbound message Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  createOutboundMessage,
  createOutboundMessageRepository,
  OUTBOUND_DELIVERY_RECEIPTS_COLLECTION,
} from '../../infra/firestore/outboundMessageRepository.js';
import type { OutboundMessage } from '../../domain/whatsapp/index.js';

interface IdempotentDeliveryRepository {
  reserveIdempotentDelivery(
    input: Readonly<{
      idempotencyKey: string;
      payloadDigest: string;
      now: string;
      expiresAt: number;
    }>
  ): Promise<
    | Readonly<{
        ok: true;
        disposition: 'acquired' | 'duplicate_in_flight' | 'duplicate_sent' | 'duplicate_ambiguous';
      }>
    | Readonly<{ ok: false; code: string }>
  >;
  completeIdempotentDelivery(
    input: Readonly<{
      idempotencyKey: string;
      payloadDigest: string;
      outboundMessage: OutboundMessage;
    }>
  ): Promise<
    | Readonly<{ ok: true; disposition: 'applied' | 'already_applied' }>
    | Readonly<{ ok: false; code: string }>
  >;
  markIdempotentDeliveryAmbiguous(
    input: Readonly<{
      idempotencyKey: string;
      payloadDigest: string;
      now: string;
    }>
  ): Promise<
    | Readonly<{ ok: true; disposition: 'applied' | 'already_applied' }>
    | Readonly<{ ok: false; code: string }>
  >;
}

/**
 * Helper to create test outbound message data.
 */
function createTestOutboundMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  const now = new Date();
  return {
    wamid: 'wamid.test123',
    correlationId: 'corr-123',
    userId: 'user-123',
    sentAt: now.toISOString(),
    expiresAt: Math.floor((now.getTime() + 7 * 24 * 60 * 60 * 1000) / 1000),
    ...overrides,
  };
}

describe('outboundMessageRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: ReturnType<typeof createOutboundMessageRepository>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createOutboundMessageRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('save', () => {
    it('saves outbound message successfully', async () => {
      const message = createTestOutboundMessage();
      const result = await repository.save(message);

      expect(result.ok).toBe(true);
    });

    it('overwrites existing message with same wamid', async () => {
      const message1 = createTestOutboundMessage({ correlationId: 'corr-1' });
      const message2 = createTestOutboundMessage({ correlationId: 'corr-2' });

      await repository.save(message1);
      const result = await repository.save(message2);

      expect(result.ok).toBe(true);

      const found = await repository.findByWamid(message1.wamid);
      expect(found.ok).toBe(true);
      if (found.ok && found.value) {
        expect(found.value.correlationId).toBe('corr-2');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB error') });

      const result = await repository.save(createTestOutboundMessage());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to save outbound message');
      }
    });
  });

  describe('findByWamid', () => {
    it('returns null for non-existent wamid', async () => {
      const result = await repository.findByWamid('nonexistent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns message for existing wamid', async () => {
      const message = createTestOutboundMessage({
        wamid: 'wamid.abc123',
        correlationId: 'corr-test',
        userId: 'user-456',
      });
      await repository.save(message);

      const result = await repository.findByWamid('wamid.abc123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.wamid).toBe('wamid.abc123');
        expect(result.value.correlationId).toBe('corr-test');
        expect(result.value.userId).toBe('user-456');
      }
    });

    it('roundtrips optional assistant message text', async () => {
      const message = createTestOutboundMessage({
        wamid: 'wamid.with-text',
        messageText: 'What would you like me to help with?',
      });
      await repository.save(message);

      const result = await repository.findByWamid('wamid.with-text');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.messageText).toBe('What would you like me to help with?');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await repository.findByWamid('some-wamid');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to find outbound message');
      }
    });
  });

  describe('deleteByWamid', () => {
    it('deletes existing message', async () => {
      const message = createTestOutboundMessage({ wamid: 'wamid.delete-me' });
      await repository.save(message);

      const deleteResult = await repository.deleteByWamid('wamid.delete-me');
      expect(deleteResult.ok).toBe(true);

      const findResult = await repository.findByWamid('wamid.delete-me');
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toBeNull();
      }
    });

    it('succeeds even for non-existent wamid', async () => {
      const result = await repository.deleteByWamid('nonexistent');

      expect(result.ok).toBe(true);
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete error') });

      const result = await repository.deleteByWamid('some-wamid');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to delete outbound message');
      }
    });
  });

  describe('Matrix corpus idempotent delivery', () => {
    const idempotencyKey = 'imc_reply_publish_1';
    const payloadDigest = 'a'.repeat(64);
    const now = '2026-07-20T10:00:00.000Z';

    function deliveryRepository(): IdempotentDeliveryRepository {
      return repository as unknown as IdempotentDeliveryRepository;
    }

    function keyDigest(): string {
      return createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
    }

    function validReceipt(
      overrides: Readonly<Record<string, unknown>> = {}
    ): Readonly<Record<string, unknown>> {
      return {
        version: 1,
        idempotencyKeyDigest: keyDigest(),
        payloadDigest,
        state: 'sending',
        createdAt: now,
        updatedAt: now,
        expiresAt: 1_800_000_000,
        ...overrides,
      };
    }

    async function seedReceipt(value: unknown): Promise<void> {
      fakeFirestore.seedCollection(OUTBOUND_DELIVERY_RECEIPTS_COLLECTION, [
        { id: keyDigest(), data: value as never },
      ]);
    }

    it('atomically acquires one sender and keeps the raw key out of Firestore', async () => {
      const delivery = deliveryRepository();
      expect(delivery.reserveIdempotentDelivery).toEqual(expect.any(Function));
      if (typeof delivery.reserveIdempotentDelivery !== 'function') return;

      const results = await Promise.all([
        delivery.reserveIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          now,
          expiresAt: 1_800_000_000,
        }),
        delivery.reserveIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          now,
          expiresAt: 1_800_000_000,
        }),
      ]);

      expect(results).toContainEqual({ ok: true, disposition: 'acquired' });
      expect(results).toContainEqual({ ok: true, disposition: 'duplicate_in_flight' });
      const keyDigest = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
      const snapshot = await fakeFirestore
        .collection('whatsapp_outbound_delivery_receipts')
        .doc(keyDigest)
        .get();
      expect(snapshot.data()).toEqual({
        version: 1,
        idempotencyKeyDigest: keyDigest,
        payloadDigest,
        state: 'sending',
        createdAt: now,
        updatedAt: now,
        expiresAt: 1_800_000_000,
      });
      expect(JSON.stringify(snapshot.data())).not.toContain(idempotencyKey);
    });

    it('rejects a changed payload replay for the same key', async () => {
      const delivery = deliveryRepository();
      if (typeof delivery.reserveIdempotentDelivery !== 'function') return;
      await delivery.reserveIdempotentDelivery({
        idempotencyKey,
        payloadDigest,
        now,
        expiresAt: 1_800_000_000,
      });

      await expect(
        delivery.reserveIdempotentDelivery({
          idempotencyKey,
          payloadDigest: 'b'.repeat(64),
          now,
          expiresAt: 1_800_000_000,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    });

    it('atomically marks delivery sent and saves reply-correlation metadata', async () => {
      const delivery = deliveryRepository();
      if (
        typeof delivery.reserveIdempotentDelivery !== 'function' ||
        typeof delivery.completeIdempotentDelivery !== 'function'
      )
        return;
      await delivery.reserveIdempotentDelivery({
        idempotencyKey,
        payloadDigest,
        now,
        expiresAt: 1_800_000_000,
      });
      const outboundMessage = createTestOutboundMessage({
        wamid: 'wamid.matrix-1',
        correlationId: 'imc_reply_digest',
        messageText: 'Synthetic reply',
      });

      await expect(
        delivery.completeIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          outboundMessage,
        })
      ).resolves.toEqual({ ok: true, disposition: 'applied' });
      await expect(
        delivery.reserveIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          now,
          expiresAt: 1_800_000_000,
        })
      ).resolves.toEqual({ ok: true, disposition: 'duplicate_sent' });
      await expect(repository.findByWamid('wamid.matrix-1')).resolves.toEqual({
        ok: true,
        value: outboundMessage,
      });
    });

    it('closes an uncertain external send without permitting a blind resend', async () => {
      const delivery = deliveryRepository();
      if (
        typeof delivery.reserveIdempotentDelivery !== 'function' ||
        typeof delivery.markIdempotentDeliveryAmbiguous !== 'function'
      )
        return;
      await delivery.reserveIdempotentDelivery({
        idempotencyKey,
        payloadDigest,
        now,
        expiresAt: 1_800_000_000,
      });

      await expect(
        delivery.markIdempotentDeliveryAmbiguous({ idempotencyKey, payloadDigest, now })
      ).resolves.toEqual({ ok: true, disposition: 'applied' });
      await expect(
        delivery.reserveIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          now,
          expiresAt: 1_800_000_000,
        })
      ).resolves.toEqual({ ok: true, disposition: 'duplicate_ambiguous' });
    });

    it('terminalizes a stale sending receipt as ambiguous without reacquiring the sender', async () => {
      const delivery = deliveryRepository();
      await delivery.reserveIdempotentDelivery({
        idempotencyKey,
        payloadDigest,
        now,
        expiresAt: 1_800_000_000,
      });

      await expect(
        delivery.reserveIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          now: '2026-07-20T10:16:00.000Z',
          expiresAt: 1_800_000_000,
        })
      ).resolves.toEqual({ ok: true, disposition: 'duplicate_ambiguous' });
    });

    it('fails closed for invalid reservations, corrupt receipts, and persistence errors', async () => {
      const delivery = deliveryRepository();
      await expect(
        delivery.reserveIdempotentDelivery({
          idempotencyKey: '',
          payloadDigest,
          now,
          expiresAt: 1_800_000_000,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });

      const corruptReceipts: unknown[] = [
        null,
        [],
        'invalid',
        {},
        validReceipt({ extra: true }),
        validReceipt({ version: 2 }),
        validReceipt({ idempotencyKeyDigest: 1 }),
        validReceipt({ idempotencyKeyDigest: 'invalid' }),
        validReceipt({ payloadDigest: 1 }),
        validReceipt({ payloadDigest: 'invalid' }),
        validReceipt({ state: 'unknown' }),
        validReceipt({ createdAt: 1 }),
        validReceipt({ createdAt: 'invalid' }),
        validReceipt({ updatedAt: 1 }),
        validReceipt({ updatedAt: 'invalid' }),
        validReceipt({ expiresAt: 1.5 }),
        validReceipt({ expiresAt: 0 }),
        validReceipt({ state: 'sent', outboundMessageDigest: 1 }),
        validReceipt({ state: 'sent', outboundMessageDigest: 'invalid' }),
      ];
      for (const corruptReceipt of corruptReceipts) {
        await seedReceipt(corruptReceipt);
        await expect(
          delivery.reserveIdempotentDelivery({
            idempotencyKey,
            payloadDigest,
            now,
            expiresAt: 1_800_000_000,
          })
        ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECEIPT' });
      }

      vi.spyOn(fakeFirestore, 'runTransaction').mockRejectedValueOnce(
        new Error('transaction failed')
      );
      await expect(
        delivery.reserveIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          now,
          expiresAt: 1_800_000_000,
        })
      ).resolves.toEqual({ ok: false, code: 'PERSISTENCE_ERROR' });
    });

    it('fails closed for every completion replay state', async () => {
      const delivery = deliveryRepository();
      const outboundMessage = createTestOutboundMessage({ wamid: 'wamid.matrix-complete' });
      await expect(
        delivery.completeIdempotentDelivery({
          idempotencyKey: '',
          payloadDigest,
          outboundMessage,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(
        delivery.completeIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          outboundMessage,
        })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

      await seedReceipt({ corrupt: true });
      await expect(
        delivery.completeIdempotentDelivery({ idempotencyKey, payloadDigest, outboundMessage })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECEIPT' });

      await seedReceipt(validReceipt({ payloadDigest: 'b'.repeat(64) }));
      await expect(
        delivery.completeIdempotentDelivery({ idempotencyKey, payloadDigest, outboundMessage })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });

      await seedReceipt(validReceipt({ state: 'ambiguous' }));
      await expect(
        delivery.completeIdempotentDelivery({ idempotencyKey, payloadDigest, outboundMessage })
      ).resolves.toEqual({ ok: false, code: 'INVALID_STATE' });

      await seedReceipt(validReceipt());
      await expect(
        delivery.completeIdempotentDelivery({ idempotencyKey, payloadDigest, outboundMessage })
      ).resolves.toEqual({ ok: true, disposition: 'applied' });
      await expect(
        delivery.completeIdempotentDelivery({ idempotencyKey, payloadDigest, outboundMessage })
      ).resolves.toEqual({ ok: true, disposition: 'already_applied' });
      await expect(
        delivery.completeIdempotentDelivery({
          idempotencyKey,
          payloadDigest,
          outboundMessage: { ...outboundMessage, messageText: 'changed' },
        })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });

      vi.spyOn(fakeFirestore, 'runTransaction').mockRejectedValueOnce(
        new Error('transaction failed')
      );
      await expect(
        delivery.completeIdempotentDelivery({ idempotencyKey, payloadDigest, outboundMessage })
      ).resolves.toEqual({ ok: false, code: 'PERSISTENCE_ERROR' });
    });

    it('fails closed for every ambiguous-delivery replay state', async () => {
      const delivery = deliveryRepository();
      await expect(
        delivery.markIdempotentDeliveryAmbiguous({ idempotencyKey: '', payloadDigest, now })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(
        delivery.markIdempotentDeliveryAmbiguous({ idempotencyKey, payloadDigest, now })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

      await seedReceipt({ corrupt: true });
      await expect(
        delivery.markIdempotentDeliveryAmbiguous({ idempotencyKey, payloadDigest, now })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECEIPT' });

      await seedReceipt(validReceipt({ payloadDigest: 'b'.repeat(64) }));
      await expect(
        delivery.markIdempotentDeliveryAmbiguous({ idempotencyKey, payloadDigest, now })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });

      await seedReceipt(
        validReceipt({ state: 'sent', outboundMessageDigest: 'c'.repeat(64) })
      );
      await expect(
        delivery.markIdempotentDeliveryAmbiguous({ idempotencyKey, payloadDigest, now })
      ).resolves.toEqual({ ok: false, code: 'INVALID_STATE' });

      await seedReceipt(validReceipt({ state: 'ambiguous' }));
      await expect(
        delivery.markIdempotentDeliveryAmbiguous({ idempotencyKey, payloadDigest, now })
      ).resolves.toEqual({ ok: true, disposition: 'already_applied' });

      vi.spyOn(fakeFirestore, 'runTransaction').mockRejectedValueOnce(
        new Error('transaction failed')
      );
      await expect(
        delivery.markIdempotentDeliveryAmbiguous({ idempotencyKey, payloadDigest, now })
      ).resolves.toEqual({ ok: false, code: 'PERSISTENCE_ERROR' });
    });
  });
});

describe('createOutboundMessage', () => {
  it('creates message with correct fields', () => {
    const message = createOutboundMessage({
      wamid: 'wamid.test',
      correlationId: 'action-123',
      userId: 'user-456',
    });

    expect(message.wamid).toBe('wamid.test');
    expect(message.correlationId).toBe('action-123');
    expect(message.userId).toBe('user-456');
    expect(message.sentAt).toBeDefined();
    expect(message.expiresAt).toBeGreaterThan(0);
  });

  it('sets expiresAt to approximately 7 days in the future', () => {
    const now = Date.now();
    const message = createOutboundMessage({
      wamid: 'wamid.test',
      correlationId: 'action-123',
      userId: 'user-456',
    });

    // expiresAt is in seconds, convert to ms for comparison
    const expiresAtMs = message.expiresAt * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Allow 1 second tolerance for test execution time
    expect(expiresAtMs).toBeGreaterThanOrEqual(now + sevenDaysMs - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(now + sevenDaysMs + 1000);
  });

  it('sets sentAt to current ISO timestamp', () => {
    const before = new Date().toISOString();
    const message = createOutboundMessage({
      wamid: 'wamid.test',
      correlationId: 'action-123',
      userId: 'user-456',
    });
    const after = new Date().toISOString();

    expect(message.sentAt >= before).toBe(true);
    expect(message.sentAt <= after).toBe(true);
  });
});
