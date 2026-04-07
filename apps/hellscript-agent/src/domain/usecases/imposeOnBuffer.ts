import type { Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { HellscriptRepository } from '../ports/hellscriptRepository.js';
import type { IntentInterpreter } from '../ports/intentInterpreter.js';
import type { DraftGenerator } from '../ports/draftGenerator.js';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { HellscriptBuffer } from '../models/hellscriptBuffer.js';
import type { MaterializedBufferState } from '../models/materializedBufferState.js';
import type { WritingCategory } from '../models/writingCategory.js';
import { emptyState } from '../models/materializedBufferState.js';
import { isValidCategory } from '../models/writingCategory.js';
import { applyIntentToState } from '../services/applyIntentToState.js';
import { BufferNotFoundError, DraftGenerationError } from '../errors.js';

export interface ImposeOnBufferDeps {
  repository: HellscriptRepository;
  writingConfigRepository: WritingConfigRepository;
  interpreter: IntentInterpreter;
  draftGenerator: DraftGenerator;
  logger: Logger;
}

export interface ImposeOnBufferInput {
  userId: string;
  bufferId?: string | undefined;
  utterance: string;
  category?: WritingCategory | undefined;
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
  const { repository, writingConfigRepository, interpreter, draftGenerator, logger } = deps;

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
    // Existing buffer — read buffer + state together
    const bufferWithStateResult = await repository.getBufferWithState(bufferId, input.userId);
    if (!bufferWithStateResult.ok) {
      return bufferWithStateResult;
    }
    if (bufferWithStateResult.value === null) {
      return { ok: false, error: new BufferNotFoundError() };
    }
    buffer = bufferWithStateResult.value.buffer;
    currentState = bufferWithStateResult.value.state ?? emptyState();
  }

  const intent = await interpreter.interpret(input.utterance, currentState, logger);

  // For update_draft, validate category BEFORE saving the event.
  // This avoids phantom timeline entries when category_required is returned.
  if (intent.kind === 'update_draft') {
    const payloadCategory = intent.payload['category'];
    const intentCategoryStr = typeof payloadCategory === 'string' ? payloadCategory : '';
    const resolvedCategory: WritingCategory | null =
      input.category ?? (isValidCategory(intentCategoryStr) ? intentCategoryStr : null);

    if (resolvedCategory === null) {
      return {
        ok: true,
        value: {
          bufferId,
          action: 'category_required',
        },
      };
    }

    const payloadText = intent.payload['text'];
    const requestText = typeof payloadText === 'string' ? payloadText : input.utterance;
    const category: WritingCategory = resolvedCategory;

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
    const newEventCount = buffer.eventCount + 1;

    const updateStateResult = await repository.updateBufferState(
      bufferId,
      newState,
      newEventCount
    );
    if (!updateStateResult.ok) {
      return updateStateResult;
    }

    // Fetch writing config + samples + prior draft in parallel (independent reads)
    const currentVersionNumber = buffer.latestDraftVersionNumber ?? 0;
    const nextVersion = currentVersionNumber + 1;

    const [configResult, samplesResult, priorDraftResult] = await Promise.all([
      writingConfigRepository.getStyleConfig(input.userId),
      writingConfigRepository.listSamples(input.userId, category),
      buffer.latestDraftVersionId !== null
        ? repository.getDraftVersion(buffer.latestDraftVersionId, bufferId)
        : Promise.resolve(null),
    ]);

    let styleInstructions: string | null = null;
    if (configResult.ok) {
      styleInstructions = configResult.value?.[category] ?? null;
    } else {
      logger.warn({ err: configResult.error }, 'Failed to fetch writing config, proceeding without style instructions');
    }

    let writingSamples: string[] = [];
    if (samplesResult.ok) {
      writingSamples = samplesResult.value.map((s) => s.text);
    } else {
      logger.warn({ err: samplesResult.error }, 'Failed to fetch writing samples, proceeding without samples');
    }

    let priorDraft: string | null = null;
    if (priorDraftResult !== null) {
      if (!priorDraftResult.ok) {
        return priorDraftResult;
      }
      /* v8 ignore start -- ts-type: getDraftVersion returns T | null but null is unreachable here since latestDraftVersionId is non-null @preserve */
      priorDraft = priorDraftResult.value?.markdown ?? null;
      /* v8 ignore stop @preserve */
    }

    const generateResult = await draftGenerator.generate(
      newState,
      priorDraft,
      requestText,
      styleInstructions,
      writingSamples,
      category,
      logger
    );
    if (!generateResult.ok) {
      logger.error({ bufferId, err: generateResult.error }, 'Draft generation failed');
      return { ok: false, error: new DraftGenerationError() };
    }

    const draftResult = await repository.saveDraftVersion({
      bufferId,
      versionNumber: nextVersion,
      markdown: generateResult.value,
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

  // Non-draft intent — save event and apply state
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
  const newEventCount = buffer.eventCount + 1;

  const updateStateResult = await repository.updateBufferState(
    bufferId,
    newState,
    newEventCount
  );
  if (!updateStateResult.ok) {
    return updateStateResult;
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
