import { describe, it, expect, vi } from 'vitest';
import {
  processGitHubWebhookEvent,
  type ProcessEventDeps,
} from '../../../domain/githubWebhookAgent/processEvent.js';
import type { GitHubWebhookAgentConfig } from '../../../config/githubWebhookAgentConfig.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import type { Logger } from '@intexuraos/common-core';

function makeConfig(overrides: Partial<GitHubWebhookAgentConfig> = {}): GitHubWebhookAgentConfig {
  return {
    enabled: true,
    observeOnly: true,
    notifyOnly: false,
    executeComments: false,
    ownsProcessingMarker: false,
    ownsFinalReply: false,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    id: 'event-001',
    githubEventId: 123,
    repository: 'pbuchman/intexuraos',
    repositoryId: 456,
    pullRequestNumber: 42,
    pullRequestId: 100,
    eventType: 'issue_comment',
    action: 'created',
    senderLogin: 'testuser',
    senderId: 789,
    senderType: 'User',
    title: 'Fix auth',
    body: 'Please fix this bug',
    state: 'open',
    mergedAt: null,
    createdAt: new Date(),
    processedAt: new Date(),
    payload: {},
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ProcessEventDeps> = {}): ProcessEventDeps {
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  return {
    logger: mockLogger,
    config: makeConfig(),
    executorDeps: {
      getToolForAction: () => ({
        execute: (): Promise<{ ok: true }> => Promise.resolve({ ok: true }),
        idempotencyKey: (step: { actionId: string }): string => step.actionId,
      }),
      isActionCompleted: (): Promise<boolean> => Promise.resolve(false),
      markActionCompleted: (): Promise<void> => Promise.resolve(),
    },
    classifyEventGroup: (): 'comment' => 'comment',
    isSenderAllowed: (): boolean => true,
    isUserMapped: (): boolean => true,
    hasExistingTask: (): Promise<boolean> => Promise.resolve(false),
    saveRunRecord: vi.fn().mockResolvedValue(undefined),
    repairDeps: {
      isRepairDuplicate: (): boolean => false,
      isProtectedBranch: (): boolean => false,
    },
    ...overrides,
  };
}

describe('processGitHubWebhookEvent', () => {
  describe('observe mode - no side effects', () => {
    it('creates run record without executing tools in observe mode', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);
      const executeTool = vi.fn();

      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: true }),
        executorDeps: {
          getToolForAction: () => ({
            execute: executeTool,
            idempotencyKey: (step: { actionId: string }): string => step.actionId,
          }),
          isActionCompleted: (): Promise<boolean> => Promise.resolve(false),
          markActionCompleted: (): Promise<void> => Promise.resolve(),
        },
        saveRunRecord,
      });

      const result = await processGitHubWebhookEvent(deps, makeEvent());

      expect(result.handled).toBe(true);
      expect(result.mode).toBe('observe');
      expect(result.outcome).toBe('noop');
      expect(result.runId).toBeDefined();

      expect(saveRunRecord).toHaveBeenCalledTimes(1);
      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as { stepResults: unknown[] } | undefined;
      expect(savedRecord?.stepResults).toHaveLength(0);

      expect(executeTool).not.toHaveBeenCalled();
    });

    it('records decision and action plan in observe mode', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: true }),
        saveRunRecord,
      });

      await processGitHubWebhookEvent(deps, makeEvent());

      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as {
        decision: { actionability: string };
        actionPlan: { actions: unknown[] };
      } | undefined;
      expect(savedRecord?.decision).toBeDefined();
      expect(savedRecord?.actionPlan).toBeDefined();
    });
  });

  describe('execute mode - creates task', () => {
    it('executes action plan tools when in execute mode', async () => {
      const executedSteps: string[] = [];
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);

      const deps = makeDeps({
        config: makeConfig({
          enabled: true,
          observeOnly: false,
          notifyOnly: false,
        }),
        executorDeps: {
          getToolForAction: () => ({
            execute: (step: { actionId: string }): Promise<{ ok: true }> => {
              executedSteps.push(step.actionId);
              return Promise.resolve({ ok: true });
            },
            idempotencyKey: (step: { actionId: string }): string => step.actionId,
          }),
          isActionCompleted: (): Promise<boolean> => Promise.resolve(false),
          markActionCompleted: (): Promise<void> => Promise.resolve(),
        },
        saveRunRecord,
      });

      const result = await processGitHubWebhookEvent(deps, makeEvent());

      expect(result.handled).toBe(true);
      expect(result.mode).toBe('execute');
      expect(result.outcome).toBe('completed');
      expect(executedSteps.length).toBeGreaterThan(0);

      expect(saveRunRecord).toHaveBeenCalledTimes(1);
      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as { stepResults: unknown[]; outcome: string } | undefined;
      expect(savedRecord?.outcome).toBe('completed');
      expect(savedRecord?.stepResults.length).toBeGreaterThan(0);
    });

    it('records failed outcome when tool execution fails', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);

      const deps = makeDeps({
        config: makeConfig({
          enabled: true,
          observeOnly: false,
          notifyOnly: false,
        }),
        executorDeps: {
          getToolForAction: () => ({
            execute: (): Promise<{ ok: false; error: string }> => Promise.resolve({ ok: false, error: 'Tool failed' }),
            idempotencyKey: (step: { actionId: string }): string => step.actionId,
          }),
          isActionCompleted: (): Promise<boolean> => Promise.resolve(false),
          markActionCompleted: (): Promise<void> => Promise.resolve(),
        },
        saveRunRecord,
      });

      const result = await processGitHubWebhookEvent(deps, makeEvent());

      expect(result.outcome).toBe('failed');
      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as { outcome: string; error: string } | undefined;
      expect(savedRecord?.outcome).toBe('failed');
      expect(savedRecord?.error).toContain('Tool failed');
    });
  });

  describe('legacy rollback path', () => {
    it('returns unhandled when agent is disabled', async () => {
      const saveRunRecord = vi.fn();
      const executeTool = vi.fn();

      const deps = makeDeps({
        config: makeConfig({ enabled: false }),
        executorDeps: {
          getToolForAction: () => ({
            execute: executeTool,
            idempotencyKey: (step: { actionId: string }): string => step.actionId,
          }),
          isActionCompleted: (): Promise<boolean> => Promise.resolve(false),
          markActionCompleted: (): Promise<void> => Promise.resolve(),
        },
        saveRunRecord,
      });

      const result = await processGitHubWebhookEvent(deps, makeEvent());

      expect(result.handled).toBe(false);
      expect(result.mode).toBe('disabled');

      expect(saveRunRecord).not.toHaveBeenCalled();
      expect(executeTool).not.toHaveBeenCalled();
    });
  });

  describe('send_task_message mode', () => {
    it('produces send_task_message plan when existing task exists', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);

      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: true }),
        hasExistingTask: (): Promise<boolean> => Promise.resolve(true),
        saveRunRecord,
      });

      const result = await processGitHubWebhookEvent(deps, makeEvent());

      expect(result.handled).toBe(true);
      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as {
        decision: { decision: { kind: string } };
      } | undefined;
      expect(savedRecord?.decision.decision.kind).toBe('send_task_message');
    });
  });

  describe('notify mode', () => {
    it('records run without executing tools in notify mode', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);
      const executeTool = vi.fn();

      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: false, notifyOnly: true }),
        executorDeps: {
          getToolForAction: () => ({
            execute: executeTool,
            idempotencyKey: (step: { actionId: string }): string => step.actionId,
          }),
          isActionCompleted: (): Promise<boolean> => Promise.resolve(false),
          markActionCompleted: (): Promise<void> => Promise.resolve(),
        },
        saveRunRecord,
      });

      const result = await processGitHubWebhookEvent(deps, makeEvent());

      expect(result.handled).toBe(true);
      expect(result.mode).toBe('notify');
      expect(executeTool).not.toHaveBeenCalled();
      expect(saveRunRecord).toHaveBeenCalledTimes(1);
    });

    it('records failed outcome when validation fails in notify mode', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);

      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: false, notifyOnly: true }),
        isUserMapped: (): boolean => false,
        saveRunRecord,
      });

      const result = await processGitHubWebhookEvent(deps, makeEvent());

      expect(result.handled).toBe(true);
      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as { outcome: string; error?: string } | undefined;
      expect(savedRecord?.outcome).toBe('failed');
      expect(savedRecord?.error).toBeDefined();
    });
  });

  describe('validation warnings', () => {
    it('logs warning when action plan fails validation in execute mode', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as unknown as Logger;

      const deps = makeDeps({
        logger: mockLogger,
        config: makeConfig({ enabled: true, observeOnly: false, notifyOnly: false }),
        isUserMapped: (): boolean => false,
        saveRunRecord,
      });

      await processGitHubWebhookEvent(deps, makeEvent());

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ errors: expect.any(Array) }),
        expect.stringContaining('validation')
      );
    });
  });

  describe('github_action_result repair routing', () => {
    it('routes eligible workflow failure to create_code_action', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);

      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: true }),
        classifyEventGroup: (): 'github_action_result' => 'github_action_result',
        saveRunRecord,
      });

      const event = makeEvent({
        eventType: 'workflow_run',
        action: 'completed',
        state: 'completed/failure',
        pullRequestNumber: 42,
      });

      await processGitHubWebhookEvent(deps, event);

      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as {
        decision: { decision: { kind: string }; actionability: string };
      } | undefined;
      expect(savedRecord?.decision.decision.kind).toBe('create_code_action');
      expect(savedRecord?.decision.actionability).toBe('actionable');
    });

    it('routes ineligible workflow to noop', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);

      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: true }),
        classifyEventGroup: (): 'github_action_result' => 'github_action_result',
        saveRunRecord,
      });

      const event = makeEvent({
        eventType: 'workflow_run',
        action: 'completed',
        state: 'completed/success',
        pullRequestNumber: 42,
      });

      await processGitHubWebhookEvent(deps, event);

      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as {
        decision: { decision: { kind: string }; actionability: string };
      } | undefined;
      expect(savedRecord?.decision.decision.kind).toBe('noop');
      expect(savedRecord?.decision.actionability).toBe('non_actionable');
    });

    it('blocks repair on protected branch', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);

      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: true }),
        classifyEventGroup: (): 'github_action_result' => 'github_action_result',
        repairDeps: {
          isRepairDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => true,
        },
        saveRunRecord,
      });

      const event = makeEvent({
        eventType: 'workflow_run',
        action: 'completed',
        state: 'completed/failure',
        pullRequestNumber: 42,
      });

      await processGitHubWebhookEvent(deps, event);

      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as {
        decision: { decision: { kind: string } };
      } | undefined;
      expect(savedRecord?.decision.decision.kind).toBe('noop');
    });
  });

  describe('non-actionable events', () => {
    it('produces noop plan for non-actionable events', async () => {
      const saveRunRecord = vi.fn().mockResolvedValue(undefined);

      const deps = makeDeps({
        config: makeConfig({ enabled: true, observeOnly: false, notifyOnly: false }),
        isSenderAllowed: (): boolean => false,
        saveRunRecord,
      });

      const result = await processGitHubWebhookEvent(deps, makeEvent());

      expect(result.handled).toBe(true);
      const savedRecord = saveRunRecord.mock.calls[0]?.[0] as { actionPlan: { actions: unknown[] } } | undefined;
      expect(savedRecord?.actionPlan.actions).toHaveLength(0);
    });
  });
});
