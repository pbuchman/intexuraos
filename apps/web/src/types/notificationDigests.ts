/**
 * Types for the WhatsApp group daily-digest feature.
 *
 * Mirrors the API response shapes defined in
 * apps/mobile-notifications-service/src/routes/digestRoutes.ts and
 * apps/mobile-notifications-service/src/domain/schemas/digestSchemas.ts.
 * Kept in one place for the web app — no zod runtime here, only TS shapes.
 */

export interface DigestThread {
  readonly topic: string;
  readonly participants: readonly string[];
  readonly resolved: boolean;
  readonly keyFacts: readonly string[];
}

export interface DigestModeratorPost {
  readonly time: string;
  readonly topic: string;
  readonly summary: string;
}

export interface DigestActivityOutlier {
  readonly sender: string;
  readonly messageCount: number;
  readonly note: string;
}

export interface DailySummary {
  readonly date: string;
  readonly groupKey: string;
  readonly messageCount: number;
  readonly headline: string;
  readonly bullets: readonly string[];
  readonly threads: readonly DigestThread[];
  readonly moderatorPosts: readonly DigestModeratorPost[];
  readonly openQuestions: readonly string[];
  readonly activityOutliers: readonly DigestActivityOutlier[];
}

export interface PersistedDailySummary {
  readonly summary: DailySummary;
  readonly generation: number;
  readonly generatedAt: string;
  readonly modelId: string;
}

export interface IdentityLedgerEntry {
  readonly sender: string;
  readonly firstSeen: string;
  readonly totalMessages: number;
  readonly activeDays: number;
  readonly role?: 'member' | 'moderator' | 'newcomer';
  readonly notes?: string;
}

export interface ModeratorEvent {
  readonly date: string;
  readonly topic: string;
  readonly summary: string;
}

export interface OpenThread {
  readonly topic: string;
  readonly openedOn: string;
  readonly lastSignal: string;
  readonly lastSignalDate: string;
}

export interface GroupState {
  readonly userId: string;
  readonly groupKey: string;
  readonly updatedAt: string;
  readonly identityLedger: readonly IdentityLedgerEntry[];
  readonly moderatorEvents: readonly ModeratorEvent[];
  readonly openThreads: readonly OpenThread[];
  readonly recentSummaryDates: readonly string[];
}

export interface RunDigestResponse {
  readonly summaryDocId: string;
  readonly generation: number;
  readonly messageCount: number;
  readonly modelId: string;
  readonly regenerated: boolean;
  readonly lockSkipped?: boolean;
}

export interface ListDigestsResponse {
  readonly items: readonly PersistedDailySummary[];
  readonly nextCursor?: string;
}

export type BackfillStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface BackfillFailure {
  readonly date: string;
  readonly error: string;
}

export interface BackfillRun {
  readonly runId: string;
  readonly userId: string;
  readonly groupKey: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly status: BackfillStatus;
  readonly totalDates: number;
  readonly completedDates: readonly string[];
  readonly failedDates: readonly BackfillFailure[];
  readonly currentDate: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface StartBackfillResponse {
  readonly runId: string;
  readonly queuedDates: readonly string[];
}
