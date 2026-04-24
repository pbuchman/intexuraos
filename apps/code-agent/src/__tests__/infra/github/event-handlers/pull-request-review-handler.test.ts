/**
 * Unit tests for the pull_request_review event handler.
 */

import { describe, it, expect } from 'vitest';
import { parsePullRequestReviewEvent } from '../../../../infra/github/event-handlers/pull-request-review-handler.js';

describe('parsePullRequestReviewEvent', () => {
  const basePayload = {
    id: 22222,
    action: 'submitted',
    repository: {
      id: 456,
      full_name: 'intexuraos/code-agent',
    },
    pull_request: {
      id: 101,
      number: 42,
      title: 'Feature: refactor event parser',
      body: 'PR body',
      state: 'open',
      merged_at: null,
      draft: false,
      base: { ref: 'main' },
      user: { login: 'pr-author' },
    },
    review: {
      body: 'Looks great — LGTM',
    },
    sender: {
      login: 'reviewer',
      id: 222,
      type: 'User',
    },
  };

  it('parses a submitted review and prefers the review body over the PR body', () => {
    const result = parsePullRequestReviewEvent(basePayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventType).toBe('pull_request_review'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.action).toBe('submitted'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.body).toBe('Looks great — LGTM'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.baseBranch).toBe('main'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.senderLogin).toBe('reviewer'); // @allow-result-access -- narrowed by result.ok
    }
  });

  it('falls back to the PR body when the review has no body', () => {
    const payloadWithoutReviewBody = {
      ...basePayload,
      review: {},
    };

    const result = parsePullRequestReviewEvent(payloadWithoutReviewBody);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body).toBe('PR body'); // @allow-result-access -- narrowed by result.ok
    }
  });
});
