/**
 * Service wiring for srt-service.
 * Provides class-based adapters for domain use cases.
 */
import { FirestoreJobRepository } from './infra/firestore/index.js';
import { SpeechmaticsBatchClient } from './infra/speechmatics/index.js';
import { GcpTranscriptionEventPublisher } from './infra/pubsub/index.js';
import { GcsAudioStorage } from './infra/gcs/index.js';
import type {
  TranscriptionJobRepository,
  SpeechmaticsClient,
  TranscriptionEventPublisher,
  AudioStoragePort,
} from './domain/transcription/index.js';

/**
 * Configuration for service initialization.
 */
export interface ServiceConfig {
  speechmaticsApiKey: string;
  gcpProjectId: string;
  transcriptionCompletedTopic: string;
  mediaBucketName: string;
}

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  jobRepository: TranscriptionJobRepository;
  speechmaticsClient: SpeechmaticsClient;
  eventPublisher: TranscriptionEventPublisher;
  audioStorage: AudioStoragePort;
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
    eventPublisher: new GcpTranscriptionEventPublisher(
      serviceConfig?.gcpProjectId ?? 'test-project',
      serviceConfig?.transcriptionCompletedTopic ?? 'test-topic'
    ),
    audioStorage: new GcsAudioStorage(serviceConfig?.mediaBucketName ?? 'test-bucket'),
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
