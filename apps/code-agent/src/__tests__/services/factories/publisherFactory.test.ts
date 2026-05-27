/**
 * Tests for publisherFactory.
 *
 * Asserts the E2E branch returns the provided mocks untouched, and the
 * non-E2E branch returns objects that satisfy the publisher interfaces.
 */

import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Logger } from 'pino';
import { createE2EMocks } from '../../../services/factories/e2eMocks.js';
import { createPublisherServices } from '../../../services/factories/publisherFactory.js';
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
    linearAgentUrl: '',
    actionsAgentUrl: '',
    webhookVerifySecret: '',
    orchestratorSecret: '',
    serviceUrl: '',
    webAppUrl: 'https://dev.intexuraos.cloud',
    userServiceUrl: '',
    openRouterAppApiKey: '',
    openaiAppApiKey: '',
    llmUsageServiceUrl: '',
    ...overrides,
  };
}

describe('createPublisherServices', () => {
  it('returns e2eMocks directly when isE2eMode=true', () => {
    const e2eMocks = createE2EMocks(logger);
    const services = createPublisherServices({
      config: makeConfig(), isE2eMode: true, e2eMocks, logger,
    });
    expect(services.whatsappPublisher).toBe(e2eMocks.whatsappPublisher);
    expect(services.prTriagePublisher).toBe(e2eMocks.prTriagePublisher);
  });

  it('returns real publishers exposing the expected interface when isE2eMode=false', () => {
    const e2eMocks = createE2EMocks(logger);
    const services = createPublisherServices({
      config: makeConfig(), isE2eMode: false, e2eMocks, logger,
    });
    expect(typeof services.whatsappPublisher.publishSendMessage).toBe('function');
    expect(typeof services.prTriagePublisher.publishPRTriage).toBe('function');
    // Not same as e2eMocks (we built fresh ones)
    expect(services.whatsappPublisher).not.toBe(e2eMocks.whatsappPublisher);
    expect(services.prTriagePublisher).not.toBe(e2eMocks.prTriagePublisher);
  });
});
