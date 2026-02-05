/**
 * Tests for GitHub webhook route
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes, createHmac } from 'node:crypto';
import { ok } from '@intexuraos/common-core';
import type { FastifyInstance } from 'fastify';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import * as jose from 'jose';
import { buildServer } from '../../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../../services.js';
import { createFakeFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import type { GitHubPREventRepository } from '../../../domain/repositories/gitHubPREventRepository.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

describe('POST /webhooks/github', () => {
  let app: FastifyInstance;
  let testSecret: string;
  let mockEventRepo: GitHubPREventRepository;

  beforeEach(async () => {
    testSecret = 'test-webhook-secret';

    // Mock JWT verification
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    // Set required env vars
    process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'] = testSecret;
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    // Setup fake Firestore
    const fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    const logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    // Create mock repo that returns a valid event object with an id
    mockEventRepo = {
      save: (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 123,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 789,
        pullRequestId: 101,
        eventType: 'pull_request' as const,
        action: 'opened' as const,
        senderLogin: 'testuser',
        senderId: 999,
        senderType: 'User',
        title: 'Test PR',
        body: 'Test description',
        state: 'open',
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: {},
      })),
      findByPullRequest: (): Promise<ReturnType<typeof ok<GitHubPREvent[]>>> => Promise.resolve(ok([])),
      findByRepository: (): Promise<ReturnType<typeof ok<GitHubPREvent[]>>> => Promise.resolve(ok([])),
    };

    // Setup services with all required fields
    const mockServices: ServiceContainer = {
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo: {} as never,
      logChunkRepo: {} as never,
      taskDispatcher: {} as never,
      whatsappNotifier: {} as never,
      actionsAgentClient: {} as never,
      linearAgentClient: {} as never,
      rateLimitService: {} as never,
      linearIssueService: {} as never,
      statusMirrorService: {} as never,
      processHeartbeat: {} as never,
      detectZombieTasks: {} as never,
      cleanupTaskLogs: {} as never,
      metricsClient: {} as never,
      workerSettingsRepo: {} as never,
      workerHealthProbe: {} as never,
      gitHubPREventRepo: mockEventRepo,
    };

    setServices(mockServices);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
  });

  function signPayload(payload: unknown): { payload: string; signature: string } {
    const payloadStr = JSON.stringify(payload);
    const payloadBuffer = Buffer.from(payloadStr, 'utf-8');
    const hmac = createHmac('sha256', testSecret);
    hmac.update(payloadBuffer);
    const signature = `sha256=${hmac.digest('hex')}`;
    return { payload: payloadStr, signature };
  }

  describe('signature verification', () => {
    it('should return 200 OK for valid signature', async () => {
      const { payload, signature } = signPayload({ action: 'opened' });

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 401 for missing signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'ping',
        },
        body: '{}',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for invalid signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=wrong',
          'x-github-event': 'ping',
        },
        body: '{}',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for signature without sha256= prefix', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': randomBytes(32).toString('hex'),
          'x-github-event': 'ping',
        },
        body: '{}',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('ping event', () => {
    it('should respond to ping event with pong', async () => {
      const { payload, signature } = signPayload({ zen: 'keep it real' });

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('pong');
    });
  });

  describe('pull_request event - IntexuraOS repository', () => {
    it('should process pull_request events for intexuraos repositories', async () => {
      const prPayload = {
        action: 'opened',
        number: 123,
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'pbuchman/intexuraos',
          owner: {
            login: 'pbuchman',
            id: 789,
          },
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Test PR',
          body: 'Test description',
          state: 'open',
          merged_at: null,
        },
        sender: {
          login: 'testuser',
          id: 999,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return 200 but not store events for non-intexuraos repositories', async () => {
      const prPayload = {
        action: 'opened',
        number: 123,
        repository: {
          id: 456,
          name: 'other-repo',
          full_name: 'someone/other-repo',
          owner: {
            login: 'someone',
            id: 789,
          },
        },
        sender: {
          login: 'testuser',
          id: 999,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('ignored');
    });
  });

  describe('pull_request_review event', () => {
    it('should process review events for intexuraos repositories', async () => {
      const reviewPayload = {
        action: 'submitted',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Test PR',
          state: 'open',
        },
        review: {
          id: 456,
          body: 'LGTM',
          state: 'approved',
        },
        sender: {
          login: 'reviewer',
          id: 111,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(reviewPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request_review',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  describe('push event', () => {
    it('should process push events for intexuraos repositories', async () => {
      const pushPayload = {
        ref: 'refs/heads/main',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        sender: {
          login: 'pusher',
          id: 222,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(pushPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });
});
