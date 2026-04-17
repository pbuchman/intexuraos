/**
 * API wrapper for the WhatsApp group daily-digest endpoints served by
 * mobile-notifications-service. Mirrors the codeAgentApi.ts pattern.
 */

import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  BackfillRun,
  GroupState,
  ListDigestsResponse,
  PersistedDailySummary,
  RunDigestResponse,
  StartBackfillResponse,
} from '@/types/notificationDigests';

export interface ListDigestsOptions {
  readonly groupKey: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * List daily digests for the authenticated user in [fromDate, toDate].
 */
export async function listDigests(
  accessToken: string,
  options: ListDigestsOptions,
): Promise<ListDigestsResponse> {
  const params = new URLSearchParams();
  params.set('groupKey', options.groupKey);
  params.set('fromDate', options.fromDate);
  params.set('toDate', options.toDate);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor !== undefined) params.set('cursor', options.cursor);
  return await apiRequest<ListDigestsResponse>(
    config.mobileNotificationsServiceUrl,
    `/notifications/digests?${params.toString()}`,
    accessToken,
  );
}

/**
 * Fetch a single digest by (groupKey, date).
 * Returns null if the digest does not exist (404).
 */
export async function getDigest(
  accessToken: string,
  groupKey: string,
  date: string,
): Promise<PersistedDailySummary> {
  return await apiRequest<PersistedDailySummary>(
    config.mobileNotificationsServiceUrl,
    `/notifications/digests/${encodeURIComponent(groupKey)}/${encodeURIComponent(date)}`,
    accessToken,
  );
}

/**
 * Fetch the group-state snapshot for a specific date.
 */
export async function getDigestState(
  accessToken: string,
  groupKey: string,
  date: string,
): Promise<GroupState> {
  return await apiRequest<GroupState>(
    config.mobileNotificationsServiceUrl,
    `/notifications/digests/${encodeURIComponent(groupKey)}/${encodeURIComponent(date)}/state`,
    accessToken,
  );
}

/**
 * Regenerate (or create) the digest for a specific (groupKey, date).
 * Returns generation metadata; if lockSkipped=true, the caller should retry later.
 */
export async function runDigest(
  accessToken: string,
  input: { groupKey: string; date: string },
): Promise<RunDigestResponse> {
  return await apiRequest<RunDigestResponse>(
    config.mobileNotificationsServiceUrl,
    '/notifications/digests/run',
    accessToken,
    { method: 'POST', body: input, timeout: 90000 },
  );
}

/**
 * Start a new backfill run for a date range. Returns the runId and the list
 * of queued dates. Subsequent days are processed asynchronously via an
 * internal HTTP chain.
 */
export async function startBackfill(
  accessToken: string,
  input: { groupKey: string; fromDate: string; toDate: string },
): Promise<StartBackfillResponse> {
  return await apiRequest<StartBackfillResponse>(
    config.mobileNotificationsServiceUrl,
    '/notifications/digests/backfill',
    accessToken,
    { method: 'POST', body: input },
  );
}

/**
 * Poll the status of an in-flight or completed backfill run.
 */
export async function getBackfillRun(
  accessToken: string,
  runId: string,
): Promise<BackfillRun> {
  return await apiRequest<BackfillRun>(
    config.mobileNotificationsServiceUrl,
    `/notifications/digests/backfill/${encodeURIComponent(runId)}`,
    accessToken,
  );
}
