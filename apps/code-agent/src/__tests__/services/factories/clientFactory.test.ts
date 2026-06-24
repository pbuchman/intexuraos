/**
 * Tests for clientFactory.
 *
 * Verifies:
 * - isE2eMode=true uses the e2e mock Linear + Intex agent clients
 * - isE2eMode=false builds real HTTP clients
 * - `usageServiceClient` is undefined when llmUsageServiceUrl is ''
 *   and defined when set
 * - `buildUsageSink` returns an HttpInternalAuthUsageSink instance
 */

import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Logger } from 'pino';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { createE2EMocks } from '../../../services/factories/e2eMocks.js';
import { createClientServices } from '../../../services/factories/clientFactory.js';
import type { ServiceConfig } from '../../../services/types.js';

const logger = pino({ level: 'silent' }) as unknown as Logger;

function makeConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    gcpProjectId: 'test-project',
    internalAuthToken: 'tok',
    firestoreProjectId: 'test-project',
    whatsappServiceUrl: '',
    whatsappSendTopic: '',
    prTriageTopic: '',
    linearAgentUrl: 'http://linear-agent',
    intexAgentUrl: 'http://intex-agent',
    webhookVerifySecret: '',
    orchestratorSecret: '',
    serviceUrl: '',
    codeTaskCallbackBaseUrl: '',
    webAppUrl: 'https://dev.intexuraos.cloud',
    userServiceUrl: 'http://user-service',
    openRouterAppApiKey: '',
    openaiAppApiKey: '',
    llmUsageServiceUrl: '',
    ...overrides,
  };
}

describe('createClientServices', () => {
  it('returns e2e mocks for linearAgentClient and intexAgentClient when isE2eMode=true', () => {
    const e2eMocks = createE2EMocks(logger);
    const services = createClientServices({
      config: makeConfig(), logger, isE2eMode: true, e2eMocks,
    });
    expect(services.linearAgentClient).toBe(e2eMocks.linearAgentClient);
    expect(services.intexAgentClient).toBe(e2eMocks.intexAgentClient);
  });

  it('returns real HTTP clients when isE2eMode=false', () => {
    const e2eMocks = createE2EMocks(logger);
    const services = createClientServices({
      config: makeConfig(), logger, isE2eMode: false, e2eMocks,
    });
    expect(services.linearAgentClient).not.toBe(e2eMocks.linearAgentClient);
    expect(services.intexAgentClient).not.toBe(e2eMocks.intexAgentClient);
    expect(typeof services.linearAgentClient.createIssue).toBe('function');
    expect(typeof services.intexAgentClient.updateActionStatus).toBe('function');
  });

  it('omits usageServiceClient when llmUsageServiceUrl is empty', () => {
    const e2eMocks = createE2EMocks(logger);
    const services = createClientServices({
      config: makeConfig({ llmUsageServiceUrl: '' }), logger, isE2eMode: false, e2eMocks,
    });
    expect(services.usageServiceClient).toBeUndefined();
  });

  it('provides usageServiceClient when llmUsageServiceUrl is set', () => {
    const e2eMocks = createE2EMocks(logger);
    const services = createClientServices({
      config: makeConfig({ llmUsageServiceUrl: 'http://usage' }), logger, isE2eMode: false, e2eMocks,
    });
    expect(services.usageServiceClient).toBeDefined();
  });

  it('buildUsageSink returns an HttpInternalAuthUsageSink', () => {
    const e2eMocks = createE2EMocks(logger);
    const services = createClientServices({
      config: makeConfig(), logger, isE2eMode: false, e2eMocks,
    });
    const sink = services.buildUsageSink('unit-test');
    expect(sink).toBeInstanceOf(HttpInternalAuthUsageSink);
  });

  it('always returns userServiceClient and gitHubPRClient', () => {
    const e2eMocks = createE2EMocks(logger);
    const services = createClientServices({
      config: makeConfig(), logger, isE2eMode: false, e2eMocks,
    });
    expect(services.userServiceClient).toBeDefined();
    expect(services.gitHubPRClient).toBeDefined();
  });
});
