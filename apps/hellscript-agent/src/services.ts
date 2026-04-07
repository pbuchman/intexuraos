import type { HellscriptRepository } from './domain/ports/hellscriptRepository.js';
import type { IntentInterpreter } from './domain/ports/intentInterpreter.js';
import type { DraftGenerator } from './domain/ports/draftGenerator.js';
import type { WritingConfigRepository } from './domain/ports/writingConfigRepository.js';
import type { Logger } from '@intexuraos/common-core';
import { FirestoreHellscriptRepository } from './infra/firestore/firestoreHellscriptRepository.js';
import { FirestoreWritingConfigRepository } from './infra/firestore/firestoreWritingConfigRepository.js';
import { GeminiIntentInterpreter } from './infra/llm/geminiIntentInterpreter.js';
import { GeminiDraftGenerator } from './infra/llm/geminiDraftGenerator.js';
import type { GeminiClient } from '@intexuraos/infra-gemini';

export interface ServiceContainer {
  hellscriptRepository: HellscriptRepository;
  writingConfigRepository: WritingConfigRepository;
  intentInterpreter: IntentInterpreter;
  draftGenerator: DraftGenerator;
  logger: Logger;
}

export interface ServiceConfig {
  geminiClient: GeminiClient;
  logger: Logger;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  container = {
    hellscriptRepository: new FirestoreHellscriptRepository(),
    writingConfigRepository: new FirestoreWritingConfigRepository(),
    intentInterpreter: new GeminiIntentInterpreter(config.geminiClient),
    draftGenerator: new GeminiDraftGenerator(config.geminiClient),
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
