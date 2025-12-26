/**
 * Ports exports.
 */
export type { TranscriptionError, TranscriptionJobRepository } from './repositories.js';

export type {
  SpeechmaticsJobStatus,
  CreateJobResponse,
  JobStatusResponse,
  SpeechmaticsClient,
} from './speechmaticsClient.js';

export type { TranscriptionCompletedEvent, TranscriptionEventPublisher } from './eventPublisher.js';
