/**
 * Unit tests for processing Sentry webhook deliveries under an atomic lease.
 */

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import type { AcquireSentryTaskReservationInput } from '../../domain/models/sentryIssueEvent.js';
import { processSentryWebhook, type ProcessSentryWebhookInput } from '../../domain/usecases/processSentryWebhook.js';
import { verifySentrySignature } from '../../infra/sentry-webhook-auth.js';
import { parseSentryIssueEvent } from '../../infra/sentry-event-parser.js';
import { createMockLogger } from '../helpers/mockLogger.js';
import { createFakeTask } from '../helpers/mockFirestore.js';

const WEBHOOK_SECRET = 'sentry-webhook-secret';
const ORCHESTRATOR_SECRET = 'orchestrator-secret';
const AUTOMATION_USER_ID = 'sentry-automation-user';
const TRANSITION_KEY = 'sentry:intexuraos:100:4509001:issue:created';
const ISSUE_KEY = 'sentry-task:intexuraos:100:4509001';
const LEASE_TOKEN = 'lease-token';

function buildIssueBody(): Record<string, unknown> {
  return {
    action: 'created',
    data: {
      issue: {
        id: '4509001',
        shortId: 'INTEXURAOS-DEVELOPMENT-7',
        title: 'TypeError: Cannot read properties of undefined',
        permalink:
          'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/4509001/',
        status: 'unresolved',
        project: { id: '100', slug: 'intexuraos-development' },
      },
    },
  };
}

function buildEventAlertBody(): Record<string, unknown> {
  return {
    action: 'triggered',
    data: {
      event: {
        event_id: 'event-4509002',
        title: 'Error: fetch failed',
        web_url:
          'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/4509002/events/event-4509002/',
        issue:
          'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/4509002/',
        project: 'intexuraos-web-development',
      },
    },
  };
}

function buildResolvedEventAlertBody(): Record<string, unknown> {
  return {
    action: 'triggered',
    data: {
      event: {
        event_id: 'event-resolved',
        title: 'Resolved issue',
        issue: {
          id: '4509003',
          title: 'Resolved issue',
          status: 'resolved',
          url:
            'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/4509003/',
          project: { slug: 'intexuraos-web-development' },
        },
      },
    },
  };
}

function buildSampleEventAlertBody(): Record<string, unknown> {
  return {
    action: 'triggered',
    data: {
      event: {
        event_id: 'sample-event',
        project: 4510702691024976,
        title: 'This is an example node-fastify exception',
        web_url:
          'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/1117540176/events/sample-event/',
        issue_url:
          'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/1117540176/',
        issue_id: '1117540176',
      },
    },
  };
}

function signBody(body: unknown): { rawBody: Buffer; signatureHeader: string } {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf-8');
  return {
    rawBody,
    signatureHeader: createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex'),
  };
}

interface MocksShape {
  sentryIssueEventRepo: {
    acquire: ReturnType<typeof vi.fn>;
    checkpointLinearIssue: ReturnType<typeof vi.fn>;
    completeReservation: ReturnType<typeof vi.fn>;
    failReservation: ReturnType<typeof vi.fn>;
  };
  workerSettingsRepo: { getSettings: ReturnType<typeof vi.fn> };
  linearIssueService: { ensureIssueExists: ReturnType<typeof vi.fn> };
  codeTaskRepo: { create: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };
  taskEnqueueService: { enqueue: ReturnType<typeof vi.fn> };
}

type MockOverrides = {
  [Key in keyof MocksShape]?: Partial<MocksShape[Key]>;
};

function acquiredResult(input: AcquireSentryTaskReservationInput): ReturnType<typeof ok> {
  return ok({
    kind: 'acquired' as const,
    transitionKey: TRANSITION_KEY,
    issueKey: ISSUE_KEY,
    leaseToken: LEASE_TOKEN,
    codeTaskId: input.proposedCodeTaskId,
  });
}

function installMocks(overrides: MockOverrides = {}): MocksShape {
  const sentryIssueEventRepo = {
    acquire: vi.fn(async (input: AcquireSentryTaskReservationInput) => acquiredResult(input)),
    checkpointLinearIssue: vi.fn().mockResolvedValue(ok(undefined)),
    completeReservation: vi.fn().mockResolvedValue(ok(undefined)),
    failReservation: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides.sentryIssueEventRepo,
  };
  const workerSettingsRepo = {
    getSettings: vi.fn().mockResolvedValue(ok({
      userId: AUTOMATION_USER_ID,
      workers: [{
        name: 'home-mac',
        url: 'https://worker.intexuraos.cloud',
        cfAccessClientId: 'client-id',
        cfAccessClientSecret: 'client-secret',
        dispatchSigningSecret: 'dispatch-secret',
        enabled: true,
      }],
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
      defaultExecutionWorkerType: 'sonnet',
      defaultSentryWorkerType: 'codex-xhigh',
    })),
    ...overrides.workerSettingsRepo,
  };
  const linearIssueService = {
    ensureIssueExists: vi.fn().mockResolvedValue({
      linearIssueId: 'INT-200',
      linearIssueTitle: '[sentry] TypeError: Cannot read properties of undefined',
      linearIssueLabels: ['bug', 'sentry'],
      linearFallback: false,
      hasChildren: false,
      linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-200',
    }),
    ...overrides.linearIssueService,
  };
  const codeTaskRepo = {
    findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'task not found' })),
    create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
      id: input['id'],
      ...input,
      status: 'queued',
    })),
    ...overrides.codeTaskRepo,
  };
  const taskEnqueueService = {
    enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'task_sentry', queuePosition: 1 })),
    ...overrides.taskEnqueueService,
  };

  setServices({
    logger: createMockLogger(),
    sentryIssueEventRepo,
    workerSettingsRepo,
    linearIssueService,
    codeTaskRepo,
    taskEnqueueService,
  } as unknown as ServiceContainer);

  return {
    sentryIssueEventRepo,
    workerSettingsRepo,
    linearIssueService,
    codeTaskRepo,
    taskEnqueueService,
  };
}

function buildInput(partial: Partial<ProcessSentryWebhookInput> = {}): ProcessSentryWebhookInput {
  const body = partial.body ?? buildIssueBody();
  const { rawBody, signatureHeader } = signBody(body);
  return {
    rawBody: partial.rawBody ?? rawBody,
    signatureHeader: partial.signatureHeader ?? signatureHeader,
    resourceHeader: partial.resourceHeader ?? 'issue',
    body,
    logger: partial.logger ?? createMockLogger(),
    webhookSecret: partial.webhookSecret ?? WEBHOOK_SECRET,
    orchestratorSecret: partial.orchestratorSecret ?? ORCHESTRATOR_SECRET,
    automationUserId: partial.automationUserId ?? AUTOMATION_USER_ID,
    repository: partial.repository ?? 'pbuchman/intexuraos',
    baseBranch: partial.baseBranch ?? 'development',
    verifySignature: partial.verifySignature ?? verifySentrySignature,
    parseIssueEvent: partial.parseIssueEvent ?? parseSentryIssueEvent,
  };
}

function inspectResult(codeTaskId: string): ReturnType<typeof ok> {
  return ok({
    kind: 'inspect_linked_task' as const,
    codeTaskId,
    transitionKey: TRANSITION_KEY,
    issueKey: ISSUE_KEY,
  });
}

describe('processSentryWebhook', () => {
  let mocks: MocksShape;

  beforeEach(() => {
    mocks = installMocks();
  });

  afterEach(() => {
    resetServices();
  });

  it('rejects invalid signatures before acquiring a reservation', async () => {
    const result = await processSentryWebhook(buildInput({ signatureHeader: 'a'.repeat(64) }));

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_signature',
      message: 'Invalid Sentry webhook signature',
    });
    expect(mocks.sentryIssueEventRepo.acquire).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('creates, enqueues, and completes exactly one task under the acquired lease', async () => {
    const result = await processSentryWebhook(buildInput());
    const acquisition = mocks.sentryIssueEventRepo.acquire.mock.calls[0]?.[0] as
      | AcquireSentryTaskReservationInput
      | undefined;
    if (acquisition === undefined) throw new Error('Expected reservation acquisition');

    expect(result).toEqual({
      ok: true,
      outcome: 'processed',
      message: 'Sentry issue code task created',
      codeTaskId: acquisition.proposedCodeTaskId,
    });
    expect(acquisition).toEqual(expect.objectContaining({
      proposedCodeTaskId: expect.stringMatching(/^task_/),
      leaseOwner: acquisition.proposedCodeTaskId,
      leaseDurationMs: 300_000,
      event: expect.objectContaining({
        organizationSlug: 'intexuraos',
        projectId: '100',
        issueId: '4509001',
      }),
    }));
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      id: acquisition.proposedCodeTaskId,
      userId: AUTOMATION_USER_ID,
      workerType: 'codex-xhigh',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      linearIssueId: 'INT-200',
      agentType: 'sentry',
      sentryIssue: expect.objectContaining({
        issueId: '4509001',
        title: 'TypeError: Cannot read properties of undefined',
      }),
    }));
    expect(mocks.taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: acquisition.proposedCodeTaskId,
      userId: AUTOMATION_USER_ID,
    });
    expect(mocks.sentryIssueEventRepo.completeReservation).toHaveBeenCalledWith({
      transitionKey: TRANSITION_KEY,
      issueKey: ISSUE_KEY,
      leaseToken: LEASE_TOKEN,
      codeTaskId: acquisition.proposedCodeTaskId,
      linearIssueId: 'INT-200',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).not.toHaveBeenCalled();
  });

  it('returns a duplicate without touching task dependencies', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        acquire: vi.fn().mockResolvedValue(ok({ kind: 'duplicate' })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
    });
    expect(mocks.codeTaskRepo.findById).not.toHaveBeenCalled();
    expect(mocks.workerSettingsRepo.getSettings).not.toHaveBeenCalled();
  });

  it('returns the known task id for a completed exact-transition duplicate', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        acquire: vi.fn().mockResolvedValue(ok({ kind: 'duplicate', codeTaskId: 'task_existing' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_existing',
    });
  });

  it('returns a retryable error while another delivery holds the lease without a task', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        acquire: vi.fn().mockResolvedValue(ok({ kind: 'retryable' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'retryable',
      message: 'Sentry issue processing is already in progress',
    });
    expect(mocks.codeTaskRepo.findById).not.toHaveBeenCalled();
    expect(mocks.workerSettingsRepo.getSettings).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('creates exactly one task when a delivery retries after the active lease expires', async () => {
    resetServices();
    const acquire = vi.fn()
      .mockResolvedValueOnce(ok({ kind: 'retryable' }))
      .mockResolvedValueOnce(ok({
        kind: 'acquired',
        transitionKey: TRANSITION_KEY,
        issueKey: ISSUE_KEY,
        leaseToken: LEASE_TOKEN,
        codeTaskId: 'task_after_expiry',
      }));
    mocks = installMocks({ sentryIssueEventRepo: { acquire } });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'retryable',
      message: 'Sentry issue processing is already in progress',
    });
    expect((await processSentryWebhook(buildInput())).ok).toBe(true);

    expect(mocks.codeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task_after_expiry',
    }));
    expect(mocks.taskEnqueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.sentryIssueEventRepo.completeReservation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['failed', createFakeTask({ id: 'task_linked', status: 'failed', agentType: 'sentry' })],
    ['cancelled', createFakeTask({ id: 'task_linked', status: 'cancelled', agentType: 'sentry' })],
    ['interrupted', createFakeTask({ id: 'task_linked', status: 'interrupted', agentType: 'sentry' })],
    ['implemented with a merged PR', createFakeTask({
      id: 'task_linked',
      status: 'implemented',
      agentType: 'sentry',
      prNumber: 123,
      prMergedAt: Timestamp.fromDate(new Date('2026-07-29T01:00:00.000Z')),
    })],
  ])('keeps the issue-level task tombstone when the linked task is %s', async (_label, linkedTask) => {
    resetServices();
    const acquire = vi.fn().mockResolvedValue(inspectResult('task_linked'));
    const findById = vi.fn().mockResolvedValue(ok(linkedTask));
    mocks = installMocks({ sentryIssueEventRepo: { acquire }, codeTaskRepo: { findById } });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_linked',
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(findById).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('recovers a task created before reservation completion without creating another', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        acquire: vi.fn().mockResolvedValue(ok({
          kind: 'acquired',
          transitionKey: TRANSITION_KEY,
          issueKey: ISSUE_KEY,
          leaseToken: LEASE_TOKEN,
          codeTaskId: 'task_proposed',
        })),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_proposed',
          status: 'queued',
          agentType: 'sentry',
          linearIssueId: 'INT-200',
        }))),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'processed',
      message: 'Sentry issue code task created',
      codeTaskId: 'task_proposed',
    });
    expect(mocks.linearIssueService.ensureIssueExists).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(mocks.taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: 'task_proposed',
      userId: AUTOMATION_USER_ID,
    });
  });

  it('fails the lease when re-enqueueing a recovered queued task fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        acquire: vi.fn().mockResolvedValue(ok({
          kind: 'acquired',
          transitionKey: TRANSITION_KEY,
          issueKey: ISSUE_KEY,
          leaseToken: LEASE_TOKEN,
          codeTaskId: 'task_proposed',
        })),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_proposed',
          status: 'queued',
          agentType: 'sentry',
          linearIssueId: 'INT-200',
        }))),
      },
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(err({ code: 'QUEUE_ERROR', message: 're-enqueue failed' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 're-enqueue failed',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 're-enqueue failed',
      codeTaskId: 'task_proposed',
      linearIssueId: 'INT-200',
    }));
    expect(mocks.sentryIssueEventRepo.completeReservation).not.toHaveBeenCalled();
  });

  it('completes a recovered task already beyond the queue without enqueueing it again', async () => {
    resetServices();
    mocks = installMocks({
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_running',
          status: 'running',
          agentType: 'sentry',
        }))),
      },
      sentryIssueEventRepo: {
        acquire: vi.fn().mockResolvedValue(ok({
          kind: 'acquired',
          transitionKey: TRANSITION_KEY,
          issueKey: ISSUE_KEY,
          leaseToken: LEASE_TOKEN,
          codeTaskId: 'task_running',
        })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result.ok && result.outcome).toBe('processed');
    expect(mocks.taskEnqueueService.enqueue).not.toHaveBeenCalled();
    expect(mocks.sentryIssueEventRepo.completeReservation).toHaveBeenCalledWith(expect.objectContaining({
      codeTaskId: 'task_running',
    }));
  });

  it('fails the lease when the proposed task lookup fails', async () => {
    resetServices();
    mocks = installMocks({
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'task lookup failed' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'task lookup failed',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'task lookup failed',
    }));
  });

  it('retains idempotent task creation when the same proposed id wins the create race', async () => {
    resetServices();
    const findById = vi.fn()
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'not created yet' }))
      .mockImplementationOnce(async (taskId: string) => ok(createFakeTask({
        id: taskId,
        status: 'queued',
        agentType: 'sentry',
        linearIssueId: 'INT-200',
      })));
    const create = vi.fn().mockImplementation(async (input: { id: string }) => err({
      code: 'DUPLICATE_PROMPT',
      message: 'already created',
      existingTaskId: input.id,
    }));
    mocks = installMocks({ codeTaskRepo: { findById, create } });

    const result = await processSentryWebhook(buildInput());

    expect(result.ok && result.outcome).toBe('processed');
    expect(mocks.taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: expect.stringMatching(/^task_/),
      userId: AUTOMATION_USER_ID,
    });
    expect(mocks.sentryIssueEventRepo.completeReservation).toHaveBeenCalledTimes(1);
  });

  it('fails the lease when an idempotent create race cannot recover the task', async () => {
    resetServices();
    const findById = vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'task not found' }));
    const create = vi.fn().mockImplementation(async (input: { id: string }) => err({
      code: 'DUPLICATE_PROMPT',
      message: 'already created',
      existingTaskId: input.id,
    }));
    mocks = installMocks({ codeTaskRepo: { findById, create } });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'already created',
    });
    expect(findById).toHaveBeenCalledTimes(2);
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'already created',
      linearIssueId: 'INT-200',
    }));
  });

  it('completes an idempotently recovered non-queued task without enqueueing it', async () => {
    resetServices();
    const findById = vi.fn()
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'not created yet' }))
      .mockImplementationOnce(async (taskId: string) => ok(createFakeTask({
        id: taskId,
        status: 'running',
        agentType: 'sentry',
        linearIssueId: 'INT-200',
      })));
    const create = vi.fn().mockImplementation(async (input: { id: string }) => err({
      code: 'ACTIVE_TASK_EXISTS',
      message: 'already active',
      existingTaskId: input.id,
    }));
    mocks = installMocks({ codeTaskRepo: { findById, create } });

    const result = await processSentryWebhook(buildInput());

    expect(result.ok && result.outcome).toBe('processed');
    expect(mocks.taskEnqueueService.enqueue).not.toHaveBeenCalled();
    expect(mocks.sentryIssueEventRepo.completeReservation).toHaveBeenCalledWith(expect.objectContaining({
      codeTaskId: expect.stringMatching(/^task_/),
    }));
  });

  it('fails the lease when enqueueing an idempotently recovered queued task fails', async () => {
    resetServices();
    const findById = vi.fn()
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'not created yet' }))
      .mockImplementationOnce(async (taskId: string) => ok(createFakeTask({
        id: taskId,
        status: 'queued',
        agentType: 'sentry',
        linearIssueId: 'INT-200',
      })));
    const create = vi.fn().mockImplementation(async (input: { id: string }) => err({
      code: 'DUPLICATE_PROMPT',
      message: 'already created',
      existingTaskId: input.id,
    }));
    mocks = installMocks({
      codeTaskRepo: { findById, create },
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(err({ code: 'QUEUE_ERROR', message: 'retry enqueue failed' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'retry enqueue failed',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'retry enqueue failed',
      codeTaskId: expect.stringMatching(/^task_/),
      linearIssueId: 'INT-200',
    }));
    expect(mocks.sentryIssueEventRepo.completeReservation).not.toHaveBeenCalled();
  });

  it.each([
    ['Failed to record task completion metric'],
    ['Dispatch failed for fallback decision'],
  ])('ignores Sentry automation self-alert %s before acquisition', async (title) => {
    const body = buildIssueBody();
    (body['data'] as { issue: { title: string } }).issue.title = title;

    expect(await processSentryWebhook(buildInput({ body }))).toEqual({
      ok: true,
      outcome: 'ignored',
      message: `Ignored Sentry automation self-alert: ${title}`,
    });
    expect(mocks.sentryIssueEventRepo.acquire).not.toHaveBeenCalled();
  });

  it.each([
    ['resolved'], ['ignored'], ['muted'], ['assigned'], ['unassigned'], ['archived'], ['deleted'], ['unknown'],
  ])('ignores non-actionable issue.%s before acquisition', async (action) => {
    const body = buildIssueBody();
    body['action'] = action;

    expect(await processSentryWebhook(buildInput({ body }))).toEqual({
      ok: true,
      outcome: 'ignored',
      message: `Ignored non-actionable Sentry issue event: issue.${action}`,
    });
    expect(mocks.sentryIssueEventRepo.acquire).not.toHaveBeenCalled();
  });

  it('normalizes a blank issue action to unknown before classification', async () => {
    const result = await processSentryWebhook(buildInput({
      parseIssueEvent: () => ok({
        resource: 'issue',
        action: '   ',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-development',
        projectId: '100',
        issueId: '4509001',
        issueShortId: 'INTEXURAOS-DEVELOPMENT-7',
        issueTitle: 'TypeError',
        issueUrl:
          'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/4509001/',
        status: 'unresolved',
        eventId: undefined,
      }),
    }));

    expect(result).toEqual({
      ok: true,
      outcome: 'ignored',
      message: 'Ignored non-actionable Sentry issue event: issue.unknown',
    });
  });

  it('processes issue.unresolved as reopen semantics', async () => {
    const body = buildIssueBody();
    body['action'] = 'unresolved';

    const result = await processSentryWebhook(buildInput({ body }));

    expect(result.ok && result.outcome).toBe('processed');
    expect(mocks.sentryIssueEventRepo.acquire).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ resource: 'issue', action: 'unresolved', issueId: '4509001' }),
    }));
  });

  it('processes event_alert.triggered and carries its event id into the task', async () => {
    const result = await processSentryWebhook(buildInput({
      body: buildEventAlertBody(),
      resourceHeader: 'event_alert',
    }));

    expect(result.ok && result.outcome).toBe('processed');
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('SentryBox reported an actionable IntexuraOS issue.'),
      sentryIssue: expect.objectContaining({ eventId: 'event-4509002', issueId: '4509002' }),
    }));
    const prompt = mocks.codeTaskRepo.create.mock.calls[0]?.[0]?.prompt;
    expect(prompt).toContain('SentryBox issue: Error: fetch failed');
    expect(prompt).toContain('SentryBox URL:');
    expect(prompt).toContain('Event ID: event-4509002');
    expect(prompt).toContain('Fetch current SentryBox issue details and recent events');
  });

  it('ignores terminal event_alert.triggered deliveries before acquisition', async () => {
    expect(await processSentryWebhook(buildInput({
      body: buildResolvedEventAlertBody(),
      resourceHeader: 'event_alert',
    }))).toEqual({
      ok: true,
      outcome: 'ignored',
      message: 'Ignored non-actionable Sentry issue event: event_alert.triggered',
    });
    expect(mocks.sentryIssueEventRepo.acquire).not.toHaveBeenCalled();
  });

  it('ignores non-triggered event alerts before acquisition', async () => {
    const body = buildEventAlertBody();
    body['action'] = 'resolved';

    expect(await processSentryWebhook(buildInput({ body, resourceHeader: 'event_alert' }))).toEqual({
      ok: true,
      outcome: 'ignored',
      message: 'Ignored non-actionable Sentry issue event: event_alert.resolved',
    });
  });

  it('ignores Sentry sample event alerts before acquisition', async () => {
    expect(await processSentryWebhook(buildInput({
      body: buildSampleEventAlertBody(),
      resourceHeader: 'event_alert',
    }))).toEqual({
      ok: true,
      outcome: 'ignored',
      message: 'Ignored Sentry sample event_alert delivery',
    });
  });

  it('ignores unsupported resources before acquisition', async () => {
    expect(await processSentryWebhook(buildInput({ resourceHeader: 'metric_alert' }))).toEqual({
      ok: true,
      outcome: 'ignored',
      message: "Unsupported Sentry webhook resource 'metric_alert'",
    });
    expect(mocks.sentryIssueEventRepo.acquire).not.toHaveBeenCalled();
  });

  it('returns invalid_payload for a malformed supported payload', async () => {
    expect(await processSentryWebhook(buildInput({ body: { action: 'created' } }))).toEqual({
      ok: false,
      reason: 'invalid_payload',
      message: 'Sentry webhook payload did not include an issue id or issue URL',
    });
    expect(mocks.sentryIssueEventRepo.acquire).not.toHaveBeenCalled();
  });

  it('returns internal_error when the reservation repository is not configured', async () => {
    resetServices();
    setServices({ logger: createMockLogger() } as unknown as ServiceContainer);

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Sentry issue event repository is not configured',
    });
  });

  it('returns internal_error when atomic acquisition fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        acquire: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'reserve failed' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'reserve failed',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).not.toHaveBeenCalled();
  });

  it('fails the lease when worker settings cannot be loaded', async () => {
    resetServices();
    mocks = installMocks({
      workerSettingsRepo: {
        getSettings: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'settings failed' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'settings failed',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith({
      transitionKey: TRANSITION_KEY,
      issueKey: ISSUE_KEY,
      leaseToken: LEASE_TOKEN,
      reason: 'settings failed',
    });
  });

  it.each([
    ['disabled workers', ok({
      userId: AUTOMATION_USER_ID,
      workers: [{ name: 'home-mac', enabled: false }],
    })],
    ['missing settings', ok(undefined)],
  ])('fails the lease for %s', async (_label, settingsResult) => {
    resetServices();
    mocks = installMocks({
      workerSettingsRepo: { getSettings: vi.fn().mockResolvedValue(settingsResult) },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Sentry automation user has no enabled workers',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'Sentry automation user has no enabled workers',
    }));
  });

  it('fails the lease when prompt injection sanitization rejects the payload', async () => {
    const body = buildIssueBody();
    (body['data'] as { issue: { title: string } }).issue.title = 'A'.repeat(3000);

    expect(await processSentryWebhook(buildInput({ body }))).toEqual({
      ok: false,
      reason: 'invalid_payload',
      message: 'Prompt contains a base64 blob and was rejected',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'Prompt contains a base64 blob and was rejected',
    }));
  });

  it.each([
    ['fallback', { linearFallback: true, linearFallbackError: 'linear unavailable' }, 'linear unavailable'],
    ['missing id', { linearFallback: false }, 'Failed to create or link Linear issue for Sentry issue'],
  ])('fails the lease when Linear linking returns %s', async (_label, linearResult, message) => {
    resetServices();
    mocks = installMocks({
      linearIssueService: { ensureIssueExists: vi.fn().mockResolvedValue(linearResult) },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message,
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({ reason: message }));
  });

  it('fails the lease without a task linkage when task creation fails', async () => {
    resetServices();
    mocks = installMocks({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'create failed' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'create failed',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith({
      transitionKey: TRANSITION_KEY,
      issueKey: ISSUE_KEY,
      leaseToken: LEASE_TOKEN,
      reason: 'create failed',
      linearIssueId: 'INT-200',
    });
  });

  it('checkpoints Linear and reuses it with the same proposed task id after task creation fails', async () => {
    resetServices();
    const acquire = vi.fn()
      .mockResolvedValueOnce(ok({
        kind: 'acquired',
        transitionKey: TRANSITION_KEY,
        issueKey: ISSUE_KEY,
        leaseToken: 'lease-1',
        codeTaskId: 'task_stable',
      }))
      .mockResolvedValueOnce(ok({
        kind: 'acquired',
        transitionKey: TRANSITION_KEY,
        issueKey: ISSUE_KEY,
        leaseToken: 'lease-2',
        codeTaskId: 'task_stable',
        linearIssueId: 'INT-200',
      }));
    let linearCreates = 0;
    const ensureIssueExists = vi.fn().mockImplementation(async (params: {
      linearIssueId?: string;
    }) => {
      if (params.linearIssueId === undefined) linearCreates += 1;
      return {
        linearIssueId: 'INT-200',
        linearIssueTitle: '[sentry] TypeError',
        linearFallback: false,
        linearIssueLabels: ['bug', 'sentry'],
        hasChildren: false,
      };
    });
    const create = vi.fn()
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'create failed' }))
      .mockImplementationOnce(async (input: Record<string, unknown>) => ok({
        ...input,
        id: input['id'],
        status: 'queued',
      }));
    mocks = installMocks({
      sentryIssueEventRepo: { acquire },
      linearIssueService: { ensureIssueExists },
      codeTaskRepo: { create },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'create failed',
    });
    expect((await processSentryWebhook(buildInput())).ok).toBe(true);

    expect(linearCreates).toBe(1);
    expect(ensureIssueExists).toHaveBeenNthCalledWith(2, expect.objectContaining({
      linearIssueId: 'INT-200',
    }));
    expect(mocks.sentryIssueEventRepo.checkpointLinearIssue).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map((call) => call[0]?.id)).toEqual(['task_stable', 'task_stable']);
  });

  it('uses the transition key to recover a Linear issue after a crash before checkpoint', async () => {
    resetServices();
    const acquire = vi.fn().mockResolvedValue(ok({
      kind: 'acquired',
      transitionKey: TRANSITION_KEY,
      issueKey: ISSUE_KEY,
      leaseToken: LEASE_TOKEN,
      codeTaskId: 'task_stable',
    }));
    const remoteIssues = new Map<string, string>();
    let crashAfterLinearResponse = true;
    const ensureIssueExists = vi.fn().mockImplementation(async (params: {
      idempotencyKey?: string;
    }) => {
      const key = params.idempotencyKey ?? 'missing-key';
      if (!remoteIssues.has(key)) remoteIssues.set(key, 'INT-200');
      const response = {
        linearIssueId: remoteIssues.get(key),
        linearIssueTitle: '[sentry] TypeError',
        linearFallback: false,
        linearIssueLabels: ['bug', 'sentry'],
        hasChildren: false,
      };
      if (crashAfterLinearResponse) {
        crashAfterLinearResponse = false;
        throw new Error('crash after Linear response');
      }
      return response;
    });
    mocks = installMocks({
      sentryIssueEventRepo: { acquire },
      linearIssueService: { ensureIssueExists },
    });

    await expect(processSentryWebhook(buildInput())).rejects.toThrow('crash after Linear response');
    expect((await processSentryWebhook(buildInput())).ok).toBe(true);

    expect(ensureIssueExists).toHaveBeenNthCalledWith(1, expect.objectContaining({
      idempotencyKey: TRANSITION_KEY,
    }));
    expect(ensureIssueExists).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idempotencyKey: TRANSITION_KEY,
    }));
    expect(remoteIssues.size).toBe(1);
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task_stable',
      linearIssueId: 'INT-200',
    }));
  });

  it('fails the lease when the Linear checkpoint cannot be persisted', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        checkpointLinearIssue: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'checkpoint failed',
        })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'checkpoint failed',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'checkpoint failed',
      linearIssueId: 'INT-200',
    }));
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('records the known task id when enqueueing fails', async () => {
    resetServices();
    mocks = installMocks({
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(err({ code: 'QUEUE_ERROR', message: 'enqueue failed' })),
      },
    });

    const result = await processSentryWebhook(buildInput());
    const createdTaskId = mocks.codeTaskRepo.create.mock.calls[0]?.[0]?.id as string | undefined;

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'enqueue failed' });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith({
      transitionKey: TRANSITION_KEY,
      issueKey: ISSUE_KEY,
      leaseToken: LEASE_TOKEN,
      reason: 'enqueue failed',
      codeTaskId: createdTaskId,
      linearIssueId: 'INT-200',
    });
  });

  it('attempts to fail a known task reservation when completion fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        completeReservation: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR', message: 'complete failed',
        })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'complete failed',
    });
    expect(mocks.sentryIssueEventRepo.failReservation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'complete failed',
      codeTaskId: expect.stringMatching(/^task_/),
      linearIssueId: 'INT-200',
    }));
  });

  it('surfaces failure to release the lease', async () => {
    resetServices();
    mocks = installMocks({
      workerSettingsRepo: {
        getSettings: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'settings failed' })),
      },
      sentryIssueEventRepo: {
        failReservation: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'release failed' })),
      },
    });

    expect(await processSentryWebhook(buildInput())).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'release failed',
    });
  });
});
