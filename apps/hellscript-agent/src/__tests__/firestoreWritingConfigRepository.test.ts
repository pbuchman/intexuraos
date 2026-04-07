import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { FirestoreWritingConfigRepository } from '../infra/firestore/firestoreWritingConfigRepository.js';
import type { WritingConfigRepository } from '../domain/ports/writingConfigRepository.js';

describe('FirestoreWritingConfigRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: WritingConfigRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = new FirestoreWritingConfigRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getStyleConfig', () => {
    it('returns null when no config exists', async () => {
      const result = await repository.getStyleConfig('user-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns config after upsert', async () => {
      await repository.upsertStyleInstructions('user-1', 'threads', 'Be brief');
      const result = await repository.getStyleConfig('user-1');
      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.threads).toBe('Be brief');
        expect(result.value.linkedin).toBeNull();
        expect(result.value.general).toBeNull();
        expect(result.value.updatedAt).toBeDefined();
      }
    });
  });

  describe('upsertStyleInstructions', () => {
    it('creates config for new user', async () => {
      const result = await repository.upsertStyleInstructions('user-1', 'linkedin', 'Be formal');
      expect(result.ok).toBe(true);

      const config = await repository.getStyleConfig('user-1');
      expect(config.ok).toBe(true);
      if (config.ok && config.value !== null) {
        expect(config.value.linkedin).toBe('Be formal');
      }
    });

    it('updates existing category without affecting others', async () => {
      await repository.upsertStyleInstructions('user-1', 'threads', 'Short');
      await repository.upsertStyleInstructions('user-1', 'linkedin', 'Professional');

      const config = await repository.getStyleConfig('user-1');
      expect(config.ok).toBe(true);
      if (config.ok && config.value !== null) {
        expect(config.value.threads).toBe('Short');
        expect(config.value.linkedin).toBe('Professional');
      }
    });
  });

  describe('deleteStyleInstructions', () => {
    it('sets category to null', async () => {
      await repository.upsertStyleInstructions('user-1', 'threads', 'Old');
      const result = await repository.deleteStyleInstructions('user-1', 'threads');
      expect(result.ok).toBe(true);

      const config = await repository.getStyleConfig('user-1');
      expect(config.ok).toBe(true);
      if (config.ok && config.value !== null) {
        expect(config.value.threads).toBeNull();
      }
    });
  });

  describe('createSample', () => {
    it('creates a sample with generated ID', async () => {
      const result = await repository.createSample('user-1', {
        category: 'threads',
        title: 'My Sample',
        text: 'Sample text',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.category).toBe('threads');
        expect(result.value.title).toBe('My Sample');
        expect(result.value.text).toBe('Sample text');
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });
  });

  describe('listSamples', () => {
    it('returns empty array when no samples', async () => {
      const result = await repository.listSamples('user-1', 'threads');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns only samples for the specified category', async () => {
      await repository.createSample('user-1', { category: 'threads', title: 'T1', text: 'Text1' });
      await repository.createSample('user-1', { category: 'linkedin', title: 'L1', text: 'Text2' });
      await repository.createSample('user-1', { category: 'threads', title: 'T2', text: 'Text3' });

      const result = await repository.listSamples('user-1', 'threads');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.title).toBe('T1');
        expect(result.value[1]?.title).toBe('T2');
      }
    });
  });

  describe('getSample', () => {
    it('returns null for non-existent sample', async () => {
      const result = await repository.getSample('user-1', 'nonexistent');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns sample by ID', async () => {
      const created = await repository.createSample('user-1', {
        category: 'general',
        title: 'Test',
        text: 'Content',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repository.getSample('user-1', created.value.id);
      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.title).toBe('Test');
        expect(result.value.text).toBe('Content');
      }
    });
  });

  describe('updateSample', () => {
    it('updates title and text', async () => {
      const created = await repository.createSample('user-1', {
        category: 'threads',
        title: 'Old',
        text: 'Old text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repository.updateSample(
        'user-1', created.value.id, 'threads', 'New title', 'New text'
      );
      expect(result.ok).toBe(true);

      const fetched = await repository.getSample('user-1', created.value.id);
      expect(fetched.ok).toBe(true);
      if (fetched.ok && fetched.value !== null) {
        expect(fetched.value.title).toBe('New title');
        expect(fetched.value.text).toBe('New text');
      }
    });

    it('returns error for non-existent sample', async () => {
      const result = await repository.updateSample(
        'user-1', 'nonexistent', 'threads', 'title', 'text'
      );
      expect(result.ok).toBe(false);
    });

    it('returns error for category mismatch', async () => {
      const created = await repository.createSample('user-1', {
        category: 'threads',
        title: 'Test',
        text: 'Content',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repository.updateSample(
        'user-1', created.value.id, 'linkedin', 'title', 'text'
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('deleteSample', () => {
    it('deletes an existing sample', async () => {
      const created = await repository.createSample('user-1', {
        category: 'general',
        title: 'Delete me',
        text: 'Text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repository.deleteSample('user-1', created.value.id, 'general');
      expect(result.ok).toBe(true);

      const fetched = await repository.getSample('user-1', created.value.id);
      expect(fetched.ok).toBe(true);
      if (fetched.ok) {
        expect(fetched.value).toBeNull();
      }
    });

    it('returns error for non-existent sample', async () => {
      const result = await repository.deleteSample('user-1', 'nonexistent', 'threads');
      expect(result.ok).toBe(false);
    });

    it('returns error for category mismatch', async () => {
      const created = await repository.createSample('user-1', {
        category: 'threads',
        title: 'Test',
        text: 'Content',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repository.deleteSample('user-1', created.value.id, 'linkedin');
      expect(result.ok).toBe(false);
    });
  });

  describe('countSamplesByCategory', () => {
    it('returns 0 when no samples exist', async () => {
      const result = await repository.countSamplesByCategory('user-1', 'threads');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0);
      }
    });

    it('counts only samples in the specified category', async () => {
      await repository.createSample('user-1', { category: 'threads', title: 'T1', text: 'A' });
      await repository.createSample('user-1', { category: 'threads', title: 'T2', text: 'B' });
      await repository.createSample('user-1', { category: 'threads', title: 'T3', text: 'C' });
      await repository.createSample('user-1', { category: 'linkedin', title: 'L1', text: 'D' });
      await repository.createSample('user-1', { category: 'linkedin', title: 'L2', text: 'E' });

      const threadsResult = await repository.countSamplesByCategory('user-1', 'threads');
      expect(threadsResult.ok).toBe(true);
      if (threadsResult.ok) {
        expect(threadsResult.value).toBe(3);
      }

      const linkedinResult = await repository.countSamplesByCategory('user-1', 'linkedin');
      expect(linkedinResult.ok).toBe(true);
      if (linkedinResult.ok) {
        expect(linkedinResult.value).toBe(2);
      }

      const generalResult = await repository.countSamplesByCategory('user-1', 'general');
      expect(generalResult.ok).toBe(true);
      if (generalResult.ok) {
        expect(generalResult.value).toBe(0);
      }
    });
  });

  describe('error handling', () => {
    it('returns error from getStyleConfig on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Connection failed') });
      const result = await repository.getStyleConfig('user-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Connection failed');
      }
    });

    it('returns error from upsertStyleInstructions on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });
      const result = await repository.upsertStyleInstructions('user-1', 'threads', 'text');
      expect(result.ok).toBe(false);
    });

    it('returns error from deleteStyleInstructions on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });
      const result = await repository.deleteStyleInstructions('user-1', 'threads');
      expect(result.ok).toBe(false);
    });

    it('returns error from listSamples on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });
      const result = await repository.listSamples('user-1', 'threads');
      expect(result.ok).toBe(false);
    });

    it('returns error from getSample on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });
      const result = await repository.getSample('user-1', 'some-id');
      expect(result.ok).toBe(false);
    });

    it('returns error from createSample on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });
      const result = await repository.createSample('user-1', {
        category: 'threads',
        title: 'Test',
        text: 'Content',
      });
      expect(result.ok).toBe(false);
    });

    it('returns error from updateSample on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });
      const result = await repository.updateSample('user-1', 'some-id', 'threads', 'title', 'text');
      expect(result.ok).toBe(false);
    });

    it('returns error from deleteSample on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });
      const result = await repository.deleteSample('user-1', 'some-id', 'threads');
      expect(result.ok).toBe(false);
    });

    it('returns error from countSamplesByCategory on Firestore failure', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });
      const result = await repository.countSamplesByCategory('user-1', 'threads');
      expect(result.ok).toBe(false);
    });

    it('wraps non-Error throws', async () => {
      fakeFirestore.configure({ errorToThrow: 'string error' as unknown as Error });
      const result = await repository.getStyleConfig('user-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
      }
    });
  });
});
