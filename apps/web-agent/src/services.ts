import pino from 'pino';
import { getLogLevel } from '@intexuraos/common-core';
import type { LinkPreviewFetcherPort, PageSummaryServicePort } from './domain/index.js';
import { OpenGraphFetcher, createCrawl4AIClient } from './infra/index.js';

export interface ServiceContainer {
  linkPreviewFetcher: LinkPreviewFetcherPort;
  pageSummaryService: PageSummaryServicePort;
}

let container: ServiceContainer | undefined;

export function initServices(): void {
  const crawl4aiApiKey = process.env['INTEXURAOS_CRAWL4AI_API_KEY'] ?? '';

  container = {
    linkPreviewFetcher: new OpenGraphFetcher(
      {},
      pino({ name: 'openGraphFetcher', level: getLogLevel() })
    ),
    pageSummaryService: createCrawl4AIClient(
      { apiKey: crawl4aiApiKey },
      pino({ name: 'crawl4aiClient', level: getLogLevel() })
    ),
  };
}

export function getServices(): ServiceContainer {
  if (container === undefined) {
    throw new Error('Services not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = undefined;
}
