/**
 * Unit tests for the issue_comment event handler.
 */

import { describe, it, expect } from 'vitest';
import { parseIssueCommentEvent } from '../../../../infra/github/event-handlers/issue-comment-handler.js';

describe('parseIssueCommentEvent', () => {
  it('parses a comment on a pull request successfully', () => {
    const prCommentPayload = {
      id: 7001,
      action: 'created',
      repository: {
        id: 456,
        full_name: 'intexuraos/code-agent',
      },
      issue: {
        id: 202,
        number: 42,
        title: 'Test PR',
        state: 'open',
        pull_request: {
          url: 'https://api.github.com/repos/intexuraos/code-agent/pulls/42',
        },
      },
      comment: {
        id: 303,
        body: 'Looks good to me!',
      },
      sender: {
        login: 'reviewer',
        id: 222,
        type: 'User',
      },
    };

    const result = parseIssueCommentEvent(prCommentPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBeNull();
      expect(result.value?.eventType).toBe('issue_comment'); // @allow-result-access -- narrowed by result.ok
      expect(result.value?.body).toBe('Looks good to me!'); // @allow-result-access -- narrowed by result.ok
      expect(result.value?.pullRequestNumber).toBe(42); // @allow-result-access -- narrowed by result.ok
      expect(result.value?.action).toBe('created'); // @allow-result-access -- narrowed by result.ok
    }
  });

  it('returns ok(null) when the comment is on an issue (no pull_request field)', () => {
    const plainIssueCommentPayload = {
      id: 7002,
      action: 'created',
      repository: {
        id: 456,
        full_name: 'intexuraos/code-agent',
      },
      issue: {
        id: 204,
        number: 50,
        title: 'Plain issue — not a PR',
        state: 'open',
        // No `pull_request` field → this is a comment on an issue.
      },
      comment: {
        id: 305,
        body: 'A comment on a plain issue',
      },
      sender: {
        login: 'commenter',
        id: 333,
        type: 'User',
      },
    };

    const result = parseIssueCommentEvent(plainIssueCommentPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });
});
