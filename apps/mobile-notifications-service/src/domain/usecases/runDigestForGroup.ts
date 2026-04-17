import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { getServices } from '../../services.js';
import { filterAndDedupeNotifications, type RawNotification } from '../messageFilter.js';
import { aggregateDigest } from './aggregateDigest.js';
import {
  type DigestError,
  lockHeld,
  persistenceFailed,
} from './digestErrors.js';
import type { DailySummary, GroupState } from '../schemas/digestSchemas.js';
import type { PersistedDailySummary, RepositoryError } from '../repositories/digestRepositories.js';
import type { PaginatedNotifications, RepositoryError as NotifRepositoryError } from '../notifications/index.js';

export interface RunDigestForGroupDeps {
  readonly llmClient: LlmGenerateClient;
  readonly logger: Logger;
  readonly modelId: string;
}

export interface RunDigestForGroupInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string; // YYYY-MM-DD (CET interpretation)
  readonly holder: 'cron' | 'backfill' | 'manual';
}

export interface RunDigestForGroupResult {
  readonly summary: DailySummary;
  readonly state: GroupState;
  readonly generation: number;
  readonly modelId: string;
  readonly regenerated: boolean;
}

const PREVIOUS_SUMMARIES_WINDOW = 3;

export async function runDigestForGroup(
  deps: RunDigestForGroupDeps,
  input: RunDigestForGroupInput,
): Promise<Result<RunDigestForGroupResult, DigestError>> {
  const services = getServices();

  const lock = await services.digestLockRepository.acquire({
    userId: input.userId,
    groupKey: input.groupKey,
    holder: input.holder,
    currentDate: input.date,
  });
  if (!lock.ok) return err(persistenceFailed(lock.error.message));
  if (!lock.value.acquired) return err(lockHeld(lock.value.heldBy ?? 'unknown'));

  try {
    const previousState = await loadPreviousState(services, input);
    if (!previousState.ok) return err(persistenceFailed(previousState.error.message));

    const lastSummaries = await loadLastSummaries(services, input);
    if (!lastSummaries.ok) return err(persistenceFailed(lastSummaries.error.message));

    const messages = await loadDayMessages(services, input);
    if (!messages.ok) return err(persistenceFailed(messages.error.message));

    const rawNotifications = messages.value.notifications as unknown as RawNotification[];
    const filtered = filterAndDedupeNotifications(rawNotifications);
    deps.logger.info({ ...input, raw: rawNotifications.length, filtered: filtered.length }, 'runDigestForGroup: input prepared');

    const existing = await services.digestRepository.findByDate({
      userId: input.userId, groupKey: input.groupKey, date: input.date,
    });
    if (!existing.ok) return err(persistenceFailed(existing.error.message));
    const regenerated = existing.value !== null;

    const aggregation = await aggregateDigest(
      { llmClient: deps.llmClient, logger: deps.logger },
      {
        userId: input.userId,
        groupKey: input.groupKey,
        date: input.date,
        previousState: previousState.value,
        last3Summaries: lastSummaries.value.map((p) => p.summary),
        todaysMessages: filtered.map((m) => ({ sender: m.sender, text: m.text, postTimeSec: m.postTimeSec })),
      },
    );
    if (!aggregation.ok) return aggregation;

    const persistSummary = await services.digestRepository.save({
      userId: input.userId,
      groupKey: input.groupKey,
      summary: aggregation.value.dailySummary,
      modelId: deps.modelId,
    });
    if (!persistSummary.ok) return err(persistenceFailed(persistSummary.error.message));

    const persistState = await services.groupStateRepository.save({
      state: aggregation.value.stateUpdate,
      date: input.date,
    });
    if (!persistState.ok) return err(persistenceFailed(persistState.error.message));

    return ok({
      summary: aggregation.value.dailySummary,
      state: aggregation.value.stateUpdate,
      generation: persistSummary.value.generation,
      modelId: deps.modelId,
      regenerated,
    });
  } finally {
    await services.digestLockRepository.release({ userId: input.userId, groupKey: input.groupKey });
  }
}

async function loadPreviousState(
  services: ReturnType<typeof getServices>,
  input: RunDigestForGroupInput,
): Promise<Result<GroupState | null, { message: string }>> {
  const prior = previousDate(input.date);
  const r = await services.groupStateRepository.getByDate({
    userId: input.userId, groupKey: input.groupKey, date: prior,
  });
  if (!r.ok) return err({ message: r.error.message });
  return ok(r.value);
}

async function loadLastSummaries(
  services: ReturnType<typeof getServices>,
  input: RunDigestForGroupInput,
): Promise<Result<readonly PersistedDailySummary[], RepositoryError>> {
  return await services.digestRepository.findRecentByGroup({
    userId: input.userId, groupKey: input.groupKey, limit: PREVIOUS_SUMMARIES_WINDOW,
  });
}

async function loadDayMessages(
  services: ReturnType<typeof getServices>,
  input: RunDigestForGroupInput,
): Promise<Result<PaginatedNotifications, NotifRepositoryError>> {
  // The notification repo already filters by app/title; we narrow further here by date.
  // Using ISO date conversion via Europe/Warsaw timezone.
  return await services.notificationRepository.findByUserIdPaginated(input.userId, {
    limit: 1000,
    filter: { title: input.groupKey, app: ['com.whatsapp'] },
  });
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
