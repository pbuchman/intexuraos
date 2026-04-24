/**
 * Shared test fixtures for unifiedEvaluator sibling module tests.
 *
 * Each test file may override specific fields for its scenario; only the
 * neutral common shape lives here to avoid drift when `GitHubPREvent` or
 * `UnifiedEvaluatorDeps` gains fields.
 */

import { vi } from 'vitest';
import { ok, type Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../../../domain/models/gitHubPREvent.js';
import type { WebhookRulesService } from '../../../../domain/services/gitHubWebhookRules.js';
import type { WebhookDispatchService } from '../../../../domain/services/gitHubDispatchService.js';
import type { EventDecisionRepository } from '../../../../domain/repositories/eventDecisionRepository.js';
import type { GitHubEventLogEntryRepository } from '../../../../domain/repositories/gitHubEventLogEntryRepository.js';
import type { UnifiedEvaluatorDeps } from '../../../../domain/services/unifiedEvaluator/types.js';

export function createFakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

export function createFakeEvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    id: 'evt-1',
    auditEventId: 'audit-evt-1',
    githubEventId: 1001,
    deliveryId: null,
    repository: 'intexuraos/intexuraos',
    repositoryId: 100,
    pullRequestNumber: 42,
    pullRequestId: 200,
    eventType: 'issue_comment',
    action: 'created',
    senderLogin: 'dev-user',
    senderId: 1,
    senderType: 'User',
    prAuthorLogin: null,
    title: 't',
    body: 'b',
    state: 'open',
    isDraft: null,
    baseBranch: null,
    mergedAt: null,
    createdAt: new Date(),
    processedAt: new Date(),
    payload: null,
    ...overrides,
  };
}

export function createDeps(overrides: Partial<UnifiedEvaluatorDeps> = {}): UnifiedEvaluatorDeps {
  return {
    webhookRules: { evaluate: vi.fn() } as unknown as WebhookRulesService,
    dispatchService: {
      dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
    } as unknown as WebhookDispatchService,
    eventDecisionRepo: {
      save: vi.fn().mockResolvedValue(ok({ id: 'ed_1' })),
    } as unknown as EventDecisionRepository,
    gitHubEventLogEntryRepo: {
      complete: vi.fn().mockResolvedValue(ok({ id: 'audit-evt-1' })),
      createPending: vi.fn(),
      listRecent: vi.fn(),
      findByIds: vi.fn(),
    } as unknown as GitHubEventLogEntryRepository,
    createReviewTask: vi.fn(),
    allowedBots: new Set(['claude[bot]']),
    automationLog: { record: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}
