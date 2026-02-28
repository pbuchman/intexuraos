import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  loadWebhookEventContext,
  type ContextLoaderDeps,
  type WebhookEventInput,
} from '../../../domain/githubWebhookAgent/contextLoader.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';

function fakeTask(overrides?: Partial<CodeTask>): CodeTask {
  return {
    id: 'task-001',
    userId: 'user-123',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'abc123',
    workerType: 'auto',
    workerLocation: 'cloud',
    repository: 'owner/repo',
    baseBranch: 'main',
    traceId: 'trace-001',
    status: 'running',
    createdAt: new Date('2026-02-27T10:00:00Z'),
    updatedAt: new Date('2026-02-27T10:00:05Z'),
    callbackReceived: false,
    ...overrides,
  } as CodeTask;
}

function commentInput(overrides?: Partial<WebhookEventInput>): WebhookEventInput {
  return {
    eventType: 'issue_comment',
    action: 'created',
    senderLogin: 'pbuchman',
    repository: 'owner/repo',
    pullRequestNumber: 42,
    body: 'Please fix this',
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<ContextLoaderDeps>): ContextLoaderDeps {
  return {
    findTaskByPR: vi.fn().mockResolvedValue(ok(null)),
    resolveUser: vi.fn().mockResolvedValue(null),
    isSenderAllowed: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe('loadWebhookEventContext', () => {
  it('groups comment event and returns context', async () => {
    const deps = makeDeps();
    const result = await loadWebhookEventContext(deps, commentInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventGroup).toBe('comment');
      expect(result.value.senderAllowed).toBe(true);
    }
  });

  it('groups unsupported event as other', async () => {
    const deps = makeDeps();
    const input = commentInput({ eventType: 'push', action: null, pullRequestNumber: null });
    const result = await loadWebhookEventContext(deps, input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventGroup).toBe('other');
    }
  });

  it('populates existingTask when PR has existing task', async () => {
    const task = fakeTask({ id: 'task-existing' });
    const deps = makeDeps({
      findTaskByPR: vi.fn().mockResolvedValue(ok(task)),
    });
    const result = await loadWebhookEventContext(deps, commentInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.existingTask).not.toBeNull();
      expect(result.value.existingTask?.id).toBe('task-existing');
    }
  });

  it('returns null existingTask when no task found', async () => {
    const deps = makeDeps();
    const result = await loadWebhookEventContext(deps, commentInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.existingTask).toBeNull();
    }
  });

  it('skips task lookup when pullRequestNumber is null', async () => {
    const findTaskByPR = vi.fn().mockResolvedValue(ok(null));
    const deps = makeDeps({ findTaskByPR });
    const input = commentInput({ pullRequestNumber: null });

    const result = await loadWebhookEventContext(deps, input);

    expect(result.ok).toBe(true);
    expect(findTaskByPR).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.existingTask).toBeNull();
    }
  });

  it('returns error when task lookup fails', async () => {
    const deps = makeDeps({
      findTaskByPR: vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Firestore unavailable' })
      ),
    });
    const result = await loadWebhookEventContext(deps, commentInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_LOOKUP_FAILED');
    }
  });

  it('marks sender as disallowed', async () => {
    const deps = makeDeps({
      isSenderAllowed: vi.fn().mockReturnValue(false),
    });
    const result = await loadWebhookEventContext(deps, commentInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.senderAllowed).toBe(false);
    }
  });

  it('resolves user mapping when sender is allowed', async () => {
    const deps = makeDeps({
      resolveUser: vi.fn().mockResolvedValue({
        userId: 'user-123',
        senderLogin: 'pbuchman',
      }),
    });
    const result = await loadWebhookEventContext(deps, commentInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userMapping).not.toBeNull();
      expect(result.value.userMapping?.userId).toBe('user-123');
    }
  });

  it('skips user resolution when sender is disallowed', async () => {
    const resolveUser = vi.fn().mockResolvedValue(null);
    const deps = makeDeps({
      isSenderAllowed: vi.fn().mockReturnValue(false),
      resolveUser,
    });
    const result = await loadWebhookEventContext(deps, commentInput());

    expect(result.ok).toBe(true);
    expect(resolveUser).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.userMapping).toBeNull();
    }
  });

  it('returns null userMapping when user not found', async () => {
    const deps = makeDeps({
      resolveUser: vi.fn().mockResolvedValue(null),
    });
    const result = await loadWebhookEventContext(deps, commentInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userMapping).toBeNull();
    }
  });

  it('handles pull_request_review event as comment group', async () => {
    const deps = makeDeps();
    const input = commentInput({ eventType: 'pull_request_review', action: 'submitted' });
    const result = await loadWebhookEventContext(deps, input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventGroup).toBe('comment');
    }
  });
});
