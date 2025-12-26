/**
 * Service wiring for srt-service.
 * Provides class-based adapters for domain use cases.
 */
import { FirestoreJobRepository } from './infra/firestore/index.js';
import { SpeechmaticsBatchClient } from './infra/speechmatics/index.js';
import { AudioStoredSubscriber } from './infra/pubsub/index.js';
import type {
  TranscriptionJobRepository,
  SpeechmaticsClient,
} from './domain/transcription/index.js';

/**
 * Configuration for service initialization.
 */
export interface ServiceConfig {
  speechmaticsApiKey: string;
  gcpProjectId: string;
  audioStoredSubscription: string;
}

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  jobRepository: TranscriptionJobRepository;
  speechmaticsClient: SpeechmaticsClient;
  audioStoredSubscriber: AudioStoredSubscriber;
}

let container: ServiceContainer | null = null;
let serviceConfig: ServiceConfig | null = null;

/**
 * Initialize the service container with configuration.
 * Must be called before getServices().
 */
export function initServices(config: ServiceConfig): void {
  serviceConfig = config;
}

/**
 * Get or create the service container.
 * Requires initServices() to be called first in production.
 */
export function getServices(): ServiceContainer {
  container ??= {
    jobRepository: new FirestoreJobRepository(),
    speechmaticsClient: new SpeechmaticsBatchClient(
      serviceConfig?.speechmaticsApiKey ?? 'test-api-key'
    ),
    audioStoredSubscriber: new AudioStoredSubscriber(
      serviceConfig?.gcpProjectId ?? 'test-project',
      serviceConfig?.audioStoredSubscription ?? 'test-subscription'
    ),
  };
  return container;
}

/**
 * Set a custom service container (for testing).
 */
export function setServices(services: ServiceContainer): void {
  container = services;
}

/**
 * Reset the service container (for testing).
 */
export function resetServices(): void {
  container = null;
}
