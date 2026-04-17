import type { Result } from '@intexuraos/common-core';
import type {
  DailySummary,
  GroupState,
} from '../schemas/digestSchemas.js';

export interface RepositoryError {
  readonly code: 'INTERNAL_ERROR' | 'NOT_FOUND' | 'CONFLICT';
  readonly message: string;
}

export type DigestLockHolder = 'cron' | 'backfill' | 'manual';

/** Doc shape stored in `notification_daily_digests`. Augments DailySummary with server fields. */
export interface PersistedDailySummary {
  readonly summary: DailySummary;
  readonly generation: number;
  readonly generatedAt: string; // ISO
  readonly modelId: string;
}

export interface DigestRepository {
  /** Save (overwriting if exists) and return the new generation number. */
  save(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly summary: DailySummary;
    readonly modelId: string;
  }): Promise<Result<PersistedDailySummary, RepositoryError>>;

  findByDate(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly date: string;
  }): Promise<Result<PersistedDailySummary | null, RepositoryError>>;

  /** Last N summaries for a group, ordered by date desc. */
  findRecentByGroup(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly limit: number;
  }): Promise<Result<readonly PersistedDailySummary[], RepositoryError>>;

  findInRange(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly fromDate: string;
    readonly toDate: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<Result<{
    readonly items: readonly PersistedDailySummary[];
    readonly nextCursor?: string;
  }, RepositoryError>>;
}

export interface GroupStateRepository {
  /** Read snapshot for a specific date. Returns null if missing. */
  getByDate(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly date: string;
  }): Promise<Result<GroupState | null, RepositoryError>>;

  /** Read the latest snapshot (highest date) for a group. Returns null if none. */
  getLatest(input: {
    readonly userId: string;
    readonly groupKey: string;
  }): Promise<Result<GroupState | null, RepositoryError>>;

  /** Save snapshot for the given date (overwrites). Trims `recentSummaryDates` to last 30. */
  save(input: {
    readonly state: GroupState;
    readonly date: string;
  }): Promise<Result<void, RepositoryError>>;
}

export interface DigestLockRepository {
  /**
   * Try to acquire a lock for `(userId, groupKey)`. Returns ok(true) on success,
   * ok(false) if held and not expired. TTL is 5 minutes.
   */
  acquire(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly holder: DigestLockHolder;
    readonly currentDate: string;
  }): Promise<Result<{ readonly acquired: boolean; readonly heldBy?: string }, RepositoryError>>;

  release(input: {
    readonly userId: string;
    readonly groupKey: string;
  }): Promise<Result<void, RepositoryError>>;
}
