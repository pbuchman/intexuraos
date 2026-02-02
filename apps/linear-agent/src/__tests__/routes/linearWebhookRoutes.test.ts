/**
 * Tests for Linear webhook routes.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../server.js';
import {
  FakeLinearIssueRepository,
  FakeLinearConnectionRepository,
  FakeLinearApiClient,
  FakeLinearActionExtractionService,
  FakeFailedIssueRepository,
  FakeProcessedActionRepository,
  FakeUserServiceClient,
} from '../fakes.js';
import { setServices, resetServices } from '../../services.js';
import crypto from 'node:crypto';

describe('Linear Webhook Routes', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let issueRepo: FakeLinearIssueRepository;
  let connectionRepo: FakeLinearConnectionRepository;
  let linearApiClient: FakeLinearApiClient;
  let extractionService: FakeLinearActionExtractionService;
  let failedIssueRepo: FakeFailedIssueRepository;
  let processedActionRepo: FakeProcessedActionRepository;
  let userServiceClient: FakeUserServiceClient;

  const webhookSecret = 'test-webhook-secret';
  const userId = 'user-123';

  beforeEach(async () => {
    process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET'] = webhookSecret;

    issueRepo = new FakeLinearIssueRepository();
    connectionRepo = new FakeLinearConnectionRepository();
    linearApiClient = new FakeLinearApiClient();
    extractionService = new FakeLinearActionExtractionService();
    failedIssueRepo = new FakeFailedIssueRepository();
    processedActionRepo = new FakeProcessedActionRepository();
    userServiceClient = new FakeUserServiceClient();

    // Seed a connection for the user
    connectionRepo.seedConnection({
      userId,
      apiKey: 'test-api-key',
      teamId: 'team-1',
      teamName: 'Engineering',
      connected: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    setServices({
      connectionRepository: connectionRepo,
      linearApiClient,
      extractionService,
      failedIssueRepository: failedIssueRepo,
      processedActionRepository: processedActionRepo,
      issueRepository: issueRepo,
      userServiceClient,
    });

    app = await buildServer(undefined);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    connectionRepo.reset();
    issueRepo.reset();
    linearApiClient.reset();
    extractionService.reset();
    failedIssueRepo.reset();
    processedActionRepo.reset();
    userServiceClient.reset();
    delete process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET'];
  });

  function computeLinearSignature(body: unknown): string {
    const rawBody = JSON.stringify(body);
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return `sha256=${signature}`;
  }

  function createLinearWebhookPayload(overrides: Partial<unknown> = {}): unknown {
    return {
      action: 'create',
      type: 'Issue',
      webhookTimestamp: Date.now(),
      webhookId: 'webhook-123',
      data: {
        id: 'issue-uuid-1',
        identifier: 'INT-123',
        title: 'Test Issue',
        description: 'Test description',
        priority: 2,
        url: 'https://linear.app/team/issue/INT-123',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        state: { id: 'state-1', name: 'In Progress', type: 'started' },
        assignee: { id: 'user-1', name: 'Test User' },
        labels: [{ id: 'label-1', name: 'bug' }],
        team: { id: 'team-1', key: 'INT' },
      },
      ...overrides,
    };
  }

  describe('POST /linear/webhook', () => {
    it('accepts valid webhook with correct signature', async () => {
      const payload = createLinearWebhookPayload();
      const signature = computeLinearSignature(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/linear/webhook',
        headers: {
          'Linear-Hmacsha256': signature,
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('created');
      expect(body.data.issueId).toBe('issue-uuid-1');
    });

    it('rejects webhook without signature', async () => {
      const payload = createLinearWebhookPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/linear/webhook',
        headers: {
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects webhook with invalid signature', async () => {
      const payload = createLinearWebhookPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/linear/webhook',
        headers: {
          'Linear-Hmacsha256': 'sha256=invalid',
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 200 for non-Issue webhook events', async () => {
      const payload = createLinearWebhookPayload({ type: 'Comment' });
      const signature = computeLinearSignature(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/linear/webhook',
        headers: {
          'Linear-Hmacsha256': signature,
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.message).toBe('Ignored');
    });

    it('returns 200 for unconnected teams', async () => {
      const payload = createLinearWebhookPayload({
        data: { team: { id: 'unknown-team', key: 'UNK' } },
      });
      const signature = computeLinearSignature(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/linear/webhook',
        headers: {
          'Linear-Hmacsha256': signature,
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.message).toBe('Team not connected');
    });
  });
});
