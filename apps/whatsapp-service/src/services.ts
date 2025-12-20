/**
 * Service container for whatsapp-service.
 * Provides dependency injection for adapters and use cases.
 */
import type { WhatsAppWebhookEventRepository } from '@praxos/infra-firestore';
import { FirestoreWhatsAppWebhookEventRepository } from '@praxos/infra-firestore';
import type { InboxNotesRepository } from '@praxos/domain-inbox';
import { IngestWhatsAppMessage } from '@praxos/domain-inbox';
import { InboxNotesAdapter } from '@praxos/infra-notion';
import type { Config } from './config.js';

/**
 * Service container holding all adapter instances and use cases.
 */
export interface ServiceContainer {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  inboxNotesRepository: InboxNotesRepository;
  ingestWhatsAppMessage: IngestWhatsAppMessage;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 * In production, uses real adapters and use cases.
 */
export function getServices(config: Config): ServiceContainer {
  if (container === null) {
    const inboxNotesRepository = new InboxNotesAdapter({
      token: config.notionToken,
      databaseId: config.notionInboxDatabaseId,
    });

    container = {
      webhookEventRepository: new FirestoreWhatsAppWebhookEventRepository(),
      inboxNotesRepository,
      ingestWhatsAppMessage: new IngestWhatsAppMessage(inboxNotesRepository),
    };
  }
  return container;
}

/**
 * Set a custom service container (for testing).
 */
export function setServices(services: ServiceContainer): void {
  container = services;
}

/**
 * Reset the service container (for testing).
 */
export function resetServices(): void {
  container = null;
}
