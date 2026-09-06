/**
 * Service container for calendar-agent.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { GoogleCalendarClient, UserServiceClient } from './domain/index.js';
import type {
  FailedEventRepository,
  CalendarActionExtractionService,
  ProcessedActionRepository,
  CalendarPreviewRepository,
  CalendarScheduleRepository,
  MatrixDeliveryStatus,
  OutboundMatrixMessageResult,
  WhatsAppScheduleClient,
} from './domain/index.js';
import { GoogleCalendarClientImpl } from './infra/google/googleCalendarClient.js';
import { createFailedEventRepository } from './infra/firestore/failedEventRepository.js';
import { createProcessedActionRepository } from './infra/firestore/processedActionRepository.js';
import { createCalendarPreviewRepository } from './infra/firestore/calendarPreviewRepository.js';
import { createCalendarScheduleRepository } from './infra/firestore/calendarScheduleRepository.js';
import { createCalendarActionExtractionService } from './infra/gemini/calendarActionExtractionService.js';
import {
  createWhatsAppServiceClient,
  createUserServiceClient,
  type PrivateMatrixDeliveryStatus,
  type SendPrivateOutboundMatrixMessageResult,
} from '@intexuraos/internal-clients';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { createAppLogger } from '@intexuraos/infra-sentry';

const logger = createAppLogger({ name: 'calendar-agent' });

export interface ServiceContainer {
  googleCalendarClient: GoogleCalendarClient;
  userServiceClient: UserServiceClient;
  failedEventRepository: FailedEventRepository;
  calendarActionExtractionService: CalendarActionExtractionService;
  processedActionRepository: ProcessedActionRepository;
  calendarPreviewRepository: CalendarPreviewRepository;
  calendarScheduleRepository?: CalendarScheduleRepository;
  whatsAppScheduleClient?: WhatsAppScheduleClient;
}

export interface ServiceConfig {
  userServiceUrl: string;
  whatsappServiceUrl: string;
  internalAuthToken: string;
  llmUsageServiceUrl: string;
}

let container: ServiceContainer | null = null;

function mapClientError(error: Error, prefix: string): Error {
  return new Error(`${prefix}: ${error.message}`);
}

function createWhatsAppScheduleClient(config: {
  baseUrl: string;
  internalAuthToken: string;
}): WhatsAppScheduleClient {
  const client = createWhatsAppServiceClient({
    baseUrl: config.baseUrl,
    internalAuthToken: config.internalAuthToken,
    logger,
  });

  function mapDeliveryStatus(status: PrivateMatrixDeliveryStatus): MatrixDeliveryStatus {
    if (status.status === 'ready') {
      return { status: 'ready' };
    }
    if (status.status === 'setup_required') {
      return { status: 'setup_required', reason: status.reason };
    }
    return { status: 'error', message: status.message };
  }

  function mapSendResult(
    result: SendPrivateOutboundMatrixMessageResult
  ): OutboundMatrixMessageResult {
    if (result.status === 'sent') {
      return { status: 'sent', matrixEventId: result.matrixEventId };
    }
    if (result.status === 'setup_required') {
      return { status: 'setup_required', reason: result.reason };
    }
    return { status: 'error', message: result.message };
  }

  return {
    async getMatrixDeliveryStatus(userId: string): Promise<Result<MatrixDeliveryStatus>> {
      const result = await client.getPrivateMatrixDeliveryStatus(userId);
      if (!result.ok) {
        return err(mapClientError(result.error, 'Failed to read Matrix delivery status'));
      }
      return ok(mapDeliveryStatus(result.value));
    },

    async sendOutboundMatrixMessage(input: {
      userId: string;
      target: 'intex_agent';
      text: string;
      startNewSession?: boolean;
      idempotencyKey?: string;
    }): Promise<Result<OutboundMatrixMessageResult>> {
      const result = await client.sendPrivateOutboundMatrixMessage({
        userId: input.userId,
        text: input.text,
        ...(input.startNewSession !== undefined
          ? { startNewSession: input.startNewSession }
          : {}),
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
      });
      if (!result.ok) {
        return err(mapClientError(result.error, 'Failed to send outbound Matrix message'));
      }
      return ok(mapSendResult(result.value));
    },
  };
}

export function initServices(config: ServiceConfig): void {
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger: logger,
    usageSink: new HttpInternalAuthUsageSink({
      usageServiceUrl: config.llmUsageServiceUrl,
      internalAuthToken: config.internalAuthToken,
      service: 'calendar-agent',
      component: 'user-service-client',
      logger,
    }),
    platformOpenRouterApiKey: process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'],
  });

  const calendarActionExtractionService = createCalendarActionExtractionService(userServiceClient, logger);

  container = {
    googleCalendarClient: new GoogleCalendarClientImpl(),
    userServiceClient,
    failedEventRepository: createFailedEventRepository(),
    calendarActionExtractionService,
    processedActionRepository: createProcessedActionRepository(),
    calendarPreviewRepository: createCalendarPreviewRepository(),
    calendarScheduleRepository: createCalendarScheduleRepository(),
    whatsAppScheduleClient: createWhatsAppScheduleClient({
      baseUrl: config.whatsappServiceUrl,
      internalAuthToken: config.internalAuthToken,
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
