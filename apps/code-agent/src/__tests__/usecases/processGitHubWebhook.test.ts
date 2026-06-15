/**
 * Unit tests for processGitHubWebhook use case.
 *
 * Covers the principal control-flow branches directly; the full matrix of
 * normalization / audit / summary side effects is exercised by the route-level
 * integration tests in `__tests__/routes/webhooks/github.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { ok, err } from '@intexuraos/common-core';
import {
  processGitHubWebhook,
  type ProcessGitHubWebhookInput,
  type VerifyGitHubSignature,
  type ParseGitHubWebhookEvent,
} from '../../domain/usecases/processGitHubWebhook.js';
import type { GitHubPREvent } from '../../domain/models/gitHubPREvent.js';
import { verifyGitHubSignature } from '../../infra/github-webhook-auth.js';
import { parseGitHubWebhookEvent } from '../../infra/github-event-parser.js';
import { createMockLogger } from '../helpers/mockLogger.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';

const WEBHOOK_SECRET = 'test-secret';

function signPayload(body: unknown): { rawBody: Buffer; signatureHeader: string } {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf-8');
  const hmac = createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(rawBody);
  return { rawBody, signatureHeader: `sha256=${hmac.digest('hex')}` };
}

function buildPREvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    id: 'evt_1',
    githubEventId: 1,
    deliveryId: 'del-1',
    repository: 'intexuraos/intexuraos',
    repositoryId: 42,
    pullRequestNumber: 7,
    pullRequestId: 100,
    eventType: 'pull_request',
    action: 'opened',
    senderLogin: 'alice',
    senderId: 7,
    senderType: 'User',
    prAuthorLogin: 'alice',
    title: 'Some PR',
    body: 'Body',
    state: 'open',
    isDraft: false,
    baseBranch: 'development',
    mergedAt: null,
    createdAt: new Date('2026-04-20T00:00:00.000Z'),
    processedAt: new Date('2026-04-20T00:00:00.000Z'),
    payload: {},
    ...overrides,
  } as GitHubPREvent;
}

interface MocksShape {
  gitHubPREventRepo: { save: ReturnType<typeof vi.fn> };
  gitHubPRSummaryRepo: { upsert: ReturnType<typeof vi.fn> };
  gitHubWebhookAuditEventRepo: {
    save: ReturnType<typeof vi.fn>;
    updateNormalizationStatus: ReturnType<typeof vi.fn>;
  };
  gitHubEventLogEntryRepo: {
    createPending: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  eventDecisionRepo: {
    save: ReturnType<typeof vi.fn>;
    findByEventIds: ReturnType<typeof vi.fn>;
  };
  automationLog: { record: ReturnType<typeof vi.fn> };
  prTriagePublisher: { publishPRTriage: ReturnType<typeof vi.fn> };
  unifiedEvaluator: { evaluate: ReturnType<typeof vi.fn> };
  mergeConflictDetector: { detectOnPush: ReturnType<typeof vi.fn>; reconcile: ReturnType<typeof vi.fn> };
}

function buildMocksAndInstall(): MocksShape {
  const logger = createMockLogger();
  const gitHubPREventRepo = {
    save: vi.fn().mockResolvedValue(ok(buildPREvent())),
  };
  const gitHubPRSummaryRepo = {
    upsert: vi.fn().mockResolvedValue(ok(undefined)),
  };
  const gitHubWebhookAuditEventRepo = {
    save: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({ id: 'audit-1', ...input })),
    updateNormalizationStatus: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({ id: input['id'], ...input })),
  };
  const gitHubEventLogEntryRepo = {
    createPending: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({ ...input, decisionId: null })),
    complete: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({ ...input })),
  };
  const eventDecisionRepo = {
    save: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({ id: 'decision-1', ...input, createdAt: new Date() })),
    findByEventIds: vi.fn().mockResolvedValue(ok([])),
  };
  const automationLog = { record: vi.fn().mockResolvedValue(undefined) };
  const prTriagePublisher = { publishPRTriage: vi.fn().mockResolvedValue(ok(undefined)) };
  const unifiedEvaluator = { evaluate: vi.fn().mockResolvedValue(undefined) };
  const mergeConflictDetector = {
    detectOnPush: vi.fn().mockResolvedValue(undefined),
    reconcile: vi.fn().mockResolvedValue({ processed: 0 }),
  };

  setServices({
    logger,
    gitHubPREventRepo,
    gitHubPRSummaryRepo,
    gitHubWebhookAuditEventRepo,
    gitHubEventLogEntryRepo,
    eventDecisionRepo,
    automationLog,
    userServiceClient: {
      resolveGitHubUsername: vi.fn().mockResolvedValue(ok({ userId: 'user-1' })),
    },
    prTriagePublisher,
    unifiedEvaluator,
    mergeConflictDetector,
    codeTaskRepo: {},
    linearIssueService: {},
    taskDispatcher: {},
    workerSettingsRepo: {},
    groupSummaryRepo: undefined,
  } as unknown as ServiceContainer);

  return {
    gitHubPREventRepo,
    gitHubPRSummaryRepo,
    gitHubWebhookAuditEventRepo,
    gitHubEventLogEntryRepo,
    eventDecisionRepo,
    automationLog,
    prTriagePublisher,
    unifiedEvaluator,
    mergeConflictDetector,
  };
}

function buildPullRequestBody(): Record<string, unknown> {
  return {
    action: 'opened',
    repository: {
      id: 42,
      name: 'intexuraos',
      full_name: 'intexuraos/intexuraos',
      owner: { login: 'intexuraos', id: 1 },
    },
    pull_request: {
      id: 100,
      number: 7,
      title: 'Some PR',
      body: 'Body',
      state: 'open',
      closed_at: null,
      merged_at: null,
      draft: false,
      user: { login: 'alice', id: 7 },
      head: { ref: 'feature', sha: 'abc123' },
      base: { ref: 'development' },
    },
    sender: { login: 'alice', id: 7, type: 'User' },
  };
}

function buildPushBody(): Record<string, unknown> {
  return {
    ref: 'refs/heads/development',
    repository: {
      id: 42,
      name: 'intexuraos',
      full_name: 'intexuraos/intexuraos',
      owner: { login: 'intexuraos', id: 1 },
    },
    sender: { login: 'alice', id: 7, type: 'User' },
    pusher: { name: 'alice' },
    head_commit: { id: 'abc123', message: 'commit message', url: 'https://github.com/x' },
  };
}

const defaultVerifySignature: VerifyGitHubSignature = verifyGitHubSignature;
const defaultParseEvent: ParseGitHubWebhookEvent = parseGitHubWebhookEvent;

function runInput(partial: Partial<ProcessGitHubWebhookInput>): ProcessGitHubWebhookInput {
  const body = partial.body ?? buildPullRequestBody();
  const { rawBody, signatureHeader } = signPayload(body);
  return {
    rawBody: partial.rawBody ?? rawBody,
    signatureHeader: partial.signatureHeader ?? signatureHeader,
    eventType: partial.eventType ?? 'pull_request',
    deliveryId: partial.deliveryId ?? 'delivery-1',
    body: body as never,
    logger: partial.logger ?? createMockLogger(),
    webhookSecret: partial.webhookSecret ?? WEBHOOK_SECRET,
    verifySignature: partial.verifySignature ?? defaultVerifySignature,
    parseEvent: partial.parseEvent ?? defaultParseEvent,
  };
}

describe('processGitHubWebhook', () => {
  let mocks: MocksShape;

  beforeEach(() => {
    mocks = buildMocksAndInstall();
  });

  afterEach(() => {
    resetServices();
  });

  it('returns invalid_signature when signature header is missing', async () => {
    const body = buildPullRequestBody();
    const { rawBody } = signPayload(body);
    const logger = createMockLogger();
    const result = await processGitHubWebhook({
      rawBody,
      signatureHeader: undefined,
      eventType: 'pull_request',
      deliveryId: 'delivery-1',
      body: body as never,
      logger,
      webhookSecret: WEBHOOK_SECRET,
      verifySignature: defaultVerifySignature,
      parseEvent: defaultParseEvent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_signature');
    }
    expect(mocks.gitHubWebhookAuditEventRepo.save).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ _skipSentry: true }),
      'Invalid GitHub webhook signature'
    );
  });

  it('returns invalid_signature when signature does not match', async () => {
    const body = buildPullRequestBody();
    const rawBody = Buffer.from(JSON.stringify(body), 'utf-8');
    const logger = createMockLogger();
    const result = await processGitHubWebhook({
      rawBody,
      signatureHeader: 'sha256=deadbeef',
      eventType: 'pull_request',
      deliveryId: 'delivery-1',
      body: body as never,
      logger,
      webhookSecret: WEBHOOK_SECRET,
      verifySignature: defaultVerifySignature,
      parseEvent: defaultParseEvent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_signature');
    }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ signature: 'sha256=deadbeef', _skipSentry: true }),
      'Invalid GitHub webhook signature'
    );
  });

  it('returns internal_error when audit repositories are not configured', async () => {
    // Install services without audit repos to trigger the early-return branch.
    setServices({
      logger: createMockLogger(),
      gitHubPREventRepo: mocks.gitHubPREventRepo,
      gitHubPRSummaryRepo: mocks.gitHubPRSummaryRepo,
      eventDecisionRepo: mocks.eventDecisionRepo,
      automationLog: mocks.automationLog,
      userServiceClient: { resolveGitHubUsername: vi.fn() },
      prTriagePublisher: mocks.prTriagePublisher,
      unifiedEvaluator: mocks.unifiedEvaluator,
      mergeConflictDetector: mocks.mergeConflictDetector,
    } as unknown as ServiceContainer);

    const result = await processGitHubWebhook(runInput({}));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('internal_error');
    }
  });

  it('responds with pong for a valid ping event', async () => {
    const body = { zen: 'Non-blocking is better than blocking.' };
    const { rawBody, signatureHeader } = signPayload(body);
    const result = await processGitHubWebhook({
      rawBody,
      signatureHeader,
      eventType: 'ping',
      deliveryId: 'delivery-ping',
      body: body as never,
      logger: createMockLogger(),
      webhookSecret: WEBHOOK_SECRET,
      verifySignature: defaultVerifySignature,
      parseEvent: defaultParseEvent,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('pong');
      expect(result.message).toBe('pong');
    }
    expect(mocks.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ping_event', decision: 'skip' }),
    );
  });

  it('acknowledges unsupported event types without normalization', async () => {
    const body = buildPullRequestBody();
    const { rawBody, signatureHeader } = signPayload(body);

    const result = await processGitHubWebhook({
      rawBody,
      signatureHeader,
      eventType: 'release',
      deliveryId: 'delivery-release',
      body: body as never,
      logger: createMockLogger(),
      webhookSecret: WEBHOOK_SECRET,
      verifySignature: defaultVerifySignature,
      parseEvent: defaultParseEvent,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('acknowledged');
    }
    expect(mocks.gitHubPREventRepo.save).not.toHaveBeenCalled();
    expect(mocks.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unsupported_event' }),
    );
  });

  it('returns duplicate when the PR event repo reports DUPLICATE_EVENT', async () => {
    mocks.gitHubPREventRepo.save.mockResolvedValueOnce(
      err({ code: 'DUPLICATE_EVENT', message: 'already seen' }),
    );

    const result = await processGitHubWebhook(runInput({}));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('duplicate');
    }
    expect(mocks.prTriagePublisher.publishPRTriage).not.toHaveBeenCalled();
    expect(mocks.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'duplicate_delivery' }),
    );
  });

  it('ignores events from repositories outside the IntexuraOS allow-list', async () => {
    const body = buildPullRequestBody();
    (body['repository'] as Record<string, unknown>)['full_name'] = 'someone/other';

    const result = await processGitHubWebhook(runInput({ body: body as never }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('ignored');
    }
    expect(mocks.gitHubPREventRepo.save).not.toHaveBeenCalled();
  });

  it('processes a valid pull_request event and publishes a triage message', async () => {
    const result = await processGitHubWebhook(runInput({}));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('processed');
      expect(result.message).toBe('processed');
    }
    expect(mocks.gitHubPREventRepo.save).toHaveBeenCalledTimes(1);
    expect(mocks.prTriagePublisher.publishPRTriage).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt_1', repository: 'intexuraos/intexuraos', pullRequestNumber: 7 }),
    );
    expect(mocks.gitHubPRSummaryRepo.upsert).toHaveBeenCalledTimes(1);
  });

  it('falls back to the inline evaluator when triage publish fails', async () => {
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'pub/sub unavailable' }),
    );

    const result = await processGitHubWebhook(runInput({}));

    expect(result.ok).toBe(true);
    expect(mocks.unifiedEvaluator.evaluate).toHaveBeenCalledTimes(1);
  });

  it('skips fallback decision persist when an existing decision is already recorded', async () => {
    // Arrange: triage publish fails AND inline evaluator throws → triggers
    // ensureDecisionAfterEvaluationFailure. Seed an existing decision so the
    // dedup check (findByEventIds → non-empty) prevents a second persist.
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'pub/sub unavailable' }),
    );
    mocks.unifiedEvaluator.evaluate.mockRejectedValueOnce(new Error('evaluator failure'));
    mocks.eventDecisionRepo.findByEventIds.mockResolvedValueOnce(
      ok([{ id: 'existing-decision-1', eventId: 'audit-1', decision: 'skip', reason: 'previously_recorded' }]),
    );

    const result = await processGitHubWebhook(runInput({}));

    expect(result.ok).toBe(true);
    // Wait for fire-and-forget fallback chain to settle
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.eventDecisionRepo.findByEventIds).toHaveBeenCalledWith(['audit-1']);
    // The fallback must NOT record another decision because one already exists
    const fallbackCalls = mocks.eventDecisionRepo.save.mock.calls.filter(
      (call: unknown[]) => {
        const arg = call[0] as { reason?: string } | undefined;
        return arg?.reason?.startsWith('evaluation_failed') === true;
      },
    );
    expect(fallbackCalls).toHaveLength(0);
  });

  it('persists a fallback decision when evaluation fails and no prior decision exists', async () => {
    // Arrange: publish fails, inline evaluator throws, findByEventIds returns
    // an empty array (default fake). The false-branch of the dedup check
    // leads to persistRouteDecision with reason "evaluation_failed:*".
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'pub/sub unavailable' }),
    );
    mocks.unifiedEvaluator.evaluate.mockRejectedValueOnce(new Error('evaluator failure'));

    const result = await processGitHubWebhook(runInput({}));

    expect(result.ok).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.eventDecisionRepo.findByEventIds).toHaveBeenCalledWith(['audit-1']);
    const fallbackCalls = mocks.eventDecisionRepo.save.mock.calls.filter(
      (call: unknown[]) => {
        const arg = call[0] as { reason?: string } | undefined;
        return arg?.reason?.startsWith('evaluation_failed') === true;
      },
    );
    expect(fallbackCalls.length).toBeGreaterThan(0);
  });

  it('processes a valid push event and triggers merge-conflict detection', async () => {
    mocks.gitHubPREventRepo.save.mockResolvedValueOnce(
      ok(buildPREvent({ eventType: 'push', pullRequestNumber: 0, action: null })),
    );
    const body = buildPushBody();
    const { rawBody, signatureHeader } = signPayload(body);

    const result = await processGitHubWebhook({
      rawBody,
      signatureHeader,
      eventType: 'push',
      deliveryId: 'delivery-push',
      body: body as never,
      logger: createMockLogger(),
      webhookSecret: WEBHOOK_SECRET,
      verifySignature: defaultVerifySignature,
      parseEvent: defaultParseEvent,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('processed');
    }
    // PR summary upsert should be skipped for pullRequestNumber=0
    expect(mocks.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    expect(mocks.mergeConflictDetector.detectOnPush).toHaveBeenCalledTimes(1);
  });
});
