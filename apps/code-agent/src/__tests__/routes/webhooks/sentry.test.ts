/**
 * Tests for POST /webhooks/sentry.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { err, ok } from '@intexuraos/common-core';
import pino from 'pino';
import { resetServices, setServices, type ServiceContainer } from '../../../services.js';
import {
  normalizeRawBodyChunk,
  readRawBody,
  sentryWebhookRoute,
} from '../../../routes/webhooks/sentry.js';

const WEBHOOK_SECRET = 'sentry-webhook-secret';
const ERROR_HUB_EVENT_ALERT_RAW = readFileSync(
  new URL('../../fixtures/error-hub-event-alert.json', import.meta.url),
  'utf8',
);

function buildIssueBody(
  issueUrl = 'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/4509001/'
): Record<string, unknown> {
  return {
    action: 'created',
    data: {
      issue: {
        id: '4509001',
        title: 'TypeError: Cannot read properties of undefined',
        permalink: issueUrl,
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
  let sentryReservationAcquire: ReturnType<typeof vi.fn>;
  let sentryRouteSchema: unknown;

  beforeEach(async () => {
    process.env['INTEXURAOS_SENTRY_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    process.env['INTEXURAOS_SENTRY_AUTOMATION_USER_ID'] = 'sentry-automation-user';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'orchestrator-secret';

    codeTaskCreate = vi.fn().mockImplementation(async (input: Record<string, unknown>) => ok({
      id: input['id'],
      ...input,
      status: 'queued',
    }));
    sentryReservationAcquire = vi.fn().mockImplementation(async (input: { proposedCodeTaskId: string }) => ok({
      kind: 'acquired',
      transitionKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created',
      issueKey: 'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:4509001',
      leaseToken: 'lease-token',
      codeTaskId: input.proposedCodeTaskId,
    }));
    setServices({
      logger: pino({ level: 'silent' }),
      sentryIssueEventRepo: {
        acquire: sentryReservationAcquire,
        checkpointLinearIssue: vi.fn().mockResolvedValue(ok(undefined)),
        completeReservation: vi.fn().mockResolvedValue(ok(undefined)),
        failReservation: vi.fn().mockResolvedValue(ok(undefined)),
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
        findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'task not found' })),
        create: codeTaskCreate,
      },
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'task_sentry', queuePosition: 1 })),
      },
    } as unknown as ServiceContainer);

    app = fastify({ logger: false });
    app.addHook('onRoute', (routeOptions) => {
      if (routeOptions.url === '/webhooks/sentry') {
        sentryRouteSchema = routeOptions.schema;
      }
    });
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

  it('describes the compatibility webhook as SentryBox automation', () => {
    expect(sentryRouteSchema).toEqual(expect.objectContaining({
      summary: 'Receive SentryBox issue webhook events',
      description:
        'Receives SentryBox issue and event_alert webhook events and creates a SentryBox code task.',
    }));
  });

  it('accepts a signed SentryBox issue webhook and creates a Sentry code task', async () => {
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
    expect(sentryReservationAcquire).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        issueId: '4509001',
        issueTitle: 'TypeError: Cannot read properties of undefined',
      }),
    }));
  });

  it('rejects a signed Legacy Sentry issue URL before reserving or creating a task', async () => {
    const rawBody = JSON.stringify(
      buildIssueBody('https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/')
    );

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
        message: 'Sentry webhook issue URL is not a private SentryBox URL',
      },
    }));
    expect(sentryReservationAcquire).not.toHaveBeenCalled();
    expect(codeTaskCreate).not.toHaveBeenCalled();
  });

  it('accepts the exact signed Error Hub event_alert contract without route changes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/sentry',
      headers: {
        'content-type': 'application/json',
        'sentry-hook-resource': 'event_alert',
        'sentry-hook-signature': sign(ERROR_HUB_EVENT_ALERT_RAW),
      },
      payload: ERROR_HUB_EVENT_ALERT_RAW,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      data: {
        message: 'Sentry issue code task created',
      },
    });
    expect(sentryReservationAcquire).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          resource: 'event_alert',
          action: 'triggered',
          organizationSlug: 'intexuraos',
          projectSlug: 'intexuraos-backend',
          projectId: '1',
          issueId: '1042',
          issueShortId: 'INTEXURA-HUB-1042',
          issueTitle: 'TypeError: Cannot read properties of undefined',
          issueUrl:
            'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/1042/',
          status: 'unresolved',
          eventId: '4f7a4f2c0e8e4c2a9c3d5e7f90123456',
        },
      }),
    );
    expect(codeTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'sentry',
        sentryIssue: expect.objectContaining({
          issueId: '1042',
          eventId: '4f7a4f2c0e8e4c2a9c3d5e7f90123456',
        }),
      }),
    );
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

  it('returns 200 ignored for signed Sentry lifecycle cleanup events without reserving dedupe state', async () => {
    const body = buildIssueBody();
    body['action'] = 'resolved';
    const rawBody = JSON.stringify(body);

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
        message: 'Ignored non-actionable Sentry issue event: issue.resolved',
      },
    });
    expect(sentryReservationAcquire).not.toHaveBeenCalled();
    expect(codeTaskCreate).not.toHaveBeenCalled();
  });

  it('returns internal error when accepted Sentry payloads cannot be processed', async () => {
    setServices({
      logger: pino({ level: 'silent' }),
      sentryIssueEventRepo: {
        acquire: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'reserve failed' })),
        completeReservation: vi.fn(),
        failReservation: vi.fn(),
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

  it('returns service unavailable while an active lease has no task', async () => {
    sentryReservationAcquire.mockResolvedValue(ok({ kind: 'retryable' }));
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

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Sentry issue processing is already in progress',
      },
    }));
    expect(codeTaskCreate).not.toHaveBeenCalled();
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

  it('uses the original request bytes for signature verification when attached rawBody is not a string', async () => {
    const fallbackApp = fastify({ logger: false });
    await fallbackApp.register(intexuraFastifyPlugin);
    await fallbackApp.register(sentryWebhookRoute);
    await fallbackApp.ready();

    try {
      const rawBody = JSON.stringify(buildIssueBody(), null, 2);
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

describe('Sentry webhook raw body helpers', () => {
  it('reads Buffer, string, and missing raw body attachments', () => {
    const bufferBody = Buffer.from('{"ok":true}', 'utf-8');
    expect(readRawBody({ rawBody: bufferBody } as never)).toBe(bufferBody);
    expect(readRawBody({ rawBody: '{"ok":true}' } as never).toString('utf-8')).toBe('{"ok":true}');
    expect(readRawBody({} as never).length).toBe(0);
  });

  it('normalizes stream chunks without changing byte content', () => {
    const bufferChunk = Buffer.from('buffer', 'utf-8');
    expect(normalizeRawBodyChunk(bufferChunk)).toBe(bufferChunk);
    expect(normalizeRawBodyChunk(new Uint8Array([117, 56])).toString('utf-8')).toBe('u8');
    expect(normalizeRawBodyChunk('string').toString('utf-8')).toBe('string');
  });
});
