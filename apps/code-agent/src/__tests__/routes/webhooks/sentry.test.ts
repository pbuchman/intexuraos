/**
 * Tests for POST /webhooks/sentry.
 */

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { err, ok } from '@intexuraos/common-core';
import pino from 'pino';
import { resetServices, setServices, type ServiceContainer } from '../../../services.js';
import { sentryWebhookRoute } from '../../../routes/webhooks/sentry.js';

const WEBHOOK_SECRET = 'sentry-webhook-secret';

function buildIssueBody(): Record<string, unknown> {
  return {
    action: 'created',
    data: {
      issue: {
        id: '4509001',
        title: 'TypeError: Cannot read properties of undefined',
        permalink: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
        project: {
          slug: 'intexuraos-development',
        },
      },
    },
  };
}

function sign(rawBody: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(rawBody, 'utf-8')).digest('hex');
}

describe('POST /webhooks/sentry', () => {
  let app: FastifyInstance;
  let codeTaskCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env['INTEXURAOS_SENTRY_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    process.env['INTEXURAOS_SENTRY_AUTOMATION_USER_ID'] = 'sentry-automation-user';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'orchestrator-secret';

    codeTaskCreate = vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
      id: input['id'],
      ...input,
    }));
    setServices({
      logger: pino({ level: 'silent' }),
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(ok({
          created: true,
          record: {
            dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001',
            duplicateCount: 0,
          },
        })),
        markCodeTaskCreated: vi.fn().mockResolvedValue(ok(undefined)),
      },
      workerSettingsRepo: {
        getSettings: vi.fn().mockResolvedValue(ok({
          workers: [{
            name: 'home-mac',
            url: 'https://worker.intexuraos.cloud',
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'dispatch-secret',
            enabled: true,
          }],
          defaultSentryWorkerType: 'codex-xhigh',
        })),
      },
      linearIssueService: {
        ensureIssueExists: vi.fn().mockResolvedValue({
          linearIssueId: 'INT-200',
          linearIssueTitle: '[sentry] TypeError',
          linearFallback: false,
          linearIssueLabels: ['bug', 'sentry'],
          hasChildren: false,
        }),
      },
      codeTaskRepo: {
        create: codeTaskCreate,
      },
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'task_sentry', queuePosition: 1 })),
      },
    } as unknown as ServiceContainer);

    app = fastify({ logger: false });
    await app.register(intexuraFastifyPlugin);
    await app.register(sentryWebhookRoute);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_SENTRY_WEBHOOK_SECRET'];
    delete process.env['INTEXURAOS_SENTRY_AUTOMATION_USER_ID'];
    delete process.env['INTEXURAOS_ORCHESTRATOR_SECRET'];
    vi.clearAllMocks();
  });

  it('accepts a signed issue webhook and creates a Sentry code task', async () => {
    const rawBody = JSON.stringify(buildIssueBody());

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/sentry',
      headers: {
        'content-type': 'application/json',
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': sign(rawBody),
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      data: {
        message: 'Sentry issue code task created',
      },
    });
    expect(codeTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'sentry',
      workerType: 'codex-xhigh',
    }));
  });

  it('rejects an invalid Sentry signature', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/sentry',
      headers: {
        'content-type': 'application/json',
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': 'a'.repeat(64),
      },
      payload: JSON.stringify(buildIssueBody()),
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid Sentry webhook signature',
      },
    });
    expect(codeTaskCreate).not.toHaveBeenCalled();
  });

  it('rejects signed Sentry payloads that cannot be normalized', async () => {
    const rawBody = JSON.stringify({ action: 'created', data: {} });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/sentry',
      headers: {
        'content-type': 'application/json',
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': sign(rawBody),
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Sentry webhook payload did not include an issue id or issue URL',
      },
    }));
    expect(codeTaskCreate).not.toHaveBeenCalled();
  });

  it('returns internal error when accepted Sentry payloads cannot be processed', async () => {
    setServices({
      logger: pino({ level: 'silent' }),
      sentryIssueEventRepo: {
        reserve: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'reserve failed' })),
        markCodeTaskCreated: vi.fn(),
      },
    } as unknown as ServiceContainer);
    const rawBody = JSON.stringify(buildIssueBody());

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/sentry',
      headers: {
        'content-type': 'application/json',
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': sign(rawBody),
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'reserve failed',
      },
    }));
  });

  it('uses attached rawBody strings when Fastify raw body capture is available', async () => {
    const rawBodyApp = fastify({ logger: false });
    await rawBodyApp.register(intexuraFastifyPlugin);
    rawBodyApp.addHook('preHandler', async (request) => {
      (request as unknown as { rawBody: string }).rawBody = JSON.stringify(request.body);
    });
    await rawBodyApp.register(sentryWebhookRoute);
    await rawBodyApp.ready();

    try {
      const rawBody = JSON.stringify(buildIssueBody());
      const response = await rawBodyApp.inject({
        method: 'POST',
        url: '/webhooks/sentry',
        headers: {
          'content-type': 'application/json',
          'sentry-hook-resource': 'issue',
          'sentry-hook-signature': sign(rawBody),
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      expect(codeTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        agentType: 'sentry',
      }));
    } finally {
      await rawBodyApp.close();
    }
  });

  it('falls back to JSON stringifying the parsed body when attached rawBody is not a string', async () => {
    const fallbackApp = fastify({ logger: false });
    await fallbackApp.register(intexuraFastifyPlugin);
    fallbackApp.addHook('preHandler', async (request) => {
      (request as unknown as { rawBody: Buffer }).rawBody = Buffer.from('not-used', 'utf-8');
    });
    await fallbackApp.register(sentryWebhookRoute);
    await fallbackApp.ready();

    try {
      const rawBody = JSON.stringify(buildIssueBody());
      const response = await fallbackApp.inject({
        method: 'POST',
        url: '/webhooks/sentry',
        headers: {
          'content-type': 'application/json',
          'sentry-hook-resource': 'issue',
          'sentry-hook-signature': sign(rawBody),
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      expect(codeTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        agentType: 'sentry',
      }));
    } finally {
      await fallbackApp.close();
    }
  });
});
