/**
 * Integration test verifying that `initServices(config)` composes a full
 * ServiceContainer from the factory modules.
 *
 * Uses infra-firestore's fake so initServices()'s internal getFirestore()
 * resolves to a fake — no real Firestore contact is made. This mirrors
 * how apps/code-agent/src/__tests__/server.test.ts sets up its world.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { getServices, initServices, resetServices, type ServiceConfig } from '../../../services.js';

function makeConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    gcpProjectId: 'test-project',
    internalAuthToken: 'internal-token',
    firestoreProjectId: 'test-project',
    whatsappServiceUrl: 'http://whatsapp',
    whatsappSendTopic: 'whatsapp-send',
    prTriageTopic: 'pr-triage',
    linearAgentUrl: 'http://linear-agent',
    webhookVerifySecret: 'webhook',
    orchestratorSecret: 'orch',
    serviceUrl: 'http://code-agent',
    codeTaskCallbackBaseUrl: 'http://callbacks',
    webAppUrl: 'https://dev.intexuraos.cloud',
    userServiceUrl: 'http://user-service',
    openRouterAppApiKey: '',
    llmUsageServiceUrl: '',
    ...overrides,
  };
}

describe('initServices', () => {
  beforeEach(() => {
    setFirestore(createFakeFirestore() as unknown as Firestore);
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    delete process.env['E2E_MODE'];
    delete process.env['INTEXURAOS_ENABLE_METRICS'];
  });

  it('builds a container where every non-optional ServiceContainer property is defined', () => {
    initServices(makeConfig());
    const c = getServices();

    // Non-optional required properties
    expect(c.firestore).toBeDefined();
    expect(c.logger).toBeDefined();
    expect(c.codeTaskCallbackBaseUrl).toBe('http://callbacks');
    expect(c.codeTaskSystemStatusRepo).toBeDefined();
    expect(c.codeTaskRepo).toBeDefined();
    expect(c.logChunkRepo).toBeDefined();
    expect(c.logLineRepo).toBeDefined();
    expect(c.taskDispatcher).toBeDefined();
    expect(c.whatsappNotifier).toBeDefined();
    expect(c.codeTaskDispatchStatusService).toBeDefined();
    expect(c.linearAgentClient).toBeDefined();
    expect(c.linearIssueService).toBeDefined();
    expect(c.processHeartbeat).toBeDefined();
    expect(c.detectZombieTasks).toBeDefined();
    expect(c.archiveStaleGroups).toBeDefined();
    expect(c.autoArchiveMergedTasks).toBeDefined();
    expect(c.metricsClient).toBeDefined();
    expect(c.workerSettingsRepo).toBeDefined();
    expect(c.workerHealthProbe).toBeDefined();
    expect(c.gitHubPREventRepo).toBeDefined();
    expect(c.gitHubPRSummaryRepo).toBeDefined();
    expect(c.turnMetricsRepo).toBeDefined();
    expect(c.userServiceClient).toBeDefined();
    expect(c.gitHubPRClient).toBeDefined();
    expect(c.webhookRules).toBeDefined();
    expect(c.dispatchService).toBeDefined();
    expect(c.resolveToolCallingClient).toBeDefined();
    expect(c.eventDecisionRepo).toBeDefined();
    expect(c.dispatchRetryRepo).toBeDefined();
    expect(c.unifiedEvaluator).toBeDefined();
    expect(c.prTriagePublisher).toBeDefined();
    expect(c.mergeConflictDetector).toBeDefined();
    expect(c.automationLog).toBeDefined();
    expect(c.taskEnqueueService).toBeDefined();
    expect(c.mergeQueueWatchRepo).toBeDefined();
    expect(c.createRemediationTaskFn).toBeDefined();
    expect(c.groupSummaryRepo).toBeDefined();
    expect(c.userLookupService).toBeDefined();
    expect(c.gitHubWebhookAuditEventRepo).toBeDefined();
    expect(c.gitHubEventLogEntryRepo).toBeDefined();
    expect(c.executionMemoryRepo).toBeDefined();
    expect(c.executionMemoryApplicationRepo).toBeDefined();
  });

  it('omits executionMemoryEmbeddingClient when openRouterAppApiKey is empty', () => {
    initServices(makeConfig({ openRouterAppApiKey: '' }));
    const c = getServices();
    expect(c.executionMemoryEmbeddingClient).toBeUndefined();
  });

  it('omits usageServiceClient when llmUsageServiceUrl is empty', () => {
    initServices(makeConfig({ llmUsageServiceUrl: '' }));
    const c = getServices();
    expect(c.usageServiceClient).toBeUndefined();
  });

  it('uses e2e mocks when E2E_MODE=true', () => {
    process.env['E2E_MODE'] = 'true';
    initServices(makeConfig());
    const c = getServices();
    expect(c.linearAgentClient).toBeDefined();
  });

  it('throws from getServices() before initServices()', () => {
    resetServices();
    expect(() => getServices()).toThrow('Service container not initialized');
  });
});
