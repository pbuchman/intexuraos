/**
 * Unit tests for processing Sentry webhook deliveries into code tasks.
 */

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import { processSentryWebhook, type ProcessSentryWebhookInput } from '../../domain/usecases/processSentryWebhook.js';
import { verifySentrySignature } from '../../infra/sentry-webhook-auth.js';
import { parseSentryIssueEvent } from '../../infra/sentry-event-parser.js';
import { createMockLogger } from '../helpers/mockLogger.js';
import { createFakeTask } from '../helpers/mockFirestore.js';

const WEBHOOK_SECRET = 'sentry-webhook-secret';
const ORCHESTRATOR_SECRET = 'orchestrator-secret';
const AUTOMATION_USER_ID = 'sentry-automation-user';

function buildIssueBody(): Record<string, unknown> {
  return {
    action: 'created',
    data: {
      issue: {
        id: '4509001',
        shortId: 'INTEXURAOS-DEVELOPMENT-7',
        title: 'TypeError: Cannot read properties of undefined',
        permalink: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
        status: 'unresolved',
        project: {
          id: '100',
          slug: 'intexuraos-development',
        },
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
        web_url: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509002/events/event-4509002/',
        issue: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509002/',
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
          url: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509003/',
          project: {
            slug: 'intexuraos-web-development',
          },
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
        web_url: 'https://sentry.io/organizations/intexuraos/issues/1117540176/events/sample-event/',
        issue_url: 'https://sentry.io/api/0/issues/1117540176/',
        issue_id: '1117540176',
      },
    },
  };
}

function signBody(body: unknown): { rawBody: Buffer; signatureHeader: string } {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf-8');
  const signatureHeader = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return { rawBody, signatureHeader };
}

interface MocksShape {
  sentryIssueEventRepo: {
    reserve: ReturnType<typeof vi.fn>;
    reserveTaskForProblem: ReturnType<typeof vi.fn>;
    markCodeTaskCreated: ReturnType<typeof vi.fn>;
  };
  workerSettingsRepo: { getSettings: ReturnType<typeof vi.fn> };
  linearIssueService: { ensureIssueExists: ReturnType<typeof vi.fn> };
  codeTaskRepo: { create: ReturnType<typeof vi.fn>; findById?: ReturnType<typeof vi.fn> };
  taskEnqueueService: { enqueue: ReturnType<typeof vi.fn> };
}

function installMocks(overrides: Partial<MocksShape> = {}): MocksShape {
  const sentryIssueEventRepo = overrides.sentryIssueEventRepo ?? {
    reserve: vi.fn().mockResolvedValue(ok({
      created: true,
      record: {
        dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-development',
        issueId: '4509001',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
        issueTitle: 'TypeError: Cannot read properties of undefined',
        action: 'created',
        resource: 'issue',
        receivedAt: new Date('2026-06-28T10:00:00.000Z'),
        latestReceivedAt: new Date('2026-06-28T10:00:00.000Z'),
        duplicateCount: 0,
      },
    })),
    reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
      created: true,
      record: {
        dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-development',
        issueId: '4509001',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
        issueTitle: 'TypeError: Cannot read properties of undefined',
        action: 'created',
        resource: 'issue',
        receivedAt: new Date('2026-06-28T10:00:00.000Z'),
        latestReceivedAt: new Date('2026-06-28T10:00:00.000Z'),
        duplicateCount: 0,
      },
    })),
    markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
  };
  const workerSettingsRepo = overrides.workerSettingsRepo ?? {
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
  };
  const linearIssueService = overrides.linearIssueService ?? {
    ensureIssueExists: vi.fn().mockResolvedValue({
      linearIssueId: 'INT-200',
      linearIssueTitle: '[sentry] TypeError: Cannot read properties of undefined',
      linearIssueLabels: ['bug', 'sentry'],
      linearFallback: false,
      hasChildren: false,
      linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-200',
    }),
  };
  const codeTaskRepo = overrides.codeTaskRepo ?? {
    findById: vi.fn().mockResolvedValue(ok(createFakeTask({
      id: 'task_existing',
      status: 'queued',
      agentType: 'sentry',
    }))),
    create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
      id: input['id'],
      ...input,
      status: 'queued',
    })),
  };
  const taskEnqueueService = overrides.taskEnqueueService ?? {
    enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'task_sentry', queuePosition: 1 })),
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

describe('processSentryWebhook', () => {
  let mocks: MocksShape;

  beforeEach(() => {
    mocks = installMocks();
  });

  afterEach(() => {
    resetServices();
  });

  it('rejects invalid signatures before persisting or creating tasks', async () => {
    const result = await processSentryWebhook(buildInput({ signatureHeader: 'a'.repeat(64) }));

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_signature',
      message: 'Invalid Sentry webhook signature',
    });
    expect(mocks.sentryIssueEventRepo.reserve).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('creates exactly one queued sentry code task for an accepted issue webhook', async () => {
    const result = await processSentryWebhook(buildInput());

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'processed') {
      throw new Error('Expected Sentry webhook to be processed');
    }
    expect(result.codeTaskId).toMatch(/^task_/);

    expect(mocks.sentryIssueEventRepo.reserve).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        resource: 'issue',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-development',
        issueId: '4509001',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
        issueTitle: 'TypeError: Cannot read properties of undefined',
      }),
    }));
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        resource: 'issue',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-development',
        issueId: '4509001',
        issueTitle: 'TypeError: Cannot read properties of undefined',
      }),
    }));
    expect(mocks.linearIssueService.ensureIssueExists).toHaveBeenCalledWith({
      userId: AUTOMATION_USER_ID,
      taskPrompt: expect.stringContaining('https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/'),
    });
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: AUTOMATION_USER_ID,
      workerType: 'codex-xhigh',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      linearIssueId: 'INT-200',
      agentType: 'sentry',
      sentryIssue: expect.objectContaining({
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-development',
        issueId: '4509001',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
        title: 'TypeError: Cannot read properties of undefined',
      }),
    }));
    expect(mocks.taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: expect.stringMatching(/^task_/),
      userId: AUTOMATION_USER_ID,
    });
    expect(mocks.sentryIssueEventRepo.markCodeTaskCreated).toHaveBeenNthCalledWith(1, {
      dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
      codeTaskId: expect.stringMatching(/^task_/),
      linearIssueId: 'INT-200',
    });
    expect(mocks.sentryIssueEventRepo.markCodeTaskCreated).toHaveBeenNthCalledWith(2, {
      dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
      codeTaskId: expect.stringMatching(/^task_/),
      linearIssueId: 'INT-200',
    });
  });

  it('does not create a second task when the Sentry issue was already reserved', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_existing',
            linearIssueId: 'INT-200',
          },
        })),
        reserveTaskForProblem: vi.fn(),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_existing',
    });
    expect(mocks.linearIssueService.ensureIssueExists).not.toHaveBeenCalled();
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(mocks.taskEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it('does not create a second task when the issue reservation points to a finished Sentry task with an open PR', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_completed_open_pr',
            linearIssueId: 'INT-200',
          },
        })),
        reserveTaskForProblem: vi.fn(),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_completed_open_pr',
          status: 'implemented',
          agentType: 'sentry',
          result: {
            sentry_outcome: 'fixed',
            prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
          },
        }))),
        create: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_completed_open_pr',
    });
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('does not create a second task when the issue reservation points to an implemented task with an open PR number', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_implemented_open_pr',
            linearIssueId: 'INT-200',
          },
        })),
        reserveTaskForProblem: vi.fn(),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_implemented_open_pr',
          status: 'implemented',
          agentType: 'sentry',
          prNumber: 123,
        }))),
        create: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_implemented_open_pr',
    });
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('does not create a second task when a prior task has a Sentry outcome and open PR URL', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_sentry_outcome_open_pr_url',
            linearIssueId: 'INT-200',
          },
        })),
        reserveTaskForProblem: vi.fn(),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_sentry_outcome_open_pr_url',
          status: 'reviewed',
          agentType: 'review',
          result: {
            sentry_outcome: 'fixed',
            prUrl: 'https://github.com/pbuchman/intexuraos/pull/456',
          },
        }))),
        create: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_sentry_outcome_open_pr_url',
    });
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('does not create a second task when an implemented task has an open PR URL', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_implemented_open_pr_url',
            linearIssueId: 'INT-200',
          },
        })),
        reserveTaskForProblem: vi.fn(),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_implemented_open_pr_url',
          status: 'implemented',
          agentType: 'execution',
          result: {
            prUrl: 'https://github.com/pbuchman/intexuraos/pull/789',
          },
        }))),
        create: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_implemented_open_pr_url',
    });
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('creates a new task when the existing issue reservation points to an archived Sentry task without completion evidence', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_archived_duplicate',
            linearIssueId: 'INT-1775',
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            duplicateCount: 0,
          },
        })),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_archived_duplicate',
          status: 'archived',
          agentType: 'sentry',
        }))),
        create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
          id: input['id'],
          ...input,
          status: 'queued',
        })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'processed') {
      throw new Error('Expected stale Sentry reservation to create a new task');
    }
    expect(mocks.codeTaskRepo.findById).toHaveBeenCalledWith('task_archived_duplicate');
    expect(mocks.linearIssueService.ensureIssueExists).toHaveBeenCalledTimes(1);
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).toHaveBeenCalledTimes(1);
    expect(mocks.sentryIssueEventRepo.markCodeTaskCreated).toHaveBeenNthCalledWith(1, {
      dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
      codeTaskId: result.codeTaskId,
      linearIssueId: 'INT-200',
    });
  });

  it('does not create a second task when the existing issue reservation points to a merged Sentry PR', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_merged_duplicate',
            linearIssueId: 'INT-1775',
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            duplicateCount: 0,
          },
        })),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_merged_duplicate',
          status: 'implemented',
          agentType: 'sentry',
          prNumber: 123,
          prMergedAt: Timestamp.fromDate(new Date('2026-06-29T02:00:00Z')),
        }))),
        create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
          id: input['id'],
          ...input,
          status: 'queued',
        })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_merged_duplicate',
    });
    expect(mocks.codeTaskRepo.findById).toHaveBeenCalledWith('task_merged_duplicate');
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(mocks.taskEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it('does not create a second task when the existing Sentry reservation has only a merged PR URL', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_merged_pr_url_duplicate',
            linearIssueId: 'INT-1775',
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            duplicateCount: 0,
          },
        })),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_merged_pr_url_duplicate',
          status: 'implemented',
          agentType: 'sentry',
          result: {
            prUrl: 'https://github.com/pbuchman/intexuraos/pull/321',
          },
          prMergedAt: Timestamp.fromDate(new Date('2026-06-29T02:00:00Z')),
        }))),
        create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
          id: input['id'],
          ...input,
          status: 'queued',
        })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      codeTaskId: 'task_merged_pr_url_duplicate',
    });
    expect(mocks.codeTaskRepo.findById).toHaveBeenCalledWith('task_merged_pr_url_duplicate');
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(mocks.taskEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it('creates a new task when the existing issue reservation points to a missing task', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_missing',
            linearIssueId: 'INT-1775',
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            duplicateCount: 0,
          },
        })),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'task missing' })),
        create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
          id: input['id'],
          ...input,
          status: 'queued',
        })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'processed') {
      throw new Error('Expected missing linked Sentry task to create a replacement');
    }
    expect(mocks.codeTaskRepo.findById).toHaveBeenCalledWith('task_missing');
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledTimes(1);
  });

  it('returns internal_error when duplicate reservation task lookup fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            codeTaskId: 'task_lookup_error',
            linearIssueId: 'INT-1775',
          },
        })),
        reserveTaskForProblem: vi.fn(),
        markCodeTaskCreated: vi.fn(),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'lookup failed' })),
        create: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'lookup failed' });
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('does not create a task when the same Sentry problem already has a task for another issue id', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509002:issue:created',
            duplicateCount: 0,
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            codeTaskId: 'task_existing_problem',
            linearIssueId: 'INT-200',
          },
        })),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry problem already has a code task',
      codeTaskId: 'task_existing_problem',
    });
    expect(mocks.linearIssueService.ensureIssueExists).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(mocks.taskEnqueueService.enqueue).not.toHaveBeenCalled();
    expect(mocks.sentryIssueEventRepo.markCodeTaskCreated).not.toHaveBeenCalled();
  });

  it('creates a new task when the same Sentry problem reservation points to an archived task without completion evidence', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509002:issue:created',
            duplicateCount: 0,
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            codeTaskId: 'task_archived_problem_duplicate',
            linearIssueId: 'INT-1775',
          },
        })),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok(createFakeTask({
          id: 'task_archived_problem_duplicate',
          status: 'archived',
          agentType: 'sentry',
        }))),
        create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
          id: input['id'],
          ...input,
          status: 'queued',
        })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'processed') {
      throw new Error('Expected stale Sentry problem reservation to create a new task');
    }
    expect(mocks.codeTaskRepo.findById).toHaveBeenCalledWith('task_archived_problem_duplicate');
    expect(mocks.linearIssueService.ensureIssueExists).toHaveBeenCalledTimes(1);
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(mocks.sentryIssueEventRepo.markCodeTaskCreated).toHaveBeenNthCalledWith(2, {
      dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
      codeTaskId: result.codeTaskId,
      linearIssueId: 'INT-200',
    });
  });

  it('returns internal_error when problem reservation task lookup fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509002:issue:created',
            duplicateCount: 0,
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            codeTaskId: 'task_problem_lookup_error',
            linearIssueId: 'INT-1775',
          },
        })),
        markCodeTaskCreated: vi.fn(),
      },
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'problem lookup failed' })),
        create: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'problem lookup failed' });
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(mocks.sentryIssueEventRepo.markCodeTaskCreated).not.toHaveBeenCalled();
  });

  it('returns internal_error when reserving the Sentry problem task fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            duplicateCount: 0,
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'problem reserve failed',
        })),
        markCodeTaskCreated: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'problem reserve failed' });
    expect(mocks.linearIssueService.ensureIssueExists).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(mocks.taskEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['Failed to record task completion metric'],
    ['Dispatch failed for fallback decision'],
  ])('ignores Sentry automation self-alert %s before reservation', async (title) => {
    const body = buildIssueBody();
    const data = body['data'] as { issue: { title: string } };
    data.issue.title = title;

    const result = await processSentryWebhook(buildInput({ body }));

    expect(result).toEqual({
      ok: true,
      outcome: 'ignored',
      message: `Ignored Sentry automation self-alert: ${title}`,
    });
    expect(mocks.sentryIssueEventRepo.reserve).not.toHaveBeenCalled();
    expect(mocks.sentryIssueEventRepo.reserveTaskForProblem).not.toHaveBeenCalled();
    expect(mocks.linearIssueService.ensureIssueExists).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it.each([
    ['resolved'],
    ['ignored'],
    ['muted'],
    ['assigned'],
    ['unassigned'],
    ['archived'],
    ['deleted'],
    ['unknown'],
  ])('ignores non-actionable issue.%s deliveries without reserving dedupe state', async (action) => {
    const body = buildIssueBody();
    body['action'] = action;

    const result = await processSentryWebhook(buildInput({ body }));

    expect(result).toEqual({
      ok: true,
      outcome: 'ignored',
      message: `Ignored non-actionable Sentry issue event: issue.${action}`,
    });
    expect(mocks.sentryIssueEventRepo.reserve).not.toHaveBeenCalled();
    expect(mocks.linearIssueService.ensureIssueExists).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('ignores normalized issue deliveries with blank actions as unknown without reserving dedupe state', async () => {
    const result = await processSentryWebhook(buildInput({
      parseIssueEvent: () => ok({
        resource: 'issue',
        action: '   ',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-development',
        projectId: '100',
        issueId: '4509001',
        issueShortId: 'INTEXURAOS-DEVELOPMENT-7',
        issueTitle: 'TypeError: Cannot read properties of undefined',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
        status: 'unresolved',
        eventId: undefined,
      }),
    }));

    expect(result).toEqual({
      ok: true,
      outcome: 'ignored',
      message: 'Ignored non-actionable Sentry issue event: issue.unknown',
    });
    expect(mocks.sentryIssueEventRepo.reserve).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('creates a task for issue.unresolved as Sentry reopen semantics', async () => {
    const body = buildIssueBody();
    body['action'] = 'unresolved';

    const result = await processSentryWebhook(buildInput({ body }));

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'processed') {
      throw new Error('Expected Sentry issue.unresolved webhook to be processed');
    }
    expect(mocks.sentryIssueEventRepo.reserve).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        resource: 'issue',
        action: 'unresolved',
        issueId: '4509001',
      }),
    }));
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledTimes(1);
  });

  it('creates a queued task for event_alert webhooks and carries the event id', async () => {
    const result = await processSentryWebhook(buildInput({
      body: buildEventAlertBody(),
      resourceHeader: 'event_alert',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'processed') {
      throw new Error('Expected Sentry event_alert webhook to be processed');
    }
    expect(mocks.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Event ID: event-4509002'),
      sentryIssue: expect.objectContaining({
        projectSlug: 'intexuraos-web-development',
        issueId: '4509002',
        eventId: 'event-4509002',
      }),
    }));
  });

  it('ignores event_alert.triggered deliveries for terminal Sentry issues before reservation', async () => {
    const result = await processSentryWebhook(buildInput({
      body: buildResolvedEventAlertBody(),
      resourceHeader: 'event_alert',
    }));

    expect(result).toEqual({
      ok: true,
      outcome: 'ignored',
      message: 'Ignored non-actionable Sentry issue event: event_alert.triggered',
    });
    expect(mocks.sentryIssueEventRepo.reserve).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('ignores event_alert deliveries that are not triggered actions before reservation', async () => {
    const body = buildEventAlertBody();
    body['action'] = 'resolved';

    const result = await processSentryWebhook(buildInput({
      body,
      resourceHeader: 'event_alert',
    }));

    expect(result).toEqual({
      ok: true,
      outcome: 'ignored',
      message: 'Ignored non-actionable Sentry issue event: event_alert.resolved',
    });
    expect(mocks.sentryIssueEventRepo.reserve).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('ignores Sentry event_alert sample deliveries before reservation', async () => {
    const result = await processSentryWebhook(buildInput({
      body: buildSampleEventAlertBody(),
      resourceHeader: 'event_alert',
    }));

    expect(result).toEqual({
      ok: true,
      outcome: 'ignored',
      message: 'Ignored Sentry sample event_alert delivery',
    });
    expect(mocks.sentryIssueEventRepo.reserve).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('ignores unsupported Sentry webhook resources without reserving an event', async () => {
    const result = await processSentryWebhook(buildInput({ resourceHeader: 'metric_alert' }));

    expect(result).toEqual({
      ok: true,
      outcome: 'ignored',
      message: "Unsupported Sentry webhook resource 'metric_alert'",
    });
    expect(mocks.sentryIssueEventRepo.reserve).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns internal_error when the Sentry issue event repository is not configured', async () => {
    resetServices();
    setServices({ logger: createMockLogger() } as unknown as ServiceContainer);

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Sentry issue event repository is not configured',
    });
  });

  it('returns internal_error when reserving the Sentry issue event fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'reserve failed' })),
        reserveTaskForProblem: vi.fn(),
        markCodeTaskCreated: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'reserve failed' });
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns duplicate without codeTaskId when duplicate audit has not been linked yet', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: false,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
          },
        })),
        reserveTaskForProblem: vi.fn(),
        markCodeTaskCreated: vi.fn(),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
    });
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns internal_error when worker settings cannot be loaded', async () => {
    resetServices();
    mocks = installMocks({
      workerSettingsRepo: {
        getSettings: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'settings failed' })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'settings failed' });
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns internal_error when the automation user has no enabled workers', async () => {
    resetServices();
    mocks = installMocks({
      workerSettingsRepo: {
        getSettings: vi.fn().mockResolvedValue(ok({
          userId: AUTOMATION_USER_ID,
          workers: [{
            name: 'home-mac',
            url: 'https://worker.intexuraos.cloud',
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'dispatch-secret',
            enabled: false,
          }],
        })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Sentry automation user has no enabled workers',
    });
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns internal_error when the automation user has no worker settings record', async () => {
    resetServices();
    mocks = installMocks({
      workerSettingsRepo: {
        getSettings: vi.fn().mockResolvedValue(ok(undefined)),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Sentry automation user has no enabled workers',
    });
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });


  it('rejects Sentry payloads that make the generated task prompt fail injection sanitization', async () => {
    const body = buildIssueBody();
    const data = body['data'] as { issue: { title: string } };
    data.issue.title = 'A'.repeat(3000);

    const result = await processSentryWebhook(buildInput({ body }));

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_payload',
      message: 'Prompt contains a base64 blob and was rejected',
    });
    expect(mocks.linearIssueService.ensureIssueExists).not.toHaveBeenCalled();
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns internal_error when Linear issue linking falls back', async () => {
    resetServices();
    mocks = installMocks({
      linearIssueService: {
        ensureIssueExists: vi.fn().mockResolvedValue({
          linearFallback: true,
          linearFallbackError: 'linear unavailable',
        }),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'linear unavailable' });
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns internal_error when Linear issue linking returns no issue id', async () => {
    resetServices();
    mocks = installMocks({
      linearIssueService: {
        ensureIssueExists: vi.fn().mockResolvedValue({
          linearFallback: false,
        }),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({
      ok: false,
      reason: 'internal_error',
      message: 'Failed to create or link Linear issue for Sentry issue',
    });
    expect(mocks.codeTaskRepo.create).not.toHaveBeenCalled();
  });


  it('returns internal_error when creating the Sentry code task fails', async () => {
    resetServices();
    mocks = installMocks({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'create failed' })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'create failed' });
    expect(mocks.taskEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it('returns internal_error when queueing the Sentry code task fails', async () => {
    resetServices();
    mocks = installMocks({
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(err({ code: 'QUEUE_ERROR', message: 'enqueue failed' })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'enqueue failed' });
    expect(mocks.sentryIssueEventRepo.markCodeTaskCreated).not.toHaveBeenCalled();
  });

  it('returns internal_error when linking the audit record to the code task fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            duplicateCount: 0,
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            duplicateCount: 0,
          },
        })),
        markCodeTaskCreated: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'link failed' })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'link failed' });
  });

  it('returns internal_error when linking the problem task record to the code task fails', async () => {
    resetServices();
    mocks = installMocks({
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
            duplicateCount: 0,
          },
        })),
        reserveTaskForProblem: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:task-problem',
            duplicateCount: 0,
          },
        })),
        markCodeTaskCreated: vi.fn()
          .mockResolvedValueOnce(ok(undefined))
          .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'problem link failed' })),
      },
    });

    const result = await processSentryWebhook(buildInput());

    expect(result).toEqual({ ok: false, reason: 'internal_error', message: 'problem link failed' });
    expect(mocks.sentryIssueEventRepo.markCodeTaskCreated).toHaveBeenCalledTimes(2);
  });
});
