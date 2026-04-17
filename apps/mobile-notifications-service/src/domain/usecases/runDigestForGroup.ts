import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { getServices } from '../../services.js';
import { filterAndDedupeNotifications, type RawNotification } from '../messageFilter.js';
import { aggregateDigest } from './aggregateDigest.js';
import { cetDayBounds } from './cetDayBounds.js';
import {
  type DigestError,
  lockHeld,
  persistenceFailed,
} from './digestErrors.js';
import type { DailySummary, GroupState } from '../schemas/digestSchemas.js';
import type { DigestLockHolder } from '../repositories/digestRepositories.js';

export interface RunDigestForGroupDeps {
  readonly llmClient: LlmGenerateClient;
  readonly logger: Logger;
  readonly modelId: string;
}

export interface RunDigestForGroupInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly groupTitlePrefix: string;
  readonly date: string; // YYYY-MM-DD (CET interpretation)
  readonly holder: DigestLockHolder;
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
    const bounds = cetDayBounds(input.date);
    const [previousState, lastSummaries, messages] = await Promise.all([
      services.groupStateRepository.getByDate({
        userId: input.userId, groupKey: input.groupKey, date: previousDate(input.date),
      }),
      services.digestRepository.findRecentByGroup({
        userId: input.userId, groupKey: input.groupKey, limit: PREVIOUS_SUMMARIES_WINDOW,
      }),
      services.notificationRepository.findByUserIdPaginated(input.userId, {
        limit: 1000,
        filter: {
          title: input.groupTitlePrefix,
          app: ['com.whatsapp'],
          postTimeSecFrom: bounds.fromSec,
          postTimeSecTo: bounds.toSec,
        },
      }),
    ]);
    if (!previousState.ok) return err(persistenceFailed(previousState.error.message));
    if (!lastSummaries.ok) return err(persistenceFailed(lastSummaries.error.message));
    if (!messages.ok) return err(persistenceFailed(messages.error.message));

    const rawNotifications = messages.value.notifications as unknown as RawNotification[];
    const filtered = filterAndDedupeNotifications(rawNotifications);
    deps.logger.info({ ...input, raw: rawNotifications.length, filtered: filtered.length }, 'runDigestForGroup: input prepared');

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
      regenerated: persistSummary.value.generation > 1,
    });
  } finally {
    await services.digestLockRepository.release({ userId: input.userId, groupKey: input.groupKey });
  }
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
