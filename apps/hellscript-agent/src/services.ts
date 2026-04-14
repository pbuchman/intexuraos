import type { HellscriptRepository } from './domain/ports/hellscriptRepository.js';
import type { WritingConfigRepository } from './domain/ports/writingConfigRepository.js';
import type { IntentInterpreter } from './domain/ports/intentInterpreter.js';
import type { DraftGenerator } from './domain/ports/draftGenerator.js';
import type { Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { FirestoreHellscriptRepository } from './infra/firestore/firestoreHellscriptRepository.js';
import { FirestoreWritingConfigRepository } from './infra/firestore/firestoreWritingConfigRepository.js';
import { GeminiIntentInterpreter } from './infra/llm/geminiIntentInterpreter.js';
import { GeminiDraftGenerator } from './infra/llm/geminiDraftGenerator.js';

export interface LlmAdapters {
  interpreter: IntentInterpreter;
  draftGenerator: DraftGenerator;
}

export interface ServiceContainer {
  hellscriptRepository: HellscriptRepository;
  writingConfigRepository: WritingConfigRepository;
  userServiceClient: UserServiceClient;
  createLlmAdapters: (llmClient: LlmGenerateClient) => LlmAdapters;
  logger: Logger;
}

export interface ServiceConfig {
  userServiceClient: UserServiceClient;
  logger: Logger;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  container = {
    hellscriptRepository: new FirestoreHellscriptRepository(),
    writingConfigRepository: new FirestoreWritingConfigRepository(),
    userServiceClient: config.userServiceClient,
    createLlmAdapters: (llmClient: LlmGenerateClient): LlmAdapters => ({
      interpreter: new GeminiIntentInterpreter(llmClient),
      draftGenerator: new GeminiDraftGenerator(llmClient),
    }),
    logger: config.logger,
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
