import type { Result } from '@intexuraos/common-core';
import type { HellscriptBuffer } from '../models/hellscriptBuffer.js';
import type { HellscriptEvent } from '../models/hellscriptEvent.js';
import type { HellscriptDraftVersion } from '../models/hellscriptDraftVersion.js';
import type { MaterializedBufferState } from '../models/materializedBufferState.js';

export interface HellscriptRepository {
  createBuffer(userId: string, title: string): Promise<Result<HellscriptBuffer>>;
  getBuffer(bufferId: string, userId: string): Promise<Result<HellscriptBuffer | null>>;
  listBuffers(userId: string): Promise<Result<HellscriptBuffer[]>>;
  saveEvent(event: Omit<HellscriptEvent, 'id'>): Promise<Result<HellscriptEvent>>;
  getEvents(bufferId: string): Promise<Result<HellscriptEvent[]>>;
  updateBufferState(
    bufferId: string,
    state: MaterializedBufferState,
    eventCount: number
  ): Promise<Result<void>>;
  getBufferState(bufferId: string): Promise<Result<MaterializedBufferState | null>>;
  saveDraftVersion(
    draft: Omit<HellscriptDraftVersion, 'id'>
  ): Promise<Result<HellscriptDraftVersion>>;
  getDraftVersions(bufferId: string): Promise<Result<HellscriptDraftVersion[]>>;
  updateBufferDraftInfo(
    bufferId: string,
    versionNumber: number,
    versionId: string
  ): Promise<Result<void>>;
}
