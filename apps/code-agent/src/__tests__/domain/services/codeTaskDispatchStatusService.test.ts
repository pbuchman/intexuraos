import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { createCodeTaskDispatchStatusService } from '../../../domain/services/codeTaskDispatchStatusService.js';
import type { CodeTaskSystemStatus } from '../../../domain/models/codeTaskSystemStatus.js';
import type {
  CodeTaskSystemStatusRepository,
  CodeTaskSystemStatusRepositoryError,
  ResolveCodeTaskSystemStatusesInput,
} from '../../../domain/repositories/codeTaskSystemStatusRepository.js';

const BLOCKER = {
  dispatchable: false as const,
  reason: 'codex_auth_unavailable' as const,
  severity: 'critical' as const,
  message: 'No reachable worker has active Codex auth for codex-xhigh.',
  remediation: 'Refresh Codex/ChatGPT authentication on a worker that can run this task.',
  workerNames: ['home-dev'],
};

function makeStatus(overrides: Partial<CodeTaskSystemStatus> = {}): CodeTaskSystemStatus {
  return {
    id: 'status-1',
    userId: 'user-1',
    component: 'code-task-dispatch',
    status: 'active',
    severity: 'critical',
    workerType: 'codex-xhigh',
    reason: 'codex_auth_unavailable',
    message: BLOCKER.message,
    remediation: BLOCKER.remediation,
    affectedTaskCount: 2,
    exampleTaskIds: ['task-1', 'task-2'],
    workerNames: ['home-dev'],
    firstSeenAt: new Date('2026-06-05T10:00:00.000Z'),
    lastSeenAt: new Date('2026-06-05T10:00:00.000Z'),
    ...overrides,
  };
}

describe('CodeTaskDispatchStatusService', () => {
  let upsertedStatus: CodeTaskSystemStatus;
  let resolveCalls: ResolveCodeTaskSystemStatusesInput[];
  let logger: Logger;
  let statusRepo: CodeTaskSystemStatusRepository;

  beforeEach(() => {
    upsertedStatus = makeStatus();
    resolveCalls = [];
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    statusRepo = {
      upsertActive: vi.fn(async () => ok(upsertedStatus)),
      listActiveForUser: vi.fn(async () => ok([])),
      resolveActive: vi.fn(async (input: ResolveCodeTaskSystemStatusesInput) => {
        resolveCalls.push(input);
        return ok(1);
      }),
      markNotified: vi.fn(async (): Promise<Result<void, CodeTaskSystemStatusRepositoryError>> => {
        return ok(undefined);
      }),
    };
  });

  it('upserts an active status without marking aggregate notifications', async () => {
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      logger,
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1', 'task-2'],
    });

    expect(statusRepo.upsertActive).toHaveBeenCalledWith({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      reason: 'codex_auth_unavailable',
      severity: 'critical',
      message: BLOCKER.message,
      remediation: BLOCKER.remediation,
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1', 'task-2'],
      workerNames: ['home-dev'],
    });
    expect(statusRepo.markNotified).not.toHaveBeenCalled();
  });

  it('logs and exits when status persistence fails', async () => {
    statusRepo.upsertActive = vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'unavailable' }));
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      logger,
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 1,
      exampleTaskIds: ['task-1'],
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: 'unavailable' }) }),
      'Failed to persist code task dispatch system status'
    );
  });

  it('ignores aggregate lastNotifiedAt when recording status because task-level state owns notification dedupe', async () => {
    upsertedStatus = makeStatus({
      lastNotifiedAt: new Date('2026-06-05T09:00:00.000Z'),
    });
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      logger,
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1'],
    });

    expect(statusRepo.markNotified).not.toHaveBeenCalled();
  });

  it('does not mark aggregate status as notified', async () => {
    statusRepo.markNotified = vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'write failed' }));
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      logger,
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1'],
    });

    expect(statusRepo.markNotified).not.toHaveBeenCalled();
  });

  it('resolves active statuses for the user and worker type', async () => {
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      logger,
    });

    await service.resolveDispatchBlockers({
      userId: 'user-1',
      workerType: 'sonnet',
    });

    expect(resolveCalls).toEqual([{ userId: 'user-1', workerType: 'sonnet' }]);
  });

  it('logs when resolving active statuses fails', async () => {
    statusRepo.resolveActive = vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'resolve failed' }));
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      logger,
    });

    await service.resolveDispatchBlockers({
      userId: 'user-1',
      workerType: 'sonnet',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: 'resolve failed' }) }),
      'Failed to resolve code task dispatch system statuses'
    );
  });
});
