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
  FakeFailedIssueRepository,
  FakeLinearActionExtractionService,
  FakeProcessedActionRepository,
  FakeUserServiceClient,
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
      failedIssueRepository: new FakeFailedIssueRepository(),
      extractionService: new FakeLinearActionExtractionService(),
      processedActionRepository: new FakeProcessedActionRepository(),
      issueRepository: fakeIssueRepo,
      userServiceClient: new FakeUserServiceClient(),
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

    it('should update state to done', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'done',
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
      fakeIssueRepo.setFindByIdentifiersFailure(true, { code: 'INTERNAL_ERROR', message: 'Issue repo unavailable' });

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

    it('returns 500 when comment summary lookup fails', async () => {
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
      fakeCommentRepo.setGetCommentSummariesFailure(true, {
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

    it('preserves identifier order in response', async () => {
      fakeIssueRepo.seedIssue({
        id: 'issue-z',
        identifier: 'ENG-300',
        title: 'Third Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-300',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });
      fakeIssueRepo.seedIssue({
        id: 'issue-a',
        identifier: 'ENG-100',
        title: 'First Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 1,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-100',
        userId: testUserId,
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        syncedAt: '2024-01-02T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/display-batch',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: {
          identifiers: ['ENG-300', 'ENG-100'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { issues: { identifier: string }[] };
      };
      expect(body.data.issues.map((i) => i.identifier)).toEqual(['ENG-300', 'ENG-100']);
    });

    it('returns empty array when no identifiers match', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/linear/issues/display-batch',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: {
          identifiers: ['ENG-999', 'ENG-888'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { issues: { identifier: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.issues).toHaveLength(0);
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

    it('should remove label when called with Linear identifier instead of UUID', async () => {
      fakeIssueRepo.seedIssue({
        id: 'uuid-123',
        identifier: 'INT-1147',
        title: 'Test Issue',
        description: null,
        state: 'In Review',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [{ id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' }],
        url: 'https://linear.app/test/INT-1147',
        userId: testUserId,
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-16T12:30:00.000Z',
        syncedAt: '2024-01-16T12:30:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });

      fakeLinearClient.setLabels([
        { id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' },
        { id: 'label-bug', name: 'bug', color: '#ff0000' },
      ]);

      fakeLinearClient.seedIssue({
        id: 'INT-1147',
        identifier: 'INT-1147',
        title: 'Test Issue',
        description: null,
        priority: 2,
        state: { id: 'state-1', name: 'In Review', type: 'started' },
        url: 'https://linear.app/test/INT-1147',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-16T12:30:00.000Z',
        completedAt: null,
        childCount: 0,
        children: [],
        labels: [{ id: 'label-rtm', name: 'ready-to-merge', color: '#00ff00' }],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/INT-1147/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { removeLabels: ['ready-to-merge'] },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { labels: { name: string }[] } };
      expect(body.success).toBe(true);
      expect(body.data.labels).toEqual([]);
    });

    it('should return 502 when findByIdentifier fails after findById returns null', async () => {
      fakeIssueRepo.setFindByIdentifierFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/INT-9999/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { removeLabels: ['ready-to-merge'] },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
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

  describe('PATCH /internal/linear/issues/:issueId/metadata - null apiKey and updateIssue paths', () => {
    const metaIssue: SyncedLinearIssue = {
      id: 'issue-meta-null-key',
      identifier: 'ENG-300',
      title: 'Meta Null Key Issue',
      description: null,
      state: 'In Progress',
      stateType: 'started',
      priority: 2,
      assigneeId: null,
      assigneeName: null,
      labels: [],
      url: 'https://linear.app/test/ENG-300',
      userId: 'user-no-connection',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      syncedAt: '2024-01-01T00:00:00.000Z',
      teamId: 'team-1',
      parentId: null,
    };

    beforeEach(() => {
      fakeIssueRepo.seedIssue(metaIssue);
    });

    it('returns 403 when getApiKey returns null (user not connected)', async () => {
      // user-no-connection has no seeded connection → getApiKey returns ok(null)
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-meta-null-key/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': 'user-no-connection' },
        payload: { addLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('PATCH /internal/linear/issues/:issueId/metadata - updateIssue paths', () => {
    const metaIssueForUpdate: SyncedLinearIssue = {
      id: 'issue-meta-update',
      identifier: 'ENG-400',
      title: 'Meta Update Issue',
      description: null,
      state: 'In Progress',
      stateType: 'started',
      priority: 2,
      assigneeId: null,
      assigneeName: null,
      labels: [],
      url: 'https://linear.app/test/ENG-400',
      userId: testUserId,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      syncedAt: '2024-01-01T00:00:00.000Z',
      teamId: 'team-1',
      parentId: null,
    };

    beforeEach(() => {
      fakeIssueRepo.seedIssue(metaIssueForUpdate);
    });

    it('returns 502 when updateIssue fails (issue not found in Linear API)', async () => {
      // fakeLinearClient has no issue seeded → updateIssue returns err('Issue not found')
      // This covers: listIssueLabels FALSE branch (labelsResult.ok=true), updateIssue call, updateResult not ok
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-meta-update/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { addLabels: [] },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 200 when metadata update succeeds (assignee null path)', async () => {
      // Seed issue in linearApiClient so updateIssue succeeds with no assignee
      fakeLinearClient.seedIssue({
        id: 'issue-meta-update',
        identifier: 'ENG-400',
        title: 'Meta Update Issue',
        description: null,
        priority: 2,
        state: { id: 'state-1', name: 'In Progress', type: 'started' },
        url: 'https://linear.app/test/ENG-400',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        childCount: 0,
        children: [],
        labels: [],
        // assignee not set → undefined → updateResult.value.assignee ?? null → null
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-meta-update/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { addLabels: [], assigneeId: 'assignee-123' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { id: string; labels: unknown[]; assignee: null; droppedLabels: string[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('issue-meta-update');
      expect(body.data.assignee).toBeNull();
      expect(body.data.droppedLabels).toEqual([]);
    });

    it('applies addLabels and removeLabels correctly', async () => {
      // Seed issue with initial labels: bug, feature
      fakeIssueRepo.seedIssue({
        id: 'issue-label-mutation',
        identifier: 'ENG-450',
        title: 'Label Mutation Test',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [
          { id: 'label-bug', name: 'bug', color: '#ff0000' },
          { id: 'label-feature', name: 'feature', color: '#00ff00' },
        ],
        url: 'https://linear.app/test/ENG-450',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });

      // Seed the same issue in Linear API client so updateIssue succeeds
      fakeLinearClient.seedIssue({
        id: 'issue-label-mutation',
        identifier: 'ENG-450',
        title: 'Label Mutation Test',
        description: null,
        priority: 2,
        state: { id: 'state-1', name: 'In Progress', type: 'started' },
        url: 'https://linear.app/test/ENG-450',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        childCount: 0,
        children: [],
        labels: [
          { id: 'label-bug', name: 'bug', color: '#ff0000' },
          { id: 'label-feature', name: 'feature', color: '#00ff00' },
        ],
      });

      // Seed available team labels: bug, feature, docs
      fakeLinearClient.setLabels([
        { id: 'label-bug', name: 'bug', color: '#ff0000' },
        { id: 'label-feature', name: 'feature', color: '#00ff00' },
        { id: 'label-docs', name: 'docs', color: '#0000ff' },
      ]);

      // PATCH: add 'docs', remove 'bug'
      // Expected: start with ['bug', 'feature'], add 'docs' -> ['bug', 'feature', 'docs'], remove 'bug' -> ['feature', 'docs']
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-label-mutation/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { addLabels: ['docs'], removeLabels: ['bug'] },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { id: string; labels: { id: string; name: string; color: string }[]; droppedLabels: string[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('issue-label-mutation');
      // Verify final labels are ['feature', 'docs'] (by ID)
      const labelIds = body.data.labels.map((l) => l.id).sort();
      expect(labelIds).toEqual(['label-docs', 'label-feature']);
      expect(body.data.droppedLabels).toEqual([]);
    });

    it('returns droppedLabels when addLabels include names not in team labels', async () => {
      fakeIssueRepo.seedIssue({
        id: 'issue-label-drop',
        identifier: 'ENG-460',
        title: 'Label Drop Test',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-460',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      });

      fakeLinearClient.seedIssue({
        id: 'issue-label-drop',
        identifier: 'ENG-460',
        title: 'Label Drop Test',
        description: null,
        priority: 2,
        state: { id: 'state-1', name: 'In Progress', type: 'started' },
        url: 'https://linear.app/test/ENG-460',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        childCount: 0,
        children: [],
        labels: [],
      });

      // Available labels do NOT include 'ready-to-merge'
      fakeLinearClient.setLabels([
        { id: 'label-bug', name: 'bug', color: '#ff0000' },
      ]);

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/linear/issues/issue-label-drop/metadata',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
        payload: { addLabels: ['bug', 'ready-to-merge'] },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { id: string; labels: { id: string; name: string }[]; droppedLabels: string[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.labels.map((l) => l.name)).toEqual(['bug']);
      expect(body.data.droppedLabels).toEqual(['ready-to-merge']);
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

  describe('GET /internal/linear/issues/:identifier/context', () => {
    const testIssueId = 'ctx-issue-1';
    const testIdentifier = 'ENG-100';
    const testIssue: SyncedLinearIssue = {
      id: testIssueId,
      identifier: testIdentifier,
      title: 'Context Test Issue',
      description: 'Some issue description',
      state: 'In Progress',
      stateType: 'started',
      priority: 2,
      assigneeId: null,
      assigneeName: null,
      labels: [],
      url: 'https://linear.app/test/ENG-100',
      userId: testUserId,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      syncedAt: '2024-01-01T00:00:00.000Z',
      teamId: 'team-1',
      parentId: null,
    };

    it('returns description and comments sorted newest first', async () => {
      fakeIssueRepo.seedIssue(testIssue);

      const olderComment: LinearComment = {
        id: 'comment-1',
        issueId: testIssueId,
        issueIdentifier: testIdentifier,
        userId: 'linear-user-1',
        userName: 'Alice',
        body: 'Older comment',
        createdAt: '2024-01-10T10:00:00.000Z',
        updatedAt: '2024-01-10T10:00:00.000Z',
        syncedAt: '2024-01-10T10:00:00.000Z',
      };
      const newerComment: LinearComment = {
        id: 'comment-2',
        issueId: testIssueId,
        issueIdentifier: testIdentifier,
        userId: 'linear-user-2',
        userName: 'Bob',
        body: 'Newer comment',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:00:00.000Z',
        syncedAt: '2024-01-15T10:00:00.000Z',
      };

      await fakeCommentRepo.save(olderComment);
      await fakeCommentRepo.save(newerComment);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIdentifier}/context`,
        headers: internalAuthHeader,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          description: string | null;
          comments: { body: string; createdAt: string }[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.description).toBe('Some issue description');
      expect(body.data.comments).toHaveLength(2);
      // Newest first
      expect(body.data.comments[0]?.body).toBe('Newer comment');
      expect(body.data.comments[0]?.createdAt).toBe('2024-01-15T10:00:00.000Z');
      expect(body.data.comments[1]?.body).toBe('Older comment');
      expect(body.data.comments[1]?.createdAt).toBe('2024-01-10T10:00:00.000Z');
    });

    it('returns null description when issue has no description', async () => {
      const noDescIssue: SyncedLinearIssue = { ...testIssue, description: null };
      fakeIssueRepo.seedIssue(noDescIssue);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIdentifier}/context`,
        headers: internalAuthHeader,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { description: string | null; comments: unknown[] };
      };
      expect(body.data.description).toBeNull();
      expect(body.data.comments).toHaveLength(0);
    });

    it('returns 404 when issue not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/linear/issues/ENG-NOTFOUND/context',
        headers: internalAuthHeader,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIdentifier}/context`,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 502 when issueRepository fails', async () => {
      fakeIssueRepo.setFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIdentifier}/context`,
        headers: internalAuthHeader,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 when commentRepository fails', async () => {
      fakeIssueRepo.seedIssue(testIssue);
      fakeCommentRepo.setListByIssueIdFailure(true, { code: 'INTERNAL_ERROR', message: 'Comment DB error' });

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIdentifier}/context`,
        headers: internalAuthHeader,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns null description when issue has empty-string description', async () => {
      const emptyDescIssue: SyncedLinearIssue = { ...testIssue, description: '' };
      fakeIssueRepo.seedIssue(emptyDescIssue);

      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${testIdentifier}/context`,
        headers: internalAuthHeader,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { description: string | null; comments: unknown[] };
      };
      expect(body.data.description).toBeNull();
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
      const root: SyncedLinearIssue = {
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
      const child: SyncedLinearIssue = {
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

    it('returns root with no children (empty descendants, covers ?? [] fallback)', async () => {
      // Root has no children → byParent.get(root.id) is undefined → ?? [] fires
      const root: SyncedLinearIssue = {
        id: 'root-leaf',
        identifier: 'ENG-510',
        title: 'Leaf Root Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-510',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      };
      fakeIssueRepo.seedIssue(root);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/issues/root-leaf/tree',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { root: { id: string }; descendants: unknown[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.root.id).toBe('root-leaf');
      expect(body.data.descendants).toHaveLength(0);
    });

    it('returns grandchildren in tree (covers children !== undefined branch)', async () => {
      // Three-level hierarchy: root → child → grandchild
      const root: SyncedLinearIssue = {
        id: 'root-deep',
        identifier: 'ENG-520',
        title: 'Deep Root',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-520',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      };
      const child: SyncedLinearIssue = {
        id: 'child-deep',
        identifier: 'ENG-521',
        title: 'Deep Child',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-521',
        userId: testUserId,
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        syncedAt: '2024-01-02T00:00:00.000Z',
        teamId: 'team-1',
        parentId: 'root-deep',
      };
      const grandchild: SyncedLinearIssue = {
        id: 'grandchild-deep',
        identifier: 'ENG-522',
        title: 'Deep Grandchild',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/test/ENG-522',
        userId: testUserId,
        createdAt: '2024-01-03T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
        syncedAt: '2024-01-03T00:00:00.000Z',
        teamId: 'team-1',
        parentId: 'child-deep',
      };
      fakeIssueRepo.seedIssue(root);
      fakeIssueRepo.seedIssue(child);
      fakeIssueRepo.seedIssue(grandchild);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/issues/root-deep/tree',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { root: { id: string }; descendants: { id: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.root.id).toBe('root-deep');
      expect(body.data.descendants).toHaveLength(2);
      const descendantIds = body.data.descendants.map((d) => d.id);
      expect(descendantIds).toContain('child-deep');
      expect(descendantIds).toContain('grandchild-deep');
    });

    it('tree response includes labels and assigneeId on root and descendants', async () => {
      // Root with labels and assigneeId
      const root: SyncedLinearIssue = {
        id: 'root-labels',
        identifier: 'ENG-600',
        title: 'Root With Labels',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: 'user-A',
        assigneeName: 'Alice',
        labels: [{ id: 'l1', name: 'backend', color: '#000' }],
        url: 'https://linear.app/test/ENG-600',
        userId: testUserId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        syncedAt: '2024-01-01T00:00:00.000Z',
        teamId: 'team-1',
        parentId: null,
      };
      // Child with different labels and assigneeId
      const child: SyncedLinearIssue = {
        id: 'child-labels',
        identifier: 'ENG-601',
        title: 'Child With Labels',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: 'user-B',
        assigneeName: 'Bob',
        labels: [{ id: 'l2', name: 'frontend', color: '#fff' }],
        url: 'https://linear.app/test/ENG-601',
        userId: testUserId,
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        syncedAt: '2024-01-02T00:00:00.000Z',
        teamId: 'team-1',
        parentId: 'root-labels',
      };
      fakeIssueRepo.seedIssue(root);
      fakeIssueRepo.seedIssue(child);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/issues/root-labels/tree',
        headers: { ...internalAuthHeader, 'x-user-id': testUserId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          root: { id: string; labels: string[]; assigneeId: string | null; state: string };
          descendants: { id: string; labels: string[]; assigneeId: string | null; state: string }[];
        };
      };
      expect(body.success).toBe(true);
      // Verify root has labels and assigneeId
      expect(body.data.root.id).toBe('root-labels');
      expect(body.data.root.labels).toEqual(['backend']);
      expect(body.data.root.assigneeId).toBe('user-A');
      expect(body.data.root.state).toBe('In Progress');
      // Verify child has labels and assigneeId
      expect(body.data.descendants).toHaveLength(1);
      expect(body.data.descendants[0]?.id).toBe('child-labels');
      expect(body.data.descendants[0]?.labels).toEqual(['frontend']);
      expect(body.data.descendants[0]?.assigneeId).toBe('user-B');
      expect(body.data.descendants[0]?.state).toBe('Backlog');
    });
  });
});
