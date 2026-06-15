/**
 * Unit tests for the push event handler.
 */

import { describe, it, expect } from 'vitest';
import { parsePushEvent } from '../../../../infra/github/event-handlers/push-handler.js';

describe('parsePushEvent', () => {
  const standardPushPayload = {
    id: 9001,
    ref: 'refs/heads/feature/int-1437',
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

  it('parses a standard push event into a normalized GitHub PR event input', () => {
    const result = parsePushEvent(standardPushPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBeNull();
      expect(result.value).toMatchObject({ // @allow-result-access -- narrowed by result.ok
        githubEventId: 9001,
        deliveryId: null,
        repository: 'intexuraos/code-agent',
        repositoryId: 456,
        pullRequestNumber: 0,
        pullRequestId: 0,
        eventType: 'push',
        action: null,
        senderLogin: 'testuser',
        senderId: 111,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Push to feature/int-1437',
        body: null,
        state: null,
        isDraft: null,
        baseBranch: null,
        mergedAt: null,
      });
    }
  });

  it('preserves the payload verbatim for a force push (handler does not extract forced)', () => {
    const forcePushPayload = {
      ...standardPushPayload,
      id: 9002,
      forced: true,
    };

    const result = parsePushEvent(forcePushPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBeNull();
      // Payload is preserved verbatim — including the `forced` flag —
      // even though the normalized output does not surface it.
      expect(result.value?.payload).toBe(forcePushPayload); // @allow-result-access -- narrowed by result.ok
    }
  });
});
