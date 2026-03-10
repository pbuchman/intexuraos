/**
 * Tests for WorkerSettings Firestore repository.
 *
 * Key test scenarios:
 * - User isolation: Document ID = userId, no cross-user access
 * - Encryption: Credentials encrypted at rest, decrypted on read
 * - CRUD operations: get, add, update, delete worker configs
 * - Reordering: Workers can be reordered by priority
 * - Test result storage
 * - Max workers: 2 workers per user enforced
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createWorkerSettingsRepository } from '../../../infra/firestore/workerSettingsRepository.js';
import { encryptToken } from '../../../infra/firestore/encryption.js';
import type { WorkerConfigInput } from '../../../domain/models/workerSettings.js';
import { WORKER_NAME_REGEX, MAX_WORKERS_PER_USER } from '../../../domain/models/workerSettings.js';

describe('workerSettingsRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    resetFirestore();
  });

  function createWorkerConfig(overrides: Partial<WorkerConfigInput> = {}): WorkerConfigInput {
    return {
      name: 'home-mac',
      url: 'https://mac.example.com',
      cfAccessClientId: 'client-id-mac',
      cfAccessClientSecret: 'secret-mac',
      dispatchSigningSecret: 'signing-secret-mac',
      ...overrides,
    };
  }

  describe('getSettings', () => {
    it('should return null for user with no settings', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.getSettings('new-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return decrypted settings for user with workers', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));

      const result = await repo.getSettings('user-1');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.userId).toBe('user-1');
        expect(result.value.workers).toHaveLength(1);
        expect(result.value.workers[0]?.name).toBe('home-mac');
        expect(result.value.workers[0]?.url).toBe('https://mac.example.com');
        expect(result.value.workers[0]?.cfAccessClientId).toBe('client-id-mac');
        expect(result.value.workers[0]?.cfAccessClientSecret).toBe('secret-mac');
        expect(result.value.workers[0]?.dispatchSigningSecret).toBe('signing-secret-mac');
        expect(result.value.workers[0]?.enabled).toBe(true);
      }
    });

    it('should return settings with multiple workers', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac', url: 'https://mac.example.com' }));
      await repo.addWorker('user-1', createWorkerConfig({ name: 'office-pc', url: 'https://office.example.com' }));

      const result = await repo.getSettings('user-1');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.workers).toHaveLength(2);
        expect(result.value.workers[0]?.name).toBe('home-mac');
        expect(result.value.workers[1]?.name).toBe('office-pc');
        expect(result.value.workers[0]?.url).toBe('https://mac.example.com');
        expect(result.value.workers[1]?.url).toBe('https://office.example.com');
      }
    });
  });

  describe('getWorkerByName', () => {
    it('should return null for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.getWorkerByName('no-user', 'home-mac');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null for non-existent worker', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));

      const result = await repo.getWorkerByName('user-1', 'office-pc');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return decrypted config for existing worker', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));

      const result = await repo.getWorkerByName('user-1', 'home-mac');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.name).toBe('home-mac');
        expect(result.value.url).toBe('https://mac.example.com');
        expect(result.value.cfAccessClientId).toBe('client-id-mac');
        expect(result.value.cfAccessClientSecret).toBe('secret-mac');
        expect(result.value.dispatchSigningSecret).toBe('signing-secret-mac');
      }
    });
  });

  describe('addWorker', () => {
    it('should create new document for new user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.addWorker('new-user', createWorkerConfig({ name: 'home-mac' }));

      expect(result.ok).toBe(true);

      const settings = await repo.getSettings('new-user');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.userId).toBe('new-user');
        expect(settings.value.workers).toHaveLength(1);
        expect(settings.value.workers[0]?.name).toBe('home-mac');
      }
    });

    it('should enforce max workers limit', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));
      await repo.addWorker('user-1', createWorkerConfig({ name: 'office-pc' }));

      const thirdWorker = await repo.addWorker('user-1', createWorkerConfig({ name: 'cloud-vm' }));

      expect(thirdWorker.ok).toBe(false);
      if (!thirdWorker.ok) {
        expect(thirdWorker.error.code).toBe('max_workers_exceeded');
        expect(thirdWorker.error.message).toContain(`Maximum ${MAX_WORKERS_PER_USER} workers`);
      }
    });

    it('should reject duplicate worker names', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));

      const duplicate = await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac', url: 'https://different.url' }));

      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.error.code).toBe('already_exists');
      }
    });

    it('should accept valid worker names', async () => {
      const validNames = [
        'home-mac',
        'office-pc',
        'cloud-vm-1',
        'a-b',
        'abc123',
        '123abc',
        'worker',
      ];

      for (const name of validNames) {
        expect(WORKER_NAME_REGEX.test(name)).toBe(true);
      }
    });

    it('should encrypt credentials in Firestore', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));

      const collection = fakeFirestore.collection('code_worker_settings');
      const doc = await collection.doc('user-1').get();
      const data = doc.data();

      expect(data?.['userId']).toBe('user-1');
      const workers = data?.['workers'] as unknown[];
      expect(workers).toHaveLength(1);

      const workerData = workers[0] as Record<string, string>;
      expect(workerData['cfAccessClientId']).not.toBe('client-id-mac');
      expect(workerData['cfAccessClientId']).toContain(':');
      expect(workerData['cfAccessClientSecret']).not.toBe('secret-mac');
      expect(workerData['dispatchSigningSecret']).not.toBe('signing-secret-mac');
    });

    it('should set enabled to true by default', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.workers[0]?.enabled).toBe(true);
      }
    });

    it('should normalize URL by removing trailing slashes', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({
        name: 'trailing-slash',
        url: 'https://worker.example.com/',
      }));

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'trailing-slash');
        expect(worker?.url).toBe('https://worker.example.com');
      }
    });

    it('should normalize URL with multiple trailing slashes', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({
        name: 'multi-slash',
        url: 'https://worker.example.com///',
      }));

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'multi-slash');
        expect(worker?.url).toBe('https://worker.example.com');
      }
    });
  });

  describe('updateWorker', () => {
    beforeEach(async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));
      await repo.addWorker('user-1', createWorkerConfig({ name: 'office-pc', url: 'https://office.example.com' }));
    });

    it('should update existing worker', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateWorker('user-1', 'home-mac', {
        url: 'https://new-mac.example.com',
        cfAccessClientId: 'new-client-id',
        cfAccessClientSecret: 'new-secret',
        dispatchSigningSecret: 'new-signing-secret',
      });

      expect(result.ok).toBe(true);

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'home-mac');
        expect(worker?.url).toBe('https://new-mac.example.com');
        expect(worker?.cfAccessClientId).toBe('new-client-id');
      }
    });

    it('should update enabled flag', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorker('user-1', 'home-mac', { enabled: false });

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'home-mac');
        expect(worker?.enabled).toBe(false);
      }
    });

    it('should normalize URL by removing trailing slashes on update', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorker('user-1', 'home-mac', { url: 'https://updated.example.com/' });

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'home-mac');
        expect(worker?.url).toBe('https://updated.example.com');
      }
    });

    it('should preserve other workers when updating one', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorker('user-1', 'home-mac', { url: 'https://updated.example.com' });

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.workers).toHaveLength(2);
        const homeMac = settings.value.workers.find((w) => w.name === 'home-mac');
        const officePc = settings.value.workers.find((w) => w.name === 'office-pc');
        expect(homeMac?.url).toBe('https://updated.example.com');
        expect(officePc?.url).toBe('https://office.example.com');
      }
    });

    it('should return NOT_FOUND for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateWorker('no-user', 'home-mac', { url: 'https://new.example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not_found');
      }
    });

    it('should return NOT_FOUND for non-existent worker', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateWorker('user-1', 'cloud-vm', { url: 'https://new.example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not_found');
      }
    });
  });

  describe('deleteWorker', () => {
    it('should return NOT_FOUND for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.deleteWorker('no-user', 'home-mac');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not_found');
      }
    });

    it('should delete entire document when removing last worker', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));
      await repo.deleteWorker('user-1', 'home-mac');

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok) {
        expect(settings.value).toBeNull();
      }
    });

    it('should remove only specified worker and keep others', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));
      await repo.addWorker('user-1', createWorkerConfig({ name: 'office-pc', url: 'https://office.example.com' }));
      await repo.deleteWorker('user-1', 'home-mac');

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.workers).toHaveLength(1);
        expect(settings.value.workers[0]?.name).toBe('office-pc');
      }
    });
  });

  describe('reorderWorkers', () => {
    beforeEach(async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));
      await repo.addWorker('user-1', createWorkerConfig({ name: 'office-pc', url: 'https://office.example.com' }));
    });

    it('should reorder workers by name list', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.reorderWorkers('user-1', ['office-pc', 'home-mac']);

      expect(result.ok).toBe(true);

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.workers).toHaveLength(2);
        expect(settings.value.workers[0]?.name).toBe('office-pc');
        expect(settings.value.workers[1]?.name).toBe('home-mac');
      }
    });

    it('should return NOT_FOUND for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.reorderWorkers('no-user', ['home-mac']);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not_found');
      }
    });

    it('should validate all worker names exist', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.reorderWorkers('user-1', ['home-mac', 'cloud-vm']);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toContain('exactly all existing worker names');
      }
    });
  });

  describe('updateTestResult', () => {
    beforeEach(async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      await repo.addWorker('user-1', createWorkerConfig({ name: 'home-mac' }));
    });

    it('should return NOT_FOUND for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateTestResult('no-user', 'home-mac', {
        status: 'success',
        message: 'Test passed',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not_found');
      }
    });

    it('should return NOT_FOUND for non-existent worker', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateTestResult('user-1', 'office-pc', {
        status: 'success',
        message: 'Test passed',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not_found');
      }
    });

    it('should update test status for success', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateTestResult('user-1', 'home-mac', {
        status: 'success',
        message: 'Connection successful',
      });

      expect(result.ok).toBe(true);

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'home-mac');
        expect(worker?.testStatus).toBe('success');
        expect(worker?.testMessage).toBe('Connection successful');
        expect(worker?.lastTestedAt).toBeDefined();
      }
    });

    it('should update test status for failure', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateTestResult('user-1', 'home-mac', {
        status: 'failure',
        message: 'Connection timeout',
      });

      expect(result.ok).toBe(true);

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'home-mac');
        expect(worker?.testStatus).toBe('failure');
        expect(worker?.testMessage).toBe('Connection timeout');
      }
    });
  });

  describe('user isolation', () => {
    it('should not allow access to other users settings', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-a', createWorkerConfig({ name: 'home-mac', url: 'https://user-a.example.com' }));
      await repo.addWorker('user-b', createWorkerConfig({ name: 'home-mac', url: 'https://user-b.example.com' }));

      const settingsA = await repo.getSettings('user-a');
      const settingsB = await repo.getSettings('user-b');

      expect(settingsA.ok).toBe(true);
      expect(settingsB.ok).toBe(true);

      if (settingsA.ok && settingsA.value !== null) {
        expect(settingsA.value.workers[0]?.url).toBe('https://user-a.example.com');
      }

      if (settingsB.ok && settingsB.value !== null) {
        expect(settingsB.value.workers[0]?.url).toBe('https://user-b.example.com');
      }
    });

    it('should use userId as document ID for direct access', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('specific-user-id', createWorkerConfig({ name: 'home-mac' }));

      const collection = fakeFirestore.collection('code_worker_settings');
      const doc = await collection.doc('specific-user-id').get();

      expect(doc.exists).toBe(true);
      expect(doc.data()?.['userId']).toBe('specific-user-id');
    });
  });

  describe('encryption verification', () => {
    it('should store encrypted values that cannot be read directly', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.addWorker('user-1', createWorkerConfig({
        name: 'home-mac',
        cfAccessClientSecret: 'super-secret-value-12345',
      }));

      const collection = fakeFirestore.collection('code_worker_settings');
      const doc = await collection.doc('user-1').get();
      const rawData = doc.data();

      const workers = rawData?.['workers'] as unknown[];
      const workerRawData = workers[0] as Record<string, string>;
      expect(workerRawData['cfAccessClientSecret']).not.toBe('super-secret-value-12345');
      expect(workerRawData['cfAccessClientSecret']).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      const decrypted = await repo.getSettings('user-1');
      expect(decrypted.ok).toBe(true);
      if (decrypted.ok && decrypted.value !== null) {
        expect(decrypted.value.workers[0]?.cfAccessClientSecret).toBe('super-secret-value-12345');
      }
    });
  });

  // Tests for v8 ignore blocks
  describe('decryption error path (line 138)', () => {
    it('should return error for corrupted encrypted data', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Write corrupted (non-base64) encrypted data directly to Firestore
      const collection = fakeFirestore.collection('code_worker_settings');
      await collection.doc('corrupted-user').set({
        userId: 'corrupted-user',
        workers: [
          {
            name: 'test-worker',
            url: 'https://test.example.com',
            cfAccessClientId: 'not-valid-base64!!!', // corrupted encrypted data
            cfAccessClientSecret: 'also-corrupted',
            dispatchSigningSecret: 'bad-data',
            enabled: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await repo.getSettings('corrupted-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toContain('Failed to decrypt');
      }
    });
  });

  describe('getWorkerByName error propagation (line 162)', () => {
    it('should propagate error from getSettings when data is corrupted', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Write corrupted encrypted data directly to Firestore
      const collection = fakeFirestore.collection('code_worker_settings');
      await collection.doc('corrupted-user').set({
        userId: 'corrupted-user',
        workers: [
          {
            name: 'test-worker',
            url: 'https://test.example.com',
            cfAccessClientId: 'invalid-base64-data',
            cfAccessClientSecret: 'more-bad-data',
            dispatchSigningSecret: 'still-bad',
            enabled: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await repo.getWorkerByName('corrupted-user', 'test-worker');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toContain('Failed to decrypt');
      }
    });
  });

  describe('encryption error in addWorker (line 235)', () => {
    it('should return error when encryption fails in production', async () => {
      // Set production mode and invalid encryption key to cause encryption to fail
      // Using vi.stubEnv for automatic cleanup after test
      vi.stubEnv('INTEXURAOS_TOKEN_ENCRYPTION_KEY', 'invalid-key'); // Too short
      vi.stubEnv('NODE_ENV', 'production');

      try {
        const repo = createWorkerSettingsRepository({
          firestore: fakeFirestore as unknown as Firestore,
          logger,
        });

        const result = await repo.addWorker('user-1', createWorkerConfig({
          name: 'test-worker',
          url: 'https://test.example.com',
        }));

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('internal_error');
          expect(result.error.message.toLowerCase()).toContain('encrypt');
        }
      } finally {
        // Reset environment after test to prevent leaking to subsequent tests
        vi.stubEnv('INTEXURAOS_TOKEN_ENCRYPTION_KEY', undefined);
        vi.stubEnv('NODE_ENV', undefined);
      }
    });
  });

  describe('conditional spreads in updateWorker (line 299)', () => {
    it('should preserve test fields when updating other fields', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // First add a worker
      await repo.addWorker('user-1', createWorkerConfig({ name: 'test-worker' }));

      // Update test result to set test fields
      await repo.updateTestResult('user-1', 'test-worker', {
        status: 'success',
        message: 'Connection successful',
      });

      // Now update a different field using updateWorker
      await repo.updateWorker('user-1', 'test-worker', {
        url: 'https://updated.example.com',
      });

      // Verify test fields are preserved
      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'test-worker');
        expect(worker?.testStatus).toBe('success');
        expect(worker?.testMessage).toBe('Connection successful');
        expect(worker?.lastTestedAt).toBeDefined();
        expect(worker?.url).toBe('https://updated.example.com');
      }
    });

    it('should preserve test fields when they are undefined', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Add a worker without test fields
      await repo.addWorker('user-1', createWorkerConfig({ name: 'test-worker' }));

      // Update a field - should not add test fields if they didn't exist
      await repo.updateWorker('user-1', 'test-worker', {
        url: 'https://updated.example.com',
      });

      // Verify test fields are still undefined/not present
      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        const worker = settings.value.workers.find((w) => w.name === 'test-worker');
        expect(worker?.testStatus).toBeUndefined();
        expect(worker?.testMessage).toBeUndefined();
        expect(worker?.lastTestedAt).toBeUndefined();
      }
    });
  });

  describe('getHealthStatuses edge cases (line 483)', () => {
    it('should return null for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.getHealthStatuses('non-existent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null when user has no workerHealthStatuses field', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create user with workers but no health statuses
      const collection = fakeFirestore.collection('code_worker_settings');
      await collection.doc('user-no-health').set({
        userId: 'user-no-health',
        workers: [
          {
            name: 'test-worker',
            url: 'https://test.example.com',
            cfAccessClientId: encryptToken('client-id'),
            cfAccessClientSecret: encryptToken('secret'),
            dispatchSigningSecret: encryptToken('signing'),
            enabled: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Note: no workerHealthStatuses field
      });

      const result = await repo.getHealthStatuses('user-no-health');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return health statuses when they exist', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create user with health statuses
      const collection = fakeFirestore.collection('code_worker_settings');
      await collection.doc('user-with-health').set({
        userId: 'user-with-health',
        workers: [
          {
            name: 'test-worker',
            url: 'https://test.example.com',
            cfAccessClientId: encryptToken('client-id'),
            cfAccessClientSecret: encryptToken('secret'),
            dispatchSigningSecret: encryptToken('signing'),
            enabled: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        workerHealthStatuses: {
          'test-worker': {
            state: { status: 'healthy' },
            checkedAt: new Date().toISOString(),
            stale: false,
          },
        },
      });

      const result = await repo.getHealthStatuses('user-with-health');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value['test-worker']).toBeDefined();
        expect(result.value['test-worker']?.stale).toBe(false);
      }
    });
  });

});
