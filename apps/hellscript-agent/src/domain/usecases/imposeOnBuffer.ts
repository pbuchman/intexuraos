import type { Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { HellscriptRepository } from '../ports/hellscriptRepository.js';
import type { IntentInterpreter } from '../ports/intentInterpreter.js';
import type { DraftGenerator } from '../ports/draftGenerator.js';
import type { HellscriptBuffer } from '../models/hellscriptBuffer.js';
import { emptyState } from '../models/materializedBufferState.js';
import { applyIntentToState } from '../services/applyIntentToState.js';

export interface ImposeOnBufferDeps {
  repository: HellscriptRepository;
  interpreter: IntentInterpreter;
  draftGenerator: DraftGenerator;
  logger: Logger;
}

export interface ImposeOnBufferInput {
  userId: string;
  bufferId?: string | undefined;
  utterance: string;
}

export interface ImposeOnBufferResult {
  bufferId: string;
  action: string;
  latestDraftVersionId?: string;
}

export async function imposeOnBuffer(
  deps: ImposeOnBufferDeps,
  input: ImposeOnBufferInput
): Promise<Result<ImposeOnBufferResult>> {
  const { repository, interpreter, draftGenerator, logger } = deps;

  let bufferId = input.bufferId;
  let buffer: HellscriptBuffer | null = null;

  if (bufferId === undefined) {
    const createResult = await repository.createBuffer(input.userId, 'Untitled buffer');
    if (!createResult.ok) {
      return createResult;
    }
    buffer = createResult.value;
    bufferId = buffer.id;
    logger.info({ bufferId }, 'Created new buffer');
  } else {
    const bufferResult = await repository.getBuffer(bufferId, input.userId);
    if (!bufferResult.ok) {
      return bufferResult;
    }
    if (bufferResult.value === null) {
      return { ok: false, error: new Error('Buffer not found') };
    }
    buffer = bufferResult.value;
  }

  const currentStateResult = await repository.getBufferState(bufferId);
  if (!currentStateResult.ok) {
    return currentStateResult;
  }
  const currentState = currentStateResult.value ?? emptyState();

  const intent = await interpreter.interpret(input.utterance, currentState, logger);

  const eventResult = await repository.saveEvent({
    bufferId,
    rawUtterance: input.utterance,
    intent,
    createdAt: new Date().toISOString(),
  });
  if (!eventResult.ok) {
    return eventResult;
  }

  const newState = applyIntentToState(currentState, intent);

  // Use cached event count from buffer doc instead of reading all events
  const newEventCount = buffer.eventCount + 1;

  const updateStateResult = await repository.updateBufferState(
    bufferId,
    newState,
    newEventCount
  );
  if (!updateStateResult.ok) {
    return updateStateResult;
  }

  if (intent.kind === 'update_draft') {
    const payloadText = intent.payload['text'];
    const requestText = typeof payloadText === 'string' ? payloadText : input.utterance;

    // Use cached version number from buffer doc instead of reading all draft versions
    const currentVersionNumber = buffer.latestDraftVersionNumber ?? 0;
    const nextVersion = currentVersionNumber + 1;

    // Only need prior draft for generation - read drafts only when needed
    const draftsResult = await repository.getDraftVersions(bufferId);
    if (!draftsResult.ok) {
      return draftsResult;
    }

    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess fallback after length guard @preserve */
    const priorDraft =
      draftsResult.value.length > 0
        ? (draftsResult.value[draftsResult.value.length - 1]?.markdown ?? null)
        : null;
    /* v8 ignore stop @preserve */

    const markdown = await draftGenerator.generate(newState, priorDraft, requestText, logger);

    const draftResult = await repository.saveDraftVersion({
      bufferId,
      versionNumber: nextVersion,
      markdown,
      requestText,
      createdAt: new Date().toISOString(),
    });
    if (!draftResult.ok) {
      return draftResult;
    }

    const updateDraftInfoResult = await repository.updateBufferDraftInfo(
      bufferId,
      nextVersion,
      draftResult.value.id
    );
    if (!updateDraftInfoResult.ok) {
      return updateDraftInfoResult;
    }

    logger.info({ bufferId, versionNumber: nextVersion }, 'Draft generated');

    return {
      ok: true,
      value: {
        bufferId,
        action: intent.kind,
        latestDraftVersionId: draftResult.value.id,
      },
    };
  }

  logger.info({ bufferId, action: intent.kind }, 'Intent applied');

  return {
    ok: true,
    value: {
      bufferId,
      action: intent.kind,
    },
  };
}
