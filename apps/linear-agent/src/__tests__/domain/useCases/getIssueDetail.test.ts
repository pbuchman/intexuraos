/**
 * Tests for getIssueDetail use case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIssueDetail } from '../../../domain/useCases/getIssueDetail.js';
import {
  FakeLinearIssueRepository,
  FakeLinearCommentRepository,
} from '../../fakes.js';
import type { SyncedLinearIssue, LinearComment } from '../../../domain/models.js';

describe('getIssueDetail', () => {
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

  function seedIssue(overrides?: Partial<SyncedLinearIssue>): void {
    const issue: SyncedLinearIssue = {
      id: 'issue-1',
      identifier: 'ENG-123',
      title: 'Test Issue',
      description: 'Test description',
      state: 'Backlog',
      stateType: 'backlog',
      priority: 2,
      assigneeId: 'user-789',
      assigneeName: 'Assignee Name',
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
      fakeCommentRepo.save(comment);
    }
  }

  describe('successful retrieval', () => {
    beforeEach(() => {
      seedIssue();
    });

    it('should return issue detail without comments', async () => {
      const result = await getIssueDetail({ identifier: 'ENG-123', userId: 'user-456' }, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.identifier).toBe('ENG-123');
        expect(result.value?.title).toBe('Test Issue');
        expect(result.value?.commentCount).toBe(0);
        expect(result.value?.lastCommentAt).toBeNull();
      }
    });

    it('should return issue detail with comments', async () => {
      seedComments(3);

      const result = await getIssueDetail({ identifier: 'ENG-123', userId: 'user-456' }, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.commentCount).toBe(3);
        expect(result.value?.lastCommentAt).toBeDefined();
      }
    });

    it('should include assignee when present', async () => {
      const result = await getIssueDetail({ identifier: 'ENG-123', userId: 'user-456' }, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.assignee).toEqual({
          id: 'user-789',
          name: 'Assignee Name',
        });
      }
    });

    it('should include labels', async () => {
      seedIssue({
        labels: [
          { id: 'label-1', name: 'Bug', color: '#FF0000' },
          { id: 'label-2', name: 'Feature', color: '#00FF00' },
        ],
      });

      const result = await getIssueDetail({ identifier: 'ENG-123', userId: 'user-456' }, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.labels).toHaveLength(2);
      }
    });
  });

  describe('issue not found', () => {
    it('should return null when issue does not exist', async () => {
      const result = await getIssueDetail({ identifier: 'ENG-999', userId: 'user-456' }, {
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

      const result = await getIssueDetail({ identifier: 'ENG-123', userId: 'user-456' }, {
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

      const result = await getIssueDetail({ identifier: 'ENG-123', userId: 'user-456' }, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(false);
    });

    it('should return error when listByIssueId fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake property
      (fakeCommentRepo as any).shouldFail = true;

      const result = await getIssueDetail({ identifier: 'ENG-123', userId: 'user-456' }, {
        issueRepository: fakeIssueRepo,
        commentRepository: fakeCommentRepo,
      });

      expect(result.ok).toBe(false);
    });
  });
});
