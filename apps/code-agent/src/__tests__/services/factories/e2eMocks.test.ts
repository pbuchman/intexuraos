/**
 * Tests for E2E mock factories.
 *
 * Each mock's methods must return ok() shapes consistent with their production
 * contracts so e2e-mode pipelines don't choke on type surprises.
 */

import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Logger } from 'pino';
import { createE2EMocks } from '../../../services/factories/e2eMocks.js';

const logger = pino({ level: 'silent' }) as unknown as Logger;

describe('createE2EMocks', () => {
  it('returns external mocks still used by code-agent', () => {
    const mocks = createE2EMocks(logger);
    expect(mocks.whatsappPublisher).toBeDefined();
    expect(mocks.prTriagePublisher).toBeDefined();
    expect(mocks.linearAgentClient).toBeDefined();
  });

  describe('whatsappPublisher', () => {
    it('publishSendMessage resolves to ok', async () => {
      const { whatsappPublisher } = createE2EMocks(logger);
      const result = await whatsappPublisher.publishSendMessage({ userId: 'u1', message: 'hi' });
      expect(result.ok).toBe(true);
    });
  });

  describe('prTriagePublisher', () => {
    it('publishPRTriage resolves to ok', async () => {
      const { prTriagePublisher } = createE2EMocks(logger);
      const result = await prTriagePublisher.publishPRTriage({
        eventId: 'e1', repository: 'o/r', pullRequestNumber: 7, correlationId: 'c1',
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('linearAgentClient', () => {
    it('createIssue returns ok with generated identifier', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.createIssue({
        userId: 'u1', title: 'Hello', description: 'body',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.issueIdentifier).toMatch(/^INT-\d+$/);
        expect(result.value.issueTitle).toBe('Hello');
      }
    });

    it('updateIssueState returns ok', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.updateIssueState({ userId: 'u1', issueId: 'i1', state: 'done' });
      expect(result.ok).toBe(true);
    });

    it('validateIssue returns ok with normalized issue', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.validateIssue({ userId: 'u1', identifier: 'INT-1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.identifier).toBe('INT-1');
        expect(result.value.parentId).toBeNull();
      }
    });

    it('generateTitle returns ok with truncated title', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.generateTitle({ userId: 'u1', description: 'A'.repeat(200) });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title.length).toBe(80);
        expect(result.value.issueType).toBe('feature');
      }
    });

    it('addComment returns ok', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.addComment({ userId: 'u1', issueId: 'i1', body: 'hi' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.commentId).toMatch(/^comment-\d+$/);
    });

    it('fetchIssueTree returns ok with root + empty descendants', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.fetchIssueTree({ userId: 'u1', issueId: 'issue-1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.root.id).toBe('issue-1');
        expect(result.value.descendants).toEqual([]);
      }
    });

    it('fetchDirectChildrenLive returns empty array', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.fetchDirectChildrenLive({ userId: 'u1', issueId: 'i' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([]);
    });

    it('updateIssueMetadata returns ok with no dropped labels', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.updateIssueMetadata({
        userId: 'u1', issueId: 'i', addLabels: ['a'], removeLabels: ['b'], assigneeId: 'u',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.droppedLabels).toEqual([]);
    });

    it('fetchIssueForDisplay returns mock issue', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.fetchIssueForDisplay({ userId: 'u1', identifier: 'INT-9' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.identifier).toBe('INT-9');
        expect(result.value.state.type).toBe('started');
      }
    });

    it('fetchIssuesForDisplay maps identifiers to mock issues', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.fetchIssuesForDisplay({ userId: 'u1', identifiers: ['A-1', 'A-2'] });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(2);
    });

    it('getIssueDescription returns ok with undefined', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.getIssueDescription({ userId: 'u1', identifier: 'INT-1' });
      expect(result.ok).toBe(true);
    });

    it('getIssueContext returns ok with empty context', async () => {
      const { linearAgentClient } = createE2EMocks(logger);
      const result = await linearAgentClient.getIssueContext({ identifier: 'INT-1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.description).toBeNull();
        expect(result.value.comments).toEqual([]);
      }
    });
  });
});
