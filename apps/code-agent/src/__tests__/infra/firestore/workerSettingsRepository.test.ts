/**
 * Tests for WorkerSettings Firestore repository.
 *
 * Key test scenarios:
 * - User isolation: Document ID = userId, no cross-user access
 * - Encryption: Credentials encrypted at rest, decrypted on read
 * - CRUD operations: get, update, delete worker configs
 * - Test result storage
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createWorkerSettingsRepository } from '../../../infra/firestore/workerSettingsRepository.js';
import type { WorkerConfigInput } from '../../../domain/models/workerSettings.js';

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

  function createMacConfig(overrides: Partial<WorkerConfigInput> = {}): WorkerConfigInput {
    return {
      url: 'https://mac.example.com',
      cfAccessClientId: 'client-id-mac',
      cfAccessClientSecret: 'secret-mac',
      dispatchSigningSecret: 'signing-secret-mac',
      ...overrides,
    };
  }

  function createVmConfig(overrides: Partial<WorkerConfigInput> = {}): WorkerConfigInput {
    return {
      url: 'https://vm.example.com',
      cfAccessClientId: 'client-id-vm',
      cfAccessClientSecret: 'secret-vm',
      dispatchSigningSecret: 'signing-secret-vm',
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

    it('should return decrypted settings for user with settings', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());

      const result = await repo.getSettings('user-1');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.userId).toBe('user-1');
        expect(result.value.mac).toBeDefined();
        expect(result.value.mac?.url).toBe('https://mac.example.com');
        expect(result.value.mac?.cfAccessClientId).toBe('client-id-mac');
        expect(result.value.mac?.cfAccessClientSecret).toBe('secret-mac');
        expect(result.value.mac?.dispatchSigningSecret).toBe('signing-secret-mac');
        expect(result.value.mac?.enabled).toBe(true);
      }
    });

    it('should return settings with both mac and vm configs', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());
      await repo.updateWorkerConfig('user-1', 'vm', createVmConfig());

      const result = await repo.getSettings('user-1');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.mac).toBeDefined();
        expect(result.value.vm).toBeDefined();
        expect(result.value.mac?.url).toBe('https://mac.example.com');
        expect(result.value.vm?.url).toBe('https://vm.example.com');
        expect(result.value.workerPriority).toEqual(['mac', 'vm']);
      }
    });
  });

  describe('getWorkerConfig', () => {
    it('should return null for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.getWorkerConfig('no-user', 'mac');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null for non-existent worker type', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());

      const result = await repo.getWorkerConfig('user-1', 'vm');

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

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());

      const result = await repo.getWorkerConfig('user-1', 'mac');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.url).toBe('https://mac.example.com');
        expect(result.value.cfAccessClientId).toBe('client-id-mac');
        expect(result.value.cfAccessClientSecret).toBe('secret-mac');
        expect(result.value.dispatchSigningSecret).toBe('signing-secret-mac');
      }
    });
  });

  describe('updateWorkerConfig', () => {
    it('should create new document for new user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateWorkerConfig('new-user', 'mac', createMacConfig());

      expect(result.ok).toBe(true);

      const settings = await repo.getSettings('new-user');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.userId).toBe('new-user');
        expect(settings.value.mac).toBeDefined();
        expect(settings.value.workerPriority).toEqual(['mac']);
      }
    });

    it('should encrypt credentials in Firestore', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());

      const collection = fakeFirestore.collection('code_worker_settings');
      const doc = await collection.doc('user-1').get();
      const data = doc.data();

      const macData = data?.['mac'] as Record<string, string> | undefined;
      expect(macData?.['cfAccessClientId']).not.toBe('client-id-mac');
      expect(macData?.['cfAccessClientId']).toContain(':');
      expect(macData?.['cfAccessClientSecret']).not.toBe('secret-mac');
      expect(macData?.['dispatchSigningSecret']).not.toBe('signing-secret-mac');
    });

    it('should update existing config and preserve other worker', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());
      await repo.updateWorkerConfig('user-1', 'vm', createVmConfig());
      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig({ url: 'https://new-mac.example.com' }));

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.mac?.url).toBe('https://new-mac.example.com');
        expect(settings.value.vm?.url).toBe('https://vm.example.com');
      }
    });

    it('should add new worker type to priority list', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());
      await repo.updateWorkerConfig('user-1', 'vm', createVmConfig());

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.workerPriority).toEqual(['mac', 'vm']);
      }
    });

    it('should not duplicate worker type in priority list on update', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());
      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig({ url: 'https://updated.example.com' }));

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.workerPriority).toEqual(['mac']);
      }
    });

    it('should set enabled to true by default', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.mac?.enabled).toBe(true);
      }
    });

    it('should respect enabled flag when provided', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig({ enabled: false }));

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.mac?.enabled).toBe(false);
      }
    });
  });

  describe('deleteWorkerConfig', () => {
    it('should do nothing for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.deleteWorkerConfig('no-user', 'mac');

      expect(result.ok).toBe(true);
    });

    it('should delete entire document when only one worker config', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());
      await repo.deleteWorkerConfig('user-1', 'mac');

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok) {
        expect(settings.value).toBeNull();
      }
    });

    it('should remove only specified worker type and keep other', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());
      await repo.updateWorkerConfig('user-1', 'vm', createVmConfig());
      await repo.deleteWorkerConfig('user-1', 'mac');

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.mac).toBeUndefined();
        expect(settings.value.vm).toBeDefined();
        expect(settings.value.workerPriority).toEqual(['vm']);
      }
    });

    it('should update priority list on delete', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());
      await repo.updateWorkerConfig('user-1', 'vm', createVmConfig());
      await repo.deleteWorkerConfig('user-1', 'vm');

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.workerPriority).toEqual(['mac']);
      }
    });
  });

  describe('updateTestResult', () => {
    it('should return NOT_FOUND for non-existent user', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.updateTestResult('no-user', 'mac', {
        testStatus: 'success',
        lastTestedAt: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return NOT_FOUND for non-existent worker type', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());

      const result = await repo.updateTestResult('user-1', 'vm', {
        testStatus: 'success',
        lastTestedAt: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should update test status for existing worker', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());

      const testTime = new Date().toISOString();
      const result = await repo.updateTestResult('user-1', 'mac', {
        testStatus: 'success',
        testMessage: 'Connection successful',
        lastTestedAt: testTime,
      });

      expect(result.ok).toBe(true);

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.mac?.testStatus).toBe('success');
        expect(settings.value.mac?.testMessage).toBe('Connection successful');
        expect(settings.value.mac?.lastTestedAt).toBe(testTime);
      }
    });

    it('should update test status for failure', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig());

      const testTime = new Date().toISOString();
      const result = await repo.updateTestResult('user-1', 'mac', {
        testStatus: 'failure',
        testMessage: 'Connection timeout',
        lastTestedAt: testTime,
      });

      expect(result.ok).toBe(true);

      const settings = await repo.getSettings('user-1');
      expect(settings.ok).toBe(true);
      if (settings.ok && settings.value !== null) {
        expect(settings.value.mac?.testStatus).toBe('failure');
        expect(settings.value.mac?.testMessage).toBe('Connection timeout');
      }
    });
  });

  describe('user isolation', () => {
    it('should not allow access to other users settings', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('user-a', 'mac', createMacConfig({ url: 'https://user-a.example.com' }));
      await repo.updateWorkerConfig('user-b', 'mac', createMacConfig({ url: 'https://user-b.example.com' }));

      const settingsA = await repo.getSettings('user-a');
      const settingsB = await repo.getSettings('user-b');

      expect(settingsA.ok).toBe(true);
      expect(settingsB.ok).toBe(true);

      if (settingsA.ok && settingsA.value !== null) {
        expect(settingsA.value.mac?.url).toBe('https://user-a.example.com');
      }

      if (settingsB.ok && settingsB.value !== null) {
        expect(settingsB.value.mac?.url).toBe('https://user-b.example.com');
      }
    });

    it('should use userId as document ID for direct access', async () => {
      const repo = createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.updateWorkerConfig('specific-user-id', 'mac', createMacConfig());

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

      await repo.updateWorkerConfig('user-1', 'mac', createMacConfig({
        cfAccessClientSecret: 'super-secret-value-12345',
      }));

      const collection = fakeFirestore.collection('code_worker_settings');
      const doc = await collection.doc('user-1').get();
      const rawData = doc.data();

      const macRawData = rawData?.['mac'] as Record<string, string> | undefined;
      expect(macRawData?.['cfAccessClientSecret']).not.toBe('super-secret-value-12345');
      expect(macRawData?.['cfAccessClientSecret']).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      const decrypted = await repo.getSettings('user-1');
      expect(decrypted.ok).toBe(true);
      if (decrypted.ok && decrypted.value !== null) {
        expect(decrypted.value.mac?.cfAccessClientSecret).toBe('super-secret-value-12345');
      }
    });
  });
});
