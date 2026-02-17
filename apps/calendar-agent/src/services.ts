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
import { GoogleCalendarClientImpl } from './infra/google/googleCalendarClient.js';
import { createFailedEventRepository } from './infra/firestore/failedEventRepository.js';
import { createProcessedActionRepository } from './infra/firestore/processedActionRepository.js';
import { createCalendarPreviewRepository } from './infra/firestore/calendarPreviewRepository.js';
import { createCalendarActionExtractionService } from './infra/gemini/calendarActionExtractionService.js';
import { createUserServiceClient } from '@intexuraos/internal-clients';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import { createAppLogger } from '@intexuraos/infra-sentry';

const logger = createAppLogger({ name: 'calendar-agent' });

export type { IPricingContext as PricingContext };

export interface ServiceContainer {
  googleCalendarClient: GoogleCalendarClient;
  userServiceClient: UserServiceClient;
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
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext: config.pricingContext,
    logger: logger,
    platformZaiApiKey: process.env['INTEXURAOS_ZAI_APP_API_KEY'],
    platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
  });

  const calendarActionExtractionService = createCalendarActionExtractionService(userServiceClient, logger);

  container = {
    googleCalendarClient: new GoogleCalendarClientImpl(),
    userServiceClient,
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
