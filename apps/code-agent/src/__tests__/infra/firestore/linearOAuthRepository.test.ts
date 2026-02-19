/**
 * Tests for Firestore-backed Linear OAuth repository.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import { createLinearOAuthRepository } from '../../../infra/firestore/linearOAuthRepository.js';
import type { LinearOAuthCredentials } from '../../../domain/ports/linearOAuthRepository.js';

describe('createLinearOAuthRepository', () => {
  let repo: ReturnType<typeof createLinearOAuthRepository>;
  let firestore: Firestore;

  const testCredentials: LinearOAuthCredentials = {
    accessToken: 'lin_api_test_token_123',
    appUserId: 'app-user-abc-123',
    workspaceId: 'default',
    installedAt: '2026-02-19T12:00:00.000Z',
    installedBy: 'oauth-flow',
  };

  beforeEach(() => {
    firestore = createFakeFirestore() as unknown as Firestore;
    const logger = pino({ name: 'test', level: 'silent' });
    repo = createLinearOAuthRepository({ firestore, logger });
  });

  describe('save', () => {
    it('stores credentials successfully', async () => {
      const result = await repo.save(testCredentials);
      expect(result.ok).toBe(true);
    });

    it('stored credentials can be retrieved', async () => {
      await repo.save(testCredentials);
      const getResult = await repo.get('default');

      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).not.toBeNull();
        expect(getResult.value?.accessToken).toBe('lin_api_test_token_123');
        expect(getResult.value?.appUserId).toBe('app-user-abc-123');
      }
    });

    it('overwrites existing credentials for same workspace', async () => {
      await repo.save(testCredentials);

      const updated: LinearOAuthCredentials = {
        ...testCredentials,
        accessToken: 'lin_api_new_token_456',
      };
      await repo.save(updated);

      const getResult = await repo.get('default');
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value?.accessToken).toBe('lin_api_new_token_456');
      }
    });
  });

  describe('get', () => {
    it('returns null for non-existent workspace', async () => {
      const result = await repo.get('non-existent');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns credentials for existing workspace', async () => {
      await repo.save(testCredentials);
      const result = await repo.get('default');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.workspaceId).toBe('default');
        expect(result.value?.installedBy).toBe('oauth-flow');
      }
    });
  });

  describe('findByAppUserId', () => {
    it('returns null when no matching credentials', async () => {
      const result = await repo.findByAppUserId('non-existent');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns credentials matching appUserId', async () => {
      await repo.save(testCredentials);
      const result = await repo.findByAppUserId('app-user-abc-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.accessToken).toBe('lin_api_test_token_123');
      }
    });
  });

  describe('document validation', () => {
    it('rejects corrupted document missing accessToken on get', async () => {
      // Write a malformed document directly to Firestore
      await firestore.collection('linear_oauth').doc('corrupted').set({
        appUserId: 'test',
        workspaceId: 'corrupted',
        installedAt: '2026-01-01',
        installedBy: 'test',
        // accessToken deliberately missing
      });

      const result = await repo.get('corrupted');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Corrupted credential document');
      }
    });

    it('rejects corrupted document missing installedBy on get', async () => {
      await firestore.collection('linear_oauth').doc('corrupted2').set({
        accessToken: 'encrypted-value',
        appUserId: 'test',
        workspaceId: 'corrupted2',
        installedAt: '2026-01-01',
        // installedBy deliberately missing
      });

      const result = await repo.get('corrupted2');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
    });

    it('rejects corrupted document on findByAppUserId', async () => {
      // Write a malformed document directly to Firestore
      await firestore.collection('linear_oauth').doc('corrupted-find').set({
        appUserId: 'find-me',
        workspaceId: 'corrupted-find',
        installedAt: '2026-01-01',
        // accessToken and installedBy deliberately missing
      });

      const result = await repo.findByAppUserId('find-me');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Corrupted credential document');
      }
    });

    it('encrypts accessToken on save and decrypts on read', async () => {
      await repo.save(testCredentials);

      // Read raw document from Firestore to verify encryption
      const doc = await firestore.collection('linear_oauth').doc('default').get();
      const rawData = doc.data() as Record<string, unknown>;

      // The raw stored value should NOT be the plaintext token
      expect(rawData['accessToken']).not.toBe('lin_api_test_token_123');

      // But reading through the repo should return the plaintext token
      const result = await repo.get('default');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.accessToken).toBe('lin_api_test_token_123');
      }
    });
  });
});
