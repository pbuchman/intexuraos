/**
 * Firestore implementation of WorkerSettingsRepository.
 *
 * Key security properties:
 * - Document ID = userId (direct access, no cross-user queries possible)
 * - All credentials encrypted at rest using AES-256-GCM
 * - Decryption happens only when credentials are needed for dispatch
 */

import { FieldValue } from '@intexuraos/infra-firestore';
import { randomUUID } from 'node:crypto';
import type { Firestore } from '@intexuraos/infra-firestore';
import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import {
  isCodeTaskWorkerTypePolicy,
  type CodeTaskWorkerType,
  type CodeTaskWorkerTypePolicy,
} from '@intexuraos/code-task-domain';
import type {
  WorkerSettingsRepository,
  WorkerSettingsError,
  TestResult,
  DefaultWorkerTypeField,
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
  defaultReviewWorkerType?: string;
  defaultRemediationWorkerType?: string;
  defaultExecutionWorkerType?: string;
  defaultPlanningWorkerType?: string;
  defaultPullRequestWorkerType?: string;
  defaultSentryWorkerType?: string;
  workerHealthStatuses?: Record<string, {
    state: unknown;
    checkedAt: string;
    stale: boolean;
    registrationId?: string;
  }>;
}

/**
 * Worker config as stored in Firestore (credentials encrypted).
 */
interface EncryptedWorkerConfig extends Partial<CodeTaskWorkerTypePolicy> {
  name: string;
  registrationId?: string;
  url: string;
  cfAccessClientId: string; // encrypted
  cfAccessClientSecret: string; // encrypted
  dispatchSigningSecret: string; // encrypted
  enabled?: boolean;
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
    enabled: encrypted.enabled ?? true,
    ...(encrypted.registrationId !== undefined && { registrationId: encrypted.registrationId }),
    ...(isCodeTaskWorkerTypePolicy(encrypted) && {
      enabledWorkerTypes: encrypted.enabledWorkerTypes,
      workerTypesRevision: encrypted.workerTypesRevision,
    }),
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

function isSameRegistration(stored: EncryptedWorkerConfig, worker: WorkerConfig): boolean {
  return stored.name === worker.name && stored.url === worker.url && stored.registrationId === worker.registrationId;
}

function registrationChanged(): WorkerSettingsError {
  return { code: 'registration_changed', message: 'Worker registration changed. Refresh worker settings and try again.' };
}

function selectPolicy(
  stored: EncryptedWorkerConfig,
  policy: CodeTaskWorkerTypePolicy
): CodeTaskWorkerTypePolicy {
  if (isCodeTaskWorkerTypePolicy(stored) && stored.workerTypesRevision >= policy.workerTypesRevision) {
    return {
      enabledWorkerTypes: stored.enabledWorkerTypes,
      workerTypesRevision: stored.workerTypesRevision,
    };
  }
  return policy;
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
          ...(data.defaultReviewWorkerType !== undefined && {
            defaultReviewWorkerType: data.defaultReviewWorkerType as CodeTaskWorkerType,
          }),
          ...(data.defaultRemediationWorkerType !== undefined && { defaultRemediationWorkerType: data.defaultRemediationWorkerType as CodeTaskWorkerType }),
          ...(data.defaultExecutionWorkerType !== undefined && { defaultExecutionWorkerType: data.defaultExecutionWorkerType as CodeTaskWorkerType }),
          ...(data.defaultPlanningWorkerType !== undefined && { defaultPlanningWorkerType: data.defaultPlanningWorkerType as CodeTaskWorkerType }),
          ...(data.defaultPullRequestWorkerType !== undefined && { defaultPullRequestWorkerType: data.defaultPullRequestWorkerType as CodeTaskWorkerType }),
          ...(data.defaultSentryWorkerType !== undefined && { defaultSentryWorkerType: data.defaultSentryWorkerType as CodeTaskWorkerType }),
        };

        return ok(settings);
      } catch (error) {
        const message = getErrorMessage(error);

        if (message.includes('decrypt') || message.includes('Invalid encrypted')) {
          logger.error({ error, userId }, 'Failed to decrypt worker settings');
          return err({
            code: 'internal_error',
            message: `Failed to decrypt worker settings: ${message}`,
          });
        }

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

      if (!settingsResult.ok) {
        return settingsResult;
      }

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
        return await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(userId);
          const doc = await transaction.get(docRef);

          /* v8 ignore start -- ts-type: FakeFirestore always returns data() when exists is true @preserve */
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
            registrationId: randomUUID(),
            url: normalizeUrl(config.url),
            cfAccessClientId: encryptToken(config.cfAccessClientId),
            cfAccessClientSecret: encryptToken(config.cfAccessClientSecret),
            dispatchSigningSecret: encryptToken(config.dispatchSigningSecret),
            enabled: true,
          };

          const newWorkers = [...existingWorkers, encryptedWorker];
          const now = new Date().toISOString();

          if (doc.exists) {
            transaction.update(docRef, { workers: newWorkers, updatedAt: now });
          } else {
            transaction.set(docRef, {
              userId,
              workers: newWorkers,
              createdAt: now,
              updatedAt: now,
            });
          }

          return ok(undefined);
        });
      } catch (error) {
        const message = getErrorMessage(error);

        if (message.includes('encrypt')) {
          logger.error({ error, userId }, 'Failed to encrypt worker config');
          return err({
            code: 'internal_error',
            message: `Failed to encrypt worker config: ${message}`,
          });
        }

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
        return await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(userId);
          const doc = await transaction.get(docRef);

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
          const url = config.url === undefined ? existingWorker.url : normalizeUrl(config.url);
          const endpointChanged = url !== existingWorker.url;
          const registrationId = endpointChanged ? randomUUID() : existingWorker.registrationId;

          // Build updated worker config - only include optional fields if they have values
          const updatedWorker: EncryptedWorkerConfig = {
            name: workerName, // Name is immutable
            url,
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
            enabled: config.enabled ?? existingWorker.enabled ?? true,
            ...(registrationId !== undefined && { registrationId }),
            ...(!endpointChanged && isCodeTaskWorkerTypePolicy(existingWorker) && {
              enabledWorkerTypes: existingWorker.enabledWorkerTypes,
              workerTypesRevision: existingWorker.workerTypesRevision,
            }),
            ...(existingWorker.lastTestedAt !== undefined && { lastTestedAt: existingWorker.lastTestedAt }),
            ...(existingWorker.testStatus !== undefined && { testStatus: existingWorker.testStatus }),
            ...(existingWorker.testMessage !== undefined && { testMessage: existingWorker.testMessage }),
          };

          const updatedWorkers = [...existingData.workers];
          updatedWorkers[workerIndex] = updatedWorker;

          transaction.update(docRef, {
            workers: updatedWorkers,
            updatedAt: now,
            ...(endpointChanged && { [`workerHealthStatuses.${workerName}`]: FieldValue.delete() }),
          });

          return ok(undefined);
        });
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, workerName }, 'Failed to update worker');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async confirmWorkerTypePolicy(
      userId: string,
      worker: WorkerConfig,
      policy: CodeTaskWorkerTypePolicy
    ): Promise<Result<CodeTaskWorkerTypePolicy, WorkerSettingsError>> {
      try {
        return await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(userId);
          const data = (await transaction.get(docRef)).data() as WorkerSettingsDoc | undefined;
          const stored = data?.workers.find((candidate) => candidate.name === worker.name);
          if (data === undefined || stored === undefined || !isSameRegistration(stored, worker)) {
            return err(registrationChanged());
          }

          const confirmed = selectPolicy(stored, policy);
          if (confirmed === policy) {
            const cachedState = data.workerHealthStatuses?.[worker.name]?.state;
            transaction.update(docRef, {
              workers: data.workers.map((candidate) =>
                candidate === stored ? {
                  ...candidate,
                  enabledWorkerTypes: policy.enabledWorkerTypes,
                  workerTypesRevision: policy.workerTypesRevision,
                } : candidate
              ),
              ...(isCodeTaskWorkerTypePolicy(cachedState) && cachedState.workerTypesRevision < policy.workerTypesRevision && {
                [`workerHealthStatuses.${worker.name}.state.enabledWorkerTypes`]: policy.enabledWorkerTypes,
                [`workerHealthStatuses.${worker.name}.state.workerTypesRevision`]: policy.workerTypesRevision,
              }),
              updatedAt: new Date().toISOString(),
            });
          }
          return ok(confirmed);
        });
      } catch (error) {
        logger.error({ userId, workerName: worker.name, error }, 'Failed to confirm worker types');
        return err({ code: 'internal_error', message: 'Failed to confirm worker types' });
      }
    },

    async deleteWorker(
      userId: string,
      workerName: string
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        return await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(userId);
          const doc = await transaction.get(docRef);

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

          const updatedWorkers = existingData.workers.filter((w) => w.name !== workerName);
          transaction.update(docRef, {
            workers: updatedWorkers,
            updatedAt: now,
            [`workerHealthStatuses.${workerName}`]: FieldValue.delete(),
          });

          return ok(undefined);
        });
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
        return await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(userId);
          const doc = await transaction.get(docRef);

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

          transaction.update(docRef, {
            workers: reorderedWorkers,
            updatedAt: now,
          });

          return ok(undefined);
        });
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
        return await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(userId);
          const doc = await transaction.get(docRef);

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

          transaction.update(docRef, {
            workers: updatedWorkers,
            updatedAt: now,
          });

          return ok(undefined);
        });
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
        if (!doc.exists) {
          return ok(null);
        }
        const data = doc.data() as WorkerSettingsDoc;
        if (!data.workerHealthStatuses) {
          return ok(null);
        }
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
      status: WorkerHealthStatus,
      registration?: WorkerConfig
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const update = {
          [`workerHealthStatuses.${workerName}`]: status,
          updatedAt: new Date().toISOString(),
        };
        if (registration === undefined) {
          await docRef.update(update);
          return ok(undefined);
        }

        return await firestore.runTransaction(async (transaction) => {
          const data = (await transaction.get(docRef)).data() as WorkerSettingsDoc | undefined;
          const stored = data?.workers.find((candidate) => candidate.name === workerName);
          if (data === undefined || stored === undefined || !isSameRegistration(stored, registration)) {
            return err(registrationChanged());
          }

          const cached = data.workerHealthStatuses?.[workerName];
          const policy = isCodeTaskWorkerTypePolicy(status.state) ? status.state : undefined;
          const confirmed = policy === undefined ? undefined : selectPolicy(stored, policy);
          if ((cached !== undefined && cached.checkedAt > status.checkedAt) ||
              (confirmed !== undefined && policy !== undefined && confirmed.workerTypesRevision > policy.workerTypesRevision)) {
            return ok(undefined);
          }

          transaction.update(docRef, {
            ...update,
            [`workerHealthStatuses.${workerName}`]: {
              ...status,
              ...(registration.registrationId !== undefined && { registrationId: registration.registrationId }),
              ...(status.state._tag === 'healthy' && confirmed !== undefined && {
                state: { ...status.state, ...confirmed },
              }),
            },
            ...(confirmed !== undefined && confirmed === policy && {
              workers: data.workers.map((candidate) =>
                candidate === stored ? {
                  ...candidate,
                  enabledWorkerTypes: confirmed.enabledWorkerTypes,
                  workerTypesRevision: confirmed.workerTypesRevision,
                } : candidate
              ),
            }),
          });
          return ok(undefined);
        });
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, workerName }, 'Failed to update health status');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async updateDefaultWorkerType(
      userId: string,
      field: DefaultWorkerTypeField,
      workerType: CodeTaskWorkerType
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        return await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(userId);
          const doc = await transaction.get(docRef);
          const now = new Date().toISOString();

          if (doc.exists) {
            transaction.update(docRef, { [field]: workerType, updatedAt: now });
          } else {
            transaction.set(docRef, {
              userId,
              workers: [],
              [field]: workerType,
              createdAt: now,
              updatedAt: now,
            });
          }

          return ok(undefined);
        });
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, field }, 'Failed to update default worker type');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async clearDefaultWorkerType(
      userId: string,
      field: DefaultWorkerTypeField
    ): Promise<Result<void, WorkerSettingsError>> {
      try {
        const docRef = collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return ok(undefined);
        }

        const now = new Date().toISOString();
        await docRef.update({ [field]: FieldValue.delete(), updatedAt: now });

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, userId, field }, 'Failed to clear default worker type');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async updateDefaultReviewWorkerType(
      userId: string,
      workerType: CodeTaskWorkerType
    ): Promise<Result<void, WorkerSettingsError>> {
      return await this.updateDefaultWorkerType(userId, 'defaultReviewWorkerType', workerType);
    },
  };
}
