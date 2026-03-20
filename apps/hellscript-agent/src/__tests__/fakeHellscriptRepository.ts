import { randomUUID } from 'node:crypto';
import type { Result } from '@intexuraos/common-core';
import type { HellscriptBuffer } from '../domain/models/hellscriptBuffer.js';
import type { HellscriptEvent } from '../domain/models/hellscriptEvent.js';
import type { HellscriptDraftVersion } from '../domain/models/hellscriptDraftVersion.js';
import type { MaterializedBufferState } from '../domain/models/materializedBufferState.js';
import type { HellscriptRepository } from '../domain/ports/hellscriptRepository.js';

type MethodName =
  | 'createBuffer'
  | 'getBuffer'
  | 'listBuffers'
  | 'saveEvent'
  | 'getEvents'
  | 'updateBufferState'
  | 'getBufferState'
  | 'saveDraftVersion'
  | 'getDraftVersions'
  | 'updateBufferDraftInfo';

export class FakeHellscriptRepository implements HellscriptRepository {
  private buffers = new Map<string, HellscriptBuffer>();
  private events = new Map<string, HellscriptEvent[]>();
  private states = new Map<string, MaterializedBufferState>();
  private drafts = new Map<string, HellscriptDraftVersion[]>();
  private nextError: Error | null = null;
  private methodErrors = new Map<MethodName, Error>();

  simulateNextError(error: Error): void {
    this.nextError = error;
  }

  simulateMethodError(method: MethodName, error: Error): void {
    this.methodErrors.set(method, error);
  }

  private checkError(method: MethodName): Error | null {
    const methodError = this.methodErrors.get(method);
    if (methodError !== undefined) {
      this.methodErrors.delete(method);
      return methodError;
    }
    const error = this.nextError;
    this.nextError = null;
    return error;
  }

  async createBuffer(userId: string, title: string): Promise<Result<HellscriptBuffer, Error>> {
    const error = this.checkError('createBuffer');
    if (error !== null) {
      return { ok: false, error };
    }

    const now = new Date().toISOString();
    const buffer: HellscriptBuffer = {
      id: randomUUID(),
      userId,
      title,
      eventCount: 0,
      latestDraftVersionNumber: null,
      latestDraftVersionId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.buffers.set(buffer.id, buffer);
    return { ok: true, value: buffer };
  }

  async getBuffer(
    bufferId: string,
    userId: string
  ): Promise<Result<HellscriptBuffer | null, Error>> {
    const error = this.checkError('getBuffer');
    if (error !== null) {
      return { ok: false, error };
    }

    const buffer = this.buffers.get(bufferId);
    if (buffer === undefined) {
      return { ok: true, value: null };
    }
    if (buffer.userId !== userId) {
      return { ok: true, value: null };
    }
    return { ok: true, value: buffer };
  }

  async listBuffers(userId: string): Promise<Result<HellscriptBuffer[], Error>> {
    const error = this.checkError('listBuffers');
    if (error !== null) {
      return { ok: false, error };
    }

    const userBuffers = Array.from(this.buffers.values())
      .filter((b) => b.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return { ok: true, value: userBuffers };
  }

  async saveEvent(event: Omit<HellscriptEvent, 'id'>): Promise<Result<HellscriptEvent, Error>> {
    const error = this.checkError('saveEvent');
    if (error !== null) {
      return { ok: false, error };
    }

    const fullEvent: HellscriptEvent = {
      id: randomUUID(),
      ...event,
    };

    const existing = this.events.get(event.bufferId) ?? [];
    existing.push(fullEvent);
    this.events.set(event.bufferId, existing);

    return { ok: true, value: fullEvent };
  }

  async getEvents(bufferId: string): Promise<Result<HellscriptEvent[], Error>> {
    const error = this.checkError('getEvents');
    if (error !== null) {
      return { ok: false, error };
    }

    const events = this.events.get(bufferId) ?? [];
    return { ok: true, value: [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
  }

  async updateBufferState(
    bufferId: string,
    state: MaterializedBufferState,
    eventCount: number
  ): Promise<Result<void, Error>> {
    const error = this.checkError('updateBufferState');
    if (error !== null) {
      return { ok: false, error };
    }

    this.states.set(bufferId, state);

    const buffer = this.buffers.get(bufferId);
    if (buffer !== undefined) {
      buffer.eventCount = eventCount;
      buffer.updatedAt = new Date().toISOString();

      const firstThought = state.thoughts[0];
      if (firstThought !== undefined && firstThought.text.trim() !== '') {
        const text = firstThought.text.trim();
        buffer.title = text.length > 80 ? text.slice(0, 80) : text;
      }
    }

    return { ok: true, value: undefined };
  }

  async getBufferState(
    bufferId: string
  ): Promise<Result<MaterializedBufferState | null, Error>> {
    const error = this.checkError('getBufferState');
    if (error !== null) {
      return { ok: false, error };
    }

    return { ok: true, value: this.states.get(bufferId) ?? null };
  }

  async saveDraftVersion(
    draft: Omit<HellscriptDraftVersion, 'id'>
  ): Promise<Result<HellscriptDraftVersion, Error>> {
    const error = this.checkError('saveDraftVersion');
    if (error !== null) {
      return { ok: false, error };
    }

    const fullDraft: HellscriptDraftVersion = {
      id: randomUUID(),
      ...draft,
    };

    const existing = this.drafts.get(draft.bufferId) ?? [];
    existing.push(fullDraft);
    this.drafts.set(draft.bufferId, existing);

    return { ok: true, value: fullDraft };
  }

  async getDraftVersions(
    bufferId: string
  ): Promise<Result<HellscriptDraftVersion[], Error>> {
    const error = this.checkError('getDraftVersions');
    if (error !== null) {
      return { ok: false, error };
    }

    const drafts = this.drafts.get(bufferId) ?? [];
    return {
      ok: true,
      value: [...drafts].sort((a, b) => a.versionNumber - b.versionNumber),
    };
  }

  async updateBufferDraftInfo(
    bufferId: string,
    versionNumber: number,
    versionId: string
  ): Promise<Result<void, Error>> {
    const error = this.checkError('updateBufferDraftInfo');
    if (error !== null) {
      return { ok: false, error };
    }

    const buffer = this.buffers.get(bufferId);
    if (buffer !== undefined) {
      buffer.latestDraftVersionNumber = versionNumber;
      buffer.latestDraftVersionId = versionId;
    }

    return { ok: true, value: undefined };
  }

  getAll(): HellscriptBuffer[] {
    return Array.from(this.buffers.values());
  }

  clear(): void {
    this.buffers.clear();
    this.events.clear();
    this.states.clear();
    this.drafts.clear();
  }
}
