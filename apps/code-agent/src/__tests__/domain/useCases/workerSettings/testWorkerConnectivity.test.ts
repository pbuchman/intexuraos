/**
 * Unit tests for the testWorkerConnectivity use case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import pino from 'pino';
import type { Logger } from 'pino';
import { createTestWorkerConnectivityUseCase } from '../../../../domain/usecases/workerSettings/testWorkerConnectivity.js';
import type { WorkerSettingsRepository } from '../../../../domain/ports/workerSettingsRepository.js';
import type { WorkerConfig } from '../../../../domain/models/workerSettings.js';

function makeRepo(overrides: Partial<WorkerSettingsRepository> = {}): WorkerSettingsRepository {
  const base: WorkerSettingsRepository = {
    getSettings: vi.fn(),
    getWorkerByName: vi.fn(),
    addWorker: vi.fn(),
    updateWorker: vi.fn(),
    deleteWorker: vi.fn(),
    reorderWorkers: vi.fn(),
    updateTestResult: vi.fn().mockResolvedValue(ok(undefined)),
    getHealthStatuses: vi.fn(),
    updateHealthStatus: vi.fn(),
    updateDefaultReviewWorkerType: vi.fn(),
    updateDefaultWorkerType: vi.fn(),
    clearDefaultWorkerType: vi.fn(),
  };
  return { ...base, ...overrides };
}

const sampleWorker: WorkerConfig = {
  name: 'home-mac',
  url: 'https://mac.example.com',
  cfAccessClientId: 'client-id',
  cfAccessClientSecret: 'client-secret',
  dispatchSigningSecret: 'signing',
  enabled: true,
};

describe('testWorkerConnectivity use case', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = pino({ level: 'silent' }) as unknown as Logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns not_found when the worker does not exist', async () => {
    const repo = makeRepo({
      getWorkerByName: vi.fn().mockResolvedValue(ok(null)),
    });
    const useCase = createTestWorkerConnectivityUseCase({ workerSettingsRepo: repo, logger });

    const result = await useCase({ userId: 'u1', workerName: 'missing' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_found');
      expect(result.error.message).toContain('missing');
    }
  });

  it('returns internal_error when the repo read fails', async () => {
    const repo = makeRepo({
      getWorkerByName: vi
        .fn()
        .mockResolvedValue(err({ code: 'internal_error' as const, message: 'boom' })),
    });
    const useCase = createTestWorkerConnectivityUseCase({ workerSettingsRepo: repo, logger });

    const result = await useCase({ userId: 'u1', workerName: 'home-mac' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('boom');
    }
  });

  it('records success when health endpoint returns dispatch-compatible health', async () => {
    const repo = makeRepo({
      getWorkerByName: vi.fn().mockResolvedValue(ok(sampleWorker)),
    });
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        status: 'ready',
        capacity: 2,
        running: 0,
        available: 2,
        workerAuths: {},
        providerApiKeys: {},
        dockerHealthy: true,
        diskHealthy: true,
      }),
    });
    const useCase = createTestWorkerConnectivityUseCase({
      workerSettingsRepo: repo,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await useCase({ userId: 'u1', workerName: 'home-mac' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.testStatus).toBe('success');
      expect(result.value.testMessage).toBe('Connection successful');
      expect(result.value.lastTestedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    }
    expect(repo.updateTestResult).toHaveBeenCalledWith('u1', 'home-mac', {
      status: 'success',
      message: 'Connection successful',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://mac.example.com/health',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'CF-Access-Client-Id': 'client-id',
          'CF-Access-Client-Secret': 'client-secret',
        },
      })
    );
  });

  it('records failure when HTTP 200 health lacks dispatch capability fields', async () => {
    const repo = makeRepo({
      getWorkerByName: vi.fn().mockResolvedValue(ok(sampleWorker)),
    });
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        status: 'ready',
        capacity: 2,
        running: 0,
        available: 2,
      }),
    });
    const useCase = createTestWorkerConnectivityUseCase({
      workerSettingsRepo: repo,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await useCase({ userId: 'u1', workerName: 'home-mac' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.testStatus).toBe('failure');
      expect(result.value.testMessage).toBe(
        'Health response missing worker capability details: workerAuths, providerApiKeys, dockerHealthy, diskHealthy'
      );
    }
    expect(repo.updateTestResult).toHaveBeenCalledWith('u1', 'home-mac', {
      status: 'failure',
      message: 'Health response missing worker capability details: workerAuths, providerApiKeys, dockerHealthy, diskHealthy',
    });
  });

  it('records invalid health response when HTTP 200 body is not an object', async () => {
    const repo = makeRepo({
      getWorkerByName: vi.fn().mockResolvedValue(ok(sampleWorker)),
    });
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => 'ready',
    });
    const useCase = createTestWorkerConnectivityUseCase({
      workerSettingsRepo: repo,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await useCase({ userId: 'u1', workerName: 'home-mac' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.testStatus).toBe('failure');
      expect(result.value.testMessage).toBe('Invalid health response format');
    }
  });

  it('records failure for non-2xx responses with status message', async () => {
    const repo = makeRepo({
      getWorkerByName: vi.fn().mockResolvedValue(ok(sampleWorker)),
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const useCase = createTestWorkerConnectivityUseCase({
      workerSettingsRepo: repo,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await useCase({ userId: 'u1', workerName: 'home-mac' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.testStatus).toBe('failure');
      expect(result.value.testMessage).toContain('503');
      expect(result.value.testMessage).toContain('Service Unavailable');
    }
  });

  it('records failure when the fetch throws', async () => {
    const repo = makeRepo({
      getWorkerByName: vi.fn().mockResolvedValue(ok(sampleWorker)),
    });
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const useCase = createTestWorkerConnectivityUseCase({
      workerSettingsRepo: repo,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await useCase({ userId: 'u1', workerName: 'home-mac' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.testStatus).toBe('failure');
      expect(result.value.testMessage).toContain('Connection failed');
      expect(result.value.testMessage).toContain('ECONNREFUSED');
    }
  });

  it('uses the global fetch when no fetchFn is injected', async () => {
    const repo = makeRepo({
      getWorkerByName: vi.fn().mockResolvedValue(ok(sampleWorker)),
    });
    const globalFetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          status: 'ready',
          capacity: 2,
          running: 0,
          available: 2,
          workerAuths: {},
          providerApiKeys: {},
          dockerHealthy: true,
          diskHealthy: true,
        }),
      } as Response);
    const useCase = createTestWorkerConnectivityUseCase({ workerSettingsRepo: repo, logger });

    const result = await useCase({ userId: 'u1', workerName: 'home-mac' });

    expect(result.ok).toBe(true);
    expect(globalFetchSpy).toHaveBeenCalled();
  });
});
