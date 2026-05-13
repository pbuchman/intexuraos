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
    actionsAgentUrl: 'http://actions-agent',
    webhookVerifySecret: 'webhook',
    orchestratorSecret: 'orch',
    serviceUrl: 'http://code-agent',
    userServiceUrl: 'http://user-service',
    openRouterAppApiKey: '',
    openaiAppApiKey: '',
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
    expect(c.codeTaskRepo).toBeDefined();
    expect(c.logChunkRepo).toBeDefined();
    expect(c.logLineRepo).toBeDefined();
    expect(c.taskDispatcher).toBeDefined();
    expect(c.whatsappNotifier).toBeDefined();
    expect(c.actionsAgentClient).toBeDefined();
    expect(c.linearAgentClient).toBeDefined();
    expect(c.linearIssueService).toBeDefined();
    expect(c.statusMirrorService).toBeDefined();
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

  it('omits executionMemoryEmbeddingClient when openaiAppApiKey is empty', () => {
    initServices(makeConfig({ openaiAppApiKey: '' }));
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
    expect(c.actionsAgentClient).toBeDefined();
  });

  it('composes services so statusMirrorService forwards through actionsAgentClient', async () => {
    // Spot-check an actual wiring edge: if the composer created a second
    // actionsAgentClient by mistake, this test would fail.
    process.env['E2E_MODE'] = 'true';
    initServices(makeConfig());
    const c = getServices();

    const calls: { actionId: string; status: string }[] = [];
    // Replace the in-container client's method so we can observe calls from
    // statusMirrorService. If statusMirrorService was constructed with a
    // DIFFERENT client instance, the spy would never fire.
    c.actionsAgentClient.updateActionStatus = async (
      actionId,
      status,
    ): Promise<{ ok: true; value: undefined }> => {
      calls.push({ actionId, status });
      return { ok: true, value: undefined };
    };

    // Use a real UUID so isRealActionId() allows the forward.
    await c.statusMirrorService.mirrorStatus({
      actionId: '11111111-1111-4111-8111-111111111111',
      taskStatus: 'running',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.actionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(calls[0]?.status).toBe('running');
  });

  it('throws from getServices() before initServices()', () => {
    resetServices();
    expect(() => getServices()).toThrow('Service container not initialized');
  });
});
