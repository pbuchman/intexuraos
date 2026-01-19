/**
 * Service container for linear-agent.
 */

import type {
  LinearConnectionRepository,
  LinearApiClient,
  LinearActionExtractionService,
  FailedIssueRepository,
  ProcessedActionRepository,
} from './domain/index.js';
import { createLinearConnectionRepository } from './infra/firestore/linearConnectionRepository.js';
import { createLinearApiClient } from './infra/linear/linearApiClient.js';
import { createLinearActionExtractionService } from './infra/llm/linearActionExtractionService.js';
import { createFailedIssueRepository } from './infra/firestore/failedIssueRepository.js';
import { createProcessedActionRepository } from './infra/firestore/processedActionRepository.js';
import { createLlmUserServiceClient } from './infra/user/llmUserServiceClient.js';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'linear-agent',
});

export type { IPricingContext as PricingContext };

export interface ServiceContainer {
  connectionRepository: LinearConnectionRepository;
  linearApiClient: LinearApiClient;
  extractionService: LinearActionExtractionService;
  failedIssueRepository: FailedIssueRepository;
  processedActionRepository: ProcessedActionRepository;
}

export interface ServiceConfig {
  userServiceUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  const llmUserServiceClient = createLlmUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext: config.pricingContext,
    logger: logger,
  });

  const extractionService = createLinearActionExtractionService(llmUserServiceClient, logger);

  container = {
    connectionRepository: createLinearConnectionRepository(),
    linearApiClient: createLinearApiClient(),
    extractionService,
    failedIssueRepository: createFailedIssueRepository(),
    processedActionRepository: createProcessedActionRepository(),
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
