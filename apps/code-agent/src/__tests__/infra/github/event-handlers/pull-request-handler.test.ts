/**
 * Unit tests for the pull_request event handler.
 */

import { describe, it, expect } from 'vitest';
import { parsePullRequestEvent } from '../../../../infra/github/event-handlers/pull-request-handler.js';

describe('parsePullRequestEvent', () => {
  const basePayload = {
    id: 12345,
    action: 'opened',
    repository: {
      id: 456,
      full_name: 'intexuraos/code-agent',
    },
    pull_request: {
      id: 101,
      number: 42,
      title: 'Feature: refactor event parser',
      body: 'Split handlers into modules',
      state: 'open',
      merged_at: null,
      draft: false,
      base: { ref: 'main' },
      head: { ref: 'feature/int-1437', sha: 'abc123' },
      user: { login: 'pr-author' },
    },
    sender: {
      login: 'pr-author',
      id: 111,
      type: 'User',
    },
  };

  it('returns action "opened" for an opened pull_request event', () => {
    const result = parsePullRequestEvent(basePayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('opened'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.eventType).toBe('pull_request'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.baseBranch).toBe('main'); // @allow-result-access -- narrowed by result.ok
    }
  });

  it('returns action "synchronize" and preserves updated head.sha in payload', () => {
    const synchronizePayload = {
      ...basePayload,
      id: 12346,
      action: 'synchronize',
      pull_request: {
        ...basePayload.pull_request,
        head: { ref: 'feature/int-1437', sha: 'def456-updated' },
      },
    };

    const result = parsePullRequestEvent(synchronizePayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('synchronize'); // @allow-result-access -- narrowed by result.ok
      // The full payload (including updated head.sha) is preserved verbatim.
      expect(result.value.payload).toBe(synchronizePayload); // @allow-result-access -- narrowed by result.ok
    }
  });
});
