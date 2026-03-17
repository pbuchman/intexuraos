/**
 * Tests for processWebhook use case.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { processWebhook } from '../../../domain/useCases/processWebhook.js';
import type { LinearConnectionRepository, LinearIssueRepository, LinearCommentRepository, CodeAgentClient } from '../../../domain/ports.js';
import type { SyncedLinearIssue, LinearComment, CommentSummary, LinearConnectionPublic, LinearConnection } from '../../../domain/models.js';
import type { LinearError } from '../../../domain/errors.js';
import type { ProcessWebhookResult } from '../../../domain/useCases/processWebhook.js';

// Type guard helpers for discriminated union
function expectIgnored(result: ProcessWebhookResult): asserts result is { outcome: 'ignored'; message: string } {
  expect(result.outcome).toBe('ignored');
}

function expectProcessed(result: ProcessWebhookResult): asserts result is { outcome: 'processed'; action: string; issueId?: string; commentId?: string } {
  expect(result.outcome).toBe('processed');
}

function expectUnauthorized(result: ProcessWebhookResult): asserts result is { outcome: 'unauthorized'; message: string } {
  expect(result.outcome).toBe('unauthorized');
}

// Create a simple fake logger
function createFakeLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    silent: () => undefined,
    level: 'info',
  } as unknown as Logger;
}

// Fake repositories for testing
class FakeConnectionRepository implements LinearConnectionRepository {
  private userIdsByTeam = new Map<string, string[]>();
  private secretsByTeam = new Map<string, { userId: string; webhookSecret: string } | null>();
  private shouldFailFindUserIds = false;
  private shouldFailFindSecret = false;

  setUserIdsForTeam(teamId: string, userIds: string[]): void {
    this.userIdsByTeam.set(teamId, userIds);
  }

  setWebhookSecretForTeam(teamId: string, secret: { userId: string; webhookSecret: string } | null): void {
    this.secretsByTeam.set(teamId, secret);
  }

  setShouldFailFindUserIds(shouldFail: boolean): void {
    this.shouldFailFindUserIds = shouldFail;
  }

  setShouldFailFindSecret(shouldFail: boolean): void {
    this.shouldFailFindSecret = shouldFail;
  }

  async findUserIdsByTeamId(teamId: string): Promise<Result<string[], LinearError>> {
    if (this.shouldFailFindUserIds) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Database error' } };
    }
    return ok(this.userIdsByTeam.get(teamId) ?? []);
  }

  async findWebhookSecretByTeamId(teamId: string): Promise<Result<{ userId: string; webhookSecret: string } | null, LinearError>> {
    if (this.shouldFailFindSecret) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Database error' } };
    }
    return ok(this.secretsByTeam.get(teamId) ?? null);
  }

   
  async save(_userId: string, _apiKey: string, _teamId: string, _teamName: string): Promise<Result<LinearConnectionPublic, LinearError>> {
    return ok({ connected: true, teamId: 'team-1', teamName: 'Test Team', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' });
  }

   
  async getConnection(_userId: string): Promise<Result<LinearConnectionPublic | null, LinearError>> {
    return ok(null);
  }

   
  async getApiKey(_userId: string): Promise<Result<string | null, LinearError>> {
    return ok(null);
  }

   
  async getFullConnection(_userId: string): Promise<Result<LinearConnection | null, LinearError>> {
    return ok(null);
  }

   
  async isConnected(_userId: string): Promise<Result<boolean, LinearError>> {
    return ok(false);
  }

   
  async disconnect(_userId: string): Promise<Result<LinearConnectionPublic, LinearError>> {
    return ok({ connected: false, teamId: null, teamName: null, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' });
  }

   
  async updateWebhookSecret(_userId: string, _webhookSecret: string | null): Promise<Result<void, LinearError>> {
    return ok(undefined);
  }

  async getAllConnectedUserIds(): Promise<Result<string[], LinearError>> {
    return ok([]);
  }
}

class FakeIssueRepository implements LinearIssueRepository {
  private issues = new Map<string, SyncedLinearIssue>();
  private userIdsByIssue = new Map<string, string[]>();
  private shouldFailFindById = false;

  setIssue(issue: SyncedLinearIssue): void {
    this.issues.set(issue.id, issue);
  }

  setUserIdsForIssue(issueId: string, userIds: string[]): void {
    this.userIdsByIssue.set(issueId, userIds);
  }

  setShouldFailFindById(shouldFail: boolean): void {
    this.shouldFailFindById = shouldFail;
  }

  async findById(id: string): Promise<Result<SyncedLinearIssue | null, LinearError>> {
    if (this.shouldFailFindById) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Database error' } };
    }
    return ok(this.issues.get(id) ?? null);
  }

  async findUserIdsByIssueId(issueId: string): Promise<Result<string[], LinearError>> {
    return ok(this.userIdsByIssue.get(issueId) ?? []);
  }

   
  async save(_issue: SyncedLinearIssue): Promise<Result<SyncedLinearIssue, LinearError>> {
    return ok(_issue);
  }

   
  async findByIdentifier(_identifier: string, _userId?: string): Promise<Result<SyncedLinearIssue | null, LinearError>> {
    return ok(null);
  }

   
  async findByIdentifiers(_identifiers: string[], _userId: string): Promise<Result<SyncedLinearIssue[], LinearError>> {
    return ok([]);
  }

   
  async listByUserId(_userId: string): Promise<Result<SyncedLinearIssue[], LinearError>> {
    return ok([]);
  }

   
  async deleteById(_id: string, _userId: string): Promise<Result<void, LinearError>> {
    return ok(undefined);
  }
}

class FakeCommentRepository implements LinearCommentRepository {
  private comments = new Map<string, LinearComment>();
  private shouldFailSave = false;

  setShouldFailSave(shouldFail: boolean): void {
    this.shouldFailSave = shouldFail;
  }

  async save(comment: LinearComment): Promise<Result<LinearComment, LinearError>> {
    if (this.shouldFailSave) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Database error' } };
    }
    this.comments.set(comment.id, comment);
    return ok(comment);
  }


  async findById(_id: string): Promise<Result<LinearComment | null, LinearError>> {
    return ok(null);
  }

   
  async listByIssueId(_issueId: string): Promise<Result<LinearComment[], LinearError>> {
    return ok([]);
  }

   
  async countByIssueId(_issueId: string): Promise<Result<number, LinearError>> {
    return ok(0);
  }

   
  async getCommentSummaries(_issueIds: string[]): Promise<Result<CommentSummary[], LinearError>> {
    return ok([]);
  }

   
  async deleteById(_id: string): Promise<Result<void, LinearError>> {
    return ok(undefined);
  }
}

class FakeCodeAgentClient implements CodeAgentClient {

  async triggerCodeTask(_request: {
    userId: string;
    linearIssueId: string;
    prompt: string;
    workerType: string;
    actionId: string;
    approvalEventId: string;
  }): Promise<Result<{ codeTaskId: string }, { code: string; message: string }>> {
    return ok({ codeTaskId: 'task-123' });
  }
}

// Test helper functions
const createIssuePayload = (): {
  id: string;
  identifier: string;
  title: string;
  description: string;
  priority: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  state: { id: string; name: string; type: 'backlog' };
  assignee: null;
  labels: unknown[];
  team: { id: string; key: string };
} => ({
  id: 'issue-123',
  identifier: 'INT-123',
  title: 'Test Issue',
  description: 'Test description',
  priority: 2,
  url: 'https://linear.app/issue/INT-123',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  state: {
    id: 'state-1',
    name: 'Backlog',
    type: 'backlog' as const,
  },
  assignee: null,
  labels: [],
  team: {
    id: 'team-1',
    key: 'TEAM',
  },
});

const createCommentPayload = (): {
  id: string;
  issueId: string;
  issueIdentifier: string;
  user: { id: string; name: string };
  body: string;
  createdAt: string;
  updatedAt: string;
} => ({
  id: 'comment-123',
  issueId: 'issue-123',
  issueIdentifier: 'INT-123',
  user: {
    id: 'user-1',
    name: 'Test User',
  },
  body: 'Test comment',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});

const createSyncedIssue = (): SyncedLinearIssue => ({
  id: 'issue-123',
  identifier: 'INT-123',
  title: 'Test Issue',
  description: 'Test description',
  priority: 2,
  state: 'Backlog',
  stateType: 'backlog',
  teamId: 'team-1',
  url: 'https://linear.app/issue/INT-123',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  userId: 'user-1',
  syncedAt: '2024-01-01T00:00:00Z',
  labels: [],
  assigneeId: null,
  assigneeName: null,
  parentId: null,
});

describe('processWebhook', () => {
  let connectionRepo: FakeConnectionRepository;
  let issueRepo: FakeIssueRepository;
  let commentRepo: FakeCommentRepository;
  let codeAgentClient: FakeCodeAgentClient;
  let logger: Logger;

  const webhookSecret = 'test-webhook-secret';
  const rawBody = JSON.stringify({ test: 'data' });

  beforeEach(() => {
    connectionRepo = new FakeConnectionRepository();
    issueRepo = new FakeIssueRepository();
    commentRepo = new FakeCommentRepository();
    codeAgentClient = new FakeCodeAgentClient();
    logger = createFakeLogger();
  });

  const createValidSignatureValidator = () => {
    return (): Result<void, string> => ok(undefined);
  };

  const createInvalidSignatureValidator = () => {
    return (): Result<void, string> => ({ ok: false, error: 'Invalid signature' });
  };

  describe('ignored types', () => {
    it('ignores non-Issue and non-Comment webhook types', async () => {
      const result = await processWebhook(
        {
          action: 'create',
          type: 'Cycle',
          data: {},
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Ignored');
    });

    it('ignores Project type webhooks', async () => {
      const result = await processWebhook(
        {
          action: 'create',
          type: 'Project',
          data: { id: 'proj-1', name: 'Test Project' },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Ignored');
    });
  });

  describe('issue processing', () => {
    it('returns error when no users are connected to the team', async () => {
      connectionRepo.setUserIdsForTeam('team-1', []);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: createIssuePayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Team not connected');
    });

    it('returns error when webhook secret is not configured', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', null);

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: createIssuePayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Webhook not configured');
    });

    it('returns unauthorized when signature validation fails', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: createIssuePayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createInvalidSignatureValidator(),
          logger,
        }
      );

      expectUnauthorized(result);
      expect(result.message).toBe('Invalid webhook signature');
    });

    it('processes issue create webhook successfully', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: createIssuePayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('created');
      expect(result.issueId).toBe('issue-123');
    });

    it('processes issue update webhook successfully', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'update',
          type: 'Issue',
          data: createIssuePayload(),
          updatedFrom: { stateId: 'state-old' },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('updated');
    });

    it('processes issue remove webhook successfully', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'remove',
          type: 'Issue',
          data: createIssuePayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('deleted');
    });
  });

  describe('comment processing', () => {
    it('returns ignored when issue is not found', async () => {
      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Issue not found');
    });

    it('returns ignored when issue has no teamId', async () => {
      const issue = createSyncedIssue();
      issue.teamId = '';
      issueRepo.setIssue(issue);

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Webhook not configured');
    });

    it('returns unauthorized when signature validation fails', async () => {
      issueRepo.setIssue(createSyncedIssue());
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createInvalidSignatureValidator(),
          logger,
        }
      );

      expectUnauthorized(result);
      expect(result.message).toBe('Invalid webhook signature');
    });

    it('processes comment create webhook successfully', async () => {
      issueRepo.setIssue(createSyncedIssue());
      issueRepo.setUserIdsForIssue('issue-123', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('created');
      expect(result.commentId).toBe('comment-123');
    });

    it('processes comment update webhook successfully', async () => {
      issueRepo.setIssue(createSyncedIssue());
      issueRepo.setUserIdsForIssue('issue-123', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'update',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('updated');
    });

    it('processes comment remove webhook successfully', async () => {
      issueRepo.setIssue(createSyncedIssue());
      issueRepo.setUserIdsForIssue('issue-123', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'remove',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('deleted');
    });
  });

  describe('validation branches', () => {
    it('returns ignored when team.id is missing', async () => {
      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: {
            id: 'issue-123',
            identifier: 'INT-123',
            title: 'Test Issue',
            team: {}, // missing id
          },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Invalid data structure');
    });

    it('returns ignored when required fields are missing', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: {
            team: { id: 'team-1', key: 'TEAM' },
            // missing id, identifier, title
          },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Invalid data structure');
    });

    it('returns error when connection lookup fails', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });
      connectionRepo.setShouldFailFindUserIds(true);

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: createIssuePayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expect(result.outcome).toBe('error');
      expect((result as { message: string }).message).toBe('Failed to lookup connection');
    });

    it('returns error when webhook secret lookup fails', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setShouldFailFindSecret(true);

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: createIssuePayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expect(result.outcome).toBe('error');
      expect((result as { message: string }).message).toBe('Failed to lookup connection');
    });
  });

  describe('issue field defaults', () => {
    it('processes issue with missing optional fields using defaults', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: {
            id: 'issue-123',
            identifier: 'INT-123',
            title: 'Test Issue',
            team: { id: 'team-1', key: 'TEAM' },
            // Missing: description, priority, url, createdAt, updatedAt, state, assignee, labels
          },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('created');
    });

    it('processes issue with non-array labels', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: {
            id: 'issue-123',
            identifier: 'INT-123',
            title: 'Test Issue',
            team: { id: 'team-1', key: 'TEAM' },
            labels: 'not-an-array', // invalid labels
          },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('created');
    });

    it('processes issue with parent field', async () => {
      connectionRepo.setUserIdsForTeam('team-1', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: {
            id: 'issue-123',
            identifier: 'INT-123',
            title: 'Test Issue',
            team: { id: 'team-1', key: 'TEAM' },
            parent: { id: 'parent-issue-456' },
          },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('created');
    });
  });

  describe('comment processing error paths', () => {
    it('returns error when comment sync fails', async () => {
      issueRepo.setIssue(createSyncedIssue());
      issueRepo.setUserIdsForIssue('issue-123', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });
      commentRepo.setShouldFailSave(true);

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expect(result.outcome).toBe('error');
      expect((result as { message: string }).message).toBe('Failed to sync comment');
    });

    it('returns error when issue lookup fails for comment', async () => {
      issueRepo.setShouldFailFindById(true);

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expect(result.outcome).toBe('error');
      expect((result as { message: string }).message).toBe('Failed to lookup issue');
    });

    it('returns ignored when comment issueId is empty string', async () => {
      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: {
            ...createCommentPayload(),
            issueId: '',
          },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Invalid data structure');
    });

    it('returns error when webhook secret lookup fails for comment', async () => {
      issueRepo.setIssue(createSyncedIssue());
      connectionRepo.setShouldFailFindSecret(true);

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: createCommentPayload(),
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expect(result.outcome).toBe('error');
      expect((result as { message: string }).message).toBe('Failed to lookup connection');
    });

    it('processes comment with missing optional fields using defaults', async () => {
      issueRepo.setIssue(createSyncedIssue());
      issueRepo.setUserIdsForIssue('issue-123', ['user-1']);
      connectionRepo.setWebhookSecretForTeam('team-1', { userId: 'user-1', webhookSecret });

      const result = await processWebhook(
        {
          action: 'create',
          type: 'Comment',
          data: {
            issueId: 'issue-123',
            // Missing: id, issueIdentifier, user, body, createdAt, updatedAt
          },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectProcessed(result);
      expect(result.action).toBe('created');
    });
  });

  describe('unknown data structure', () => {
    it('ignores webhook with unknown data structure', async () => {
      const result = await processWebhook(
        {
          action: 'create',
          type: 'Issue',
          data: { unknown: 'structure' },
          webhookTimestamp: Date.now(),
          webhookId: 'webhook-1',
          rawBody,
        },
        {
          connectionRepository: connectionRepo,
          issueRepository: issueRepo,
          commentRepository: commentRepo,
          codeAgentClient,
          validateSignature: createValidSignatureValidator(),
          logger,
        }
      );

      expectIgnored(result);
      expect(result.message).toBe('Unknown data structure');
    });
  });
});
