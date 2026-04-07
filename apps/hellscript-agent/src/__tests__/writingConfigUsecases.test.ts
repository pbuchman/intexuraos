import { describe, it, expect, beforeEach } from 'vitest';
import { FakeWritingConfigRepository } from './fakeWritingConfigRepository.js';
import { getWritingConfig } from '../domain/usecases/getWritingConfig.js';
import { updateStyleInstructions } from '../domain/usecases/updateStyleInstructions.js';
import { clearStyleInstructions } from '../domain/usecases/clearStyleInstructions.js';
import { listWritingSamples } from '../domain/usecases/listWritingSamples.js';
import { createWritingSample } from '../domain/usecases/createWritingSample.js';
import { updateWritingSample } from '../domain/usecases/updateWritingSample.js';
import { deleteWritingSample } from '../domain/usecases/deleteWritingSample.js';

describe('writing config use cases', () => {
  let repo: FakeWritingConfigRepository;

  beforeEach(() => {
    repo = new FakeWritingConfigRepository();
  });

  function deps(): { writingConfigRepository: FakeWritingConfigRepository } {
    return { writingConfigRepository: repo };
  }

  describe('getWritingConfig', () => {
    it('returns null when no config exists', async () => {
      const result = await getWritingConfig(deps(), 'user-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns config when it exists', async () => {
      await repo.upsertStyleInstructions('user-1', 'threads', 'Be brief');
      const result = await getWritingConfig(deps(), 'user-1');
      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.threads).toBe('Be brief');
      }
    });

    it('returns error on repository failure', async () => {
      repo.simulateMethodError('getStyleConfig', new Error('DB error'));
      const result = await getWritingConfig(deps(), 'user-1');
      expect(result.ok).toBe(false);
    });
  });

  describe('updateStyleInstructions', () => {
    it('sets style instructions for a category', async () => {
      const result = await updateStyleInstructions(deps(), 'user-1', 'linkedin', 'Be formal');
      expect(result.ok).toBe(true);

      const config = await repo.getStyleConfig('user-1');
      expect(config.ok).toBe(true);
      if (config.ok && config.value !== null) {
        expect(config.value.linkedin).toBe('Be formal');
      }
    });

    it('stores text verbatim without escaping', async () => {
      await updateStyleInstructions(deps(), 'user-1', 'threads', '<b>bold</b>');
      const config = await repo.getStyleConfig('user-1');
      if (config.ok && config.value !== null) {
        expect(config.value.threads).toBe('<b>bold</b>');
      }
    });

    it('returns error on repository failure', async () => {
      repo.simulateMethodError('upsertStyleInstructions', new Error('DB error'));
      const result = await updateStyleInstructions(deps(), 'user-1', 'general', 'test');
      expect(result.ok).toBe(false);
    });
  });

  describe('clearStyleInstructions', () => {
    it('clears style instructions for a category', async () => {
      await repo.upsertStyleInstructions('user-1', 'threads', 'Old');
      const result = await clearStyleInstructions(deps(), 'user-1', 'threads');
      expect(result.ok).toBe(true);

      const config = await repo.getStyleConfig('user-1');
      if (config.ok && config.value !== null) {
        expect(config.value.threads).toBeNull();
      }
    });

    it('returns error on repository failure', async () => {
      repo.simulateMethodError('deleteStyleInstructions', new Error('DB error'));
      const result = await clearStyleInstructions(deps(), 'user-1', 'threads');
      expect(result.ok).toBe(false);
    });
  });

  describe('listWritingSamples', () => {
    it('returns empty array when no samples exist', async () => {
      const result = await listWritingSamples(deps(), 'user-1', 'threads');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns samples for the category', async () => {
      await repo.createSample('user-1', { category: 'threads', title: 'S1', text: 'T1' });
      await repo.createSample('user-1', { category: 'linkedin', title: 'S2', text: 'T2' });

      const result = await listWritingSamples(deps(), 'user-1', 'threads');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.title).toBe('S1');
      }
    });

    it('returns error on repository failure', async () => {
      repo.simulateMethodError('listSamples', new Error('DB error'));
      const result = await listWritingSamples(deps(), 'user-1', 'threads');
      expect(result.ok).toBe(false);
    });
  });

  describe('createWritingSample', () => {
    it('creates a new sample', async () => {
      const result = await createWritingSample(deps(), 'user-1', 'general', 'Title', 'Text');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.category).toBe('general');
      }
    });

    it('enforces max 5 samples per category', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.createSample('user-1', {
          category: 'threads',
          title: `Sample ${String(i)}`,
          text: `Text ${String(i)}`,
        });
      }

      const result = await createWritingSample(deps(), 'user-1', 'threads', 'Extra', 'Too many');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Maximum');
      }
    });

    it('allows creating in a different category when one is full', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.createSample('user-1', {
          category: 'threads',
          title: `S ${String(i)}`,
          text: `T ${String(i)}`,
        });
      }

      const result = await createWritingSample(deps(), 'user-1', 'linkedin', 'Title', 'Text');
      expect(result.ok).toBe(true);
    });

    it('stores text verbatim without escaping', async () => {
      const result = await createWritingSample(
        deps(), 'user-1', 'general', '<b>Title</b>', '<script>bad</script>'
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('<b>Title</b>');
        expect(result.value.text).toBe('<script>bad</script>');
      }
    });

    it('returns error on countSamplesByCategory failure', async () => {
      repo.simulateMethodError('countSamplesByCategory', new Error('DB error'));
      const result = await createWritingSample(deps(), 'user-1', 'general', 'Title', 'Text');
      expect(result.ok).toBe(false);
    });

    it('returns error on createSample failure', async () => {
      repo.simulateMethodError('createSample', new Error('DB write error'));
      const result = await createWritingSample(deps(), 'user-1', 'general', 'Title', 'Text');
      expect(result.ok).toBe(false);
    });
  });

  describe('updateWritingSample', () => {
    it('updates an existing sample', async () => {
      const created = await repo.createSample('user-1', {
        category: 'threads',
        title: 'Old Title',
        text: 'Old Text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await updateWritingSample(
        deps(), 'user-1', created.value.id, 'threads', 'New Title', 'New Text'
      );
      expect(result.ok).toBe(true);
    });

    it('returns error for wrong category (category mismatch)', async () => {
      const created = await repo.createSample('user-1', {
        category: 'threads',
        title: 'Title',
        text: 'Text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await updateWritingSample(
        deps(), 'user-1', created.value.id, 'linkedin', 'New', 'New'
      );
      expect(result.ok).toBe(false);
    });

    it('returns error for non-existent sample', async () => {
      const result = await updateWritingSample(
        deps(), 'user-1', 'nonexistent', 'general', 'New', 'New'
      );
      expect(result.ok).toBe(false);
    });

    it('stores text verbatim without escaping', async () => {
      const created = await repo.createSample('user-1', {
        category: 'general',
        title: 'Old',
        text: 'Old',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateWritingSample(
        deps(), 'user-1', created.value.id, 'general', '<em>Bold</em>', '<div>Content</div>'
      );

      const sample = await repo.getSample('user-1', created.value.id);
      if (sample.ok && sample.value !== null) {
        expect(sample.value.title).toBe('<em>Bold</em>');
        expect(sample.value.text).toBe('<div>Content</div>');
      }
    });
  });

  describe('deleteWritingSample', () => {
    it('deletes an existing sample', async () => {
      const created = await repo.createSample('user-1', {
        category: 'general',
        title: 'Delete me',
        text: 'Text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await deleteWritingSample(deps(), 'user-1', created.value.id, 'general');
      expect(result.ok).toBe(true);

      const samples = await repo.listSamples('user-1', 'general');
      if (samples.ok) {
        expect(samples.value).toHaveLength(0);
      }
    });

    it('returns error for wrong category', async () => {
      const created = await repo.createSample('user-1', {
        category: 'threads',
        title: 'Sample',
        text: 'Text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await deleteWritingSample(deps(), 'user-1', created.value.id, 'linkedin');
      expect(result.ok).toBe(false);
    });

    it('returns error for non-existent sample', async () => {
      const result = await deleteWritingSample(deps(), 'user-1', 'nonexistent', 'general');
      expect(result.ok).toBe(false);
    });
  });

  describe('countSamplesByCategory', () => {
    it('returns correct counts per category', async () => {
      await repo.createSample('user-1', { category: 'threads', title: 'S1', text: 'T1' });
      await repo.createSample('user-1', { category: 'threads', title: 'S2', text: 'T2' });
      await repo.createSample('user-1', { category: 'threads', title: 'S3', text: 'T3' });
      await repo.createSample('user-1', { category: 'linkedin', title: 'S4', text: 'T4' });
      await repo.createSample('user-1', { category: 'linkedin', title: 'S5', text: 'T5' });

      const threadsResult = await repo.countSamplesByCategory('user-1', 'threads');
      expect(threadsResult.ok).toBe(true);
      if (threadsResult.ok) {
        expect(threadsResult.value).toBe(3);
      }

      const linkedinResult = await repo.countSamplesByCategory('user-1', 'linkedin');
      expect(linkedinResult.ok).toBe(true);
      if (linkedinResult.ok) {
        expect(linkedinResult.value).toBe(2);
      }

      const generalResult = await repo.countSamplesByCategory('user-1', 'general');
      expect(generalResult.ok).toBe(true);
      if (generalResult.ok) {
        expect(generalResult.value).toBe(0);
      }
    });
  });
});
