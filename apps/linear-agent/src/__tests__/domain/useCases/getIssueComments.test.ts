/**
 * Tests for getIssueComments use case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getIssueComments,
  type GetIssueCommentsRequest,
} from '../../../domain/useCases/getIssueComments.js';
import {
  FakeLinearIssueRepository,
  FakeLinearCommentRepository,
} from '../../fakes.js';
import type { SyncedLinearIssue, LinearComment } from '../../../domain/models.js';

describe('getIssueComments', () => {
  let fakeIssueRepo: FakeLinearIssueRepository;
  let fakeCommentRepo: FakeLinearCommentRepository;

  beforeEach(() => {
    fakeIssueRepo = new FakeLinearIssueRepository();
    fakeCommentRepo = new FakeLinearCommentRepository();
  });

  afterEach(() => {
    fakeIssueRepo.reset();
    fakeCommentRepo.reset();
  });

  const defaultRequest: GetIssueCommentsRequest = {
    identifier: 'ENG-123',
    userId: 'user-456',
    limit: 20,
    offset: 0,
  };

  function seedIssue(overrides?: Partial<SyncedLinearIssue>): void {
    const issue: SyncedLinearIssue = {
      id: 'issue-1',
      identifier: 'ENG-123',
      title: 'Test Issue',
      description: 'Test description',
      state: 'Backlog',
      stateType: 'backlog',
      priority: 2,
      assigneeId: null,
      assigneeName: null,
      labels: [],
      url: 'https://linear.app/team/issue/ENG-123',
      userId: 'user-456',
      parentId: null,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
      syncedAt: '2025-01-15T00:00:00Z',
      teamId: 'team-789',
    };
    fakeIssueRepo.seedIssue({ ...issue, ...overrides });
  }

  function seedComments(count: number): void {
    for (let i = 0; i < count; i++) {
      const comment: LinearComment = {
        id: `comment-${i}`,
        issueId: 'issue-1',
        issueIdentifier: 'ENG-123',
        userId: 'user-789',
        userName: 'Test User',
        body: `Comment body ${i}`,
        createdAt: new Date(i * 1000).toISOString(),
        updatedAt: new Date(i * 1000).toISOString(),
        syncedAt: new Date().toISOString(),
      };
      // Use save to seed comments (simulating how they'd be stored)
      fakeCommentRepo.save(comment);
    }
  }

  describe('successful retrieval', () => {
    beforeEach(() => {
      seedIssue();
    });

    it('should return paginated comments', async () => {
      seedComments(5);

      const result = await getIssueComments(defaultRequest, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          comments: expect.arrayContaining([]),
          total: 5,
          limit: 20,
          offset: 0,
          hasMore: false,
        });
        expect(result.value?.comments).toHaveLength(5);
      }
    });

    it('should respect pagination parameters', async () => {
      seedComments(10);

      const result = await getIssueComments(
        { ...defaultRequest, limit: 3, offset: 2 },
        {
          issueRepository: fakeIssueRepo,
          commentRepository: fakeCommentRepo,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.hasMore).toBe(true);
      }
    });

    it('should return hasMore=false when offset equals total', async () => {
      seedComments(5);

      const result = await getIssueComments(
        { ...defaultRequest, limit: 10, offset: 5 },
        {
          issueRepository: fakeIssueRepo,
          commentRepository: fakeCommentRepo,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.comments).toHaveLength(0);
        expect(result.value?.hasMore).toBe(false);
      }
    });

    it('should return empty when offset exceeds total', async () => {
      seedComments(3);

      const result = await getIssueComments(
        { ...defaultRequest, limit: 10, offset: 100 },
        {
          issueRepository: fakeIssueRepo,
          commentRepository: fakeCommentRepo,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.comments).toHaveLength(0);
        expect(result.value?.hasMore).toBe(false);
      }
    });
  });

  describe('issue not found', () => {
    it('should return null when issue does not exist', async () => {
      const result = await getIssueComments(defaultRequest, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null when issue belongs to different user', async () => {
      seedIssue({ userId: 'different-user' });

      const result = await getIssueComments(defaultRequest, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      seedIssue();
    });

    it('should return error when findByIdentifier fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake property
      (fakeIssueRepo as any).shouldFail = true;

      const result = await getIssueComments(defaultRequest, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(false);
    });

    it('should return error when listByIssueId fails', async () => {
      fakeCommentRepo.setListByIssueIdFailure(true);

      const result = await getIssueComments(defaultRequest, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(false);
    });

    it('should return error when countByIssueId fails', async () => {
      fakeCommentRepo.setCountByIssueIdFailure(true);

      const result = await getIssueComments(defaultRequest, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(false);
    });
  });
});
