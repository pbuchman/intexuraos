/**
 * Fake implementations for srt-service testing.
 */
import type { Result } from '@intexuraos/common';
import { ok, err } from '@intexuraos/common';
import { randomUUID } from 'node:crypto';
import type {
  TranscriptionJob,
  TranscriptionJobRepository,
  TranscriptionError,
  SpeechmaticsClient,
  CreateJobResponse,
  JobStatusResponse,
  SpeechmaticsJobStatus,
  TranscriptionEventPublisher,
  TranscriptionCompletedEvent,
  AudioStoragePort,
} from '../domain/transcription/index.js';

/**
 * Fake AudioStorage for testing.
 */
export class FakeAudioStorage implements AudioStoragePort {
  private signedUrls = new Map<string, string>();
  private shouldFail = false;
  private failureMessage = 'Audio storage error';

  getSignedUrl(gcsPath: string, _ttlSeconds?: number): Promise<Result<string, TranscriptionError>> {
    if (this.shouldFail) {
      return Promise.resolve(err({ code: 'PERSISTENCE_ERROR', message: this.failureMessage }));
    }
    const url =
      this.signedUrls.get(gcsPath) ??
      `https://storage.googleapis.com/fake-bucket/${gcsPath}?token=fake-token`;
    return Promise.resolve(ok(url));
  }

  /**
   * Set a specific signed URL for a path.
   */
  setSignedUrl(gcsPath: string, url: string): void {
    this.signedUrls.set(gcsPath, url);
  }

  /**
   * Make the storage return errors.
   */
  setFailure(shouldFail: boolean, message?: string): void {
    this.shouldFail = shouldFail;
    if (message !== undefined) {
      this.failureMessage = message;
    }
  }

  clear(): void {
    this.signedUrls.clear();
    this.shouldFail = false;
    this.failureMessage = 'Audio storage error';
  }
}

/**
 * Fake TranscriptionJobRepository for testing.
 */
export class FakeJobRepository implements TranscriptionJobRepository {
  private jobs = new Map<string, TranscriptionJob>();

  create(job: Omit<TranscriptionJob, 'id'>): Promise<Result<TranscriptionJob, TranscriptionError>> {
    const id = randomUUID();
    const fullJob: TranscriptionJob = { id, ...job };
    this.jobs.set(id, fullJob);
    return Promise.resolve(ok(fullJob));
  }

  getById(id: string): Promise<Result<TranscriptionJob | null, TranscriptionError>> {
    return Promise.resolve(ok(this.jobs.get(id) ?? null));
  }

  findByMediaKey(
    messageId: string,
    mediaId: string
  ): Promise<Result<TranscriptionJob | null, TranscriptionError>> {
    for (const job of this.jobs.values()) {
      if (job.messageId === messageId && job.mediaId === mediaId) {
        return Promise.resolve(ok(job));
      }
    }
    return Promise.resolve(ok(null));
  }

  update(
    id: string,
    updates: Partial<
      Pick<
        TranscriptionJob,
        | 'status'
        | 'speechmaticsJobId'
        | 'transcript'
        | 'error'
        | 'pollAttempts'
        | 'nextPollAt'
        | 'completedAt'
        | 'updatedAt'
      >
    >
  ): Promise<Result<TranscriptionJob, TranscriptionError>> {
    const job = this.jobs.get(id);
    if (job === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: `Job ${id} not found` }));
    }

    const updatedJob: TranscriptionJob = {
      ...job,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(id, updatedJob);
    return Promise.resolve(ok(updatedJob));
  }

  getJobsReadyToPoll(limit = 10): Promise<Result<TranscriptionJob[], TranscriptionError>> {
    const now = new Date().toISOString();
    const readyJobs = Array.from(this.jobs.values())
      .filter(
        (job) =>
          job.status === 'processing' && job.nextPollAt !== undefined && job.nextPollAt <= now
      )
      .slice(0, limit);
    return Promise.resolve(ok(readyJobs));
  }

  getPendingJobs(limit = 10): Promise<Result<TranscriptionJob[], TranscriptionError>> {
    const pendingJobs = Array.from(this.jobs.values())
      .filter((job) => job.status === 'pending')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
    return Promise.resolve(ok(pendingJobs));
  }

  getAll(): TranscriptionJob[] {
    return Array.from(this.jobs.values());
  }

  clear(): void {
    this.jobs.clear();
  }
}

/**
 * Fake SpeechmaticsClient for testing.
 */
export class FakeSpeechmaticsClient implements SpeechmaticsClient {
  private jobs = new Map<
    string,
    { status: SpeechmaticsJobStatus; transcript?: string; error?: string }
  >();
  private nextJobId = 1;

  createJob(
    _audioUrl: string,
    _languageCode?: string
  ): Promise<Result<CreateJobResponse, TranscriptionError>> {
    const id = `speechmatics-job-${String(this.nextJobId++)}`;
    this.jobs.set(id, { status: 'accepted' });
    return Promise.resolve(ok({ id }));
  }

  getJobStatus(jobId: string): Promise<Result<JobStatusResponse, TranscriptionError>> {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: `Job ${jobId} not found` }));
    }

    const response: JobStatusResponse = {
      id: jobId,
      status: job.status,
    };

    if (job.transcript !== undefined) {
      response.transcript = job.transcript;
    }
    if (job.error !== undefined) {
      response.error = job.error;
    }

    return Promise.resolve(ok(response));
  }

  /**
   * Set job status for testing.
   */
  setJobStatus(
    jobId: string,
    status: SpeechmaticsJobStatus,
    transcript?: string,
    error?: string
  ): void {
    const jobData: { status: SpeechmaticsJobStatus; transcript?: string; error?: string } = {
      status,
    };
    if (transcript !== undefined) {
      jobData.transcript = transcript;
    }
    if (error !== undefined) {
      jobData.error = error;
    }
    this.jobs.set(jobId, jobData);
  }

  clear(): void {
    this.jobs.clear();
    this.nextJobId = 1;
  }
}

/**
 * Fake TranscriptionEventPublisher for testing.
 */
export class FakeEventPublisher implements TranscriptionEventPublisher {
  private events: TranscriptionCompletedEvent[] = [];

  publishCompleted(event: TranscriptionCompletedEvent): Promise<Result<void, TranscriptionError>> {
    this.events.push(event);
    return Promise.resolve(ok(undefined));
  }

  getPublishedEvents(): TranscriptionCompletedEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
