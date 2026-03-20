import type { Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { HellscriptRepository } from '../ports/hellscriptRepository.js';
import type { HellscriptBuffer } from '../models/hellscriptBuffer.js';
import type { HellscriptEvent } from '../models/hellscriptEvent.js';
import type { HellscriptDraftVersion } from '../models/hellscriptDraftVersion.js';
import type { MaterializedBufferState } from '../models/materializedBufferState.js';

export interface GetBufferWorkspaceDeps {
  repository: HellscriptRepository;
  logger: Logger;
}

export interface BufferWorkspace {
  buffer: HellscriptBuffer;
  events: HellscriptEvent[];
  draftVersions: HellscriptDraftVersion[];
  state: MaterializedBufferState | null;
}

export async function getBufferWorkspace(
  deps: GetBufferWorkspaceDeps,
  bufferId: string,
  userId: string
): Promise<Result<BufferWorkspace>> {
  deps.logger.info({ bufferId, userId }, 'Getting buffer workspace');

  // Single read returns both buffer and state from one Firestore document
  const bufferWithStateResult = await deps.repository.getBufferWithState(bufferId, userId);
  if (!bufferWithStateResult.ok) {
    return bufferWithStateResult;
  }
  if (bufferWithStateResult.value === null) {
    return { ok: false, error: new Error('Buffer not found') };
  }

  const { buffer, state } = bufferWithStateResult.value;

  // Parallelize independent subcollection reads
  const [eventsResult, draftsResult] = await Promise.all([
    deps.repository.getEvents(bufferId),
    deps.repository.getDraftVersions(bufferId),
  ]);

  if (!eventsResult.ok) {
    return eventsResult;
  }
  if (!draftsResult.ok) {
    return draftsResult;
  }

  return {
    ok: true,
    value: {
      buffer,
      events: eventsResult.value,
      draftVersions: draftsResult.value,
      state,
    },
  };
}
