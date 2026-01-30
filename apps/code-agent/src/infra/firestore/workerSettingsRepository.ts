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
} from '../../domain/ports/workerSettingsRepository.js';
import type {
  UserWorkerSettings,
  WorkerConfig,
  WorkerConfigInput,
  WorkerType,
} from '../../domain/models/workerSettings.js';
import { encryptToken, decryptToken } from './encryption.js';

const COLLECTION_NAME = 'code_worker_settings';

/**
 * Firestore document structure with encrypted fields.
 */
interface WorkerSettingsDoc {
  userId: string;
  mac?: EncryptedWorkerConfig;
  vm?: EncryptedWorkerConfig;
  workerPriority?: WorkerType[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Worker config as stored in Firestore (credentials encrypted).
 */
interface EncryptedWorkerConfig {
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
 * Encrypt a worker config for storage.
 */
function encryptWorkerConfig(config: WorkerConfigInput): EncryptedWorkerConfig {
  return {
    url: config.url,
    cfAccessClientId: encryptToken(config.cfAccessClientId),
    cfAccessClientSecret: encryptToken(config.cfAccessClientSecret),
    dispatchSigningSecret: encryptToken(config.dispatchSigningSecret),
    enabled: config.enabled ?? true,
  };
}

/**
 * Decrypt a worker config from storage.
 */
function decryptWorkerConfig(encrypted: EncryptedWorkerConfig): WorkerConfig {
  const config: WorkerConfig = {
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

        const settings: UserWorkerSettings = {
          userId: data.userId,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };

        if (data.workerPriority !== undefined) {
          settings.workerPriority = data.workerPriority;
        }

        if (data.mac !== undefined) {
          settings.mac = decryptWorkerConfig(data.mac);
        }

        if (data.vm !== undefined) {
          settings.vm = decryptWorkerConfig(data.vm);
        }

        return ok(settings);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message.includes('decrypt') || message.includes('Invalid encrypted')) {
          logger.error({ error, userId }, 'Failed to decrypt worker settings');
          return err({
            code: 'DECRYPTION_ERROR',
            message: `Failed to decrypt worker settings: ${message}`,
          });
        }

        logger.error({ error, userId }, 'Failed to get worker settings');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async getWorkerConfig(
      userId: string,
      workerType: WorkerType
    ): Promise<Result<WorkerConfig | null, WorkerSettingsError>> {
      const settingsResult = await this.getSettings(userId);

      if (!settingsResult.ok) {
        return settingsResult;
      }

      const settings = settingsResult.value;
      if (settings === null) {
        return ok(null);
      }

      const config = settings[workerType];
      return ok(config ?? null);
    },

    async updateWorkerConfig(
      userId: string,
      workerType: WorkerType,
      config: WorkerConfigInput
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const now = new Date().toISOString();

        const encryptedConfig = encryptWorkerConfig(config);

        const doc = await docRef.get();

        if (!doc.exists) {
          const newDoc: WorkerSettingsDoc = {
            userId,
            [workerType]: encryptedConfig,
            workerPriority: [workerType],
            createdAt: now,
            updatedAt: now,
          };
          await docRef.set(newDoc);
        } else {
          const existingData = doc.data() as WorkerSettingsDoc;
          const existingPriority = existingData.workerPriority ?? [];

          const updatedPriority = existingPriority.includes(workerType)
            ? existingPriority
            : [...existingPriority, workerType];

          const updateData: Record<string, unknown> = {
            [workerType]: encryptedConfig,
            workerPriority: updatedPriority,
            updatedAt: now,
          };

          await docRef.update(updateData);
        }

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message.includes('encrypt')) {
          logger.error({ error, userId, workerType }, 'Failed to encrypt worker config');
          return err({
            code: 'ENCRYPTION_ERROR',
            message: `Failed to encrypt worker config: ${message}`,
          });
        }

        logger.error({ error, userId, workerType }, 'Failed to update worker config');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async deleteWorkerConfig(
      userId: string,
      workerType: WorkerType
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return ok(undefined);
        }

        const existingData = doc.data() as WorkerSettingsDoc;
        const now = new Date().toISOString();

        const otherType: WorkerType = workerType === 'mac' ? 'vm' : 'mac';
        const hasOtherConfig = existingData[otherType] !== undefined;

        if (!hasOtherConfig) {
          await docRef.delete();
        } else {
          const { FieldValue } = await import('@google-cloud/firestore');

          const updatedPriority = (existingData.workerPriority ?? []).filter(
            (t) => t !== workerType
          );

          await docRef.update({
            [workerType]: FieldValue.delete(),
            workerPriority: updatedPriority,
            updatedAt: now,
          });
        }

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, workerType }, 'Failed to delete worker config');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async updateTestResult(
      userId: string,
      workerType: WorkerType,
      result: {
        testStatus: 'success' | 'failure';
        testMessage?: string;
        lastTestedAt: string;
      }
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return err({
            code: 'NOT_FOUND',
            message: 'Worker settings not found',
          });
        }

        const existingData = doc.data() as WorkerSettingsDoc;

        if (existingData[workerType] === undefined) {
          return err({
            code: 'NOT_FOUND',
            message: `${workerType} worker config not found`,
          });
        }

        const now = new Date().toISOString();

        await docRef.update({
          [`${workerType}.lastTestedAt`]: result.lastTestedAt,
          [`${workerType}.testStatus`]: result.testStatus,
          [`${workerType}.testMessage`]: result.testMessage ?? null,
          updatedAt: now,
        });

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, workerType }, 'Failed to update test result');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${message}`,
        });
      }
    },
  };
}
