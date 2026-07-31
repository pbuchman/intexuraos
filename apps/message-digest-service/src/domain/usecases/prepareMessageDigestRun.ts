import type {
  MessageDigestDeliveryReadiness,
  MessageDigestWhatsAppClient,
} from '../ports/messageDigestClients.js';
import type { MessageDigestRunPreparationTokens } from '../ports/runPreparationTokens.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { getNextMessageDigestBoundary } from '../schedules/messageDigestSchedule.js';

export interface PrepareMessageDigestRunInput {
  userId: string;
  definitionId: string;
}

export interface PrepareMessageDigestRunDependencies {
  store: Pick<MessageDigestStore, 'getOwnedRunContext'>;
  whatsappClient: Pick<MessageDigestWhatsAppClient, 'getDeliveryReadiness'>;
  preparationTokens: Pick<MessageDigestRunPreparationTokens, 'issue'>;
  now?: (() => string) | undefined;
}

export type PrepareMessageDigestRunResult =
  | {
      ok: true;
      preparation: {
        token: string;
        preparedAt: string;
        window: { start: string; end: string; timeZone: string };
        source: { chatType: 'group' | 'direct'; displayName: string };
        deliveryReadiness: { status: 'ready'; maskedPrimaryNumber?: string | undefined };
      };
    }
  | {
      ok: false;
      code:
        | 'INVALID_REQUEST'
        | 'NOT_FOUND'
        | 'NOT_ACTIVE'
        | 'RUN_IN_PROGRESS'
        | 'NO_OPEN_WINDOW'
        | 'INVALID_SCHEDULE'
        | 'READINESS_UNAVAILABLE'
        | 'DELIVERY_NOT_READY'
        | 'PREPARATION_FAILED';
      readinessStatus?: Exclude<MessageDigestDeliveryReadiness['status'], 'ready'> | undefined;
    };

export async function prepareMessageDigestRun(
  input: PrepareMessageDigestRunInput,
  dependencies: PrepareMessageDigestRunDependencies
): Promise<PrepareMessageDigestRunResult> {
  const userId = input.userId.trim();
  const definitionId = input.definitionId.trim();
  const preparedAt = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (
    userId === '' ||
    userId.length > 256 ||
    definitionId === '' ||
    definitionId.length > 256 ||
    preparedAt === null
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const context = await dependencies.store.getOwnedRunContext(userId, definitionId);
  if (context === null) return { ok: false, code: 'NOT_FOUND' };
  if (context.definition.status !== 'active') return { ok: false, code: 'NOT_ACTIVE' };
  if (context.state.pendingWindow !== null) return { ok: false, code: 'RUN_IN_PROGRESS' };
  if (
    context.definition.checkpointAt !== context.state.checkpointAt ||
    Date.parse(context.state.checkpointAt) >= Date.parse(preparedAt)
  ) {
    return { ok: false, code: 'NO_OPEN_WINDOW' };
  }

  const nextBoundary = getNextMessageDigestBoundary(context.definition.schedule, preparedAt);
  if (!nextBoundary.ok) return { ok: false, code: 'INVALID_SCHEDULE' };

  const readiness = await dependencies.whatsappClient.getDeliveryReadiness(userId);
  if (!readiness.ok) return { ok: false, code: 'READINESS_UNAVAILABLE' };
  if (readiness.value.status !== 'ready') {
    return {
      ok: false,
      code: 'DELIVERY_NOT_READY',
      readinessStatus: readiness.value.status,
    };
  }

  const issued = dependencies.preparationTokens.issue({
    userId,
    definitionId,
    definitionRevision: context.definition.revision,
    stateRevision: context.state.revision,
    erasureEpoch: context.definition.erasureEpoch,
    windowStart: context.state.checkpointAt,
    windowEnd: preparedAt,
    nextRunAt: nextBoundary.value,
    persistedReadinessObservationVersion: context.definition.delivery.readinessObservationVersion,
    preparedReadinessObservationVersion: readiness.value.observationVersion,
  });
  if (!issued.ok) return { ok: false, code: 'PREPARATION_FAILED' };

  return {
    ok: true,
    preparation: {
      token: issued.value,
      preparedAt,
      window: {
        start: context.state.checkpointAt,
        end: preparedAt,
        timeZone: context.definition.schedule.timeZone,
      },
      source: {
        chatType: context.definition.source.chatType,
        displayName: context.definition.source.displayName,
      },
      deliveryReadiness: {
        status: 'ready',
        ...(readiness.value.maskedPrimaryNumber === undefined
          ? {}
          : { maskedPrimaryNumber: readiness.value.maskedPrimaryNumber }),
      },
    },
  };
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
