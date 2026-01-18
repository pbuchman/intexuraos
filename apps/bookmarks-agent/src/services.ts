import pino from 'pino';
import type { BookmarkRepository } from './domain/ports/bookmarkRepository.js';
import type { LinkPreviewFetcherPort } from './domain/ports/linkPreviewFetcher.js';
import type { BookmarkSummaryService } from './domain/ports/bookmarkSummaryService.js';
import { FirestoreBookmarkRepository } from './infra/firestore/firestoreBookmarkRepository.js';
import { createWebAgentClient } from './infra/linkpreview/webAgentClient.js';
import {
  createEnrichPublisher,
  type EnrichPublisher,
} from './infra/pubsub/enrichPublisher.js';
import {
  createSummarizePublisher,
  type SummarizePublisher,
} from './infra/pubsub/summarizePublisher.js';
import { createWebAgentSummaryClient } from './infra/summary/webAgentSummaryClient.js';

export interface ServiceContainer {
  bookmarkRepository: BookmarkRepository;
  linkPreviewFetcher: LinkPreviewFetcherPort;
  enrichPublisher: EnrichPublisher;
  summarizePublisher: SummarizePublisher;
  bookmarkSummaryService: BookmarkSummaryService;
}

export interface ServiceConfig {
  gcpProjectId: string;
  webAgentUrl: string;
  internalAuthToken: string;
  bookmarkEnrichTopic: string | null;
  bookmarkSummarizeTopic: string | null;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  container = {
    bookmarkRepository: new FirestoreBookmarkRepository(),
    linkPreviewFetcher: createWebAgentClient({
      baseUrl: config.webAgentUrl,
      internalAuthToken: config.internalAuthToken,
      logger: pino({ name: 'webAgentClient' }),
    }),
    enrichPublisher: createEnrichPublisher({
      projectId: config.gcpProjectId,
      topicName: config.bookmarkEnrichTopic,
      logger: pino({ name: 'bookmark-enrich-publisher' }),
    }),
    summarizePublisher: createSummarizePublisher({
      projectId: config.gcpProjectId,
      topicName: config.bookmarkSummarizeTopic,
      logger: pino({ name: 'bookmark-summarize-publisher' }),
    }),
    bookmarkSummaryService: createWebAgentSummaryClient({
      baseUrl: config.webAgentUrl,
      internalAuthToken: config.internalAuthToken,
      logger: pino({ name: 'webAgentSummaryClient' }),
    }),
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
