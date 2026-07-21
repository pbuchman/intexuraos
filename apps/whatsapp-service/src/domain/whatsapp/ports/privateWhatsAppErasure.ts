import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type { PrivateMediaDeletionBatchResult } from './mediaStorage.js';
import type {
  PrivateWhatsAppErasureRequest,
  PrivateWhatsAppErasureWorkItem,
} from '../models/PrivateWhatsAppErasure.js';

export type StartPrivateWhatsAppErasureResult =
  | { status: 'created'; request: PrivateWhatsAppErasureRequest }
  | { status: 'existing'; request: PrivateWhatsAppErasureRequest }
  | { status: 'not_found' }
  | { status: 'conflict' };

export type AdvancePrivateWhatsAppErasureResult =
  | { status: 'advanced'; request: PrivateWhatsAppErasureRequest }
  | {
      status: 'private_media';
      request: PrivateWhatsAppErasureRequest;
      cursor?: string;
    }
  | { status: 'completed'; request: PrivateWhatsAppErasureRequest }
  | { status: 'failed'; request: PrivateWhatsAppErasureRequest }
  | { status: 'stale' }
  | { status: 'not_found' };

export type CommitPrivateMediaErasureResult = Exclude<
  AdvancePrivateWhatsAppErasureResult,
  { status: 'private_media' }
>;

export interface PrivateWhatsAppErasureRepository {
  start(input: {
    sourceAccountId: string;
    userId: string;
    erasureRequestId: string;
    now: string;
  }): Promise<Result<StartPrivateWhatsAppErasureResult, WhatsAppError>>;

  get(input: {
    sourceAccountId: string;
    erasureRequestId: string;
  }): Promise<Result<PrivateWhatsAppErasureRequest | null, WhatsAppError>>;

  advanceOneBatch(input: {
    sourceAccountId: string;
    userId: string;
    erasureRequestId: string;
    expectedAttempt: number;
    batchSize: number;
    now: string;
  }): Promise<Result<AdvancePrivateWhatsAppErasureResult, WhatsAppError>>;

  commitPrivateMediaBatch(input: {
    sourceAccountId: string;
    userId: string;
    erasureRequestId: string;
    expectedAttempt: number;
    expectedCursor?: string;
    batch: PrivateMediaDeletionBatchResult;
    now: string;
  }): Promise<Result<CommitPrivateMediaErasureResult, WhatsAppError>>;
}

export interface PrivateWhatsAppErasurePublisher {
  publishPrivateWhatsAppErasure(
    event: PrivateWhatsAppErasureWorkItem
  ): Promise<Result<void, WhatsAppError>>;
}
