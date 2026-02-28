import { describe, it, expect } from 'vitest';
import {
  replayWebhookEventDryRun,
  type ReplayDeps,
  type ReplayFixture,
} from '../../../domain/githubWebhookAgent/replayHarness.js';

function makeReplayDeps(overrides: Partial<ReplayDeps> = {}): ReplayDeps {
  return {
    isSenderAllowed: (): boolean => true,
    isUserMapped: (): boolean => true,
    hasExistingTask: false,
    ownsProcessingMarker: false,
    ...overrides,
  };
}

function makePrSyncFixture(): ReplayFixture {
  return {
    event: {
      id: 'fixture-pr-sync-001',
      githubEventId: 1001,
      repository: 'pbuchman/intexuraos',
      repositoryId: 100,
      pullRequestNumber: 10,
      pullRequestId: 200,
      eventType: 'pull_request',
      action: 'synchronize',
      senderLogin: 'testuser',
      senderId: 300,
      senderType: 'User',
      title: 'Update dependencies',
      body: null,
      state: 'open',
      mergedAt: null,
      payload: {},
    },
    expected: {
      decisionKind: 'noop',
      actionCount: 0,
    },
  };
}

function makeCommentFixture(): ReplayFixture {
  return {
    event: {
      id: 'fixture-comment-001',
      githubEventId: 2001,
      repository: 'pbuchman/intexuraos',
      repositoryId: 100,
      pullRequestNumber: 42,
      pullRequestId: 201,
      eventType: 'issue_comment',
      action: 'created',
      senderLogin: 'pbuchman',
      senderId: 301,
      senderType: 'User',
      title: 'Fix auth bug',
      body: 'Please fix the authentication issue in the login flow',
      state: 'open',
      mergedAt: null,
      payload: {},
    },
    expected: {
      decisionKind: 'create_pr_comment_task',
      actionCount: 1,
    },
  };
}

describe('replayWebhookEventDryRun', () => {
  it('produces noop plan for PR synchronize event from disallowed sender', () => {
    const fixture = makePrSyncFixture();
    const deps = makeReplayDeps({
      isSenderAllowed: (): boolean => false,
    });

    const result = replayWebhookEventDryRun(deps, fixture);

    expect(result.decision.decision.kind).toBe('noop');
    expect(result.plan.decisionKind).toBe('noop');
    expect(result.plan.actions).toHaveLength(0);
    expect(result.validation.valid).toBe(true);
    expect(result.promptVersion).toBe('1.0');
    expect(result.diagnostics.ruleReasonCode).toBe('sender_not_allowed');
  });

  it('produces task-dispatch plan for actionable comment', () => {
    const fixture = makeCommentFixture();
    const deps = makeReplayDeps();

    const result = replayWebhookEventDryRun(deps, fixture);

    expect(result.decision.decision.kind).toBe('create_pr_comment_task');
    expect(result.plan.decisionKind).toBe('create_pr_comment_task');
    expect(result.plan.actions.length).toBeGreaterThan(0);
    expect(result.plan.actions.some((a) => a.type === 'dispatch_task')).toBe(true);
    expect(result.validation.valid).toBe(true);
  });

  it('classifies github action result events correctly', () => {
    const fixture = makePrSyncFixture();
    fixture.event.eventType = 'check_run';
    fixture.event.action = null;
    const deps = makeReplayDeps();

    const result = replayWebhookEventDryRun(deps, fixture);

    expect(result.diagnostics.eventGroup).toBe('github_action_result');
    expect(result.decision.decision.kind).toBe('noop');
  });

  it('classifies unknown event types as other', () => {
    const fixture = makePrSyncFixture();
    fixture.event.eventType = 'ping';
    fixture.event.action = null;
    const deps = makeReplayDeps();

    const result = replayWebhookEventDryRun(deps, fixture);

    expect(result.diagnostics.eventGroup).toBe('other');
  });

  it('produces send_task_message when existing task exists', () => {
    const fixture = makeCommentFixture();
    const deps = makeReplayDeps({ hasExistingTask: true });

    const result = replayWebhookEventDryRun(deps, fixture);

    expect(result.decision.decision.kind).toBe('send_task_message');
    expect(result.plan.decisionKind).toBe('send_task_message');
  });

  it('records validation diagnostics and falls back to noop for invalid plan', () => {
    const fixture = makeCommentFixture();
    const deps = makeReplayDeps({
      isUserMapped: (): boolean => false,
    });

    const result = replayWebhookEventDryRun(deps, fixture);

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
    expect(result.validation.errors.some((e) => e.code === 'user_mapping_required')).toBe(true);
    expect(result.diagnostics.validationFailed).toBe(true);
    expect(result.diagnostics.fallbackApplied).toBe(true);
    expect(result.fallbackPlan).toBeDefined();
    expect(result.fallbackPlan?.decisionKind).toBe('noop');
  });
});
