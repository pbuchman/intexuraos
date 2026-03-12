/**
 * Service container for linear-agent.
 */

import type {
  LinearConnectionRepository,
  LinearApiClient,
  LinearActionExtractionService,
  FailedIssueRepository,
  ProcessedActionRepository,
  LinearIssueRepository,
  LinearCommentRepository,
  CodeAgentClient,
} from './domain/index.js';
import { createLinearConnectionRepository } from './infra/firestore/linearConnectionRepository.js';
import { createLinearApiClient } from './infra/linear/linearApiClient.js';
import { createLinearActionExtractionService } from './infra/llm/linearActionExtractionService.js';
import { createFailedIssueRepository } from './infra/firestore/failedIssueRepository.js';
import { createProcessedActionRepository } from './infra/firestore/processedActionRepository.js';
import { createLinearIssueRepository } from './infra/firestore/linearIssueRepository.js';
import { createLinearCommentRepository } from './infra/firestore/linearCommentRepository.js';
import { createUserServiceClient, type UserServiceClient } from '@intexuraos/internal-clients';
import { createCodeAgentHttpClient } from './infra/http/codeAgentHttpClient.js';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import { createAppLogger } from '@intexuraos/infra-sentry';

const logger = createAppLogger({ name: 'linear-agent' });

export type { IPricingContext as PricingContext };

export interface ServiceContainer {
  connectionRepository: LinearConnectionRepository;
  linearApiClient: LinearApiClient;
  extractionService: LinearActionExtractionService;
  failedIssueRepository: FailedIssueRepository;
  processedActionRepository: ProcessedActionRepository;
  issueRepository: LinearIssueRepository;
  commentRepository: LinearCommentRepository;
  userServiceClient: UserServiceClient;
  codeAgentClient: CodeAgentClient;
}

export interface ServiceConfig {
  userServiceUrl: string;
  codeAgentUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext: config.pricingContext,
    logger: logger,
    platformDashscopeApiKey: process.env['INTEXURAOS_DASHSCOPE_APP_API_KEY'],
    platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
  });

  const extractionService = createLinearActionExtractionService(userServiceClient, logger);

  const codeAgentClient = createCodeAgentHttpClient(
    { baseUrl: config.codeAgentUrl, internalAuthToken: config.internalAuthToken, timeoutMs: 30_000 },
    logger
  );

  container = {
    connectionRepository: createLinearConnectionRepository(),
    linearApiClient: createLinearApiClient(),
    extractionService,
    failedIssueRepository: createFailedIssueRepository(),
    processedActionRepository: createProcessedActionRepository(),
    issueRepository: createLinearIssueRepository(),
    commentRepository: createLinearCommentRepository(),
    userServiceClient,
    codeAgentClient,
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
