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
  IssuePruningClassifier,
} from './domain/index.js';
import { createLinearConnectionRepository } from './infra/firestore/linearConnectionRepository.js';
import { createLinearApiClient } from './infra/linear/linearApiClient.js';
import { createLinearActionExtractionService } from './infra/llm/linearActionExtractionService.js';
import { createFailedIssueRepository } from './infra/firestore/failedIssueRepository.js';
import { createProcessedActionRepository } from './infra/firestore/processedActionRepository.js';
import { createLinearIssueRepository } from './infra/firestore/linearIssueRepository.js';
import { createLinearCommentRepository } from './infra/firestore/linearCommentRepository.js';
import { createIssuePruningClassifier } from './infra/llm/issuePruningClassifier.js';
import { createUserServiceClient, type UserServiceClient } from '@intexuraos/internal-clients';
import { createCodeAgentHttpClient } from './infra/http/codeAgentHttpClient.js';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { createGeminiClient, TOOL_CALLING_PRICING } from '@intexuraos/infra-gemini';
import { LlmModels } from '@intexuraos/llm-contract';

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
  issuePruningClassifier: IssuePruningClassifier;
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
    platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
  });

  const extractionService = createLinearActionExtractionService(userServiceClient, logger);

  const codeAgentClient = createCodeAgentHttpClient(
    { baseUrl: config.codeAgentUrl, internalAuthToken: config.internalAuthToken, timeoutMs: 30_000 },
    logger
  );

  // Create issue pruning classifier using platform Gemini API key
  const geminiApiKey = process.env['INTEXURAOS_GEMINI_APP_API_KEY'];
  const geminiClient = geminiApiKey !== undefined && geminiApiKey !== ''
    ? createGeminiClient({
        apiKey: geminiApiKey,
        model: LlmModels.Gemini25Flash,
        userId: 'system:pruning',
        pricing: TOOL_CALLING_PRICING[LlmModels.Gemini25Flash],
        logger,
      })
    : null;

  const issuePruningClassifier = geminiClient !== null
    ? createIssuePruningClassifier({
        generate: (prompt: string) => geminiClient.generate(prompt),
        logger,
      })
    : createIssuePruningClassifier({
        generate: async (_prompt: string) => {
          await Promise.resolve();
          return { ok: false as const, error: { code: 'INVALID_KEY', message: 'No Gemini API key configured' } };
        },
        logger,
      });

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
    issuePruningClassifier,
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
