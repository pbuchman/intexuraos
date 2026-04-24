/**
 * Publisher factory for code-agent.
 *
 * Returns real Pub/Sub publishers in production, or swaps in E2E mocks
 * when `isE2eMode` is set.
 */

import { createAppLogger } from '@intexuraos/infra-sentry';
import type { Logger } from 'pino';
import {
  createPRTriagePublisher,
  createWhatsAppSendPublisher,
  type PRTriagePublisher,
  type WhatsAppSendPublisher,
} from '@intexuraos/infra-pubsub';
import type { E2EMocks } from './e2eMocks.js';
import type { ServiceConfig } from '../types.js';

export interface PublisherFactoryDeps {
  config: ServiceConfig;
  isE2eMode: boolean;
  e2eMocks: E2EMocks;
  logger: Logger;
}

export interface PublisherServices {
  whatsappPublisher: WhatsAppSendPublisher;
  prTriagePublisher: PRTriagePublisher;
}

/**
 * Create WhatsApp and PR-triage publishers.
 *
 * When `isE2eMode` is true, returns the e2e mock publishers directly; otherwise
 * constructs real Pub/Sub-backed publishers from infra-pubsub.
 */
export function createPublisherServices(deps: PublisherFactoryDeps): PublisherServices {
  const { config, isE2eMode, e2eMocks } = deps;

  if (isE2eMode) {
    return {
      whatsappPublisher: e2eMocks.whatsappPublisher,
      prTriagePublisher: e2eMocks.prTriagePublisher,
    };
  }

  return {
    whatsappPublisher: createWhatsAppSendPublisher({
      projectId: config.gcpProjectId,
      topicName: config.whatsappSendTopic,
      logger: createAppLogger({ name: 'whatsapp-publisher' }),
    }),
    prTriagePublisher: createPRTriagePublisher({
      projectId: config.gcpProjectId,
      topicName: config.prTriageTopic,
      logger: createAppLogger({ name: 'pr-triage-publisher' }),
    }),
  };
}
