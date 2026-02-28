import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { ActionStep } from '../../../domain/githubWebhookAgent/models.js';
import {
  createSendTaskMessageTool,
  createDispatchTaskTool,
  createChatNotifyTool,
  type ToolDeps,
} from '../../../domain/githubWebhookAgent/tools.js';

function makeStep(type: ActionStep['type'], params: Record<string, unknown>): ActionStep {
  return { actionId: `test-action-${type}`, type, params };
}

function makeToolDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    sendTaskMessage: vi.fn().mockResolvedValue(ok({ action: 'queued' as const })),
    createTaskForPR: vi.fn().mockResolvedValue(ok({ taskId: 'task_abc' })),
    chatAgentClient: {
      emitSystemEvent: vi.fn().mockResolvedValue(ok({ delivered: true, duplicate: false })),
    },
    ...overrides,
  };
}

describe('sendTaskMessageTool', () => {
  it('calls sendTaskMessage and returns success with action result', async () => {
    const deps = makeToolDeps();
    const tool = createSendTaskMessageTool(deps);

    const step = makeStep('send_task_message', {
      taskId: 'task_123',
      userId: 'user_456',
      message: 'Please review the latest changes',
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(true);
    expect(deps.sendTaskMessage).toHaveBeenCalledWith({
      taskId: 'task_123',
      userId: 'user_456',
      message: 'Please review the latest changes',
    });
  });

  it('returns error when sendTaskMessage fails', async () => {
    const deps = makeToolDeps({
      sendTaskMessage: vi.fn().mockResolvedValue(
        err({ code: 'task_not_found', message: 'Task not found' })
      ),
    });
    const tool = createSendTaskMessageTool(deps);

    const step = makeStep('send_task_message', {
      taskId: 'task_missing',
      userId: 'user_456',
      message: 'Hello',
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('task_not_found');
  });

  it('returns error when required params are missing', async () => {
    const deps = makeToolDeps();
    const tool = createSendTaskMessageTool(deps);

    const step = makeStep('send_task_message', { taskId: 'task_123' });

    const result = await tool.execute(step);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('userId');
  });

  it('uses actionId as idempotency key', () => {
    const tool = createSendTaskMessageTool(makeToolDeps());
    const step = makeStep('send_task_message', {});

    expect(tool.idempotencyKey(step)).toBe('test-action-send_task_message');
  });
});

describe('createDispatchTaskTool', () => {
  it('calls createTaskForPR with workerType and returns taskId', async () => {
    const deps = makeToolDeps();
    const tool = createDispatchTaskTool(deps);

    const step = makeStep('dispatch_task', {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      prTitle: '[INT-100] Fix auth',
      senderLogin: 'testuser',
      comment: 'Please fix this',
      eventId: 'evt-789',
      workerType: 'glm',
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(true);
    expect(deps.createTaskForPR).toHaveBeenCalledWith(
      expect.objectContaining({
        workerType: 'glm',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
      })
    );
  });

  it('returns error when createTaskForPR fails', async () => {
    const deps = makeToolDeps({
      createTaskForPR: vi.fn().mockResolvedValue(
        err({ code: 'user_not_found', message: 'No user' })
      ),
    });
    const tool = createDispatchTaskTool(deps);

    const step = makeStep('dispatch_task', {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      senderLogin: 'unknown',
      comment: 'Fix it',
      eventId: 'evt-1',
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('user_not_found');
  });

  it('ignores invalid workerType silently', async () => {
    const deps = makeToolDeps();
    const tool = createDispatchTaskTool(deps);

    const step = makeStep('dispatch_task', {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      senderLogin: 'testuser',
      comment: 'Fix it',
      eventId: 'evt-1',
      workerType: 'invalid-type',
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(true);
    expect(deps.createTaskForPR).toHaveBeenCalledWith(
      expect.not.objectContaining({ workerType: 'invalid-type' })
    );
  });

  it('returns error when required params are missing', async () => {
    const deps = makeToolDeps();
    const tool = createDispatchTaskTool(deps);

    const step = makeStep('dispatch_task', { repository: 'test/repo' });

    const result = await tool.execute(step);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('prNumber');
  });
});

describe('createChatNotifyTool', () => {
  it('calls chatAgentClient and returns delivered result', async () => {
    const deps = makeToolDeps();
    const tool = createChatNotifyTool(deps);

    const step = makeStep('notify_chat', {
      userId: 'user_456',
      eventId: 'evt-notify-1',
      threadKey: 'pr-42',
      kind: 'webhook_action',
      message: 'Task dispatched for PR #42',
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(true);
    expect(deps.chatAgentClient.emitSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_456',
        eventId: 'evt-notify-1',
        kind: 'webhook_action',
      })
    );
  });

  it('returns success for duplicate event', async () => {
    const deps = makeToolDeps({
      chatAgentClient: {
        emitSystemEvent: vi.fn().mockResolvedValue(ok({ delivered: false, duplicate: true })),
      },
    });
    const tool = createChatNotifyTool(deps);

    const step = makeStep('notify_chat', {
      userId: 'user_456',
      eventId: 'evt-dup',
      threadKey: 'pr-42',
      kind: 'webhook_action',
      message: 'Duplicate event',
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(true);
  });

  it('returns error on client failure', async () => {
    const deps = makeToolDeps({
      chatAgentClient: {
        emitSystemEvent: vi.fn().mockResolvedValue(
          err({ code: 'API_ERROR' as const, message: 'HTTP 503' })
        ),
      },
    });
    const tool = createChatNotifyTool(deps);

    const step = makeStep('notify_chat', {
      userId: 'user_456',
      eventId: 'evt-fail',
      threadKey: 'pr-42',
      kind: 'webhook_action',
      message: 'Should fail',
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('API_ERROR');
  });

  it('passes metadata when provided', async () => {
    const deps = makeToolDeps();
    const tool = createChatNotifyTool(deps);

    const step = makeStep('notify_chat', {
      userId: 'user_456',
      eventId: 'evt-meta-1',
      threadKey: 'pr-42',
      kind: 'webhook_action',
      message: 'With metadata',
      metadata: { prNumber: 42, repository: 'test/repo' },
    });

    const result = await tool.execute(step);

    expect(result.ok).toBe(true);
    expect(deps.chatAgentClient.emitSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { prNumber: 42, repository: 'test/repo' },
      })
    );
  });

  it('returns error when required params are missing', async () => {
    const deps = makeToolDeps();
    const tool = createChatNotifyTool(deps);

    const step = makeStep('notify_chat', { userId: 'user_456' });

    const result = await tool.execute(step);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('eventId');
  });
});
