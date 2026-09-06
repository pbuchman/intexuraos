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
  gitHubPREventRepo: {
    save: ReturnType<typeof vi.fn>;
    acquireTriage: ReturnType<typeof vi.fn>;
    completeTriage: ReturnType<typeof vi.fn>;
    failTriage: ReturnType<typeof vi.fn>;
  };
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
    acquireTriage: vi.fn().mockResolvedValue(ok({
      kind: 'acquired',
      event: buildPREvent(),
      leaseToken: 'lease-1',
    })),
    completeTriage: vi.fn().mockResolvedValue(ok(undefined)),
    failTriage: vi.fn().mockResolvedValue(ok(undefined)),
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

  it('republishes triage when a duplicate delivery identifies the saved event', async () => {
    mocks.gitHubPREventRepo.save.mockResolvedValueOnce(
      err({ code: 'DUPLICATE_EVENT', message: 'already seen', eventId: 'evt-existing' }),
    );

    const result = await processGitHubWebhook(runInput({}));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('duplicate');
    }
    expect(mocks.prTriagePublisher.publishPRTriage).toHaveBeenCalledWith({
      eventId: 'evt-existing',
      repository: 'intexuraos/intexuraos',
      pullRequestNumber: 7,
      correlationId: 'evt-existing',
    });
    expect(mocks.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'duplicate_delivery' }),
    );
  });

  it('does not publish triage when a legacy duplicate result has no event id', async () => {
    mocks.gitHubPREventRepo.save.mockResolvedValueOnce(
      err({ code: 'DUPLICATE_EVENT', message: 'already seen' }),
    );

    const result = await processGitHubWebhook(runInput({}));

    expect(result.ok).toBe(true);
    expect(mocks.prTriagePublisher.publishPRTriage).not.toHaveBeenCalled();
  });

  it('requests redelivery when duplicate triage cannot be published or leased inline', async () => {
    mocks.gitHubPREventRepo.save.mockResolvedValueOnce(
      err({ code: 'DUPLICATE_EVENT', message: 'already seen', eventId: 'evt-existing' }),
    );
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ code: 'PUBLISH_FAILED', message: 'pubsub unavailable' }),
    );
    mocks.gitHubPREventRepo.acquireTriage.mockResolvedValueOnce(ok({
      kind: 'busy',
      owner: 'other-delivery',
    }));

    const result = await processGitHubWebhook(runInput({}));

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Failed to hand off GitHub PR event for triage',
    });
    expect(mocks.unifiedEvaluator.evaluate).not.toHaveBeenCalled();
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
    expect(mocks.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'intexuraos/intexuraos',
        pullRequestNumber: 7,
        state: 'open',
        lastConflictCheckedAt: null,
      }),
    );
  });

  it('requests webhook redelivery when the normalized event cannot be saved', async () => {
    mocks.gitHubPREventRepo.save.mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Firestore unavailable' }),
    );

    const result = await processGitHubWebhook(runInput({}));

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Failed to save GitHub PR event',
    });
    expect(mocks.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'normalized_event_save_failed',
        decision: 'skip',
      }),
    );
    expect(mocks.gitHubEventLogEntryRepo.complete).toHaveBeenCalledWith(
      expect.objectContaining({ decisionOutcome: 'skip' }),
    );
    expect(mocks.gitHubWebhookAuditEventRepo.updateNormalizationStatus).toHaveBeenCalledWith({
      id: 'audit-1',
      normalizationStatus: 'failed',
    });
  });

  it('leases, evaluates, and completes inline triage when publish fails', async () => {
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'pub/sub unavailable' }),
    );
    let finishEvaluation: (() => void) | undefined;
    mocks.unifiedEvaluator.evaluate.mockImplementationOnce(async () =>
      await new Promise<void>((resolve) => {
        finishEvaluation = resolve;
      }),
    );

    let webhookSettled = false;
    const processing = processGitHubWebhook(runInput({})).then((result) => {
      webhookSettled = true;
      return result;
    });
    await vi.waitFor(() => expect(mocks.unifiedEvaluator.evaluate).toHaveBeenCalledOnce());
    await new Promise((resolve) => setImmediate(resolve));
    expect(webhookSettled).toBe(false);
    finishEvaluation?.();
    const result = await processing;

    expect(result.ok).toBe(true);
    expect(mocks.gitHubPREventRepo.completeTriage).toHaveBeenCalledOnce();
    expect(mocks.gitHubPREventRepo.acquireTriage).toHaveBeenCalledWith({
      eventId: 'evt_1',
      leaseOwner: 'webhook-inline:audit-1',
      acquiredAt: expect.any(Date),
      leaseDurationMs: 15 * 60 * 1000,
    });
    expect(mocks.unifiedEvaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(mocks.gitHubPREventRepo.completeTriage).toHaveBeenCalledWith({
      eventId: 'evt_1',
      leaseToken: 'lease-1',
      completedAt: expect.any(Date),
    });
    expect(mocks.gitHubPREventRepo.failTriage).not.toHaveBeenCalled();
  });

  it('requests webhook redelivery when the inline fallback lease is busy', async () => {
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'ambiguous publish failure' }),
    );
    mocks.gitHubPREventRepo.acquireTriage.mockResolvedValueOnce(ok({ kind: 'busy' }));

    const result = await processGitHubWebhook(runInput({}));

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Failed to hand off GitHub PR event for triage',
    });
    await vi.waitFor(() => expect(mocks.gitHubPREventRepo.acquireTriage).toHaveBeenCalledOnce());
    expect(mocks.unifiedEvaluator.evaluate).not.toHaveBeenCalled();
    expect(mocks.gitHubPREventRepo.completeTriage).not.toHaveBeenCalled();
    expect(mocks.gitHubPREventRepo.failTriage).not.toHaveBeenCalled();
  });

  it('acknowledges a redelivery after inline triage has already completed', async () => {
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'ambiguous publish failure' }),
    );
    mocks.gitHubPREventRepo.acquireTriage.mockResolvedValueOnce(ok({ kind: 'completed' }));

    const result = await processGitHubWebhook(runInput({}));

    expect(result).toEqual({ ok: true, outcome: 'processed', message: 'processed' });
    expect(mocks.unifiedEvaluator.evaluate).not.toHaveBeenCalled();
    expect(mocks.gitHubPREventRepo.completeTriage).not.toHaveBeenCalled();
    expect(mocks.gitHubPREventRepo.failTriage).not.toHaveBeenCalled();
  });

  it('does not evaluate when the inline fallback lease cannot be acquired', async () => {
    const logger = createMockLogger();
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'pub/sub unavailable' }),
    );
    mocks.gitHubPREventRepo.acquireTriage.mockResolvedValueOnce(err({
      code: 'FIRESTORE_ERROR',
      message: 'lease store unavailable',
    }));

    const result = await processGitHubWebhook(runInput({ logger }));

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Failed to hand off GitHub PR event for triage',
    });
    expect(mocks.gitHubPREventRepo.acquireTriage).toHaveBeenCalledOnce();
    expect(mocks.unifiedEvaluator.evaluate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt_1' }),
      'Failed to acquire PR triage lease for inline fallback',
    );
  });

  it('logs a lease completion failure after successful inline evaluation', async () => {
    const logger = createMockLogger();
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'pub/sub unavailable' }),
    );
    mocks.gitHubPREventRepo.completeTriage.mockResolvedValueOnce(err({
      code: 'FIRESTORE_ERROR',
      message: 'completion unavailable',
    }));

    const result = await processGitHubWebhook(runInput({ logger }));

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Failed to hand off GitHub PR event for triage',
    });
    expect(mocks.gitHubPREventRepo.completeTriage).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt_1' }),
      'Failed to complete PR triage lease after inline evaluation',
    );
  });

  it('requests webhook redelivery when the saved event disappears before inline triage', async () => {
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'pub/sub unavailable' }),
    );
    mocks.gitHubPREventRepo.acquireTriage.mockResolvedValueOnce(ok({ kind: 'not_found' }));

    const result = await processGitHubWebhook(runInput({}));

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Failed to hand off GitHub PR event for triage',
    });
    expect(mocks.unifiedEvaluator.evaluate).not.toHaveBeenCalled();
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

    expect(result.ok).toBe(false);

    expect(mocks.gitHubPREventRepo.failTriage).toHaveBeenCalledWith({
      eventId: 'evt_1',
      leaseToken: 'lease-1',
      failedAt: expect.any(Date),
      reason: 'evaluator failure',
    });
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

    expect(result.ok).toBe(false);

    expect(mocks.eventDecisionRepo.findByEventIds).toHaveBeenCalledWith(['audit-1']);
    const fallbackCalls = mocks.eventDecisionRepo.save.mock.calls.filter(
      (call: unknown[]) => {
        const arg = call[0] as { reason?: string } | undefined;
        return arg?.reason?.startsWith('evaluation_failed') === true;
      },
    );
    expect(fallbackCalls.length).toBeGreaterThan(0);
  });

  it('persists the fallback decision when releasing a failed inline lease also fails', async () => {
    const logger = createMockLogger();
    mocks.prTriagePublisher.publishPRTriage.mockResolvedValueOnce(
      err({ message: 'pub/sub unavailable' }),
    );
    mocks.unifiedEvaluator.evaluate.mockRejectedValueOnce(new Error('evaluator failure'));
    mocks.gitHubPREventRepo.failTriage.mockResolvedValueOnce(err({
      code: 'FIRESTORE_ERROR',
      message: 'release unavailable',
    }));

    const result = await processGitHubWebhook(runInput({ logger }));

    expect(result.ok).toBe(false);
    expect(mocks.gitHubPREventRepo.failTriage).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt_1' }),
      'Failed to release PR triage lease after inline evaluator error',
    );
    expect(mocks.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'evaluation_failed:evaluator failure' }),
    );
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
