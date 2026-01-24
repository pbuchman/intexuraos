import pino from 'pino';
import { getLogLevel } from '@intexuraos/common-core';
import type { LinkPreviewFetcherPort } from './domain/index.js';
import {
  OpenGraphFetcher,
  createPageContentFetcher,
  createLlmSummarizer,
  createUserServiceClient,
  type PageContentFetcher,
  type UserServiceClient,
  type LlmSummarizer,
} from './infra/index.js';
import type { IPricingContext } from '@intexuraos/llm-pricing';

export interface ServiceContainer {
  linkPreviewFetcher: LinkPreviewFetcherPort;
  pageContentFetcher: PageContentFetcher;
  llmSummarizer: LlmSummarizer;
  userServiceClient: UserServiceClient;
}

export interface ServiceDependencies {
  crawl4aiApiKey: string;
  userServiceUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
}

let container: ServiceContainer | undefined;

export function initServices(dependencies: ServiceDependencies): void {
  const logger = pino({ level: getLogLevel() });

  container = {
    linkPreviewFetcher: new OpenGraphFetcher({}, logger),
    pageContentFetcher: createPageContentFetcher(
      { apiKey: dependencies.crawl4aiApiKey },
      pino({ name: 'pageContentFetcher', level: getLogLevel() })
    ),
    llmSummarizer: createLlmSummarizer(
      pino({ name: 'llmSummarizer', level: getLogLevel() })
    ),
    userServiceClient: createUserServiceClient({
      baseUrl: dependencies.userServiceUrl,
      internalAuthToken: dependencies.internalAuthToken,
      pricingContext: dependencies.pricingContext,
      logger: pino({ name: 'userServiceClient', level: getLogLevel() }),
    }),
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
