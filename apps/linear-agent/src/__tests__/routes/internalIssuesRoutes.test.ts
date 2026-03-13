import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { setServices, resetServices } from '../../services.js';
import type { FastifyInstance } from 'fastify';
import {
  FakeLinearConnectionRepository,
  FakeLinearApiClient,
  FakeLinearIssueRepository,
  FakeLinearCommentRepository,
  FakeCodeAgentClient,
} from '../fakes.js';
import type { LinearConnection, LinearIssue, SyncedLinearIssue, LinearComment } from '../../domain/models.js';

// Set up internal auth token for testing
process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';

describe('internalIssuesRoutes', () => {
  let app: FastifyInstance;
  let fakeConnectionRepo: FakeLinearConnectionRepository;
  let fakeLinearClient: FakeLinearApiClient;
  let fakeIssueRepo: FakeLinearIssueRepository;
  let fakeCommentRepo: FakeLinearCommentRepository;

  const testUserId = 'user-123';
  const testApiKey = 'linear-api-key-test';
  const testConnection: LinearConnection = {
    userId: testUserId,
    apiKey: testApiKey,
    teamId: 'team-1',
      teamName: 'Engineering',
    webhookSecret: null,
    connected: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    fakeConnectionRepo = new FakeLinearConnectionRepository();
    fakeLinearClient = new FakeLinearApiClient();
    fakeIssueRepo = new FakeLinearIssueRepository();
    fakeCommentRepo = new FakeLinearCommentRepository();

    setServices({
      connectionRepository: fakeConnectionRepo,
      linearApiClient: fakeLinearClient,
      failedIssueRepository: null as unknown as import('../../domain/index.js').FailedIssueRepository,
      extractionService: null as unknown as import('../../domain/index.js').LinearActionExtractionService,
      processedActionRepository: null as unknown as import('../../domain/index.js').ProcessedActionRepository,
      issueRepository: fakeIssueRepo,
      userServiceClient: null as unknown as import('@intexuraos/internal-clients').UserServiceClient,
      commentRepository: fakeCommentRepo,
      codeAgentClient: new FakeCodeAgentClient(),
    });

    app = await buildServer();
    fakeConnectionRepo.seedConnection(testConnection);
  });

  afterEach(() => {
    resetServices();
    vi.clearAllMocks();
  });

  const internalAuthHeader = { 'x-internal-auth': 'test-internal-token' };

  describe('POST /internal/issues', () => {
    it('should create issue and return expected response format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          title: 'Test Issue',
          description: 'Test description',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as { success: boolean; data: { id: string; identifier: string; title: string; url: string }; diagnostics?: unknown };
      expect(body.success).toBe(true);
      expect(body.data.id).toBeTruthy();
      expect(body.data.identifier).toMatch(/^ENG-/);
      expect(body.data.title).toBe('Test Issue');
      expect(body.data.url).toContain('linear.app');
    });

    it('should return 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          'x-user-id': testUserId,
        },
        payload: {
          title: 'Test',
          description: 'Test',
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when X-User-Id is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: internalAuthHeader,
        payload: {
          title: 'Test',
          description: 'Test',
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 when user not connected to Linear', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          ...internalAuthHeader,
          'x-user-id': 'disconnected-user',
        },
        payload: {
          title: 'Test',
          description: 'Test',
        },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should include labels when provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          title: 'Test Issue',
          description: 'Test description',
          labels: ['bug', 'high-priority'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  describe('PATCH /internal/issues/:issueId/state', () => {
    let testIssue: LinearIssue;

    beforeEach(async () => {
      // Create a test issue first
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          title: 'State Test Issue',
          description: 'For state updates',
        },
      });

      const body = JSON.parse(createResponse.body) as { data: LinearIssue };
      testIssue = body.data;
    });

    it('should update state to in_progress', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('should update state to in_review', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'in_review',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should update state to qa', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'qa',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should update state to backlog', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'backlog',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          'x-user-id': testUserId,
        },
        payload: {
          state: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when X-User-Id is missing', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: internalAuthHeader,
        payload: {
          state: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 when user not connected to Linear', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': 'disconnected-user',
        },
        payload: {
          state: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /internal/linear/issues/:identifier', () => {
    const testIssueId = 'linear-issue-123';
    const testIssueIdentifier = 'ENG-456';
    const testIssue: SyncedLinearIssue = {
      id: testIssueId,
      identifier: testIssueIdentifier,
      title: 'Test Issue Title',
      description: 'Test issue description',
      state: 'In Progress',
      stateType: 'started',
      priority: 2,
      assigneeId: 'user-456',
      assigneeName: 'John Doe',
      labels: [{ id: 'bug', name: 'bug', color: '#ff0000' }, { id: 'high-priority', name: 'high-priority', color: '#ff6600' }],
      url: 'https://linear.app/test/ENG-456',
      userId: testUserId,
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-16T12:30:00.000Z',
      syncedAt: '2024-01-16T12:30:00.000Z',
      teamId: 'team-1',
      parentId: null,
    };

    const testIssueWithoutAssignee: SyncedLinearIssue = {
      ...testIssue,
      id: 'linear-issue-789',
      identifier: 'ENG-789',
      assigneeId: null,
      assigneeName: null,
    };

    it('should return issue data with comment count and last comment timestamp', async () => {
      fakeIssueRepo.seedIssue(testIssue);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIssueIdentifier}`,
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          id: string;
          identifier: string;
          title: string;
          description: string | null;
          state: { name: string; type: string };
          priority: number;
          assignee: { id: string; name: string } | null;
          labels: { id: string; name: string }[];
          url: string;
          createdAt: string;
          updatedAt: string;
          commentCount: number;
          lastCommentAt: string | null;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testIssueId);
      expect(body.data.identifier).toBe(testIssueIdentifier);
      expect(body.data.title).toBe('Test Issue Title');
      expect(body.data.description).toBe('Test issue description');
      expect(body.data.state).toEqual({ name: 'In Progress', type: 'started' });
      expect(body.data.priority).toBe(2);
      expect(body.data.assignee).toEqual({ id: 'user-456', name: 'John Doe' });
      expect(body.data.labels).toEqual([
        { id: 'bug', name: 'bug' },
        { id: 'high-priority', name: 'high-priority' },
      ]);
      expect(body.data.url).toBe('https://linear.app/test/ENG-456');
      expect(body.data.commentCount).toBe(0);
      expect(body.data.lastCommentAt).toBeNull();
    });

    it('should return issue with assignee null when no assignee', async () => {
      fakeIssueRepo.seedIssue(testIssueWithoutAssignee);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/ENG-789`,
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as { success: boolean; data: { assignee: unknown } };
      expect(body.success).toBe(true);
      expect(body.data.assignee).toBeNull();
    });

    it('should return 401 when X-Internal-Auth is missing', async () => {
      fakeIssueRepo.seedIssue(testIssue);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIssueIdentifier}`,
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 404 when issue not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/ENG-999',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('ENG-999 not found');
    });

    it('should return 500 when issue repository fails', async () => {
      fakeIssueRepo.setFailure(true, { code: 'INTERNAL_ERROR', message: 'Database error' });

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIssueIdentifier}`,
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(502);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('should include comment count and last comment timestamp when comments exist', async () => {
      fakeIssueRepo.seedIssue(testIssue);

      const comment1: LinearComment = {
        id: 'comment-1',
        issueId: testIssueId,
        issueIdentifier: testIssueIdentifier,
        userId: 'user-1',
        userName: 'Alice',
        body: 'First comment',
        createdAt: '2024-01-16T10:00:00.000Z',
        updatedAt: '2024-01-16T10:00:00.000Z',
        syncedAt: '2024-01-16T10:00:00.000Z',
      };

      const comment2: LinearComment = {
        id: 'comment-2',
        issueId: testIssueId,
        issueIdentifier: testIssueIdentifier,
        userId: 'user-2',
        userName: 'Bob',
        body: 'Second comment',
        createdAt: '2024-01-17T14:30:00.000Z',
        updatedAt: '2024-01-17T14:30:00.000Z',
        syncedAt: '2024-01-17T14:30:00.000Z',
      };

      await fakeCommentRepo.save(comment1);
      await fakeCommentRepo.save(comment2);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIssueIdentifier}`,
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { commentCount: number; lastCommentAt: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.commentCount).toBe(2);
      expect(body.data.lastCommentAt).toBe('2024-01-17T14:30:00.000Z');
    });

    it('should return 401 when X-User-Id is missing', async () => {
      fakeIssueRepo.seedIssue(testIssue);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIssueIdentifier}`,
        headers: internalAuthHeader,
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 404 when issue belongs to different user', async () => {
      fakeIssueRepo.seedIssue(testIssue);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIssueIdentifier}`,
        headers: { ...internalAuthHeader, 'x-user-id': 'other-user-999' },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /internal/linear/issues/display-batch', () => {
    it('returns issue display data for multiple identifiers', async () => {
      fakeIssueRepo.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-101',
        title: 'First Batch Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [{ id: 'label-1', name: 'backend', color: '#000000' }],
        url: 'https://linear.app/test/ENG-101',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });
      fakeIssueRepo.seedIssue({
        id: 'issue-2',
        identifier: 'ENG-202',
        title: 'Second Batch Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: 'user-99',
        assigneeName: 'Jane Doe',
        labels: [],
        url: 'https://linear.app/test/ENG-202',
        userId: testUserId,
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        syncedAt: '2024-01-02T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });
      await fakeCommentRepo.save({
        id: 'comment-1',
        issueId: 'issue-1',
        issueIdentifier: 'ENG-101',
        userId: testUserId,
        userName: 'Alice',
        body: 'First comment',
        createdAt: '2024-01-03T10:00:00.000Z',
        updatedAt: '2024-01-03T10:00:00.000Z',
        syncedAt: '2024-01-03T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/display-batch',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: {
          identifiers: ['ENG-101', 'ENG-202', 'ENG-404'],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          issues: {
            identifier: string;
            title: string;
            commentCount: number;
            lastCommentAt: string | null;
          }[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.issues).toHaveLength(2);
      expect(body.data.issues.map((issue) => issue.identifier)).toEqual(['ENG-101', 'ENG-202']);
      expect(body.data.issues[0]?.title).toBe('First Batch Issue');
      expect(body.data.issues[0]?.commentCount).toBe(1);
      expect(body.data.issues[0]?.lastCommentAt).toBe('2024-01-03T10:00:00.000Z');
    });

    it('returns 401 when X-User-Id is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/display-batch',
        headers: internalAuthHeader,
        payload: {
          identifiers: ['ENG-101'],
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/display-batch',
        headers: { 'x-user-id': testUserId },
        payload: {
          identifiers: ['ENG-101'],
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 500 when issue lookup fails', async () => {
      fakeIssueRepo.setFailure(true, { code: 'INTERNAL_ERROR', message: 'Issue repo unavailable' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/display-batch',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: {
          identifiers: ['ENG-101'],
        },
      });

      expect(response.statusCode).toBe(502);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Issue repo unavailable');
    });

    it('returns 500 when comment lookup fails', async () => {
      fakeIssueRepo.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-101',
        title: 'First Batch Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-101',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });
      fakeCommentRepo.setListByIssueIdFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Comment repo unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/display-batch',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: {
          identifiers: ['ENG-101'],
        },
      });

      expect(response.statusCode).toBe(502);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Comment repo unavailable');
    });
  });

  describe('PATCH /internal/linear/issues/:issueId/metadata', () => {
    it('should return 404 when issue belongs to different user', async () => {
      fakeIssueRepo.seedIssue({
        id: 'owned-issue-1',
        identifier: 'ENG-100',
        title: 'Owned Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-100',
        userId: testUserId,
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-16T12:30:00.000Z',
        syncedAt: '2024-01-16T12:30:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/owned-issue-1/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': 'other-user-999' },
        payload: { addLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /internal/issues - error paths', () => {
    it('returns 502 when getApiKey fails', async () => {
      fakeConnectionRepo.setApiKeyFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { title: 'Test', description: 'Test' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when getFullConnection fails', async () => {
      fakeConnectionRepo.setGetFullConnectionFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { title: 'Test', description: 'Test' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when linearApiClient.createIssue fails', async () => {
      fakeLinearClient.setFailure(true, { code: 'API_ERROR', message: 'Linear API error' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { title: 'Test', description: 'Test' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('POST /internal/linear/issues/:issueId/comments', () => {
    it('returns 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/issue-123/comments',
        headers: { 'x-user-id': testUserId },
        payload: { body: 'A comment' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when X-User-Id is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/issue-123/comments',
        headers: internalAuthHeader,
        payload: { body: 'A comment' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when user not connected to Linear', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/issue-123/comments',
        headers: { ...internalAuthHeader, 'x-user-id': 'disconnected-user' },
        payload: { body: 'A comment' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 502 when getApiKey fails', async () => {
      fakeConnectionRepo.setApiKeyFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/issue-123/comments',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { body: 'A comment' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when createComment fails', async () => {
      fakeLinearClient.setFailure(true, { code: 'API_ERROR', message: 'Linear API error' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/issue-123/comments',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { body: 'A comment' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 200 when comment is created successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/issue-123/comments',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { body: 'A comment' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBeTruthy();
    });
  });

  describe('PATCH /internal/linear/issues/:issueId/metadata - additional error paths', () => {
    it('returns 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-123/metadata',
        headers: { 'x-user-id': testUserId },
        payload: { addLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when X-User-Id is missing', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-123/metadata',
        headers: internalAuthHeader,
        payload: { addLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 502 when issueRepository.findById fails', async () => {
      fakeIssueRepo.setFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-123/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { addLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 404 when issue not found', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/nonexistent-issue/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { addLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 502 when getApiKey fails', async () => {
      fakeIssueRepo.seedIssue({
        id: 'issue-meta-1',
        identifier: 'ENG-200',
        title: 'Meta Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-200',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });
      fakeConnectionRepo.setApiKeyFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-meta-1/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { addLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when listIssueLabels fails', async () => {
      fakeIssueRepo.seedIssue({
        id: 'issue-meta-2',
        identifier: 'ENG-201',
        title: 'Meta Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-201',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });
      fakeLinearClient.setFailure(true, { code: 'API_ERROR', message: 'Labels API error' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-meta-2/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { addLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('PATCH /internal/issues/:issueId/state - additional error paths', () => {
    let testIssueId: string;

    beforeEach(async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { title: 'State Error Test Issue', description: 'For error path testing' },
      });
      const body = JSON.parse(createResponse.body) as { data: { id: string } };
      testIssueId = body.data.id;
    });

    it('returns 502 when getApiKey fails', async () => {
      fakeConnectionRepo.setApiKeyFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssueId}/state`,
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { state: 'in_progress' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when getFullConnection fails', async () => {
      fakeConnectionRepo.setGetFullConnectionFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssueId}/state`,
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { state: 'in_progress' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when getWorkflowStates fails', async () => {
      fakeLinearClient.setFailure(true, { code: 'API_ERROR', message: 'Workflow states error' });

      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssueId}/state`,
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { state: 'in_progress' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 400 when state name is not found in workflow states', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssueId}/state`,
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { state: 'todo' },
      });

      // 'todo' maps to 'Todo' via STATE_NAME_MAP, but FakeLinearApiClient has no 'Todo' state
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 502 when updateIssueState fails', async () => {
      // Use an issueId that does not exist in FakeLinearApiClient's issues list
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/issues/nonexistent-issue-id/state',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { state: 'in_progress' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('GET /internal/linear/issues/:identifier - comment repository failure', () => {
    it('returns 502 when commentRepository.listByIssueId fails', async () => {
      fakeIssueRepo.seedIssue({
        id: 'issue-comment-err',
        identifier: 'ENG-999',
        title: 'Comment Error Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-999',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });
      fakeCommentRepo.setListByIssueIdFailure(true, { code: 'INTERNAL_ERROR', message: 'Comment DB error' });

      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/ENG-999',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('GET /internal/issues/:issueId/tree', () => {
    it('returns 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/issues/issue-1/tree',
        headers: { 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when X-User-Id is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/issues/issue-1/tree',
        headers: internalAuthHeader,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 502 when issueRepository.listByUserId fails', async () => {
      fakeIssueRepo.setListByUserIdFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'GET',
        url: '/internal/issues/issue-1/tree',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 404 when issue not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/issues/nonexistent-issue/tree',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns root issue and descendants', async () => {
      const root: import('../../domain/models.js').SyncedLinearIssue = {
        id: 'root-1',
        identifier: 'ENG-500',
        title: 'Root Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-500',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      };
      const child: import('../../domain/models.js').SyncedLinearIssue = {
        id: 'child-1',
        identifier: 'ENG-501',
        title: 'Child Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-501',
        userId: testUserId,
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        syncedAt: '2024-01-02T00:00:00.000Z',
        teamId: 'team-1',
        parentId: 'root-1',
      };
      fakeIssueRepo.seedIssue(root);
      fakeIssueRepo.seedIssue(child);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/issues/root-1/tree',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { root: { id: string }; descendants: { id: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.root.id).toBe('root-1');
      expect(body.data.descendants).toHaveLength(1);
      expect(body.data.descendants[0]?.id).toBe('child-1');
    });
  });
});
