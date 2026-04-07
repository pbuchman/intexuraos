import type { Result } from '@intexuraos/common-core';
import type { MergeQueueWatch, SkippedPr } from '../models/mergeQueueWatch.js';

export interface MergeQueueWatchRepositoryError {
  code: 'FIRESTORE_ERROR' | 'NOT_FOUND' | 'CONFLICT';
  message: string;
}

export interface CreateWatchInput {
  userId: string;
  gitHubUsername: string;
  owner: string;
  repo: string;
  baseBranch: string;
  excludedPrNumbers?: number[];
}

export interface UpdateWatchInput {
  lastTickAt?: Date;
  skippedPrs?: SkippedPr[];
  lastError?: string | null;
  lastErrorAt?: Date | null;
  status?: MergeQueueWatch['status'];
  drainedAt?: Date | null;
  cancelledAt?: Date | null;
  excludedPrNumbers?: number[];
}

export interface MergeQueueWatchRepository {
  create(input: CreateWatchInput): Promise<Result<MergeQueueWatch, MergeQueueWatchRepositoryError>>;
  findById(id: string): Promise<Result<MergeQueueWatch, MergeQueueWatchRepositoryError>>;
  findActiveByUserAndBranch(
    userId: string,
    owner: string,
    repo: string,
    baseBranch: string
  ): Promise<Result<MergeQueueWatch | null, MergeQueueWatchRepositoryError>>;
  findAllActive(): Promise<Result<MergeQueueWatch[], MergeQueueWatchRepositoryError>>;
  findByUserAndRepo(
    userId: string,
    owner: string,
    repo: string
  ): Promise<Result<MergeQueueWatch[], MergeQueueWatchRepositoryError>>;
  update(id: string, input: UpdateWatchInput): Promise<Result<void, MergeQueueWatchRepositoryError>>;
  appendMergedPr(id: string, mergedPr: AppendMergedPrInput): Promise<Result<void, MergeQueueWatchRepositoryError>>;
}

/** Input for appendMergedPr — uses Date instead of Timestamp so the domain stays infra-agnostic. */
export interface AppendMergedPrInput {
  prNumber: number;
  title: string;
  author: string;
}
