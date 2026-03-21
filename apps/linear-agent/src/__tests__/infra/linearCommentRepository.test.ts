/**
 * Tests for linearCommentRepository.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, type FakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import {
  saveLinearComment,
  findCommentById,
  listCommentsByIssueId,
  countCommentsByIssueId,
  getCommentSummaries,
  deleteCommentById,
  createLinearCommentRepository,
} from '../../infra/firestore/linearCommentRepository.js';
import type { LinearComment } from '../../domain/index.js';

function createTestComment(overrides: Partial<LinearComment> = {}): LinearComment {
  return {
    id: 'comment-uuid-1',
    issueId: 'issue-uuid-1',
    issueIdentifier: 'INT-123',
    userId: 'user-1',
    userName: 'Test User',
    body: 'Test comment body',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    syncedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('linearCommentRepository', () => {
  let fakeFirestore: FakeFirestore;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveLinearComment', () => {
    it('saves a new comment', async () => {
      const comment = createTestComment();

      const result = await saveLinearComment(comment);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('comment-uuid-1');
        expect(result.value.body).toBe('Test comment body');
      }
    });

    it('merges existing comment with updates', async () => {
      const comment = createTestComment();
      await saveLinearComment(comment);

      const updatedComment = createTestComment({
        body: 'Updated body',
        syncedAt: '2025-01-02T00:00:00.000Z',
      });

      const result = await saveLinearComment(updatedComment);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe('Updated body');
      }
    });
  });

  describe('findCommentById', () => {
    it('finds existing comment by ID', async () => {
      const comment = createTestComment();
      await saveLinearComment(comment);

      const result = await findCommentById('comment-uuid-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.body).toBe('Test comment body');
      }
    });

    it('returns null for non-existent comment', async () => {
      const result = await findCommentById('non-existent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('listCommentsByIssueId', () => {
    it('lists all comments for an issue ordered by createdAt', async () => {
      await saveLinearComment(createTestComment({ id: 'comment-1', issueId: 'issue-1', createdAt: '2025-01-01T00:00:00.000Z' }));
      await saveLinearComment(createTestComment({ id: 'comment-2', issueId: 'issue-1', createdAt: '2025-01-03T00:00:00.000Z' }));
      await saveLinearComment(createTestComment({ id: 'comment-3', issueId: 'issue-1', createdAt: '2025-01-02T00:00:00.000Z' }));

      const result = await listCommentsByIssueId('issue-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        expect(result.value.map((c) => c.createdAt)).toEqual([
          '2025-01-01T00:00:00.000Z',
          '2025-01-02T00:00:00.000Z',
          '2025-01-03T00:00:00.000Z',
        ]);
      }
    });

    it('returns empty array when issue has no comments', async () => {
      const result = await listCommentsByIssueId('issue-without-comments');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('countCommentsByIssueId', () => {
    it('counts comments for an issue', async () => {
      await saveLinearComment(createTestComment({ id: 'comment-1', issueId: 'issue-1' }));
      await saveLinearComment(createTestComment({ id: 'comment-2', issueId: 'issue-1' }));
      await saveLinearComment(createTestComment({ id: 'comment-3', issueId: 'issue-1' }));

      const result = await countCommentsByIssueId('issue-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(3);
      }
    });

    it('returns zero when issue has no comments', async () => {
      const result = await countCommentsByIssueId('issue-without-comments');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0);
      }
    });
  });

  describe('getCommentSummaries', () => {
    it('returns empty array for empty issueIds array', async () => {
      const result = await getCommentSummaries([]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns correct count and max timestamp for single issue with multiple comments', async () => {
      await saveLinearComment(createTestComment({
        id: 'comment-1',
        issueId: 'issue-1',
        createdAt: '2025-01-01T00:00:00.000Z',
      }));
      await saveLinearComment(createTestComment({
        id: 'comment-2',
        issueId: 'issue-1',
        createdAt: '2025-01-03T00:00:00.000Z',
      }));
      await saveLinearComment(createTestComment({
        id: 'comment-3',
        issueId: 'issue-1',
        createdAt: '2025-01-02T00:00:00.000Z',
      }));

      const result = await getCommentSummaries(['issue-1']);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toEqual({
          issueId: 'issue-1',
          commentCount: 3,
          lastCommentAt: '2025-01-03T00:00:00.000Z',
        });
      }
    });

    it('returns correct summaries for multiple issues', async () => {
      // Issue 1: 2 comments
      await saveLinearComment(createTestComment({
        id: 'comment-1',
        issueId: 'issue-1',
        createdAt: '2025-01-01T00:00:00.000Z',
      }));
      await saveLinearComment(createTestComment({
        id: 'comment-2',
        issueId: 'issue-1',
        createdAt: '2025-01-02T00:00:00.000Z',
      }));

      // Issue 2: 3 comments
      await saveLinearComment(createTestComment({
        id: 'comment-3',
        issueId: 'issue-2',
        createdAt: '2025-01-01T00:00:00.000Z',
      }));
      await saveLinearComment(createTestComment({
        id: 'comment-4',
        issueId: 'issue-2',
        createdAt: '2025-01-05T00:00:00.000Z',
      }));
      await saveLinearComment(createTestComment({
        id: 'comment-5',
        issueId: 'issue-2',
        createdAt: '2025-01-03T00:00:00.000Z',
      }));

      const result = await getCommentSummaries(['issue-1', 'issue-2']);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]).toEqual({
          issueId: 'issue-1',
          commentCount: 2,
          lastCommentAt: '2025-01-02T00:00:00.000Z',
        });
        expect(result.value[1]).toEqual({
          issueId: 'issue-2',
          commentCount: 3,
          lastCommentAt: '2025-01-05T00:00:00.000Z',
        });
      }
    });

    it('returns zero count for issues with no comments', async () => {
      // Only add comment for issue-1
      await saveLinearComment(createTestComment({
        id: 'comment-1',
        issueId: 'issue-1',
      }));

      const result = await getCommentSummaries(['issue-1', 'issue-2', 'issue-3']);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        expect(result.value[0]).toEqual({
          issueId: 'issue-1',
          commentCount: 1,
          lastCommentAt: '2025-01-01T00:00:00.000Z',
        });
        expect(result.value[1]).toEqual({
          issueId: 'issue-2',
          commentCount: 0,
          lastCommentAt: null,
        });
        expect(result.value[2]).toEqual({
          issueId: 'issue-3',
          commentCount: 0,
          lastCommentAt: null,
        });
      }
    });

    it('correctly chunks more than 30 issueIds (Firestore in limit)', async () => {
      // Create 35 issues with comments (exceeds Firestore in limit of 30)
      const issueIds: string[] = [];
      for (let i = 0; i < 35; i++) {
        const issueId = `issue-${i}`;
        issueIds.push(issueId);
        await saveLinearComment(createTestComment({
          id: `comment-${i}`,
          issueId,
          createdAt: `2025-01-${String(i % 28 + 1).padStart(2, '0')}T00:00:00.000Z`,
        }));
      }

      const result = await getCommentSummaries(issueIds);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(35);
        // Verify first and last entries
        expect(result.value[0]?.issueId).toBe('issue-0');
        expect(result.value[0]?.commentCount).toBe(1);
        expect(result.value[34]?.issueId).toBe('issue-34');
        expect(result.value[34]?.commentCount).toBe(1);
      }
    });

    it('handles multiple comments per issue when chunking', async () => {
      // Create 32 issues, some with multiple comments
      const issueIds: string[] = [];
      for (let i = 0; i < 32; i++) {
        const issueId = `issue-${i}`;
        issueIds.push(issueId);
        // First comment for each issue
        await saveLinearComment(createTestComment({
          id: `comment-${i}-1`,
          issueId,
          createdAt: '2025-01-01T00:00:00.000Z',
        }));
        // Extra comment for even-numbered issues
        if (i % 2 === 0) {
          await saveLinearComment(createTestComment({
            id: `comment-${i}-2`,
            issueId,
            createdAt: '2025-01-02T00:00:00.000Z',
          }));
        }
      }

      const result = await getCommentSummaries(issueIds);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(32);
        // Even indices should have 2 comments
        expect(result.value[0]?.commentCount).toBe(2);
        expect(result.value[0]?.lastCommentAt).toBe('2025-01-02T00:00:00.000Z');
        // Odd indices should have 1 comment
        expect(result.value[1]?.commentCount).toBe(1);
        expect(result.value[1]?.lastCommentAt).toBe('2025-01-01T00:00:00.000Z');
      }
    });
  });

  describe('deleteCommentById', () => {
    it('deletes existing comment', async () => {
      await saveLinearComment(createTestComment());

      const deleteResult = await deleteCommentById('comment-uuid-1');
      expect(deleteResult.ok).toBe(true);

      const findResult = await findCommentById('comment-uuid-1');
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toBeNull();
      }
    });

    it('succeeds even for non-existent comment', async () => {
      const result = await deleteCommentById('non-existent');
      expect(result.ok).toBe(true);
    });
  });

  describe('createLinearCommentRepository', () => {
    it('creates repository with all methods', () => {
      const repo = createLinearCommentRepository();

      expect(repo.save).toBeDefined();
      expect(repo.findById).toBeDefined();
      expect(repo.listByIssueId).toBeDefined();
      expect(repo.countByIssueId).toBeDefined();
      expect(repo.getCommentSummaries).toBeDefined();
      expect(repo.deleteById).toBeDefined();
    });
  });
});
