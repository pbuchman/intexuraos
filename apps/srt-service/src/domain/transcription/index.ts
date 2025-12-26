/**
 * Transcription Domain Layer.
 * Exports all public domain types, models, and ports.
 */

// Models
export type { TranscriptionJob, TranscriptionJobStatus } from './models/index.js';

// Ports
export type {
  TranscriptionError,
  TranscriptionJobRepository,
  SpeechmaticsJobStatus,
  CreateJobResponse,
  JobStatusResponse,
  SpeechmaticsClient,
} from './ports/index.js';

// Usecases
export * from './usecases/index.js';
