import type FirebaseFirestore from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import { describe, expect, it, vi } from 'vitest';
import type { CodeTask } from '../../../../domain/models/codeTask.js';
import type {
  CodeTaskRepository,
  CreateTaskInput,
} from '../../../../domain/repositories/codeTaskRepository.js';
import {
  buildGitHubEventTaskId,
  reserveGitHubEventTask,
} from '../../../../domain/services/gitHubDispatch/eventTaskReservation.js';

const transaction = {} as FirebaseFirestore.Transaction;

const taskInput: CreateTaskInput & { id: string } = {
  id: buildGitHubEventTaskId('ci-fix', 'event-123'),
  userId: 'user-1',
  prompt: 'fix CI',
  sanitizedPrompt: 'fix CI',
  systemPromptHash: 'ci-failure-fix',
  workerType: 'codex',
  workerLocation: 'queued',
  repository: 'pbuchman/intexuraos',
  baseBranch: 'development',
  traceId: 'event-123',
};

const storedTask = {
  ...taskInput,
  id: taskInput.id,
  status: 'queued',
} as CodeTask;

function repository(overrides: Partial<CodeTaskRepository> = {}): CodeTaskRepository {
  return {
    findById: vi.fn().mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'missing' }),
    ),
    create: vi.fn().mockResolvedValue(ok(storedTask)),
    ...overrides,
  } as unknown as CodeTaskRepository;
}

describe('buildGitHubEventTaskId', () => {
  it('is stable for the same action and event while separating action namespaces', () => {
    expect(buildGitHubEventTaskId('ci-fix', 'event-123')).toBe(
      buildGitHubEventTaskId('ci-fix', 'event-123'),
    );
    expect(buildGitHubEventTaskId('ci-fix', 'event-123')).not.toBe(
      buildGitHubEventTaskId('pr-dispatch', 'event-123'),
    );
    expect(buildGitHubEventTaskId('ci-fix', 'event-123')).toMatch(/^task_github_[a-f0-9]{40}$/);
  });
});

describe('reserveGitHubEventTask', () => {
  it('creates the deterministic task once inside the caller transaction', async () => {
    const codeTaskRepo = repository();

    const result = await reserveGitHubEventTask({
      codeTaskRepo,
      transaction,
      taskInput,
    });

    expect(result).toEqual(ok({ task: storedTask, created: true }));
    expect(codeTaskRepo.findById).toHaveBeenCalledWith(taskInput.id, { transaction });
    expect(codeTaskRepo.create).toHaveBeenCalledWith(taskInput, { transaction });
  });

  it('returns the existing task for an exact event replay without creating again', async () => {
    const codeTaskRepo = repository({
      findById: vi.fn().mockResolvedValue(ok(storedTask)),
    });

    const result = await reserveGitHubEventTask({
      codeTaskRepo,
      transaction,
      taskInput,
    });

    expect(result).toEqual(ok({ task: storedTask, created: false }));
    expect(codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('fails closed when the deterministic task id belongs to different event data', async () => {
    const codeTaskRepo = repository({
      findById: vi.fn().mockResolvedValue(ok({ ...storedTask, traceId: 'event-other' })),
    });

    const result = await reserveGitHubEventTask({
      codeTaskRepo,
      transaction,
      taskInput,
    });

    expect(result).toEqual(err({
      code: 'FIRESTORE_ERROR',
      message: `Deterministic GitHub event task id collision for ${taskInput.id ?? ''}`,
    }));
    expect(codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('propagates infrastructure lookup failures', async () => {
    const lookupError = { code: 'FIRESTORE_ERROR' as const, message: 'read failed' };
    const codeTaskRepo = repository({
      findById: vi.fn().mockResolvedValue(err(lookupError)),
    });

    const result = await reserveGitHubEventTask({
      codeTaskRepo,
      transaction,
      taskInput,
    });

    expect(result).toEqual(err(lookupError));
    expect(codeTaskRepo.create).not.toHaveBeenCalled();
  });
});
