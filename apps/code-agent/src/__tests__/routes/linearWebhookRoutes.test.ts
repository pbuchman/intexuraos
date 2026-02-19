/**
 * Integration tests for POST /webhooks/linear route.
 *
 * Tests Linear webhook signature validation, idempotency,
 * event type handling, and processCodeAction dispatch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock jose library for JWT validation (buildServer needs it)
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: 'test-user-id', email: 'test@example.com' },
    protectedHeader: new Uint8Array(),
  }),
}));

// Mock processCodeAction module (dynamic import in route)
vi.mock('../../domain/usecases/processCodeAction.js', () => ({
  processCodeAction: vi.fn(),
}));

import { createHmac } from 'node:crypto';
import { ok, err } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import { getServices, setServices, resetServices } from '../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../helpers/mockServices.js';
import { processCodeAction } from '../../domain/usecases/processCodeAction.js';
import type { LinearOAuthRepository } from '../../domain/ports/linearOAuthRepository.js';
import type { LinearActivityReporter } from '../../domain/services/linearActivityReporter.js';

const mockProcessCodeAction = vi.mocked(processCodeAction);

const WEBHOOK_SECRET = 'test-webhook-secret';

function computeSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'created',
    type: 'AgentSessionEvent',
    createdAt: '2026-01-15T10:00:00.000Z',
    webhookTimestamp: Date.now(),
    webhookId: `wh-${String(Math.random()).slice(2, 10)}`,
    data: {
      id: 'data-id-1',
      issueId: 'INT-100',
      agentSession: { id: 'session-123' },
    },
    promptContext: 'Fix the broken tests in the auth module',
    ...overrides,
  };
}

/**
 * Create a mock LinearOAuthRepository with all methods as vi.fn().
 */
function createMockLinearOAuthRepo(): LinearOAuthRepository {
  return {
    save: vi.fn().mockResolvedValue(ok(undefined)),
    get: vi.fn().mockResolvedValue(ok(null)),
    findByAppUserId: vi.fn().mockResolvedValue(ok(null)),
  };
}

/**
 * Create a mock LinearActivityReporter with reportEvent as vi.fn().
 */
function createMockLinearActivityReporter(): LinearActivityReporter {
  return {
    reportEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe('POST /webhooks/linear', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let mockLinearOAuthRepo: LinearOAuthRepository;
  let mockActivityReporter: LinearActivityReporter;

  beforeEach(async () => {
    // Set required env vars for loadConfig()
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'] = 'test-verify-secret';
    process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = 'test-encryption-key-32chars!!!!!';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';
    process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'] = 'test-github-secret';
    process.env['INTEXURAOS_LINEAR_CLIENT_ID'] = 'test-linear-client-id';
    process.env['INTEXURAOS_LINEAR_CLIENT_SECRET'] = 'test-linear-client-secret';
    process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    setupTestServices();

    // Replace linearOAuthRepo and linearActivityReporter with mocks
    mockLinearOAuthRepo = createMockLinearOAuthRepo();
    mockActivityReporter = createMockLinearActivityReporter();
    const services = getServices();
    setServices({
      ...services,
      linearOAuthRepo: mockLinearOAuthRepo,
      linearActivityReporter: mockActivityReporter,
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
    // Clean up env vars
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'];
    delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];
    delete process.env['INTEXURAOS_ORCHESTRATOR_SECRET'];
    delete process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'];
    delete process.env['INTEXURAOS_LINEAR_CLIENT_ID'];
    delete process.env['INTEXURAOS_LINEAR_CLIENT_SECRET'];
    delete process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
  });

  async function injectWebhook(
    payload: Record<string, unknown>,
    { secret = WEBHOOK_SECRET, omitSignature = false }: { secret?: string; omitSignature?: boolean } = {}
  ): Promise<Awaited<ReturnType<typeof app.inject>>> {
    const bodyStr = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (!omitSignature) {
      headers['linear-signature'] = computeSignature(bodyStr, secret);
    }
    return await app.inject({
      method: 'POST',
      url: '/webhooks/linear',
      headers,
      payload: bodyStr,
    });
  }

  describe('signature validation', () => {
    it('returns 401 when Linear-Signature header is missing', async () => {
      const payload = makePayload();
      const res = await injectWebhook(payload, { omitSignature: true });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Missing Linear-Signature header');
    });

    it('returns 401 when signature is invalid', async () => {
      const payload = makePayload();
      const res = await injectWebhook(payload, { secret: 'wrong-secret' });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Invalid webhook signature');
    });
  });

  describe('timestamp validation', () => {
    it('passes when webhookTimestamp is present and valid', async () => {
      const payload = makePayload({
        type: 'SomeOtherEvent',
        webhookTimestamp: Date.now(),
      });
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
    });

    it('passes when webhookTimestamp is absent', async () => {
      const payload = makePayload({ type: 'SomeOtherEvent' });
      delete payload['webhookTimestamp'];
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
    });

    it('returns 400 when webhookTimestamp is stale', async () => {
      const staleTimestamp = Date.now() - 120_000; // 2 minutes ago
      const payload = makePayload({ webhookTimestamp: staleTimestamp });
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Webhook timestamp outside acceptable window');
    });
  });

  describe('idempotency', () => {
    it('processes first webhook and returns ok for duplicate', async () => {
      const webhookId = 'idempotency-test-id';
      const payload = makePayload({
        webhookId,
        type: 'SomeOtherEvent',
      });

      // First request - should process
      const res1 = await injectWebhook(payload);
      expect(res1.statusCode).toBe(200);

      // Duplicate request - should skip
      const res2 = await injectWebhook(payload);
      expect(res2.statusCode).toBe(200);
      const body2 = JSON.parse(res2.payload) as { success: boolean; data: { received: boolean } };
      expect(body2.success).toBe(true);
      expect(body2.data.received).toBe(true);
    });
  });

  describe('event type handling', () => {
    it('returns ok for non-AgentSessionEvent types', async () => {
      const payload = makePayload({ type: 'IssueEvent' });
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
    });
  });

  describe('AgentSessionEvent.created', () => {
    it('returns ok when sessionId is missing', async () => {
      const payload = makePayload({
        data: { id: 'data-id', issueId: 'INT-100', agentSession: {} },
      });
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
    });

    it('returns ok when issueId is missing', async () => {
      const payload = makePayload({
        data: { id: 'data-id', agentSession: { id: 'session-456' } },
      });
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
    });

    it('returns 401 when no OAuth credentials exist', async () => {
      vi.mocked(mockLinearOAuthRepo.get).mockResolvedValue(ok(null));

      const payload = makePayload();
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Linear app not installed');
    });

    it('returns 401 when OAuth credential lookup fails', async () => {
      vi.mocked(mockLinearOAuthRepo.get).mockResolvedValue(
        err({ code: 'internal_error' as const, message: 'Firestore error' })
      );

      const payload = makePayload();
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('dispatches processCodeAction successfully', async () => {
      vi.mocked(mockLinearOAuthRepo.get).mockResolvedValue(ok({
        accessToken: 'test-token',
        appUserId: 'app-user-123',
        workspaceId: 'default',
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'test-user',
      }));

      mockProcessCodeAction.mockResolvedValue(ok({ codeTaskId: 'mock-task-id', resourceUrl: '/#/code-tasks/mock-task-id', workerLocation: 'test-worker' }));

      const payload = makePayload();
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
      expect(mockProcessCodeAction).toHaveBeenCalledOnce();
    });

    it('returns ok but logs warning when processCodeAction fails', async () => {
      vi.mocked(mockLinearOAuthRepo.get).mockResolvedValue(ok({
        accessToken: 'test-token',
        appUserId: 'app-user-123',
        workspaceId: 'default',
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'test-user',
      }));

      mockProcessCodeAction.mockResolvedValue(
        err({ code: 'internal_error' as const, message: 'dispatch failed' })
      );

      const payload = makePayload();
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
      expect(mockProcessCodeAction).toHaveBeenCalledOnce();
    });

    it('uses default prompt when promptContext is missing', async () => {
      vi.mocked(mockLinearOAuthRepo.get).mockResolvedValue(ok({
        accessToken: 'test-token',
        appUserId: 'app-user-123',
        workspaceId: 'default',
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'test-user',
      }));

      mockProcessCodeAction.mockResolvedValue(ok({ codeTaskId: 'mock-task-id', resourceUrl: '/#/code-tasks/mock-task-id', workerLocation: 'test-worker' }));

      const payload = makePayload();
      delete payload['promptContext'];
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      expect(mockProcessCodeAction).toHaveBeenCalledOnce();
      const callArgs = mockProcessCodeAction.mock.calls[0] as unknown[];
      const params = callArgs[1] as { prompt: string };
      expect(params.prompt).toBe('Work on Linear issue INT-100');
    });

    it('uses sessionId as fallback for approvalEventId when webhookId is absent', async () => {
      vi.mocked(mockLinearOAuthRepo.get).mockResolvedValue(ok({
        accessToken: 'test-token',
        appUserId: 'app-user-123',
        workspaceId: 'default',
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'test-user',
      }));

      mockProcessCodeAction.mockResolvedValue(ok({ codeTaskId: 'mock-task-id', resourceUrl: '/#/code-tasks/mock-task-id', workerLocation: 'test-worker' }));

      const payload = makePayload();
      delete payload['webhookId'];
      // Also remove data.id so webhookId resolves to undefined (line 197: body.webhookId ?? body.data?.id)
      const data = payload['data'] as Record<string, unknown>;
      delete data['id'];
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      expect(mockProcessCodeAction).toHaveBeenCalledOnce();
      const callArgs = mockProcessCodeAction.mock.calls[0] as unknown[];
      const params = callArgs[1] as { approvalEventId: string };
      expect(params.approvalEventId).toBe('linear-webhook-session-123');
    });
  });

  describe('AgentSessionEvent.prompted', () => {
    it('returns ok for prompted action', async () => {
      const payload = makePayload({
        action: 'prompted',
        agentActivity: { body: 'Please also fix the tests' },
      });
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
    });
  });

  describe('unknown action', () => {
    it('returns ok for unhandled action types', async () => {
      const payload = makePayload({ action: 'deleted' });
      const res = await injectWebhook(payload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; data: { received: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
    });
  });
});
