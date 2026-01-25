/**
 * Service container for calendar-agent.
 */

import type { GoogleCalendarClient, UserServiceClient } from './domain/index.js';
import type {
  FailedEventRepository,
  CalendarActionExtractionService,
  ProcessedActionRepository,
  CalendarPreviewRepository,
} from './domain/index.js';
import type { UserServiceClient as LlmUserServiceClient } from '@intexuraos/internal-clients/user-service';
import { GoogleCalendarClientImpl } from './infra/google/googleCalendarClient.js';
import { createFailedEventRepository } from './infra/firestore/failedEventRepository.js';
import { createProcessedActionRepository } from './infra/firestore/processedActionRepository.js';
import { createCalendarPreviewRepository } from './infra/firestore/calendarPreviewRepository.js';
import { createCalendarActionExtractionService } from './infra/gemini/calendarActionExtractionService.js';
import { createUserServiceClient } from '@intexuraos/internal-clients/user-service';
import { UserServiceClientImpl } from './infra/user/userServiceClient.js';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'calendar-agent',
});

export type { IPricingContext as PricingContext };

export interface ServiceContainer {
  googleCalendarClient: GoogleCalendarClient;
  userServiceClient: UserServiceClient; // Calendar OAuth client (from domain)
  llmUserServiceClient: LlmUserServiceClient; // LLM client (from shared package)
  failedEventRepository: FailedEventRepository;
  calendarActionExtractionService: CalendarActionExtractionService;
  processedActionRepository: ProcessedActionRepository;
  calendarPreviewRepository: CalendarPreviewRepository;
}

export interface ServiceConfig {
  userServiceUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  // Calendar OAuth user service client
  const userServiceClient = new UserServiceClientImpl(
    config.userServiceUrl,
    config.internalAuthToken
  );

  // LLM user service client (from shared package)
  const llmUserServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext: config.pricingContext,
    logger: logger,
  });

  const calendarActionExtractionService = createCalendarActionExtractionService(llmUserServiceClient, logger);

  container = {
    googleCalendarClient: new GoogleCalendarClientImpl(),
    userServiceClient, // Calendar OAuth client
    llmUserServiceClient, // LLM client
    failedEventRepository: createFailedEventRepository(),
    calendarActionExtractionService,
    processedActionRepository: createProcessedActionRepository(),
    calendarPreviewRepository: createCalendarPreviewRepository(),
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
