import type { Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { HellscriptRepository } from '../ports/hellscriptRepository.js';
import type { IntentInterpreter } from '../ports/intentInterpreter.js';
import type { DraftGenerator } from '../ports/draftGenerator.js';
import type { HellscriptBuffer } from '../models/hellscriptBuffer.js';
import type { MaterializedBufferState } from '../models/materializedBufferState.js';
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
  let buffer: HellscriptBuffer;
  let currentState: MaterializedBufferState;

  if (bufferId === undefined) {
    // New buffer — state is empty by definition, no need to read it
    const createResult = await repository.createBuffer(input.userId, 'Untitled buffer');
    if (!createResult.ok) {
      return createResult;
    }
    buffer = createResult.value;
    bufferId = buffer.id;
    currentState = emptyState();
    logger.info({ bufferId }, 'Created new buffer');
  } else {
    // Existing buffer — read buffer + state in a single Firestore doc read
    const bufferWithStateResult = await repository.getBufferWithState(bufferId, input.userId);
    if (!bufferWithStateResult.ok) {
      return bufferWithStateResult;
    }
    if (bufferWithStateResult.value === null) {
      return { ok: false, error: new Error('Buffer not found') };
    }
    buffer = bufferWithStateResult.value.buffer;
    currentState = bufferWithStateResult.value.state ?? emptyState();
  }

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

    // Fetch only the latest draft by ID instead of loading all draft versions
    let priorDraft: string | null = null;
    if (buffer.latestDraftVersionId !== null) {
      const latestDraftResult = await repository.getDraftVersion(
        buffer.latestDraftVersionId,
        bufferId
      );
      if (!latestDraftResult.ok) {
        return latestDraftResult;
      }
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess style fallback for optional chaining on Result value @preserve */
      priorDraft = latestDraftResult.value?.markdown ?? null;
      /* v8 ignore stop @preserve */
    }

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
