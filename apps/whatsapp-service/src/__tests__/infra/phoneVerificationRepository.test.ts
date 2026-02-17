/**
 * Tests for phone verification Firestore repository.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  createVerification,
  findVerificationById,
  findPendingByUserAndPhone,
  isPhoneVerified,
  updateVerificationStatus,
  incrementVerificationAttempts,
  countRecentVerificationsByPhone,
} from '../../infra/firestore/index.js';
import type { PhoneVerification } from '../../domain/whatsapp/models/PhoneVerification.js';

describe('phoneVerificationRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  const createTestVerification = (
    overrides?: Partial<Omit<PhoneVerification, 'id'>>
  ): Omit<PhoneVerification, 'id'> => ({
    userId: 'user-123',
    phoneNumber: '15551234567',
    code: '123456',
    attempts: 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  });

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('createVerification', () => {
    it('creates verification and returns with generated id', async () => {
      const input = createTestVerification();

      const result = await createVerification(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.phoneNumber).toBe('15551234567');
        expect(result.value.code).toBe('123456');
        expect(result.value.status).toBe('pending');
      }
    });

    it('returns error on persistence failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB error') });

      const result = await createVerification(createTestVerification());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });

  describe('findVerificationById', () => {
    it('returns null for non-existent id', async () => {
      const result = await findVerificationById('unknown-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns verification for existing id', async () => {
      const createResult = await createVerification(createTestVerification());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await findVerificationById(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.phoneNumber).toBe('15551234567');
      }
    });

    it('returns error on persistence failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await findVerificationById('some-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });

  describe('findPendingByUserAndPhone', () => {
    it('returns null when no pending verification exists', async () => {
      const result = await findPendingByUserAndPhone('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns pending verification when exists and not expired', async () => {
      await createVerification(createTestVerification());

      const result = await findPendingByUserAndPhone('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.status).toBe('pending');
        expect(result.value.phoneNumber).toBe('15551234567');
      }
    });

    it('returns null for expired verification', async () => {
      await createVerification(
        createTestVerification({
          expiresAt: Math.floor(Date.now() / 1000) - 100,
        })
      );

      const result = await findPendingByUserAndPhone('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null for verified verification', async () => {
      await createVerification(createTestVerification({ status: 'verified' }));

      const result = await findPendingByUserAndPhone('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null for different user', async () => {
      await createVerification(createTestVerification({ userId: 'other-user' }));

      const result = await findPendingByUserAndPhone('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error on persistence failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query error') });

      const result = await findPendingByUserAndPhone('user-123', '15551234567');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });

  describe('isPhoneVerified', () => {
    it('returns false when no verified verification exists', async () => {
      const result = await isPhoneVerified('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns false for pending verification', async () => {
      await createVerification(createTestVerification({ status: 'pending' }));

      const result = await isPhoneVerified('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true when verified verification exists', async () => {
      await createVerification(createTestVerification({ status: 'verified' }));

      const result = await isPhoneVerified('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for different user with verified phone', async () => {
      await createVerification(
        createTestVerification({ status: 'verified', userId: 'other-user' })
      );

      const result = await isPhoneVerified('user-123', '15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns error on persistence failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query error') });

      const result = await isPhoneVerified('user-123', '15551234567');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });

  describe('updateVerificationStatus', () => {
    it('updates status to verified', async () => {
      const createResult = await createVerification(createTestVerification());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const verifiedAt = new Date().toISOString();
      const result = await updateVerificationStatus(createResult.value.id, 'verified', {
        verifiedAt,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('verified');
        expect(result.value.verifiedAt).toBe(verifiedAt);
      }
    });

    it('updates status to max_attempts with lastAttemptAt', async () => {
      const createResult = await createVerification(createTestVerification());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const lastAttemptAt = new Date().toISOString();
      const result = await updateVerificationStatus(createResult.value.id, 'max_attempts', {
        lastAttemptAt,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('max_attempts');
        expect(result.value.lastAttemptAt).toBe(lastAttemptAt);
      }
    });

    it('returns NOT_FOUND for non-existent id', async () => {
      const result = await updateVerificationStatus('unknown-id', 'verified');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns error on persistence failure', async () => {
      const createResult = await createVerification(createTestVerification());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Update error') });

      const result = await updateVerificationStatus(createResult.value.id, 'verified');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });

  describe('incrementVerificationAttempts', () => {
    it('increments attempts count', async () => {
      const createResult = await createVerification(createTestVerification({ attempts: 0 }));
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await incrementVerificationAttempts(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.attempts).toBe(1);
        expect(result.value.lastAttemptAt).toBeDefined();
      }
    });

    it('increments multiple times', async () => {
      const createResult = await createVerification(createTestVerification({ attempts: 2 }));
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await incrementVerificationAttempts(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.attempts).toBe(3);
      }
    });

    it('returns NOT_FOUND for non-existent id', async () => {
      const result = await incrementVerificationAttempts('unknown-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns error on persistence failure', async () => {
      const createResult = await createVerification(createTestVerification());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Update error') });

      const result = await incrementVerificationAttempts(createResult.value.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });

  describe('countRecentVerificationsByPhone', () => {
    it('returns 0 when no verifications exist', async () => {
      const windowStart = new Date(Date.now() - 3600000).toISOString();

      const result = await countRecentVerificationsByPhone('15551234567', windowStart);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0);
      }
    });

    it('counts verifications within time window', async () => {
      const now = new Date();
      await createVerification(createTestVerification({ createdAt: now.toISOString() }));
      await createVerification(
        createTestVerification({
          userId: 'user-456',
          createdAt: new Date(now.getTime() - 1000).toISOString(),
        })
      );

      const windowStart = new Date(now.getTime() - 3600000).toISOString();
      const result = await countRecentVerificationsByPhone('15551234567', windowStart);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(2);
      }
    });

    it('excludes verifications outside time window', async () => {
      const now = new Date();
      await createVerification(createTestVerification({ createdAt: now.toISOString() }));
      await createVerification(
        createTestVerification({
          createdAt: new Date(now.getTime() - 7200000).toISOString(),
        })
      );

      const windowStart = new Date(now.getTime() - 3600000).toISOString();
      const result = await countRecentVerificationsByPhone('15551234567', windowStart);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1);
      }
    });

    it('only counts for specified phone number', async () => {
      await createVerification(createTestVerification());
      await createVerification(createTestVerification({ phoneNumber: '15559999999' }));

      const windowStart = new Date(Date.now() - 3600000).toISOString();
      const result = await countRecentVerificationsByPhone('15551234567', windowStart);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1);
      }
    });

    it('returns error on persistence failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query error') });

      const result = await countRecentVerificationsByPhone(
        '15551234567',
        new Date().toISOString()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });
});
