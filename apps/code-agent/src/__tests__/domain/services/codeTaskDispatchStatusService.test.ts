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
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';

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
  let markNotifiedCalls: { id: string; notifiedAt: Date }[];
  let resolveCalls: ResolveCodeTaskSystemStatusesInput[];
  let notifier: WhatsAppNotifier;
  let logger: Logger;
  let statusRepo: CodeTaskSystemStatusRepository;

  beforeEach(() => {
    upsertedStatus = makeStatus();
    markNotifiedCalls = [];
    resolveCalls = [];
    notifier = {
      notifyTaskDispatchBlocked: vi.fn(async () => ok(undefined)),
    } as unknown as WhatsAppNotifier;
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
      markNotified: vi.fn(async (id: string, notifiedAt: Date): Promise<Result<void, CodeTaskSystemStatusRepositoryError>> => {
        markNotifiedCalls.push({ id, notifiedAt });
        return ok(undefined);
      }),
    };
  });

  it('upserts an active status and sends the first WhatsApp notification', async () => {
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      whatsappNotifier: notifier,
      logger,
      now: () => new Date('2026-06-05T12:00:00.000Z'),
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
    expect(notifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-1', {
      workerType: 'codex-xhigh',
      reason: 'codex_auth_unavailable',
      affectedTaskCount: 2,
      exampleTaskId: 'task-1',
      message: BLOCKER.message,
      remediation: BLOCKER.remediation,
      workerNames: ['home-dev'],
    });
    expect(markNotifiedCalls).toEqual([
      { id: 'status-1', notifiedAt: new Date('2026-06-05T12:00:00.000Z') },
    ]);
  });

  it('uses the default clock when no now override is provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T13:00:00.000Z'));
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      whatsappNotifier: notifier,
      logger,
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 2,
      exampleTaskIds: [],
    });

    expect(notifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-1', expect.objectContaining({
      workerType: 'codex-xhigh',
    }));
    expect(markNotifiedCalls).toEqual([
      { id: 'status-1', notifiedAt: new Date('2026-06-05T13:00:00.000Z') },
    ]);

    vi.useRealTimers();
  });

  it('logs and exits when status persistence fails', async () => {
    statusRepo.upsertActive = vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'unavailable' }));
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      whatsappNotifier: notifier,
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
    expect(notifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('suppresses repeated notifications inside the resend interval', async () => {
    upsertedStatus = makeStatus({
      lastNotifiedAt: new Date('2026-06-05T09:00:00.000Z'),
    });
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      whatsappNotifier: notifier,
      logger,
      now: () => new Date('2026-06-05T12:00:00.000Z'),
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1'],
    });

    expect(notifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    expect(markNotifiedCalls).toEqual([]);
  });

  it('resends notification after the resend interval elapses', async () => {
    upsertedStatus = makeStatus({
      lastNotifiedAt: new Date('2026-06-05T05:59:59.000Z'),
    });
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      whatsappNotifier: notifier,
      logger,
      now: () => new Date('2026-06-05T12:00:00.000Z'),
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1'],
    });

    expect(notifier.notifyTaskDispatchBlocked).toHaveBeenCalledTimes(1);
    expect(markNotifiedCalls).toHaveLength(1);
  });

  it('logs and exits when WhatsApp notification fails', async () => {
    notifier.notifyTaskDispatchBlocked = vi.fn(async () => err({ code: 'notification_failed' as const, message: 'publish failed' }));
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      whatsappNotifier: notifier,
      logger,
      now: () => new Date('2026-06-05T12:00:00.000Z'),
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1'],
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: 'publish failed' }) }),
      'Failed to notify user about code task dispatch blocker'
    );
    expect(markNotifiedCalls).toEqual([]);
  });

  it('logs when marking the status as notified fails', async () => {
    statusRepo.markNotified = vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'write failed' }));
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      whatsappNotifier: notifier,
      logger,
      now: () => new Date('2026-06-05T12:00:00.000Z'),
    });

    await service.recordDispatchBlocked({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      blocker: BLOCKER,
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1'],
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: 'write failed' }) }),
      'Failed to mark code task dispatch blocker as notified'
    );
  });

  it('resolves active statuses for the user and worker type', async () => {
    const service = createCodeTaskDispatchStatusService({
      statusRepo,
      whatsappNotifier: notifier,
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
      whatsappNotifier: notifier,
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
