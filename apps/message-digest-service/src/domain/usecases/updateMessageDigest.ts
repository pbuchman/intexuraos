import type {
  MessageDigestDefinition,
  MessageDigestSchedule,
} from '../models/messageDigestDefinition.js';
import type {
  MessageDigestWhatsAppClient,
  ValidatedMessageDigestSource,
} from '../ports/messageDigestClients.js';
import type { DefinitionUpdatePatch, MessageDigestStore } from '../ports/messageDigestStore.js';
import {
  previewMessageDigestSchedule,
  type MessageDigestSchedulePreview,
} from '../schedules/messageDigestSchedule.js';
import { normalizeMessageDigestSearchValue } from './createMessageDigest.js';

export interface UpdateMessageDigestInput {
  userId: string;
  definitionId: string;
  expectedRevision: number;
  patch: {
    name?: string | undefined;
    source?: { chatId: string } | undefined;
    instructions?:
      | {
          templateId: 'fishing_group' | 'direct_sentiment' | 'custom';
          text: string;
        }
      | undefined;
    schedule?: MessageDigestSchedule | undefined;
    status?: 'active' | 'paused' | undefined;
  };
}

export interface UpdateMessageDigestDependencies {
  store: Pick<MessageDigestStore, 'getOwnedDefinition' | 'updateDefinition'>;
  whatsappClient: Pick<MessageDigestWhatsAppClient, 'validateSource' | 'getDeliveryReadiness'>;
  now?: (() => string) | undefined;
}

export type UpdateMessageDigestResult =
  | { ok: true; definition: MessageDigestDefinition }
  | {
      ok: false;
      code:
        | 'INVALID_REQUEST'
        | 'INVALID_SCHEDULE'
        | 'NOT_FOUND'
        | 'REVISION_CONFLICT'
        | 'SOURCE_LOCKED'
        | 'SOURCE_NOT_FOUND'
        | 'SOURCE_CHANGED'
        | 'SOURCE_UNAVAILABLE'
        | 'READINESS_UNAVAILABLE'
        | 'DELIVERY_NOT_READY'
        | 'INVALID_TRANSITION'
        | 'RUN_IN_PROGRESS';
    };

export async function updateMessageDigest(
  input: UpdateMessageDigestInput,
  dependencies: UpdateMessageDigestDependencies
): Promise<UpdateMessageDigestResult> {
  const now = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (now === null || !isValidEnvelope(input)) return { ok: false, code: 'INVALID_REQUEST' };
  const existing = await dependencies.store.getOwnedDefinition(input.userId, input.definitionId);
  if (existing === null) return { ok: false, code: 'NOT_FOUND' };
  if (existing.revision !== input.expectedRevision) {
    return { ok: false, code: 'REVISION_CONFLICT' };
  }

  const requestedChatId = input.patch.source?.chatId.trim();
  const replacingSource =
    requestedChatId !== undefined &&
    requestedChatId !== '' &&
    requestedChatId !== existing.source.chatId;
  if (replacingSource && existing.hasRuns) return { ok: false, code: 'SOURCE_LOCKED' };

  const resuming = existing.status === 'paused' && input.patch.status === 'active';

  const effectiveSchedule = input.patch.schedule ?? existing.schedule;
  let schedulePreview: MessageDigestSchedulePreview | null = null;
  let resetCheckpointAt = existing.checkpointAt;
  if (input.patch.schedule !== undefined || replacingSource || resuming) {
    const previewResult = previewMessageDigestSchedule({
      schedule: effectiveSchedule,
      evaluatedAt: now,
    });
    if (!previewResult.ok) return { ok: false, code: 'INVALID_SCHEDULE' };
    schedulePreview = previewResult.value;
    resetCheckpointAt = previewResult.value.precedingBoundary;
  }

  const nextBoundary = schedulePreview?.nextBoundary ?? existing.nextRunAt;
  const patch = buildProspectivePatch(input, existing, nextBoundary);
  if (patch === null) return { ok: false, code: 'INVALID_REQUEST' };
  if (resuming && existing.listStatus === 'needs_attention') {
    patch.releaseFailedPendingWindow = true;
  }

  if (resuming && !replacingSource) {
    const sourceResult = await dependencies.whatsappClient.validateSource({
      userId: input.userId,
      chatId: existing.source.chatId,
      expectedGenerationId: existing.source.generationId,
    });
    if (!sourceResult.ok) {
      return {
        ok: false,
        code:
          sourceResult.code === 'not_found'
            ? 'SOURCE_NOT_FOUND'
            : sourceResult.code === 'source_changed'
              ? 'SOURCE_CHANGED'
              : 'SOURCE_UNAVAILABLE',
      };
    }
    if (!matchesFrozenSource(sourceResult.value, existing.source)) {
      return { ok: false, code: 'SOURCE_CHANGED' };
    }
  }

  if (replacingSource) {
    const sourceResult = await dependencies.whatsappClient.validateSource({
      userId: input.userId,
      chatId: requestedChatId,
    });
    if (!sourceResult.ok) {
      return {
        ok: false,
        code: sourceResult.code === 'not_found' ? 'SOURCE_NOT_FOUND' : 'SOURCE_UNAVAILABLE',
      };
    }
    patch.source = { type: 'private_whatsapp', ...sourceResult.value };
    patch.resetCheckpointAt = resetCheckpointAt;
    patch.nextRunAt = nextBoundary;
  }

  if (replacingSource || resuming) {
    const readiness = await dependencies.whatsappClient.getDeliveryReadiness(input.userId);
    if (!readiness.ok) return { ok: false, code: 'READINESS_UNAVAILABLE' };
    const effectiveStatus = input.patch.status ?? existing.status;
    if (effectiveStatus === 'active' && readiness.value.status !== 'ready') {
      return { ok: false, code: 'DELIVERY_NOT_READY' };
    }
    patch.delivery = {
      type: 'whatsapp_primary',
      readinessObservationVersion: readiness.value.observationVersion,
      readinessObservedAt: readiness.value.observedAt,
    };
    if (effectiveStatus === 'paused' && readiness.value.status !== 'ready') {
      patch.listStatus = 'needs_attention';
      patch.attentionCode = 'DELIVERY_SETUP_REQUIRED';
    }
    if (resuming) {
      patch.nextRunAt = nextBoundary;
    }
  }

  const updated = await dependencies.store.updateDefinition({
    userId: input.userId,
    definitionId: input.definitionId,
    expectedRevision: input.expectedRevision,
    updatedAt: now,
    patch,
  });
  if (!updated.ok) return updated;
  return { ok: true, definition: updated.definition };
}

function matchesFrozenSource(
  validated: ValidatedMessageDigestSource,
  frozen: MessageDigestDefinition['source']
): boolean {
  return (
    validated.sourceAccountId === frozen.sourceAccountId &&
    validated.generationId === frozen.generationId &&
    validated.chatId === frozen.chatId &&
    validated.chatType === frozen.chatType
  );
}

function buildProspectivePatch(
  input: UpdateMessageDigestInput,
  existing: MessageDigestDefinition,
  nextBoundary: string
): DefinitionUpdatePatch | null {
  const patch: DefinitionUpdatePatch = {
    listStatus: existing.listStatus,
    attentionCode: existing.attentionCode,
  };
  if (input.patch.name !== undefined) {
    const name = input.patch.name.trim();
    if (name === '' || name.length > 80) return null;
    patch.name = name;
    patch.nameSortKey = normalizeMessageDigestSearchValue(name);
  }
  if (input.patch.instructions !== undefined) {
    const text = input.patch.instructions.text.trim();
    if (text.length < 20 || text.length > 4_000) return null;
    patch.instructions = {
      templateId: input.patch.instructions.templateId,
      text,
      revision: nextInstructionRevision(existing.instructions.revision),
    };
  }
  if (input.patch.schedule !== undefined) {
    patch.schedule = input.patch.schedule;
    patch.nextRunAt = nextBoundary;
  }
  if (input.patch.status === 'paused') {
    patch.status = 'paused';
    patch.listStatus = 'paused';
    patch.attentionCode = null;
  } else if (input.patch.status === 'active') {
    patch.status = 'active';
    patch.listStatus = 'active';
    patch.attentionCode = null;
  }
  return patch;
}

function isValidEnvelope(input: UpdateMessageDigestInput): boolean {
  return (
    input.userId.trim() !== '' &&
    input.definitionId.trim() !== '' &&
    Number.isInteger(input.expectedRevision) &&
    input.expectedRevision > 0 &&
    Object.keys(input.patch).length > 0 &&
    input.patch.source?.chatId.trim() !== ''
  );
}

function nextInstructionRevision(current: string): string {
  return /^\d+$/u.test(current) ? String(Number(current) + 1) : `${current}.next`;
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
