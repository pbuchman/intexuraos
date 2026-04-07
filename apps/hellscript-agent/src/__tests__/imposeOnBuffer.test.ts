import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { FakeHellscriptRepository } from './fakeHellscriptRepository.js';
import { FakeIntentInterpreter } from './fakeIntentInterpreter.js';
import { FakeDraftGenerator } from './fakeDraftGenerator.js';
import { FakeWritingConfigRepository } from './fakeWritingConfigRepository.js';
import { imposeOnBuffer } from '../domain/usecases/imposeOnBuffer.js';
import { BufferNotFoundError, DraftGenerationError } from '../domain/errors.js';
const logger = pino({ level: 'silent' });

describe('imposeOnBuffer', () => {
  let repository: FakeHellscriptRepository;
  let writingConfigRepository: FakeWritingConfigRepository;
  let interpreter: FakeIntentInterpreter;
  let draftGenerator: FakeDraftGenerator;

  beforeEach(() => {
    repository = new FakeHellscriptRepository();
    writingConfigRepository = new FakeWritingConfigRepository();
    interpreter = new FakeIntentInterpreter();
    draftGenerator = new FakeDraftGenerator();
  });

  function deps(): {
    repository: FakeHellscriptRepository;
    writingConfigRepository: FakeWritingConfigRepository;
    interpreter: FakeIntentInterpreter;
    draftGenerator: FakeDraftGenerator;
    logger: typeof logger;
  } {
    return { repository, writingConfigRepository, interpreter, draftGenerator, logger };
  }

  describe('buffer creation', () => {
    it('creates new buffer when bufferId is omitted', async () => {
      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'My thought' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'My thought',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.bufferId).toBeDefined();
        expect(result.value.action).toBe('append_thought');
      }
    });

    it('uses existing buffer when bufferId is provided', async () => {
      const createResult = await repository.createBuffer('user-1', 'My buffer');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'New thought' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId: createResult.value.id,
        utterance: 'New thought',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.bufferId).toBe(createResult.value.id);
      }
    });

    it('returns error when buffer not found', async () => {
      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'thought' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId: 'nonexistent',
        utterance: 'thought',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(BufferNotFoundError);
        expect(result.error.message).toBe('Buffer not found');
      }
    });

    it('returns error when createBuffer fails', async () => {
      repository.simulateMethodError('createBuffer', new Error('DB down'));

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'thought',
      });

      expect(result.ok).toBe(false);
    });

    it('returns error when getBufferWithState fails for existing bufferId', async () => {
      const createResult = await repository.createBuffer('user-1', 'Buffer');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      repository.simulateMethodError('getBufferWithState', new Error('DB read failed'));

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId: createResult.value.id,
        utterance: 'thought',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('DB read failed');
      }
    });
  });

  describe('event storage', () => {
    it('stores raw utterance as event', async () => {
      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'My thought' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'My thought',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const events = await repository.getEvents(result.value.bufferId);
      expect(events.ok).toBe(true);
      if (events.ok) {
        expect(events.value).toHaveLength(1);
        expect(events.value[0]?.rawUtterance).toBe('My thought');
      }
    });

    it('returns error when saveEvent fails', async () => {
      repository.simulateMethodError('saveEvent', new Error('Write failed'));
      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'thought' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'thought',
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('state transitions', () => {
    it('applies append_thought intent', async () => {
      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'First idea' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'First idea',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const stateResult = await repository.getBufferState(result.value.bufferId);
      expect(stateResult.ok).toBe(true);
      if (stateResult.ok && stateResult.value !== null) {
        expect(stateResult.value.thoughts).toHaveLength(1);
        expect(stateResult.value.thoughts[0]?.text).toBe('First idea');
      }
    });

    it('applies fallback_append intent', async () => {
      interpreter.setNextIntent({
        kind: 'fallback_append',
        payload: { text: 'Unclear thing' },
        fallbackReason: 'Could not classify',
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Unclear thing',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('fallback_append');
      }
    });

    it('returns error when updateBufferState fails', async () => {
      repository.simulateMethodError('updateBufferState', new Error('Write failed'));
      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'thought' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'thought',
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('draft generation', () => {
    it('generates draft for update_draft intent with valid category', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Write a blog post', category: 'general' },
      });
      draftGenerator.setNextMarkdown('# My Blog Post\n\nGreat content.');

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Write a blog post',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('update_draft');
        expect(result.value.latestDraftVersionId).toBeDefined();
      }
    });

    it('returns category_required when category is null', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Write something', category: null },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Write something',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('category_required');
        expect(result.value.latestDraftVersionId).toBeUndefined();
      }
    });

    it('does not save event when category_required is returned', async () => {
      const createResult = await repository.createBuffer('user-1', 'Buffer');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Write something', category: null },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId: createResult.value.id,
        utterance: 'Write something',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('category_required');
      }

      const events = await repository.getEvents(createResult.value.id);
      expect(events.ok).toBe(true);
      if (events.ok) {
        expect(events.value).toHaveLength(0);
      }
    });

    it('returns category_required when category is missing', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Write something' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Write something',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('category_required');
      }
    });

    it('returns category_required when category is invalid', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Write something', category: 'twitter' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Write something',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('category_required');
      }
    });

    it('uses explicit category from input over intent payload', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Write a post', category: null },
      });
      draftGenerator.setNextMarkdown('# LinkedIn Post');

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Write a post',
        category: 'linkedin',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('update_draft');
        expect(result.value.latestDraftVersionId).toBeDefined();
      }

      const calls = draftGenerator.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.category).toBe('linkedin');
    });

    it('returns error when saveEvent fails in update_draft path', async () => {
      repository.simulateMethodError('saveEvent', new Error('Write failed'));
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'draft', category: 'general' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'draft',
      });

      expect(result.ok).toBe(false);
    });

    it('returns error when updateBufferState fails in update_draft path', async () => {
      repository.simulateMethodError('updateBufferState', new Error('Write failed'));
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'draft', category: 'general' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'draft',
      });

      expect(result.ok).toBe(false);
    });

    it('fetches style instructions and samples for the category', async () => {
      await writingConfigRepository.upsertStyleInstructions('user-1', 'linkedin', 'Be professional');
      await writingConfigRepository.createSample('user-1', {
        category: 'linkedin',
        title: 'Sample 1',
        text: 'Professional post example',
      });

      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Write a LinkedIn post', category: 'linkedin' },
      });
      draftGenerator.setNextMarkdown('# LinkedIn Post');

      await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Write a LinkedIn post',
      });

      const calls = draftGenerator.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.styleInstructions).toBe('Be professional');
      expect(calls[0]?.writingSamples).toEqual(['Professional post example']);
      expect(calls[0]?.category).toBe('linkedin');
    });

    it('passes null style and empty samples when config does not exist', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Write a thread', category: 'threads' },
      });
      draftGenerator.setNextMarkdown('# Thread');

      await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Write a thread',
      });

      const calls = draftGenerator.getCalls();
      expect(calls[0]?.styleInstructions).toBeNull();
      expect(calls[0]?.writingSamples).toEqual([]);
    });

    it('does not generate draft for non-update_draft intents', async () => {
      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'Just a thought' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Just a thought',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.latestDraftVersionId).toBeUndefined();
      }
      expect(draftGenerator.getCalls()).toHaveLength(0);
    });

    it('increments version numbers', async () => {
      const createResult = await repository.createBuffer('user-1', 'Buffer');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const bufferId = createResult.value.id;

      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'First draft', category: 'general' },
      });
      draftGenerator.setNextMarkdown('# V1');

      await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId,
        utterance: 'First draft',
      });

      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Second draft', category: 'general' },
      });
      draftGenerator.setNextMarkdown('# V2');

      await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId,
        utterance: 'Second draft',
      });

      const draftsResult = await repository.getDraftVersions(bufferId);
      expect(draftsResult.ok).toBe(true);
      if (draftsResult.ok) {
        expect(draftsResult.value).toHaveLength(2);
        expect(draftsResult.value[0]?.versionNumber).toBe(1);
        expect(draftsResult.value[1]?.versionNumber).toBe(2);
      }
    });

    it('passes prior draft to generator', async () => {
      const createResult = await repository.createBuffer('user-1', 'Buffer');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const bufferId = createResult.value.id;

      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'First draft', category: 'general' },
      });
      draftGenerator.setNextMarkdown('# V1');

      await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId,
        utterance: 'First draft',
      });

      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'Improve it', category: 'general' },
      });
      draftGenerator.setNextMarkdown('# V2');

      await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId,
        utterance: 'Improve it',
      });

      const calls = draftGenerator.getCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]?.priorDraft).toBeNull();
      expect(calls[1]?.priorDraft).toBe('# V1');
    });

    it('returns error when getDraftVersion fails on second draft', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'draft', category: 'general' },
      });
      draftGenerator.setNextMarkdown('# V1');

      const first = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'generate',
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      repository.simulateMethodError('getDraftVersion', new Error('Read failed'));
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'improve', category: 'general' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        bufferId: first.value.bufferId,
        utterance: 'improve',
      });

      expect(result.ok).toBe(false);
    });

    it('returns error when draft generation fails', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'draft', category: 'general' },
      });
      draftGenerator.simulateError(new Error('LLM failed'));

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'generate draft',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(DraftGenerationError);
        expect(result.error.message).toBe('Draft generation failed');
      }
    });

    it('returns error when saveDraftVersion fails', async () => {
      repository.simulateMethodError('saveDraftVersion', new Error('Write failed'));
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'draft', category: 'general' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'draft',
      });

      expect(result.ok).toBe(false);
    });

    it('returns error when updateBufferDraftInfo fails', async () => {
      repository.simulateMethodError('updateBufferDraftInfo', new Error('Write failed'));
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'draft', category: 'general' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'draft',
      });

      expect(result.ok).toBe(false);
    });

    it('uses utterance as requestText when payload text missing', async () => {
      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { category: 'general' },
      });
      draftGenerator.setNextMarkdown('# Draft');

      await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Generate my draft now',
      });

      const calls = draftGenerator.getCalls();
      expect(calls[0]?.requestText).toBe('Generate my draft now');
    });

    it('handles writing config fetch failure gracefully', async () => {
      writingConfigRepository.simulateMethodError('getStyleConfig', new Error('DB error'));
      writingConfigRepository.simulateMethodError('listSamples', new Error('DB error'));

      interpreter.setNextIntent({
        kind: 'update_draft',
        payload: { text: 'draft', category: 'general' },
      });
      draftGenerator.setNextMarkdown('# Draft');

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'draft',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('update_draft');
      }

      const calls = draftGenerator.getCalls();
      expect(calls[0]?.styleInstructions).toBeNull();
      expect(calls[0]?.writingSamples).toEqual([]);
    });
  });

  describe('return value', () => {
    it('returns bufferId and action for non-draft intents', async () => {
      interpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'Be concise' },
      });

      const result = await imposeOnBuffer(deps(), {
        userId: 'user-1',
        utterance: 'Be concise',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.bufferId).toBeDefined();
        expect(result.value.action).toBe('append_thought');
        expect(result.value.latestDraftVersionId).toBeUndefined();
      }
    });
  });
});
