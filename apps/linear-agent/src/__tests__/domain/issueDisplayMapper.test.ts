import { describe, it, expect } from 'vitest';
import { toCommentSummary, buildIssueDisplayResponse } from '../../domain/issueDisplayMapper.js';

describe('toCommentSummary', () => {
  it('returns zero count and null for empty array', () => {
    expect(toCommentSummary([])).toEqual({
      commentCount: 0,
      lastCommentAt: null,
    });
  });

  it('returns count and last comment timestamp', () => {
    const comments = [
      { createdAt: '2025-01-01T00:00:00Z' },
      { createdAt: '2025-01-02T00:00:00Z' },
    ];
    expect(toCommentSummary(comments)).toEqual({
      commentCount: 2,
      lastCommentAt: '2025-01-02T00:00:00Z',
    });
  });

  it('returns timestamp from single comment', () => {
    const comments = [{ createdAt: '2025-06-15T12:00:00Z' }];
    expect(toCommentSummary(comments)).toEqual({
      commentCount: 1,
      lastCommentAt: '2025-06-15T12:00:00Z',
    });
  });
});

describe('buildIssueDisplayResponse', () => {
  const baseIssue = {
    id: 'issue-1',
    identifier: 'INT-100',
    title: 'Test Issue',
    state: 'In Progress',
    stateType: 'started',
    priority: 2,
    assigneeId: 'user-1',
    assigneeName: 'John Doe',
    labels: [{ id: 'label-1', name: 'bug', color: '#ff0000' }],
    url: 'https://linear.app/test/INT-100',
  };

  const commentSummary = { commentCount: 5, lastCommentAt: '2025-01-15T00:00:00Z' };

  it('builds response with assignee', () => {
    const result = buildIssueDisplayResponse(baseIssue, commentSummary);
    expect(result).toEqual({
      identifier: 'INT-100',
      title: 'Test Issue',
      state: { name: 'In Progress', type: 'started' },
      priority: 2,
      assignee: { id: 'user-1', name: 'John Doe' },
      labels: [{ id: 'label-1', name: 'bug' }],
      url: 'https://linear.app/test/INT-100',
      commentCount: 5,
      lastCommentAt: '2025-01-15T00:00:00Z',
      parentIdentifier: null,
    });
  });

  it('builds response without assignee', () => {
    const issueWithoutAssignee = { ...baseIssue, assigneeId: null, assigneeName: null };
    const result = buildIssueDisplayResponse(issueWithoutAssignee, commentSummary);
    expect(result.assignee).toBeNull();
  });

  it('strips color from labels', () => {
    const result = buildIssueDisplayResponse(baseIssue, commentSummary);
    expect(result.labels).toEqual([{ id: 'label-1', name: 'bug' }]);
  });

  it('handles empty labels', () => {
    const issueNoLabels = { ...baseIssue, labels: [] };
    const result = buildIssueDisplayResponse(issueNoLabels, commentSummary);
    expect(result.labels).toEqual([]);
  });

  it('includes parent identifier when provided', () => {
    const result = buildIssueDisplayResponse(baseIssue, commentSummary, 'INT-42');
    expect(result.parentIdentifier).toBe('INT-42');
  });
});
