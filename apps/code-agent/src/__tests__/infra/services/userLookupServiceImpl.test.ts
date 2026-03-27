/**
 * Tests for UserLookupService implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import pino from 'pino';
import {
  createUserLookupService,
  type UserLookupServiceDeps,
} from '../../../infra/services/userLookupServiceImpl.js';
import type { GitHubUsernameResolver } from '../../../domain/ports/gitHubUsernameResolver.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';
import type { WorkerConfig, UserWorkerSettings } from '../../../domain/models/workerSettings.js';

const logger = pino({ level: 'silent' }) as unknown as Logger;

function createEnabledWorker(name: string): WorkerConfig {
  return {
    name,
    url: `https://${name}.example.com`,
    cfAccessClientId: 'client-id',
    cfAccessClientSecret: 'client-secret',
    dispatchSigningSecret: 'dispatch-secret',
    enabled: true,
  };
}

function createDisabledWorker(name: string): WorkerConfig {
  return {
    ...createEnabledWorker(name),
    enabled: false,
  };
}

function createMockRepo(): WorkerSettingsRepository {
  return {
    getSettings: async (): ReturnType<WorkerSettingsRepository['getSettings']> => ok({
      userId: 'user-123',
      workers: [createEnabledWorker('home-mac')],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }),
    getWorkerByName: async (): ReturnType<WorkerSettingsRepository['getWorkerByName']> => ok(null),
    addWorker: async (): ReturnType<WorkerSettingsRepository['addWorker']> => ok(undefined),
    updateWorker: async (): ReturnType<WorkerSettingsRepository['updateWorker']> => ok(undefined),
    deleteWorker: async (): ReturnType<WorkerSettingsRepository['deleteWorker']> => ok(undefined),
    reorderWorkers: async (): ReturnType<WorkerSettingsRepository['reorderWorkers']> => ok(undefined),
    updateTestResult: async (): ReturnType<WorkerSettingsRepository['updateTestResult']> => ok(undefined),
    getHealthStatuses: async (): ReturnType<WorkerSettingsRepository['getHealthStatuses']> => ok(null),
    updateHealthStatus: async (): ReturnType<WorkerSettingsRepository['updateHealthStatus']> => ok(undefined),
    updateDefaultReviewWorkerType: async (): ReturnType<WorkerSettingsRepository['updateDefaultReviewWorkerType']> => ok(undefined),
    updateDefaultWorkerType: async (): ReturnType<WorkerSettingsRepository['updateDefaultWorkerType']> => ok(undefined),
  };
}

describe('UserLookupService', () => {
  let mockResolver: GitHubUsernameResolver;
  let mockRepo: WorkerSettingsRepository;
  let deps: UserLookupServiceDeps;

  beforeEach(() => {
    mockResolver = {
      resolve: async (): ReturnType<GitHubUsernameResolver['resolve']> => ok('user-123'),
    };

    mockRepo = createMockRepo();

    deps = {
      gitHubUsernameResolver: mockResolver,
      workerSettingsRepo: mockRepo,
      logger,
    };
  });

  it('resolves GitHub username to user ID and enabled worker', async () => {
    const service = createUserLookupService(deps);
    const result = await service.resolveByGitHubUsername('testuser');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe('user-123');
      expect(result.value.worker.name).toBe('home-mac');
    }
  });

  it('returns USER_NOT_FOUND when resolver cannot find username', async () => {
    mockResolver.resolve = async (): ReturnType<GitHubUsernameResolver['resolve']> =>
      err({ code: 'NOT_FOUND', message: 'not found' });
    const service = createUserLookupService(deps);
    const result = await service.resolveByGitHubUsername('unknown');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('USER_NOT_FOUND');
    }
  });

  it('returns INTERNAL_ERROR when worker settings fetch fails', async () => {
    mockRepo.getSettings = async (): ReturnType<WorkerSettingsRepository['getSettings']> =>
      err({ code: 'internal_error', message: 'Firestore error' });
    const service = createUserLookupService(deps);
    const result = await service.resolveByGitHubUsername('testuser');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('returns NO_ENABLED_WORKER when user has no settings', async () => {
    mockRepo.getSettings = async (): ReturnType<WorkerSettingsRepository['getSettings']> => ok(null);
    const service = createUserLookupService(deps);
    const result = await service.resolveByGitHubUsername('testuser');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_ENABLED_WORKER');
      expect(result.error.message).toContain('no worker settings');
    }
  });

  it('returns NO_ENABLED_WORKER when all workers are disabled', async () => {
    mockRepo.getSettings = async (): ReturnType<WorkerSettingsRepository['getSettings']> => ok({
      userId: 'user-123',
      workers: [createDisabledWorker('home-mac')],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as UserWorkerSettings);
    const service = createUserLookupService(deps);
    const result = await service.resolveByGitHubUsername('testuser');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_ENABLED_WORKER');
      expect(result.error.message).toContain('no enabled workers');
    }
  });

  it('returns the first enabled worker when multiple exist', async () => {
    mockRepo.getSettings = async (): ReturnType<WorkerSettingsRepository['getSettings']> => ok({
      userId: 'user-123',
      workers: [
        createDisabledWorker('disabled-one'),
        createEnabledWorker('enabled-one'),
        createEnabledWorker('enabled-two'),
      ],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as UserWorkerSettings);
    const service = createUserLookupService(deps);
    const result = await service.resolveByGitHubUsername('testuser');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.worker.name).toBe('enabled-one');
    }
  });
});
