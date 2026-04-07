/**
 * Tests for internal API routes.
 */
import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import type { LinearConnection, LinearIssueWithTeam } from '../../domain/models.js';
import {
  FakeLinearConnectionRepository,
  FakeLinearApiClient,
  FakeFailedIssueRepository,
  FakeLinearActionExtractionService,
  FakeProcessedActionRepository,
  FakeUserServiceClient,
  FakeLlmGenerateClient,
  FakeLinearIssueRepository,
  FakeCodeAgentClient,
} from '../fakes.js';
import { setServices, resetServices } from '../../services.js';

describe('internalRoutes', () => {
  let app: FastifyInstance;
  let fakeConnectionRepo: FakeLinearConnectionRepository;
  let fakeLinearClient: FakeLinearApiClient;
  let fakeExtractionService: FakeLinearActionExtractionService;
  let fakeFailedIssueRepo: FakeFailedIssueRepository;
  let fakeProcessedActionRepo: FakeProcessedActionRepository;
  let fakeIssueRepo: FakeLinearIssueRepository;
  let fakeUserServiceClient: FakeUserServiceClient;
  let fakeLlmClient: FakeLlmGenerateClient;

  const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token-12345';

  beforeAll(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
  });

  afterAll(async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  beforeEach(async () => {
    fakeConnectionRepo = new FakeLinearConnectionRepository();
    fakeLinearClient = new FakeLinearApiClient();
    fakeExtractionService = new FakeLinearActionExtractionService();
    fakeFailedIssueRepo = new FakeFailedIssueRepository();
    fakeProcessedActionRepo = new FakeProcessedActionRepository();
    fakeIssueRepo = new FakeLinearIssueRepository();
    fakeUserServiceClient = new FakeUserServiceClient();
    fakeLlmClient = new FakeLlmGenerateClient();
    fakeUserServiceClient.setLlmClient(fakeLlmClient);

    setServices({
      connectionRepository: fakeConnectionRepo,
      linearApiClient: fakeLinearClient,
      extractionService: fakeExtractionService,
      failedIssueRepository: fakeFailedIssueRepo,
      processedActionRepository: fakeProcessedActionRepo,
      issueRepository: fakeIssueRepo,
      userServiceClient: fakeUserServiceClient,
      commentRepository: null as unknown as import('../../domain/index.js').LinearCommentRepository,
      codeAgentClient: new FakeCodeAgentClient(),
      issuePruningClassifier: {
        classifyCandidates: async () => ({ ok: true, value: [] }),
      },
      pruneCandidateRepository: {
        clearAll: async () => ({ ok: true as const, value: undefined }),
        storeAll: async () => ({ ok: true as const, value: undefined }),
        listAll: async () => ({ ok: true as const, value: [] }),
      },
    });

    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    resetServices();
  });

  function seedConnection(userId: string): void {
    const connection: LinearConnection = {
      userId,
      apiKey: 'linear-api-key-123',
      teamId: 'team-456',
      teamName: 'Engineering',
      webhookSecret: null,
      connected: true,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    };
    fakeConnectionRepo.seedConnection(connection);
  }

  function createIssueWithTeam(overrides: Partial<LinearIssueWithTeam> = {}): LinearIssueWithTeam {
    const now = new Date().toISOString();
    return {
      id: 'issue-1',
      identifier: 'INT-123',
      title: 'Test Issue',
      description: null,
      priority: 0,
      state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
      url: 'https://linear.app/team/issue/INT-123',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      parentId: null,
      teamId: 'team-456',
      labels: [],
      childCount: 0,
      children: [],
      ...overrides,
    };
  }

  describe('GET /internal/linear/issues/:identifier/validate', () => {
    it('returns 401 when no internal auth header provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-123/validate?userId=user-456',
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when internal auth header is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-123/validate?userId=user-456',
        headers: { 'x-internal-auth': 'invalid-token' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 400 when identifier format is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/invalid-format/validate?userId=user-456',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 403 when user is not connected', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-123/validate?userId=user-456',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 when issue does not exist', async () => {
      seedConnection('user-456');

      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-999/validate?userId=user-456',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when issue belongs to different team', async () => {
      seedConnection('user-456');
      const issue = createIssueWithTeam({ teamId: 'different-team' });
      fakeLinearClient.seedIssueWithTeam(issue);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-123/validate?userId=user-456',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 200 with issue data when valid', async () => {
      seedConnection('user-456');
      const issue = createIssueWithTeam();
      fakeLinearClient.seedIssueWithTeam(issue);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-123/validate?userId=user-456',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('issue-1');
      expect(body.data.identifier).toBe('INT-123');
      expect(body.data.title).toBe('Test Issue');
      expect(body.data.url).toBe('https://linear.app/team/issue/INT-123');
      expect(body.data.labels).toEqual([]);
      expect(body.data.childCount).toBe(0);
      expect(body.data.parentId).toBeNull();
    });

    it('returns parentId when issue is a subtask', async () => {
      seedConnection('user-456');
      const issue = createIssueWithTeam({ parentId: 'parent-uuid-789' });
      fakeLinearClient.seedIssueWithTeam(issue);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-123/validate?userId=user-456',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.parentId).toBe('parent-uuid-789');
    });

    it('handles connection repository errors', async () => {
      fakeConnectionRepo.setGetFullConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database unavailable',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-123/validate?userId=user-456',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });

    it('handles Linear API errors', async () => {
      seedConnection('user-456');
      fakeLinearClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'Rate limit exceeded',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/INT-123/validate?userId=user-456',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });
  });

  describe('POST /internal/linear/issues/generate-title', () => {
    it('returns 401 when no internal auth header provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: { 'content-type': 'application/json' },
        payload: { description: 'Fix the bug', userId: 'user-456' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when internal auth header is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': 'invalid-token',
        },
        payload: { description: 'Fix the bug', userId: 'user-456' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('generates title from description using LLM', async () => {
      fakeLlmClient.setContent('{"title": "Fix login button on mobile", "issueType": "bug"}');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'The login button is not working on mobile devices',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Fix login button on mobile');
      expect(body.data.issueType).toBe('bug');
    });

    it('returns feature issue type', async () => {
      fakeLlmClient.setContent('{"title": "Add dark mode to settings", "issueType": "feature"}');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'I need dark mode support',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.issueType).toBe('feature');
    });

    it('returns refactor issue type', async () => {
      fakeLlmClient.setContent('{"title": "Refactor auth module", "issueType": "refactor"}');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'Clean up the authentication module',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.issueType).toBe('refactor');
    });

    it('returns research issue type', async () => {
      fakeLlmClient.setContent('{"title": "Investigate API options", "issueType": "research"}');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'Research the best API for payments',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.issueType).toBe('research');
    });

    it('returns default title for empty description', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: '',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Code task');
      expect(body.data.issueType).toBe('feature');
    });

    it('returns 500 when LLM client fails to initialize', async () => {
      fakeUserServiceClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'User service unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'Fix the bug in the login flow',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when LLM generation fails after retries', async () => {
      fakeLlmClient.setFailure(true, { code: 'API_ERROR', message: 'LLM error' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'Add new feature to dashboard',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when JSON parsing fails after retries', async () => {
      fakeLlmClient.setContent('This is not valid JSON');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'Improve performance of API',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('succeeds after retry on first LLM failure', async () => {
      const { ok, err } = await import('@intexuraos/common-core');
      const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };
      fakeLlmClient.setResponseSequence([
        err({ code: 'API_ERROR', message: 'Temporary failure' }),
        ok({ content: '{"title": "Retry worked", "issueType": "feature"}', usage }),
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'Some task description',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Retry worked');
    });

    it('handles markdown code blocks in LLM response', async () => {
      fakeLlmClient.setContent('```json\n{"title": "From code block", "issueType": "feature"}\n```');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/generate-title',
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          description: 'Some task description',
          userId: 'user-456',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('From code block');
    });
  });

  describe('POST /internal/linear/sync-all', () => {
    it('returns 401 when no internal auth header provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/sync-all',
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts OIDC Bearer token from Cloud Scheduler', async () => {
      const conn: LinearConnection = {
        userId: 'user-1',
        apiKey: 'key-1',
        teamId: 'team-1',
        teamName: 'Team 1',
        webhookSecret: null,
        connected: true,
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      };
      fakeConnectionRepo.seedConnection(conn);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/sync-all',
        headers: {
          authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.fake-oidc-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.userCount).toBe(1);
    });

    it('syncs all connected users successfully', async () => {
      // Seed two connected users
      const conn1: LinearConnection = {
        userId: 'user-1',
        apiKey: 'key-1',
        teamId: 'team-1',
        teamName: 'Team 1',
        webhookSecret: null,
        connected: true,
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      };
      const conn2: LinearConnection = {
        userId: 'user-2',
        apiKey: 'key-2',
        teamId: 'team-2',
        teamName: 'Team 2',
        webhookSecret: null,
        connected: true,
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      };
      fakeConnectionRepo.seedConnection(conn1);
      fakeConnectionRepo.seedConnection(conn2);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/sync-all',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.userCount).toBe(2);
    });

    it('handles sync failure for all users', async () => {
      fakeConnectionRepo.setGetConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database connection failed',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/sync-all',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });
  });

  describe('POST /internal/linear/sync', () => {
    it('returns 401 when no internal auth header provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/sync',
        headers: { 'content-type': 'application/json' },
        payload: { userId: 'user-1' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('syncs issues for a single user successfully', async () => {
      const conn: LinearConnection = {
        userId: 'user-1',
        apiKey: 'key-1',
        teamId: 'team-1',
        teamName: 'Team 1',
        webhookSecret: null,
        connected: true,
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      };
      fakeConnectionRepo.seedConnection(conn);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/sync',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
          'content-type': 'application/json',
        },
        payload: { userId: 'user-1' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.created).toBeGreaterThanOrEqual(0);
    });

    it('returns error when fullSync fails', async () => {
      fakeConnectionRepo.setGetFullConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database connection failed',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/sync',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
          'content-type': 'application/json',
        },
        payload: { userId: 'user-1' },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });

    it('returns 502 DOWNSTREAM_ERROR when linearApiClient fails with non-INTERNAL_ERROR code', async () => {
      const conn: LinearConnection = {
        userId: 'user-1',
        apiKey: 'key-1',
        teamId: 'team-1',
        teamName: 'Team 1',
        webhookSecret: null,
        connected: true,
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      };
      fakeConnectionRepo.seedConnection(conn);
      fakeLinearClient.setFailure(true, { code: 'API_ERROR', message: 'Linear API unavailable' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/sync',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
          'content-type': 'application/json',
        },
        payload: { userId: 'user-1' },
      });

      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });
});
