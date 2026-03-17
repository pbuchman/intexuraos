/**
 * Tests for validateIssue use case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinearConnection, LinearIssueWithTeam } from '../../../domain/models.js';
import {
  validateIssue,
  type ValidateIssueRequest,
} from '../../../domain/useCases/validateIssue.js';
import { FakeLinearConnectionRepository, FakeLinearApiClient } from '../../fakes.js';

describe('validateIssue', () => {
  let fakeConnectionRepo: FakeLinearConnectionRepository;
  let fakeLinearClient: FakeLinearApiClient;
  const fakeLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    fakeConnectionRepo = new FakeLinearConnectionRepository();
    fakeLinearClient = new FakeLinearApiClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fakeConnectionRepo.reset();
    fakeLinearClient.reset();
  });

  const defaultRequest: ValidateIssueRequest = {
    identifier: 'INT-123',
    userId: 'user-456',
  };

  function setupConnectedUser(): void {
    const connection: LinearConnection = {
      userId: 'user-456',
      apiKey: 'linear-api-key',
      teamId: 'team-789',
      teamName: 'Engineering',
      webhookSecret: null,
      connected: true,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    };
    fakeConnectionRepo.seedConnection(connection);
  }

  function createIssueWithTeam(overrides: Partial<LinearIssueWithTeam>): LinearIssueWithTeam {
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
      teamId: 'team-789',
      labels: [],
      childCount: 0,
      children: [],
      ...overrides,
    };
  }

  describe('successful validation', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('validates an existing issue that belongs to user team', async () => {
      const issue = createIssueWithTeam({});
      fakeLinearClient.seedIssueWithTeam(issue);

      const result = await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('issue-1');
        expect(result.value.identifier).toBe('INT-123');
        expect(result.value.title).toBe('Test Issue');
        expect(result.value.url).toBe('https://linear.app/team/issue/INT-123');
        expect(result.value.parentId).toBe(null);
      }
    });

    it('includes parentId when issue is a subtask', async () => {
      const issue = createIssueWithTeam({ parentId: 'parent-issue-456' });
      fakeLinearClient.seedIssueWithTeam(issue);

      const result = await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.parentId).toBe('parent-issue-456');
      }
    });

    it('logs successful validation', async () => {
      const issue = createIssueWithTeam({});
      fakeLinearClient.seedIssueWithTeam(issue);

      await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'INT-123', issueId: 'issue-1' }),
        'Issue validated successfully'
      );
    });
  });

  describe('invalid identifier format', () => {
    it('returns INVALID_FORMAT error for lowercase identifier', async () => {
      const result = await validateIssue(
        { identifier: 'int-123', userId: 'user-456' },
        {
          linearApiClient: fakeLinearClient,
          connectionRepository: fakeConnectionRepo,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_FORMAT');
        expect(result.error.message).toContain('Invalid issue identifier format');
      }
    });

    it('returns INVALID_FORMAT error for missing hyphen', async () => {
      const result = await validateIssue(
        { identifier: 'INT123', userId: 'user-456' },
        {
          linearApiClient: fakeLinearClient,
          connectionRepository: fakeConnectionRepo,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });

    it('returns INVALID_FORMAT error for non-numeric suffix', async () => {
      const result = await validateIssue(
        { identifier: 'INT-ABC', userId: 'user-456' },
        {
          linearApiClient: fakeLinearClient,
          connectionRepository: fakeConnectionRepo,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });
  });

  describe('connection errors', () => {
    it('returns API_ERROR when connection repository fails', async () => {
      fakeConnectionRepo.setGetFullConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database error',
      });

      const result = await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Database error');
      }
    });

    it('returns NOT_CONNECTED error when user has no connection', async () => {
      const result = await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('Linear not connected');
      }
    });
  });

  describe('issue not found', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('returns NOT_FOUND error when issue does not exist', async () => {
      const result = await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('INT-123');
        expect(result.error.message).toContain('not found');
      }
    });

    it('logs warning when issue not found', async () => {
      await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'INT-123' }),
        'Issue not found'
      );
    });
  });

  describe('wrong team', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('returns WRONG_TEAM error when issue belongs to different team', async () => {
      const issue = createIssueWithTeam({ teamId: 'different-team-999' });
      fakeLinearClient.seedIssueWithTeam(issue);

      const result = await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WRONG_TEAM');
        expect(result.error.message).toContain('different team');
      }
    });

    it('logs warning when issue belongs to different team', async () => {
      const issue = createIssueWithTeam({ teamId: 'different-team-999' });
      fakeLinearClient.seedIssueWithTeam(issue);

      await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'INT-123',
          issueTeamId: 'different-team-999',
          userTeamId: 'team-789',
        }),
        'Issue belongs to different team'
      );
    });
  });

  describe('API errors', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('returns API_ERROR when Linear API fails', async () => {
      fakeLinearClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'Rate limit exceeded',
      });

      const result = await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });

    it('logs warning when API fails', async () => {
      fakeLinearClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'Rate limit exceeded',
      });

      await validateIssue(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        logger: fakeLogger,
      });

      expect(fakeLogger.warn).toHaveBeenCalled();
    });
  });
});
