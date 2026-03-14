/**
 * Tests for GitHub webhook event parser.
 */

import { describe, it, expect } from 'vitest';
import {
  parsePullRequestEvent,
  parsePullRequestReviewEvent,
  parsePullRequestReviewCommentEvent,
  parseIssueCommentEvent,
  parsePushEvent,
  parseGitHubWebhookEvent,
  shouldProcessRepository,
} from '../../infra/github-event-parser.js';

describe('github-event-parser', () => {
  describe('shouldProcessRepository', () => {
    it('should accept intexuraos/* repositories', () => {
      expect(shouldProcessRepository('intexuraos/code-agent')).toBe(true);
      expect(shouldProcessRepository('intexuraos/web')).toBe(true);
      expect(shouldProcessRepository('intexuraos/docs')).toBe(true);
    });

    it('should accept username/intexuraos format', () => {
      expect(shouldProcessRepository('pbuchman/intexuraos')).toBe(true);
    });

    it('should reject non-intexuraos repositories', () => {
      expect(shouldProcessRepository('other/repo')).toBe(false);
      expect(shouldProcessRepository('intexuraos-other/repo')).toBe(false);
      expect(shouldProcessRepository('')).toBe(false);
    });
  });

  describe('parsePullRequestEvent', () => {
    const validPRPayload = {
      id: 12345,
      action: 'opened',
      repository: {
        id: 456,
        name: 'code-agent',
        full_name: 'intexuraos/code-agent',
        owner: {
          login: 'intexuraos',
          id: 789,
        },
      },
      pull_request: {
        id: 101,
        number: 42,
        title: 'Test PR',
        body: 'Test description',
        state: 'open',
        merged_at: null,
        base: { ref: 'main' },
        user: { login: 'pr-author' },
      },
      sender: {
        login: 'testuser',
        id: 111,
        type: 'User',
      },
    };

    it('should parse valid pull_request event', () => {
      const result = parsePullRequestEvent(validPRPayload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({ // @allow-result-access -- narrowed by result.ok
          githubEventId: 12345,
          deliveryId: null,
          repository: 'intexuraos/code-agent',
          repositoryId: 456,
          pullRequestNumber: 42,
          pullRequestId: 101,
          eventType: 'pull_request',
          action: 'opened',
          senderLogin: 'testuser',
          senderId: 111,
          prAuthorLogin: 'pr-author',
          title: 'Test PR',
          body: 'Test description',
          state: 'open',
          baseBranch: 'main',
          mergedAt: null,
        });
        expect(result.value.createdAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should handle missing optional fields', () => {
      const minimalPayload = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(minimalPayload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value.body).toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value.state).toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value.baseBranch).toBeNull(); // @allow-result-access -- no base in payload
        expect(result.value.action).toBeNull(); // Not a valid action
        expect(result.value.mergedAt).toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value.prAuthorLogin).toBeNull(); // @allow-result-access -- no user in payload
      }
    });

    it('should parse baseBranch as null when base is missing', () => {
      const payloadWithoutBase = {
        ...validPRPayload,
        pull_request: {
          ...validPRPayload.pull_request,
          base: undefined,
        },
      };

      const result = parsePullRequestEvent(payloadWithoutBase);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.baseBranch).toBeNull(); // @allow-result-access -- no base in payload
      }
    });

    it('should handle Date string for merged_at', () => {
      const payloadWithDate = {
        ...validPRPayload,
        pull_request: {
          ...validPRPayload.pull_request,
          merged_at: '2024-01-15T12:00:00Z',
        },
      };

      const result = parsePullRequestEvent(payloadWithDate);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mergedAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
        expect(result.value.mergedAt?.toISOString()).toBe('2024-01-15T12:00:00.000Z'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should return error for non-object payload', () => {
      const result = parsePullRequestEvent(null);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Payload is not an object');
      }
    });

    it('should return error for missing sender', () => {
      const payload = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing or invalid sender');
      }
    });

    it('should return error for missing repository', () => {
      const payload = {
        id: 12345,
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing repository');
      }
    });

    it('should return error for missing pull_request', () => {
      const payload = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing pull_request');
      }
    });

    it('should validate known PR actions', () => {
      const validActions = [
        'opened',
        'closed',
        'edited',
        'synchronize',
        'reopened',
        'assigned',
        'review_requested',
      ] as const;

      validActions.forEach((action) => {
        const payload = {
          action,
          repository: {
            id: 456,
            full_name: 'intexuraos/code-agent',
          },
          pull_request: {
            id: 101,
            number: 42,
          },
          sender: {
            login: 'testuser',
            id: 111,
          },
        };

        const result = parsePullRequestEvent(payload);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe(action); // @allow-result-access -- narrowed by result.ok
        }
      });
    });

    it('should filter unknown PR actions to null', () => {
      const payload = {
        action: 'unknown_action',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBeNull(); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should return prAuthorLogin as null when pull_request.user is missing', () => {
      const payload = {
        ...validPRPayload,
        pull_request: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test description',
          state: 'open',
          base: { ref: 'main' },
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.prAuthorLogin).toBeNull(); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should return prAuthorLogin as null when pull_request.user.login is not a string', () => {
      const payload = {
        ...validPRPayload,
        pull_request: {
          ...validPRPayload.pull_request,
          user: { login: 12345 },
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.prAuthorLogin).toBeNull(); // @allow-result-access -- narrowed by result.ok
      }
    });
  });

  describe('parsePullRequestReviewEvent', () => {
    const validReviewPayload = {
      id: 12345,
      action: 'submitted',
      repository: {
        id: 456,
        full_name: 'intexuraos/code-agent',
      },
      pull_request: {
        id: 101,
        number: 42,
        title: 'Test PR',
        state: 'open',
        base: { ref: 'main' },
        user: { login: 'pr-author' },
      },
      review: {
        id: 456,
        body: 'LGTM',
        state: 'approved',
      },
      sender: {
        login: 'reviewer',
        id: 111,
        type: 'User',
      },
    };

    it('should parse valid review event', () => {
      const result = parsePullRequestReviewEvent(validReviewPayload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({ // @allow-result-access -- narrowed by result.ok
          githubEventId: 12345,
          deliveryId: null,
          repository: 'intexuraos/code-agent',
          pullRequestNumber: 42,
          eventType: 'pull_request_review',
          action: 'submitted',
          senderLogin: 'reviewer',
          prAuthorLogin: 'pr-author',
          body: 'LGTM',
          baseBranch: 'main',
        });
      }
    });

    it('should use review body when available (covers nullish coalescing branch)', () => {
      const payloadWithReviewBody = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
          body: 'PR body here',
        },
        review: {
          id: 456,
          body: 'Great work!', // Review body exists
          state: 'approved',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payloadWithReviewBody);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe('Great work!'); // @allow-result-access -- review body used
      }
    });

    it('should fall back to PR body when review body is null (tests right side of ??)', () => {
      const payloadWithNullReviewBody = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
          body: 'PR body here',
        },
        review: {
          id: 456,
          body: null, // Explicitly null - triggers ?? fallback
          state: 'approved',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payloadWithNullReviewBody);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe('PR body here'); // @allow-result-access -- fell back to PR body
      }
    });

    it('should fall back to PR body when review body is missing', () => {
      const payloadWithoutReviewBody = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
          body: 'PR body here',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payloadWithoutReviewBody);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe('PR body here'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should handle null review object', () => {
      const payloadWithNullReview = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
          body: 'PR body',
        },
        review: null,
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payloadWithNullReview);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe('PR body'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should handle merged_at string in review events', () => {
      const payloadWithMergedAt = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
          merged_at: '2024-01-15T12:00:00Z',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payloadWithMergedAt);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mergedAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
        expect(result.value.mergedAt?.toISOString()).toBe('2024-01-15T12:00:00.000Z'); // @allow-result-access -- narrowed by result.ok
      }
    });
  });

  describe('parsePushEvent', () => {
    const validPushPayload = {
      id: 12345,
      ref: 'refs/heads/main',
      repository: {
        id: 456,
        full_name: 'intexuraos/code-agent',
      },
      sender: {
        login: 'pusher',
        id: 111,
        type: 'User',
      },
    };

    it('should parse valid push event', () => {
      const result = parsePushEvent(validPushPayload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({ // @allow-result-access -- narrowed by result.ok
          deliveryId: null,
          eventType: 'push',
          repository: 'intexuraos/code-agent',
          pullRequestNumber: 0,
          pullRequestId: 0,
          action: null,
          prAuthorLogin: null,
          title: 'Push to main',
          baseBranch: null,
        });
      }
    });

    it('should handle unknown ref gracefully', () => {
      const payloadWithoutRef = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        sender: {
          login: 'pusher',
          id: 111,
        },
      };

      const result = parsePushEvent(payloadWithoutRef);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.title).toBe('Push to unknown'); // @allow-result-access -- narrowed by result.ok && result.value !== null
      }
    });

    it('should handle missing created_at with current time', () => {
      const payloadWithoutDate = {
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        sender: {
          login: 'pusher',
          id: 111,
        },
      };

      const result = parsePushEvent(payloadWithoutDate);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.createdAt).toBeInstanceOf(Date);
        // Should be very recent (within last second)
        const now = new Date();
        const diff = Math.abs(now.getTime() - result.value.createdAt.getTime()); // @allow-result-access -- narrowed by result.ok && result.value !== null
        expect(diff).toBeLessThan(1000);
      }
    });
  });

  describe('parsePullRequestReviewCommentEvent', () => {
    const validCommentPayload = {
      id: 12345,
      action: 'created',
      repository: {
        id: 456,
        full_name: 'intexuraos/code-agent',
      },
      pull_request: {
        id: 101,
        number: 42,
        title: 'Test PR',
        state: 'open',
        base: { ref: 'main' },
        user: { login: 'pr-author' },
      },
      comment: {
        id: 789,
        body: 'Nice code!',
        path: 'src/index.ts',
        line: 10,
      },
      sender: {
        login: 'reviewer',
        id: 111,
        type: 'User',
      },
    };

    it('should parse valid review comment event', () => {
      const result = parsePullRequestReviewCommentEvent(validCommentPayload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({ // @allow-result-access -- narrowed by result.ok
          githubEventId: 12345,
          deliveryId: null,
          repository: 'intexuraos/code-agent',
          pullRequestNumber: 42,
          eventType: 'pull_request_review_comment',
          action: 'created',
          senderLogin: 'reviewer',
          prAuthorLogin: 'pr-author',
          body: 'Nice code!',
          baseBranch: 'main',
        });
      }
    });

    it('should handle missing comment body', () => {
      const payloadWithoutCommentBody = {
        ...validCommentPayload,
        comment: {
          id: 789,
          path: 'src/index.ts',
        },
      };

      const result = parsePullRequestReviewCommentEvent(payloadWithoutCommentBody);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBeNull(); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should handle missing comment object entirely', () => {
      const payloadWithoutComment = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewCommentEvent(payloadWithoutComment);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBeNull(); // @allow-result-access -- no comment object
      }
    });

    it('should return error for non-object payload', () => {
      const result = parsePullRequestReviewCommentEvent(null);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Payload is not an object');
      }
    });

    it('should return error for missing sender', () => {
      const payload = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
      };

      const result = parsePullRequestReviewCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing or invalid sender');
      }
    });

    it('should return error for missing repository', () => {
      const payload = {
        id: 12345,
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing repository');
      }
    });

    it('should return error for invalid repository data', () => {
      const payload = {
        id: 12345,
        repository: {
          id: 'not-a-number',
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid repository data');
      }
    });

    it('should return error for missing pull_request', () => {
      const payload = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing pull_request');
      }
    });

    it('should return error for invalid pull_request data', () => {
      const payload = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 'not-a-number',
          number: 42,
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid pull_request data');
      }
    });

    it('should handle merged_at string', () => {
      const payloadWithMergedAt = {
        ...validCommentPayload,
        pull_request: {
          ...validCommentPayload.pull_request,
          merged_at: '2024-01-15T12:00:00Z',
        },
      };

      const result = parsePullRequestReviewCommentEvent(payloadWithMergedAt);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mergedAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
        expect(result.value.mergedAt?.toISOString()).toBe('2024-01-15T12:00:00.000Z'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should handle Date instance for created_at', () => {
      const createdDate = new Date('2024-01-15T12:00:00Z');
      const payloadWithDateObject = {
        ...validCommentPayload,
        created_at: createdDate,
      };

      const result = parsePullRequestReviewCommentEvent(payloadWithDateObject);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
        expect(result.value.createdAt).toEqual(createdDate); // @allow-result-access -- Date instance passed through
      }
    });

    it('should filter unknown actions to null', () => {
      const payloadWithUnknownAction = {
        ...validCommentPayload,
        action: 'unknown_action',
      };

      const result = parsePullRequestReviewCommentEvent(payloadWithUnknownAction);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBeNull(); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should handle deleted action', () => {
      const payloadWithDeleted = {
        ...validCommentPayload,
        action: 'deleted',
      };

      const result = parsePullRequestReviewCommentEvent(payloadWithDeleted);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('deleted'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should use Date.now() when event id is missing', () => {
      const payloadWithoutId = {
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        comment: {
          id: 789,
          body: 'Nice code!',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const beforeTime = Date.now();
      const result = parsePullRequestReviewCommentEvent(payloadWithoutId);
      const afterTime = Date.now();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.githubEventId).toBeGreaterThanOrEqual(beforeTime);
        expect(result.value.githubEventId).toBeLessThanOrEqual(afterTime);
      }
    });
  });

  describe('parseIssueCommentEvent', () => {
    const validIssueCommentPayload = {
      id: 12345,
      action: 'created',
      repository: {
        id: 456,
        full_name: 'intexuraos/code-agent',
      },
      issue: {
        id: 101,
        number: 42,
        title: 'Test PR',
        state: 'open',
        pull_request: {
          url: 'https://api.github.com/repos/intexuraos/code-agent/pulls/42',
        },
      },
      comment: {
        id: 789,
        body: 'Great work on this PR!',
      },
      sender: {
        login: 'commenter',
        id: 111,
        type: 'User',
      },
    };

    it('should parse valid issue_comment on a PR', () => {
      const result = parseIssueCommentEvent(validIssueCommentPayload);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value).toMatchObject({
          githubEventId: 12345,
          deliveryId: null,
          repository: 'intexuraos/code-agent',
          pullRequestNumber: 42,
          pullRequestId: 101,
          eventType: 'issue_comment',
          action: 'created',
          senderLogin: 'commenter',
          prAuthorLogin: null,
          body: 'Great work on this PR!',
          title: 'Test PR',
          state: 'open',
          baseBranch: null,
        });
      }
    });

    it('should return null for comments on issues (not PRs)', () => {
      const issueOnlyPayload = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        issue: {
          id: 101,
          number: 42,
          title: 'Bug report',
          state: 'open',
          // No pull_request field - this is a regular issue
        },
        comment: {
          id: 789,
          body: 'Thanks for reporting!',
        },
        sender: {
          login: 'maintainer',
          id: 111,
        },
      };

      const result = parseIssueCommentEvent(issueOnlyPayload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should handle missing comment body', () => {
      const payloadWithoutCommentBody = {
        ...validIssueCommentPayload,
        comment: {
          id: 789,
        },
      };

      const result = parseIssueCommentEvent(payloadWithoutCommentBody);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.body).toBeNull();
      }
    });

    it('should handle missing comment object entirely', () => {
      const payloadWithoutComment = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        issue: {
          id: 101,
          number: 42,
          pull_request: { url: 'https://api.github.com/...' },
        },
        sender: {
          login: 'commenter',
          id: 111,
        },
      };

      const result = parseIssueCommentEvent(payloadWithoutComment);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.body).toBeNull();
      }
    });

    it('should return error for non-object payload', () => {
      const result = parseIssueCommentEvent(null);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Payload is not an object');
      }
    });

    it('should return error for missing issue', () => {
      const payload = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        comment: {
          id: 789,
          body: 'Hello!',
        },
        sender: {
          login: 'commenter',
          id: 111,
        },
      };

      const result = parseIssueCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing issue');
      }
    });

    it('should return error for missing sender', () => {
      const payload = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        issue: {
          id: 101,
          number: 42,
          pull_request: { url: 'https://...' },
        },
        comment: {
          id: 789,
          body: 'Hello!',
        },
      };

      const result = parseIssueCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing or invalid sender');
      }
    });

    it('should return error for missing repository', () => {
      const payload = {
        id: 12345,
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          pull_request: { url: 'https://...' },
        },
        comment: {
          id: 789,
          body: 'Hello!',
        },
        sender: {
          login: 'commenter',
          id: 111,
        },
      };

      const result = parseIssueCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing repository');
      }
    });

    it('should return error for invalid repository data', () => {
      const payload = {
        id: 12345,
        action: 'created',
        repository: {
          id: 'not-a-number',
          full_name: 'intexuraos/code-agent',
        },
        issue: {
          id: 101,
          number: 42,
          pull_request: { url: 'https://...' },
        },
        sender: {
          login: 'commenter',
          id: 111,
        },
      };

      const result = parseIssueCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid repository data');
      }
    });

    it('should return error for invalid issue data', () => {
      const payload = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        issue: {
          id: 'not-a-number',
          number: 42,
          pull_request: { url: 'https://...' },
        },
        sender: {
          login: 'commenter',
          id: 111,
        },
      };

      const result = parseIssueCommentEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid issue data');
      }
    });

    it('should filter unknown actions to null', () => {
      const payloadWithUnknownAction = {
        ...validIssueCommentPayload,
        action: 'unknown_action',
      };

      const result = parseIssueCommentEvent(payloadWithUnknownAction);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.action).toBeNull();
      }
    });

    it('should handle deleted action', () => {
      const payloadWithDeleted = {
        ...validIssueCommentPayload,
        action: 'deleted',
      };

      const result = parseIssueCommentEvent(payloadWithDeleted);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.action).toBe('deleted');
      }
    });

    it('should handle Date instance for created_at', () => {
      const createdDate = new Date('2024-01-15T12:00:00Z');
      const payloadWithDateObject = {
        ...validIssueCommentPayload,
        created_at: createdDate,
      };

      const result = parseIssueCommentEvent(payloadWithDateObject);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.createdAt).toEqual(createdDate);
      }
    });

    it('should use Date.now() when event id is missing', () => {
      const payloadWithoutId = {
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        issue: {
          id: 101,
          number: 42,
          pull_request: { url: 'https://...' },
        },
        comment: {
          id: 789,
          body: 'Hello!',
        },
        sender: {
          login: 'commenter',
          id: 111,
        },
      };

      const beforeTime = Date.now();
      const result = parseIssueCommentEvent(payloadWithoutId);
      const afterTime = Date.now();

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.githubEventId).toBeGreaterThanOrEqual(beforeTime);
        expect(result.value.githubEventId).toBeLessThanOrEqual(afterTime);
      }
    });
  });

  describe('parseGitHubWebhookEvent', () => {
    it('should parse pull_request events', () => {
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parseGitHubWebhookEvent('pull_request', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value?.eventType).toBe('pull_request'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should parse pull_request_review events', () => {
      const payload = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parseGitHubWebhookEvent('pull_request_review', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value?.eventType).toBe('pull_request_review'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should parse pull_request_review_comment events', () => {
      const payload = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        comment: {
          id: 789,
          body: 'Nice code!',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parseGitHubWebhookEvent('pull_request_review_comment', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value?.eventType).toBe('pull_request_review_comment'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should parse push events', () => {
      const payload = {
        id: 12345,
        ref: 'refs/heads/main',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        sender: {
          login: 'pusher',
          id: 111,
        },
      };

      const result = parseGitHubWebhookEvent('push', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value?.eventType).toBe('push'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should parse issue_comment events on PRs', () => {
      const payload = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        issue: {
          id: 101,
          number: 42,
          pull_request: { url: 'https://api.github.com/...' },
        },
        comment: {
          id: 789,
          body: 'Great work!',
        },
        sender: {
          login: 'commenter',
          id: 111,
        },
      };

      const result = parseGitHubWebhookEvent('issue_comment', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull(); // @allow-result-access -- narrowed by result.ok
        expect(result.value?.eventType).toBe('issue_comment'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should return null for issue_comment on non-PR issues', () => {
      const payload = {
        id: 12345,
        action: 'created',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        issue: {
          id: 101,
          number: 42,
          // No pull_request field - this is a regular issue
        },
        comment: {
          id: 789,
          body: 'Thanks for reporting!',
        },
        sender: {
          login: 'commenter',
          id: 111,
        },
      };

      const result = parseGitHubWebhookEvent('issue_comment', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull(); // @allow-result-access -- ignored for non-PR issues
      }
    });

    it('should return null for ping events', () => {
      const payload = { zen: 'May you have pleasant debugging' };

      const result = parseGitHubWebhookEvent('ping', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull(); // @allow-result-access -- testing null result for ping event
      }
    });

    it('should return null for unknown event types', () => {
      const payload = { some: 'data' };

      const result = parseGitHubWebhookEvent('unknown_event', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull(); // @allow-result-access -- testing null result for unknown event
      }
    });

    it('should return error for invalid payload', () => {
      const result = parseGitHubWebhookEvent('pull_request', null);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
      }
    });

    // Defensive validation tests - covering type checking branches
    it('should return error for sender with invalid login type', () => {
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 12345, // Invalid: number instead of string
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid sender login');
      }
    });

    it('should return error for sender with invalid id type', () => {
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 'not-a-number', // Invalid: string instead of number
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid sender id');
      }
    });

    it('should return error for repository with invalid full_name type', () => {
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 456,
          full_name: 12345, // Invalid: number instead of string
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid repository data');
      }
    });

    it('should return error for repository with invalid id type', () => {
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 'not-a-number', // Invalid: string instead of number
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid repository data');
      }
    });

    it('should return error for pull_request with invalid number type', () => {
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 'not-a-number', // Invalid: string instead of number
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid pull_request data');
      }
    });

    it('should return error for pull_request with invalid id type', () => {
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 'not-a-number', // Invalid: string instead of number
          number: 42,
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid pull_request data');
      }
    });

    // Date instance branch tests - covering defensive instanceof checks
    it('should handle Date instance for merged_at', () => {
      const mergedDate = new Date('2024-01-15T12:00:00Z');
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
          merged_at: mergedDate, // Date object instead of ISO string
        },
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mergedAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
        expect(result.value.mergedAt).toEqual(mergedDate); // @allow-result-access -- Date instance passed through
      }
    });

    it('should handle Date instance for created_at', () => {
      const createdDate = new Date('2024-01-15T12:00:00Z');
      const payload = {
        id: 12345,
        action: 'opened',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        created_at: createdDate, // Date object instead of ISO string
        sender: {
          login: 'testuser',
          id: 111,
        },
      };

      const result = parsePullRequestEvent(payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
        expect(result.value.createdAt).toEqual(createdDate); // @allow-result-access -- Date instance passed through
      }
    });
  });

  describe('parsePullRequestReviewEvent - Date instance branches', () => {
    it('should return error for non-object payload', () => {
      const result = parsePullRequestReviewEvent(null);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Payload is not an object');
      }
    });

    it('should return error for missing sender', () => {
      const payload = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
      };

      const result = parsePullRequestReviewEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing or invalid sender');
      }
    });

    it('should return error for missing repository', () => {
      const payload = {
        id: 12345,
        action: 'submitted',
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing repository');
      }
    });

    it('should return error for missing pull_request', () => {
      const payload = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing pull_request');
      }
    });

    it('should return error for invalid repository data', () => {
      const payload = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 'not-a-number',
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid repository data');
      }
    });

    it('should return error for invalid pull_request data', () => {
      const payload = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 'not-a-number',
          number: 42,
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid pull_request data');
      }
    });

    it('should filter unknown review actions to null', () => {
      const payload = {
        id: 12345,
        action: 'unknown_action',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBeNull(); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should handle merged_at string in review events', () => {
      const payloadWithMergedAt = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
          merged_at: '2024-01-15T12:00:00Z',
        },
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payloadWithMergedAt);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mergedAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
        expect(result.value.mergedAt?.toISOString()).toBe('2024-01-15T12:00:00.000Z'); // @allow-result-access -- narrowed by result.ok
      }
    });

    it('should handle Date instance for created_at in review events', () => {
      const createdDate = new Date('2024-01-15T12:00:00Z');
      const payload = {
        id: 12345,
        action: 'submitted',
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        pull_request: {
          id: 101,
          number: 42,
        },
        created_at: createdDate, // Date object instead of ISO string
        sender: {
          login: 'reviewer',
          id: 111,
        },
      };

      const result = parsePullRequestReviewEvent(payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok
        expect(result.value.createdAt).toEqual(createdDate); // @allow-result-access -- Date instance passed through
      }
    });
  });

  describe('parsePushEvent - Date instance branches', () => {
    it('should return error for non-object payload', () => {
      const result = parsePushEvent(null);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Payload is not an object');
      }
    });

    it('should return error for missing sender', () => {
      const payload = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
      };

      const result = parsePushEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing or invalid sender');
      }
    });

    it('should return error for missing repository', () => {
      const payload = {
        id: 12345,
        sender: {
          login: 'pusher',
          id: 111,
        },
      };

      const result = parsePushEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Missing repository');
      }
    });

    it('should return error for invalid repository data', () => {
      const payload = {
        id: 12345,
        repository: {
          id: 'not-a-number',
          full_name: 'intexuraos/code-agent',
        },
        sender: {
          login: 'pusher',
          id: 111,
        },
      };

      const result = parsePushEvent(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PAYLOAD');
        expect(result.error.message).toBe('Invalid repository data');
      }
    });

    it('should handle Date instance for created_at in push events', () => {
      const createdDate = new Date('2024-01-15T12:00:00Z');
      const payload = {
        id: 12345,
        repository: {
          id: 456,
          full_name: 'intexuraos/code-agent',
        },
        created_at: createdDate, // Date object instead of ISO string
        sender: {
          login: 'pusher',
          id: 111,
        },
      };

      const result = parsePushEvent(payload);

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.createdAt).toBeInstanceOf(Date); // @allow-result-access -- narrowed by result.ok && result.value !== null
        expect(result.value.createdAt).toEqual(createdDate); // @allow-result-access -- Date instance passed through
      }
    });
  });
});
