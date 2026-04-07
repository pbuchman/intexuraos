import { createAppLogger } from '@intexuraos/infra-sentry';
import type { LinkPreviewFetcherPort } from './domain/index.js';
import {
  OpenGraphFetcher,
  createCloudflareMarkdownClient,
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
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  userServiceUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
}

let container: ServiceContainer | undefined;

export function initServices(dependencies: ServiceDependencies): void {
  const logger = createAppLogger({ name: 'web-agent' });

  container = {
    linkPreviewFetcher: new OpenGraphFetcher({}, logger),
    pageContentFetcher: createCloudflareMarkdownClient(
      {
        accountId: dependencies.cloudflareAccountId,
        apiToken: dependencies.cloudflareApiToken,
      },
      createAppLogger({ name: 'pageContentFetcher' })
    ),
    llmSummarizer: createLlmSummarizer(
      createAppLogger({ name: 'llmSummarizer' })
    ),
    userServiceClient: createUserServiceClient({
      baseUrl: dependencies.userServiceUrl,
      internalAuthToken: dependencies.internalAuthToken,
      pricingContext: dependencies.pricingContext,
      logger: createAppLogger({ name: 'userServiceClient' }),
      platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
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
