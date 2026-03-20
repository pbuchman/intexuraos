import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { FirestoreHellscriptRepository } from '../infra/firestore/firestoreHellscriptRepository.js';
import type { HellscriptRepository } from '../domain/ports/hellscriptRepository.js';
import { emptyState } from '../domain/models/materializedBufferState.js';

describe('FirestoreHellscriptRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: HellscriptRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = new FirestoreHellscriptRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('createBuffer', () => {
    it('creates a new buffer', async () => {
      const result = await repository.createBuffer('user-1', 'My Buffer');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-1');
        expect(result.value.title).toBe('My Buffer');
        expect(result.value.eventCount).toBe(0);
        expect(result.value.latestDraftVersionNumber).toBeNull();
        expect(result.value.latestDraftVersionId).toBeNull();
      }
    });

    it('generates unique ids', async () => {
      const r1 = await repository.createBuffer('user-1', 'Buffer 1');
      const r2 = await repository.createBuffer('user-1', 'Buffer 2');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r1.value.id).not.toBe(r2.value.id);
      }
    });

    it('returns error on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Connection failed') });

      const result = await repository.createBuffer('user-1', 'Buffer');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Connection failed');
      }
    });
  });

  describe('getBuffer', () => {
    it('returns null for non-existent buffer', async () => {
      const result = await repository.getBuffer('nonexistent', 'user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns buffer for owner', async () => {
      const created = await repository.createBuffer('user-1', 'My Buffer');
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repository.getBuffer(created.value.id, 'user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.title).toBe('My Buffer');
      }
    });

    it('returns null for non-owner', async () => {
      const created = await repository.createBuffer('user-1', 'My Buffer');
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repository.getBuffer(created.value.id, 'other-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repository.getBuffer('some-id', 'user-1');

      expect(result.ok).toBe(false);
    });
  });

  describe('listBuffers', () => {
    it('returns empty array for user with no buffers', async () => {
      const result = await repository.listBuffers('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns only buffers for the specified user', async () => {
      await repository.createBuffer('user-A', 'Buffer A');
      await repository.createBuffer('user-B', 'Buffer B');
      await repository.createBuffer('user-A', 'Buffer A2');

      const resultA = await repository.listBuffers('user-A');
      const resultB = await repository.listBuffers('user-B');

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.value).toHaveLength(2);
        expect(resultB.value).toHaveLength(1);
      }
    });

    it('returns error on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repository.listBuffers('user-1');

      expect(result.ok).toBe(false);
    });
  });

  describe('events', () => {
    it('saves and retrieves events', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      const eventResult = await repository.saveEvent({
        bufferId: buffer.value.id,
        rawUtterance: 'Hello',
        intent: { kind: 'append_thought', payload: { text: 'Hello' } },
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      expect(eventResult.ok).toBe(true);
      if (!eventResult.ok) return;
      expect(eventResult.value.id).toBeDefined();
      expect(eventResult.value.rawUtterance).toBe('Hello');

      const events = await repository.getEvents(buffer.value.id);
      expect(events.ok).toBe(true);
      if (events.ok) {
        expect(events.value).toHaveLength(1);
        expect(events.value[0]?.rawUtterance).toBe('Hello');
      }
    });

    it('preserves intent with fallbackReason', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      await repository.saveEvent({
        bufferId: buffer.value.id,
        rawUtterance: 'unclear',
        intent: {
          kind: 'fallback_append',
          payload: { text: 'unclear' },
          fallbackReason: 'Could not classify',
        },
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      const events = await repository.getEvents(buffer.value.id);
      expect(events.ok).toBe(true);
      if (events.ok) {
        expect(events.value[0]?.intent.fallbackReason).toBe('Could not classify');
      }
    });

    it('returns error on saveEvent Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const result = await repository.saveEvent({
        bufferId: 'buf-1',
        rawUtterance: 'test',
        intent: { kind: 'append_thought', payload: { text: 'test' } },
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      expect(result.ok).toBe(false);
    });

    it('returns error on getEvents Firestore failure', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repository.getEvents(buffer.value.id);
      expect(result.ok).toBe(false);
    });
  });

  describe('buffer state', () => {
    it('updates and retrieves materialized state', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      const state = {
        ...emptyState(),
        thoughts: [{ id: 't1', text: 'First thought', addedAt: '2024-01-01T00:00:00.000Z' }],
      };

      const updateResult = await repository.updateBufferState(buffer.value.id, state, 1);
      expect(updateResult.ok).toBe(true);

      const getResult = await repository.getBufferState(buffer.value.id);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).not.toBeNull();
        expect(getResult.value?.thoughts).toHaveLength(1);
        expect(getResult.value?.thoughts[0]?.text).toBe('First thought');
      }
    });

    it('returns null state for buffer without state', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      const result = await repository.getBufferState(buffer.value.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null state for non-existent buffer', async () => {
      const result = await repository.getBufferState('nonexistent');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('derives title from first thought text', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      const state = {
        ...emptyState(),
        thoughts: [{ id: 't1', text: 'My great idea about something', addedAt: '2024-01-01T00:00:00.000Z' }],
      };

      await repository.updateBufferState(buffer.value.id, state, 1);

      const getResult = await repository.getBuffer(buffer.value.id, 'user-1');
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value !== null) {
        expect(getResult.value.title).toBe('My great idea about something');
      }
    });

    it('derives Untitled buffer when first thought is empty string', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      const state = {
        ...emptyState(),
        thoughts: [{ id: 't1', text: '   ', addedAt: '2024-01-01T00:00:00.000Z' }],
      };

      await repository.updateBufferState(buffer.value.id, state, 1);

      const getResult = await repository.getBuffer(buffer.value.id, 'user-1');
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value !== null) {
        expect(getResult.value.title).toBe('Untitled buffer');
      }
    });

    it('truncates title to 80 chars', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      const longText = 'A'.repeat(100);
      const state = {
        ...emptyState(),
        thoughts: [{ id: 't1', text: longText, addedAt: '2024-01-01T00:00:00.000Z' }],
      };

      await repository.updateBufferState(buffer.value.id, state, 1);

      const getResult = await repository.getBuffer(buffer.value.id, 'user-1');
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value !== null) {
        expect(getResult.value.title).toHaveLength(80);
      }
    });

    it('derives Untitled buffer when thoughts are empty', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      await repository.updateBufferState(buffer.value.id, emptyState(), 0);

      const getResult = await repository.getBuffer(buffer.value.id, 'user-1');
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value !== null) {
        expect(getResult.value.title).toBe('Untitled buffer');
      }
    });

    it('returns error on updateBufferState Firestore failure', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repository.updateBufferState(buffer.value.id, emptyState(), 0);
      expect(result.ok).toBe(false);
    });

    it('returns error on getBufferState Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repository.getBufferState('some-id');
      expect(result.ok).toBe(false);
    });
  });

  describe('draft versions', () => {
    it('saves and retrieves draft versions', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      const draftResult = await repository.saveDraftVersion({
        bufferId: buffer.value.id,
        versionNumber: 1,
        markdown: '# Draft\n\nContent here.',
        requestText: 'Write a draft',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      expect(draftResult.ok).toBe(true);
      if (!draftResult.ok) return;
      expect(draftResult.value.id).toBeDefined();
      expect(draftResult.value.versionNumber).toBe(1);

      const drafts = await repository.getDraftVersions(buffer.value.id);
      expect(drafts.ok).toBe(true);
      if (drafts.ok) {
        expect(drafts.value).toHaveLength(1);
        expect(drafts.value[0]?.markdown).toBe('# Draft\n\nContent here.');
      }
    });

    it('returns error on saveDraftVersion Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const result = await repository.saveDraftVersion({
        bufferId: 'buf-1',
        versionNumber: 1,
        markdown: '# Draft',
        requestText: 'Write draft',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      expect(result.ok).toBe(false);
    });

    it('returns error on getDraftVersions Firestore failure', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repository.getDraftVersions(buffer.value.id);
      expect(result.ok).toBe(false);
    });
  });

  describe('updateBufferDraftInfo', () => {
    it('updates draft info on buffer', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      const result = await repository.updateBufferDraftInfo(
        buffer.value.id,
        2,
        'draft-version-id'
      );
      expect(result.ok).toBe(true);

      const getResult = await repository.getBuffer(buffer.value.id, 'user-1');
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value !== null) {
        expect(getResult.value.latestDraftVersionNumber).toBe(2);
        expect(getResult.value.latestDraftVersionId).toBe('draft-version-id');
      }
    });

    it('returns error on Firestore failure', async () => {
      const buffer = await repository.createBuffer('user-1', 'Buffer');
      expect(buffer.ok).toBe(true);
      if (!buffer.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repository.updateBufferDraftInfo(buffer.value.id, 1, 'vid');
      expect(result.ok).toBe(false);
    });
  });
});
