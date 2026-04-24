/**
 * Tests for repositoryFactory.
 *
 * Uses the infra-firestore fake so we exercise the factory end-to-end without
 * hitting real Firestore. Asserts every field of RepositoryServices is defined
 * and that `codeTaskRepo` exposes the expected CodeTaskRepository API (meaning
 * `withGroupUpdates` wrapping succeeded).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Logger } from 'pino';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createRepositoryServices } from '../../../services/factories/repositoryFactory.js';

const logger = pino({ level: 'silent' }) as unknown as Logger;

describe('createRepositoryServices', () => {
  // Some repositories (e.g. gitHubPREventsRepository) lazily call getFirestore()
  // internally rather than using the passed-in Firestore, so we wire the global.
  beforeEach(() => {
    setFirestore(createFakeFirestore() as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  it('returns every repository defined', () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repos = createRepositoryServices({ firestore, logger });

    expect(repos.groupSummaryRepo).toBeDefined();
    expect(repos.codeTaskRepo).toBeDefined();
    expect(repos.logChunkRepo).toBeDefined();
    expect(repos.logLineRepo).toBeDefined();
    expect(repos.workerSettingsRepo).toBeDefined();
    expect(repos.gitHubPREventRepo).toBeDefined();
    expect(repos.gitHubPRSummaryRepo).toBeDefined();
    expect(repos.gitHubWebhookAuditEventRepo).toBeDefined();
    expect(repos.gitHubEventLogEntryRepo).toBeDefined();
    expect(repos.turnMetricsRepo).toBeDefined();
    expect(repos.dispatchRetryRepo).toBeDefined();
    expect(repos.mergeQueueWatchRepo).toBeDefined();
    expect(repos.eventDecisionRepo).toBeDefined();
    expect(repos.executionMemoryRepo).toBeDefined();
    expect(repos.executionMemoryApplicationRepo).toBeDefined();
    expect(repos.prAutomationCommentRepo).toBeDefined();
  });

  it('wraps codeTaskRepo so it exposes the full CodeTaskRepository API', () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repos = createRepositoryServices({ firestore, logger });

    // The wrapped repo must still expose the core CodeTaskRepository methods
    // that `withGroupUpdates` passes through.
    const methods = [
      'create', 'findById', 'findByIdForUser', 'update', 'list',
      'hasActiveTaskForLinearIssue', 'findZombieTasks',
      'countByUserToday', 'findArchivableTasks', 'archiveTaskLogs', 'findByPR',
    ];
    for (const m of methods) {
      expect(typeof (repos.codeTaskRepo as unknown as Record<string, unknown>)[m]).toBe('function');
    }
  });
});
