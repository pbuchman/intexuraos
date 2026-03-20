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

  // Verify buffer exists and belongs to user first
  const bufferResult = await deps.repository.getBuffer(bufferId, userId);
  if (!bufferResult.ok) {
    return bufferResult;
  }
  if (bufferResult.value === null) {
    return { ok: false, error: new Error('Buffer not found') };
  }

  // Parallelize independent reads for lower latency
  const [eventsResult, draftsResult, stateResult] = await Promise.all([
    deps.repository.getEvents(bufferId),
    deps.repository.getDraftVersions(bufferId),
    deps.repository.getBufferState(bufferId),
  ]);

  if (!eventsResult.ok) {
    return eventsResult;
  }
  if (!draftsResult.ok) {
    return draftsResult;
  }
  if (!stateResult.ok) {
    return stateResult;
  }

  return {
    ok: true,
    value: {
      buffer: bufferResult.value,
      events: eventsResult.value,
      draftVersions: draftsResult.value,
      state: stateResult.value,
    },
  };
}
