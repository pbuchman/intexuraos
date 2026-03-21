import { createAppLogger } from '@intexuraos/infra-sentry';
import type { BookmarkRepository } from './domain/ports/bookmarkRepository.js';
import type { LinkPreviewFetcherPort } from './domain/ports/linkPreviewFetcher.js';
import type { BookmarkSummaryService } from './domain/ports/bookmarkSummaryService.js';
import type { ImageProxyPort } from './domain/ports/imageProxy.js';
import { FirestoreBookmarkRepository } from './infra/firestore/firestoreBookmarkRepository.js';
import { createFetchImageProxy } from './infra/imageProxy/fetchImageProxy.js';
import { createWebAgentClient } from './infra/linkpreview/webAgentClient.js';
import {
  createEnrichPublisher,
  type EnrichPublisher,
} from './infra/pubsub/enrichPublisher.js';
import {
  createSummarizePublisher,
  type SummarizePublisher,
} from './infra/pubsub/summarizePublisher.js';
import {
  createWhatsAppSendPublisher,
  type WhatsAppSendPublisher,
} from '@intexuraos/infra-pubsub';
import { createWebAgentSummaryClient } from './infra/summary/index.js';

export interface ServiceContainer {
  bookmarkRepository: BookmarkRepository;
  linkPreviewFetcher: LinkPreviewFetcherPort;
  enrichPublisher: EnrichPublisher;
  summarizePublisher: SummarizePublisher;
  whatsAppSendPublisher: WhatsAppSendPublisher;
  bookmarkSummaryService: BookmarkSummaryService;
  imageProxy: ImageProxyPort;
}

export interface ServiceConfig {
  gcpProjectId: string;
  webAgentUrl: string;
  internalAuthToken: string;
  bookmarkEnrichTopic: string | null;
  bookmarkSummarizeTopic: string | null;
  whatsappSendTopic: string;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  container = {
    bookmarkRepository: new FirestoreBookmarkRepository(),
    linkPreviewFetcher: createWebAgentClient({
      baseUrl: config.webAgentUrl,
      internalAuthToken: config.internalAuthToken,
      logger: createAppLogger({ name: 'webAgentClient' }),
    }),
    enrichPublisher: createEnrichPublisher({
      projectId: config.gcpProjectId,
      topicName: config.bookmarkEnrichTopic,
      logger: createAppLogger({ name: 'bookmark-enrich-publisher' }),
    }),
    summarizePublisher: createSummarizePublisher({
      projectId: config.gcpProjectId,
      topicName: config.bookmarkSummarizeTopic,
      logger: createAppLogger({ name: 'bookmark-summarize-publisher' }),
    }),
    whatsAppSendPublisher: createWhatsAppSendPublisher({
      projectId: config.gcpProjectId,
      topicName: config.whatsappSendTopic,
      logger: createAppLogger({ name: 'bookmark-whatsapp-send-publisher' }),
    }),
    bookmarkSummaryService: createWebAgentSummaryClient({
      baseUrl: config.webAgentUrl,
      internalAuthToken: config.internalAuthToken,
      logger: createAppLogger({ name: 'webAgentSummaryClient' }),
    }),
    imageProxy: createFetchImageProxy(),
  };
}

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(s: ServiceContainer): void {
  container = s;
}

export function resetServices(): void {
  container = null;
}
