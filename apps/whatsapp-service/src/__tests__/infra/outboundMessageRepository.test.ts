/**
 * Tests for outbound message Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  createOutboundMessage,
  createOutboundMessageRepository,
} from '../../infra/firestore/outboundMessageRepository.js';
import type { OutboundMessage } from '../../domain/whatsapp/index.js';

/**
 * Helper to create test outbound message data.
 */
function createTestOutboundMessage(
  overrides: Partial<OutboundMessage> = {}
): OutboundMessage {
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
