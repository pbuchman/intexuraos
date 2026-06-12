/**
 * Unit tests for the updateDefaultWorkerType use case.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import pino from 'pino';
import type { Logger } from 'pino';
import { createUpdateDefaultWorkerTypeUseCase } from '../../../../domain/usecases/workerSettings/updateDefaultWorkerType.js';
import type { WorkerSettingsRepository } from '../../../../domain/ports/workerSettingsRepository.js';

const logger = pino({ level: 'silent' }) as unknown as Logger;

function makeRepo(overrides: Partial<WorkerSettingsRepository> = {}): WorkerSettingsRepository {
  const base: WorkerSettingsRepository = {
    getSettings: vi.fn(),
    getWorkerByName: vi.fn(),
    addWorker: vi.fn(),
    updateWorker: vi.fn(),
    deleteWorker: vi.fn(),
    reorderWorkers: vi.fn(),
    updateTestResult: vi.fn(),
    getHealthStatuses: vi.fn(),
    updateHealthStatus: vi.fn(),
    updateDefaultReviewWorkerType: vi.fn(),
    updateDefaultWorkerType: vi.fn().mockResolvedValue(ok(undefined)),
    clearDefaultWorkerType: vi.fn().mockResolvedValue(ok(undefined)),
  };
  return { ...base, ...overrides };
}

describe('updateDefaultWorkerType use case', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a concrete worker type through updateDefaultWorkerType', async () => {
    const repo = makeRepo();
    const useCase = createUpdateDefaultWorkerTypeUseCase({ workerSettingsRepo: repo, logger });

    const result = await useCase({
      userId: 'u1',
      field: 'defaultReviewWorkerType',
      label: 'review',
      workerType: 'glm',
    });

    expect(result.ok).toBe(true);
    expect(repo.updateDefaultWorkerType).toHaveBeenCalledWith(
      'u1',
      'defaultReviewWorkerType',
      'glm'
    );
    expect(repo.clearDefaultWorkerType).not.toHaveBeenCalled();
  });

  it('clears the field when workerType is "auto"', async () => {
    const repo = makeRepo();
    const useCase = createUpdateDefaultWorkerTypeUseCase({ workerSettingsRepo: repo, logger });

    const result = await useCase({
      userId: 'u1',
      field: 'defaultPlanningWorkerType',
      label: 'planning',
      workerType: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(repo.clearDefaultWorkerType).toHaveBeenCalledWith('u1', 'defaultPlanningWorkerType');
    expect(repo.updateDefaultWorkerType).not.toHaveBeenCalled();
  });

  it('returns internal_error when the repo update fails', async () => {
    const repo = makeRepo({
      updateDefaultWorkerType: vi
        .fn()
        .mockResolvedValue(err({ code: 'internal_error' as const, message: 'write failed' })),
    });
    const useCase = createUpdateDefaultWorkerTypeUseCase({ workerSettingsRepo: repo, logger });

    const result = await useCase({
      userId: 'u1',
      field: 'defaultExecutionWorkerType',
      label: 'execution',
      workerType: 'opus',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('write failed');
    }
  });

  it('returns internal_error when clear fails', async () => {
    const repo = makeRepo({
      clearDefaultWorkerType: vi
        .fn()
        .mockResolvedValue(err({ code: 'internal_error' as const, message: 'clear failed' })),
    });
    const useCase = createUpdateDefaultWorkerTypeUseCase({ workerSettingsRepo: repo, logger });

    const result = await useCase({
      userId: 'u1',
      field: 'defaultRemediationWorkerType',
      label: 'remediation',
      workerType: 'auto',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('clear failed');
    }
  });
});
