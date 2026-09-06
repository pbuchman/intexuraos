import { createHash } from 'node:crypto';
import type {
  MessageDigestDefinition,
  MessageDigestSchedule,
  MessageDigestState,
} from '../models/messageDigestDefinition.js';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { previewMessageDigestSchedule } from '../schedules/messageDigestSchedule.js';

export interface CreateMessageDigestInput {
  userId: string;
  requestId: string;
  status: 'active' | 'paused';
  name: string;
  source: { chatId: string };
  instructions: {
    templateId: 'fishing_group' | 'direct_sentiment' | 'custom';
    text: string;
  };
  schedule: MessageDigestSchedule;
}

export interface CreateMessageDigestDependencies {
  store: Pick<MessageDigestStore, 'createDefinition' | 'getOwnedDefinition'>;
  whatsappClient: Pick<MessageDigestWhatsAppClient, 'validateSource' | 'getDeliveryReadiness'>;
  now?: (() => string) | undefined;
}

export type CreateMessageDigestResult =
  | {
      ok: true;
      disposition: 'created' | 'existing';
      activationAdjusted: 'delivery_setup_required' | null;
      definition: MessageDigestDefinition;
    }
  | {
      ok: false;
      code:
        | 'INVALID_REQUEST'
        | 'INVALID_SCHEDULE'
        | 'SOURCE_NOT_FOUND'
        | 'SOURCE_UNAVAILABLE'
        | 'READINESS_UNAVAILABLE'
        | 'CREATE_CONFLICT';
    };

export async function createMessageDigest(
  input: CreateMessageDigestInput,
  dependencies: CreateMessageDigestDependencies
): Promise<CreateMessageDigestResult> {
  const normalized = normalizeInput(input);
  if (normalized === null) return { ok: false, code: 'INVALID_REQUEST' };
  const definitionId = createDefinitionId(normalized.userId, normalized.requestId);
  const createRequestIdDigest = createRequestFingerprint(normalized);
  const existing = await dependencies.store.getOwnedDefinition(
    normalized.userId,
    definitionId
  );
  if (existing !== null) {
    if (existing.createRequestIdDigest !== createRequestIdDigest) {
      return { ok: false, code: 'CREATE_CONFLICT' };
    }
    return {
      ok: true,
      disposition: 'existing',
      activationAdjusted: activationAdjustment(existing),
      definition: existing,
    };
  }
  const now = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (now === null) return { ok: false, code: 'INVALID_REQUEST' };
  const schedulePreview = previewMessageDigestSchedule({
    schedule: normalized.schedule,
    evaluatedAt: now,
  });
  if (!schedulePreview.ok) return { ok: false, code: 'INVALID_SCHEDULE' };

  const sourceResult = await dependencies.whatsappClient.validateSource({
    userId: normalized.userId,
    chatId: normalized.source.chatId,
  });
  if (!sourceResult.ok) {
    return {
      ok: false,
      code: sourceResult.code === 'not_found' ? 'SOURCE_NOT_FOUND' : 'SOURCE_UNAVAILABLE',
    };
  }
  const readinessResult = await dependencies.whatsappClient.getDeliveryReadiness(normalized.userId);
  if (!readinessResult.ok) return { ok: false, code: 'READINESS_UNAVAILABLE' };

  const ready = readinessResult.value.status === 'ready';
  const active = ready && normalized.status === 'active';
  const definition: MessageDigestDefinition = {
    version: 1,
    definitionId,
    userId: normalized.userId,
    name: normalized.name,
    nameSortKey: normalizeSearchValue(normalized.name),
    status: active ? 'active' : 'paused',
    listStatus: ready ? normalized.status : 'needs_attention',
    attentionCode: ready ? null : 'DELIVERY_SETUP_REQUIRED',
    revision: 1,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: false,
    source: {
      type: 'private_whatsapp',
      ...sourceResult.value,
    },
    instructions: {
      ...normalized.instructions,
      revision: '1',
    },
    schedule: normalized.schedule,
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: readinessResult.value.observationVersion,
      readinessObservedAt: readinessResult.value.observedAt,
    },
    checkpointAt: schedulePreview.value.precedingBoundary,
    nextRunAt: schedulePreview.value.nextBoundary,
    lastRunAt: null,
    latestRun: null,
    createRequestIdDigest,
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: now,
    updatedAt: now,
  };
  const state: MessageDigestState = {
    version: 1,
    definitionId,
    userId: normalized.userId,
    revision: 1,
    checkpointAt: schedulePreview.value.precedingBoundary,
    continuityMemoryMarkdown: '',
    precedingRunId: null,
    precedingRunHash: null,
    pendingWindow: null,
    updatedAt: now,
  };
  const stored = await dependencies.store.createDefinition({ definition, state });
  if (!stored.ok) return { ok: false, code: stored.code };
  return {
    ok: true,
    disposition: stored.disposition,
    activationAdjusted: activationAdjustment(stored.definition),
    definition: stored.definition,
  };
}

function activationAdjustment(
  definition: MessageDigestDefinition
): 'delivery_setup_required' | null {
  return definition.status === 'paused' &&
    definition.attentionCode === 'DELIVERY_SETUP_REQUIRED'
    ? 'delivery_setup_required'
    : null;
}

function normalizeInput(input: CreateMessageDigestInput): CreateMessageDigestInput | null {
  const userId = input.userId.trim();
  const requestId = input.requestId.trim();
  const name = input.name.trim();
  const chatId = input.source.chatId.trim();
  const instructionText = input.instructions.text.trim();
  if (
    userId === '' ||
    requestId.length < 8 ||
    requestId.length > 256 ||
    name === '' ||
    name.length > 80 ||
    chatId === '' ||
    instructionText.length < 20 ||
    instructionText.length > 4_000 ||
    !isCreateStatus(input.status)
  ) {
    return null;
  }
  return {
    ...input,
    userId,
    requestId,
    name,
    source: { chatId },
    instructions: { ...input.instructions, text: instructionText },
  };
}

function isCreateStatus(value: unknown): value is CreateMessageDigestInput['status'] {
  return value === 'active' || value === 'paused';
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function normalizeMessageDigestSearchValue(value: string): string {
  return normalizeSearchValue(value);
}

function normalizeSearchValue(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('pl-PL');
}

function createDefinitionId(userId: string, requestId: string): string {
  return `md_${digest(['message-digest-definition-v1', userId, requestId]).slice(0, 40)}`;
}

function createRequestFingerprint(input: CreateMessageDigestInput): string {
  return digest([
    'message-digest-create-request-v1',
    input.userId,
    input.requestId,
    input.status,
    input.name,
    input.source.chatId,
    input.instructions.templateId,
    input.instructions.text,
    input.schedule.kind,
    input.schedule.kind === 'weekly' ? input.schedule.weekday : '',
    input.schedule.localTime,
    input.schedule.timeZone,
  ]);
}

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part.length.toString(10)).update(':').update(part);
  return hash.digest('hex');
}
