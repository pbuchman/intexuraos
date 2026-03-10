/**
 * Firestore implementation of WorkerSettingsRepository.
 *
 * Key security properties:
 * - Document ID = userId (direct access, no cross-user queries possible)
 * - All credentials encrypted at rest using AES-256-GCM
 * - Decryption happens only when credentials are needed for dispatch
 */

import type { Firestore } from '@intexuraos/infra-firestore';
import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  WorkerSettingsRepository,
  WorkerSettingsError,
  TestResult,
} from '../../domain/ports/workerSettingsRepository.js';
import type {
  UserWorkerSettings,
  WorkerConfig,
  WorkerConfigInput,
  WorkerConfigUpdateInput,
  WorkerHealthStatus,
} from '../../domain/models/workerSettings.js';
import { MAX_WORKERS_PER_USER } from '../../domain/models/workerSettings.js';
import { encryptToken, decryptToken } from './encryption.js';

const COLLECTION_NAME = 'code_worker_settings';

/**
 * Normalize URL by removing trailing slashes.
 * Prevents double-slash issues when appending paths (e.g., /health).
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Firestore document structure with encrypted fields.
 */
interface WorkerSettingsDoc {
  userId: string;
  workers: EncryptedWorkerConfig[];
  createdAt: string;
  updatedAt: string;
  workerHealthStatuses?: Record<string, {
    state: unknown;
    checkedAt: string;
    stale: boolean;
  }>;
}

/**
 * Worker config as stored in Firestore (credentials encrypted).
 */
interface EncryptedWorkerConfig {
  name: string;
  url: string;
  cfAccessClientId: string; // encrypted
  cfAccessClientSecret: string; // encrypted
  dispatchSigningSecret: string; // encrypted
  enabled: boolean;
  lastTestedAt?: string;
  testStatus?: 'success' | 'failure';
  testMessage?: string;
}

/**
 * Decrypt a worker config from storage.
 */
function decryptWorkerConfig(
  encrypted: EncryptedWorkerConfig,
  workerName: string
): WorkerConfig {
  const config: WorkerConfig = {
    name: workerName,
    url: encrypted.url,
    cfAccessClientId: decryptToken(encrypted.cfAccessClientId),
    cfAccessClientSecret: decryptToken(encrypted.cfAccessClientSecret),
    dispatchSigningSecret: decryptToken(encrypted.dispatchSigningSecret),
    enabled: encrypted.enabled,
  };

  if (encrypted.lastTestedAt !== undefined) {
    config.lastTestedAt = encrypted.lastTestedAt;
  }
  if (encrypted.testStatus !== undefined) {
    config.testStatus = encrypted.testStatus;
  }
  if (encrypted.testMessage !== undefined) {
    config.testMessage = encrypted.testMessage;
  }

  return config;
}

export interface WorkerSettingsRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

/**
 * Create a Firestore-backed worker settings repository.
 */
export function createWorkerSettingsRepository(
  deps: WorkerSettingsRepositoryDeps
): WorkerSettingsRepository {
  const { firestore, logger } = deps;
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async getSettings(userId: string): Promise<Result<UserWorkerSettings | null, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return ok(null);
        }

        const data = doc.data() as WorkerSettingsDoc;

        const workers: WorkerConfig[] = data.workers.map((w) =>
          decryptWorkerConfig(w, w.name)
        );

        const settings: UserWorkerSettings = {
          userId: data.userId,
          workers,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };

        return ok(settings);
      } catch (error) {
        const message = getErrorMessage(error);

        /* v8 ignore start -- test-infra: decryption error path requires corrupted data @preserve */
        if (message.includes('decrypt') || message.includes('Invalid encrypted')) {
          logger.error({ error, userId }, 'Failed to decrypt worker settings');
          return err({
            code: 'internal_error',
            message: `Failed to decrypt worker settings: ${message}`,
          });
        }
        /* v8 ignore stop @preserve */

        logger.error({ error, userId }, 'Failed to get worker settings');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async getWorkerByName(
      userId: string,
      workerName: string
    ): Promise<Result<WorkerConfig | null, WorkerSettingsError>> {
      const settingsResult = await this.getSettings(userId);

      /* v8 ignore start -- ts-type: Result type error propagation @preserve */
      if (!settingsResult.ok) {
        return settingsResult;
      }
      /* v8 ignore stop @preserve */

      const settings = settingsResult.value;
      if (settings === null) {
        return ok(null);
      }

      const worker = settings.workers.find((w) => w.name === workerName);
      return ok(worker ?? null);
    },

    async addWorker(
      userId: string,
      config: WorkerConfigInput
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        /* v8 ignore start -- ts-type: nullish coalescing fallback when doc.data() returns undefined @preserve */
        const existingWorkers = doc.exists
          ? ((doc.data() as WorkerSettingsDoc | undefined)?.workers ?? [])
          : [];
        /* v8 ignore stop @preserve */

        // Check max workers limit
        if (existingWorkers.length >= MAX_WORKERS_PER_USER) {
          return err({
            code: 'max_workers_exceeded',
            message: `Maximum ${String(MAX_WORKERS_PER_USER)} workers allowed per user`,
          });
        }

        // Check for duplicate name
        if (existingWorkers.some((w: EncryptedWorkerConfig) => w.name === config.name)) {
          return err({
            code: 'already_exists',
            message: `Worker with name '${config.name}' already exists`,
          });
        }

        // Encrypt credentials and add to array
        const encryptedWorker: EncryptedWorkerConfig = {
          name: config.name,
          url: normalizeUrl(config.url),
          cfAccessClientId: encryptToken(config.cfAccessClientId),
          cfAccessClientSecret: encryptToken(config.cfAccessClientSecret),
          dispatchSigningSecret: encryptToken(config.dispatchSigningSecret),
          enabled: true,
        };

        const newWorkers = [...existingWorkers, encryptedWorker];
        const now = new Date().toISOString();

        if (doc.exists) {
          await docRef.update({ workers: newWorkers, updatedAt: now });
        } else {
          await docRef.set({
            userId,
            workers: newWorkers,
            createdAt: now,
            updatedAt: now,
          });
        }

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);

        /* v8 ignore start -- test-infra: encryption error path requires crypto failure @preserve */
        if (message.includes('encrypt')) {
          logger.error({ error, userId }, 'Failed to encrypt worker config');
          return err({
            code: 'internal_error',
            message: `Failed to encrypt worker config: ${message}`,
          });
        }
        /* v8 ignore stop @preserve */

        logger.error({ error, userId }, 'Failed to add worker');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async updateWorker(
      userId: string,
      workerName: string,
      config: WorkerConfigUpdateInput
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return err({
            code: 'not_found',
            message: `Worker '${workerName}' not found`,
          });
        }

        const existingData = doc.data() as WorkerSettingsDoc;
        const workerIndex = existingData.workers.findIndex((w) => w.name === workerName);

        const existingWorker = existingData.workers[workerIndex];
        if (workerIndex === -1 || existingWorker === undefined) {
          return err({
            code: 'not_found',
            message: `Worker '${workerName}' not found`,
          });
        }

        const now = new Date().toISOString();

        // Build updated worker config - only include optional fields if they have values
        const updatedWorker: EncryptedWorkerConfig = {
          name: workerName, // Name is immutable
          url: config.url !== undefined ? normalizeUrl(config.url) : existingWorker.url,
          cfAccessClientId:
            config.cfAccessClientId !== undefined
              ? encryptToken(config.cfAccessClientId)
              : existingWorker.cfAccessClientId,
          cfAccessClientSecret:
            config.cfAccessClientSecret !== undefined
              ? encryptToken(config.cfAccessClientSecret)
              : existingWorker.cfAccessClientSecret,
          dispatchSigningSecret:
            config.dispatchSigningSecret !== undefined
              ? encryptToken(config.dispatchSigningSecret)
              : existingWorker.dispatchSigningSecret,
          enabled: config.enabled ?? existingWorker.enabled,
          /* v8 ignore start -- ts-type: spread conditionals for optional field propagation @preserve */
          ...(existingWorker.lastTestedAt !== undefined && { lastTestedAt: existingWorker.lastTestedAt }),
          ...(existingWorker.testStatus !== undefined && { testStatus: existingWorker.testStatus }),
          ...(existingWorker.testMessage !== undefined && { testMessage: existingWorker.testMessage }),
          /* v8 ignore stop @preserve */
        };

        const updatedWorkers = [...existingData.workers];
        updatedWorkers[workerIndex] = updatedWorker;

        await docRef.update({
          workers: updatedWorkers,
          updatedAt: now,
        });

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, workerName }, 'Failed to update worker');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async deleteWorker(
      userId: string,
      workerName: string
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return err({
            code: 'not_found',
            message: `Worker '${workerName}' not found`,
          });
        }

        const existingData = doc.data() as WorkerSettingsDoc;
        const workerIndex = existingData.workers.findIndex((w) => w.name === workerName);

        if (workerIndex === -1) {
          return err({
            code: 'not_found',
            message: `Worker '${workerName}' not found`,
          });
        }

        const now = new Date().toISOString();

        // If this is the only worker, delete the entire document
        if (existingData.workers.length === 1) {
          await docRef.delete();
        } else {
          const updatedWorkers = existingData.workers.filter((w) => w.name !== workerName);
          await docRef.update({
            workers: updatedWorkers,
            updatedAt: now,
          });
        }

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, workerName }, 'Failed to delete worker');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async reorderWorkers(
      userId: string,
      workerNames: string[]
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return err({
            code: 'not_found',
            message: 'Worker settings not found',
          });
        }

        const existingData = doc.data() as WorkerSettingsDoc;
        const existingNames = existingData.workers.map((w) => w.name).sort();

        // Verify the reorder contains exactly the same workers
        const sortedInput = [...workerNames].sort();
        if (JSON.stringify(existingNames) !== JSON.stringify(sortedInput)) {
          return err({
            code: 'internal_error',
            message: 'Reorder must contain exactly all existing worker names',
          });
        }

        // Reorder workers according to the provided order
        // We've verified all names exist via the sort comparison above
        const reorderedWorkers: EncryptedWorkerConfig[] = workerNames
          .map((name) => existingData.workers.find((w) => w.name === name))
          .filter((w): w is EncryptedWorkerConfig => w !== undefined);

        const now = new Date().toISOString();

        await docRef.update({
          workers: reorderedWorkers,
          updatedAt: now,
        });

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId }, 'Failed to reorder workers');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async updateTestResult(
      userId: string,
      workerName: string,
      result: TestResult
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return err({
            code: 'not_found',
            message: 'Worker settings not found',
          });
        }

        const existingData = doc.data() as WorkerSettingsDoc;
        const workerIndex = existingData.workers.findIndex((w) => w.name === workerName);

        const existingWorker = existingData.workers[workerIndex];
        if (workerIndex === -1 || existingWorker === undefined) {
          return err({
            code: 'not_found',
            message: `Worker '${workerName}' not found`,
          });
        }

        const now = new Date().toISOString();

        const updatedWorkers = [...existingData.workers];
        updatedWorkers[workerIndex] = {
          ...existingWorker,
          lastTestedAt: now,
          testStatus: result.status,
          testMessage: result.message,
        };

        await docRef.update({
          workers: updatedWorkers,
          updatedAt: now,
        });

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, workerName }, 'Failed to update test result');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async getHealthStatuses(
      userId: string
    ): Promise<Result<Record<string, WorkerHealthStatus> | null, WorkerSettingsError>> {
      try {
        const doc = await collection.doc(userId).get();
        /* v8 ignore start -- test-infra: requires testing document existence edge case @preserve */
        if (!doc.exists) {
          return ok(null);
        }
        const data = doc.data() as WorkerSettingsDoc;
        if (!data.workerHealthStatuses) {
          return ok(null);
        }
        /* v8 ignore stop @preserve */
        return ok(data.workerHealthStatuses as Record<string, WorkerHealthStatus>);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId }, 'Failed to get health statuses');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async updateHealthStatus(
      userId: string,
      workerName: string,
      status: WorkerHealthStatus
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        await docRef.update({
          [`workerHealthStatuses.${workerName}`]: status,
          updatedAt: new Date().toISOString(),
        });
        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, workerName }, 'Failed to update health status');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },
  };
}
