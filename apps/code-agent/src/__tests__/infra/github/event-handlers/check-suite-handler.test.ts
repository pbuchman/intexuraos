/**
 * Unit tests for the check_suite event handler.
 */

import { describe, it, expect } from 'vitest';
import { parseCheckSuiteEvent } from '../../../../infra/github/event-handlers/check-suite-handler.js';

describe('parseCheckSuiteEvent', () => {
  const validFailurePayload = {
    action: 'completed',
    check_suite: {
      id: 123,
      head_branch: 'task_abc123',
      head_sha: 'abc123def456',
      conclusion: 'failure',
      pull_requests: [
        {
          id: 101,
          number: 42,
          title: 'Fix the bug',
          body: 'Description',
          state: 'open',
        },
      ],
    },
    repository: {
      id: 456,
      full_name: 'intexuraos/code-agent',
    },
    sender: {
      login: 'testuser',
      id: 111,
      type: 'User',
    },
  };

  it('parses a completed check_suite with failure conclusion', () => {
    const result = parseCheckSuiteEvent(validFailurePayload);

    expect(result.ok).toBe(true);
    if (result.ok && result.value !== null) {
      expect(result.value.eventType).toBe('check_suite');
      expect(result.value.action).toBe('completed');
      expect(result.value.pullRequestNumber).toBe(42);
      // check_suite stores the head branch as baseBranch per parser contract.
      expect(result.value.baseBranch).toBe('task_abc123');
    }
  });

  it('returns ok(null) for a non-failure conclusion', () => {
    const result = parseCheckSuiteEvent({
      ...validFailurePayload,
      check_suite: {
        ...validFailurePayload.check_suite,
        conclusion: 'success',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('returns ok(null) when no pull_requests are associated', () => {
    const result = parseCheckSuiteEvent({
      ...validFailurePayload,
      check_suite: {
        ...validFailurePayload.check_suite,
        pull_requests: [],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });
});
