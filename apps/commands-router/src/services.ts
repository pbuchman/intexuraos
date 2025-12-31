import type { CommandRepository } from './domain/ports/commandRepository.js';
import type { ActionRepository } from './domain/ports/actionRepository.js';
import type { Classifier, ClassificationResult } from './domain/ports/classifier.js';
import { createFirestoreCommandRepository } from './infra/firestore/commandRepository.js';
import { createFirestoreActionRepository } from './infra/firestore/actionRepository.js';
import { createGeminiClassifier } from './infra/gemini/classifier.js';

export interface Services {
  commandRepository: CommandRepository;
  actionRepository: ActionRepository;
  classifier: Classifier;
}

let services: Services | null = null;

function loadGeminiApiKey(): string {
  const apiKey = process.env['INTEXURAOS_GEMINI_API_KEY'];
  if (apiKey === undefined || apiKey === '') {
    throw new Error('INTEXURAOS_GEMINI_API_KEY environment variable is required');
  }
  return apiKey;
}

export function getServices(): Services {
  if (services === null) {
    const isTestEnv = process.env['NODE_ENV'] === 'test';

    services = {
      commandRepository: createFirestoreCommandRepository(),
      actionRepository: createFirestoreActionRepository(),
      classifier: isTestEnv
        ? {
            classify: (_text: string): Promise<ClassificationResult> =>
              Promise.resolve({ type: 'unclassified', confidence: 0, title: 'Test' }),
          }
        : createGeminiClassifier({ apiKey: loadGeminiApiKey() }),
    };
  }
  return services;
}

export function setServices(s: Services): void {
  services = s;
}

export function resetServices(): void {
  services = null;
}
