/**
 * Service container for calendar-agent.
 */

import type { GoogleCalendarClient, UserServiceClient } from './domain/index.js';
import type {
  FailedEventRepository,
  CalendarActionExtractionService,
} from './domain/index.js';
import { GoogleCalendarClientImpl } from './infra/google/googleCalendarClient.js';
import { UserServiceClientImpl } from './infra/user/userServiceClient.js';
import { createFailedEventRepository } from './infra/firestore/failedEventRepository.js';
import { createCalendarActionExtractionService } from './infra/gemini/calendarActionExtractionService.js';
import { createLlmUserServiceClient } from './infra/user/llmUserServiceClient.js';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'calendar-agent',
});

export type { IPricingContext as PricingContext };

export interface ServiceContainer {
  googleCalendarClient: GoogleCalendarClient;
  userServiceClient: UserServiceClient;
  failedEventRepository: FailedEventRepository;
  calendarActionExtractionService: CalendarActionExtractionService;
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

  const calendarActionExtractionService = createCalendarActionExtractionService(llmUserServiceClient, logger);

  container = {
    googleCalendarClient: new GoogleCalendarClientImpl(),
    userServiceClient: new UserServiceClientImpl(config.userServiceUrl, config.internalAuthToken),
    failedEventRepository: createFailedEventRepository(),
    calendarActionExtractionService,
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
