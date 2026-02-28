import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { ActionStep } from '../../../domain/githubWebhookAgent/models.js';
import {
  buildWebhookDelegationBrief,
  type DelegationBriefInput,
} from '../../../domain/githubWebhookAgent/delegationBrief.js';
import {
  compileWebhookActionPlan,
  type ActionCompilerInput,
} from '../../../domain/githubWebhookAgent/actionCompiler.js';
import {
  createMarkProcessingTool,
  type MarkProcessingToolDeps,
} from '../../../domain/githubWebhookAgent/tools.js';
import type { WebhookAgentDecision } from '../../../domain/githubWebhookAgent/models.js';

function makeDecision(kind: WebhookAgentDecision['decision']['kind']): WebhookAgentDecision {
  return {
    version: '1.0',
    eventGroup: 'comment',
    actionability: 'actionable',
    confidence: 0.9,
    reasoning: 'Test decision',
    requestedWorkerType: null,
    decision: { kind },
  };
}

describe('marker tool precedes dispatch', () => {
  it('places mark_processing before dispatch_task in actionable plans', () => {
    const input: ActionCompilerInput = {
      runId: 'run-1',
      decision: makeDecision('create_pr_comment_task'),
      hasExistingTask: false,
      userMapped: true,
      ownsProcessingMarker: true,
    };

    const plan = compileWebhookActionPlan(input);

    const types = plan.actions.map((a) => a.type);
    const markerIndex = types.indexOf('mark_processing');
    const dispatchIndex = types.indexOf('dispatch_task');

    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(dispatchIndex).toBeGreaterThanOrEqual(0);
    expect(markerIndex).toBeLessThan(dispatchIndex);
  });

  it('places mark_processing before dispatch_task in create_code_action plans', () => {
    const input: ActionCompilerInput = {
      runId: 'run-2',
      decision: makeDecision('create_code_action'),
      hasExistingTask: false,
      userMapped: true,
      ownsProcessingMarker: true,
    };

    const plan = compileWebhookActionPlan(input);

    const types = plan.actions.map((a) => a.type);
    const markerIndex = types.indexOf('mark_processing');
    const dispatchIndex = types.indexOf('dispatch_task');

    expect(markerIndex).toBeLessThan(dispatchIndex);
  });
});

describe('ownership flag disables marker tool', () => {
  it('omits mark_processing when ownsProcessingMarker is false', () => {
    const input: ActionCompilerInput = {
      runId: 'run-3',
      decision: makeDecision('create_pr_comment_task'),
      hasExistingTask: false,
      userMapped: true,
      ownsProcessingMarker: false,
    };

    const plan = compileWebhookActionPlan(input);

    const types = plan.actions.map((a) => a.type);
    expect(types).not.toContain('mark_processing');
    expect(types).toContain('dispatch_task');
  });

  it('omits mark_processing from create_code_action when flag is false', () => {
    const input: ActionCompilerInput = {
      runId: 'run-4',
      decision: makeDecision('create_code_action'),
      hasExistingTask: false,
      userMapped: true,
      ownsProcessingMarker: false,
    };

    const plan = compileWebhookActionPlan(input);

    const types = plan.actions.map((a) => a.type);
    expect(types).not.toContain('mark_processing');
  });
});

describe('delegation brief', () => {
  it('omits GitHub control instructions from delegation brief', () => {
    const input: DelegationBriefInput = {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      senderLogin: 'testuser',
      comment: 'Please fix this bug',
      eventType: 'issue_comment',
      action: 'created',
    };

    const brief = buildWebhookDelegationBrief(input);

    expect(brief).not.toContain('React with rocket');
    expect(brief).not.toContain('gh api');
    expect(brief).not.toContain('reactions');
    expect(brief).toContain('PR #42');
    expect(brief).toContain('Please fix this bug');
  });

  it('includes execution-only instructions without actionability detection', () => {
    const input: DelegationBriefInput = {
      repository: 'pbuchman/intexuraos',
      prNumber: 10,
      senderLogin: 'owner',
      comment: 'Update the tests',
      eventType: 'issue_comment',
      action: 'created',
    };

    const brief = buildWebhookDelegationBrief(input);

    expect(brief).not.toContain('decide if');
    expect(brief).not.toContain('If not actionable');
    expect(brief).toContain('Update the tests');
  });

  it('includes PR review context for review events', () => {
    const input: DelegationBriefInput = {
      repository: 'pbuchman/intexuraos',
      prNumber: 5,
      senderLogin: 'reviewer',
      comment: 'Looks good with minor fixes',
      eventType: 'pull_request_review',
      action: 'submitted',
    };

    const brief = buildWebhookDelegationBrief(input);

    expect(brief).toContain('review');
    expect(brief).toContain('Looks good with minor fixes');
  });
});

describe('mark_processing tool', () => {
  it('calls addReaction and returns success', async () => {
    const deps: MarkProcessingToolDeps = {
      addReaction: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const tool = createMarkProcessingTool(deps);

    const step: ActionStep = {
      actionId: 'mark-1',
      type: 'mark_processing',
      params: {
        repository: 'pbuchman/intexuraos',
        commentId: 12345,
      },
    };

    const result = await tool.execute(step);

    expect(result.ok).toBe(true);
    expect(deps.addReaction).toHaveBeenCalledWith('pbuchman/intexuraos', 12345);
  });

  it('returns error when addReaction fails', async () => {
    const deps: MarkProcessingToolDeps = {
      addReaction: vi.fn().mockResolvedValue(err({ code: 'API_ERROR', message: 'HTTP 403' })),
    };
    const tool = createMarkProcessingTool(deps);

    const step: ActionStep = {
      actionId: 'mark-2',
      type: 'mark_processing',
      params: {
        repository: 'pbuchman/intexuraos',
        commentId: 99,
      },
    };

    const result = await tool.execute(step);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('API_ERROR');
  });

  it('returns error when required params are missing', async () => {
    const deps: MarkProcessingToolDeps = {
      addReaction: vi.fn(),
    };
    const tool = createMarkProcessingTool(deps);

    const step: ActionStep = {
      actionId: 'mark-3',
      type: 'mark_processing',
      params: {},
    };

    const result = await tool.execute(step);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('repository');
  });
});
