import { describe, it, expect, beforeEach } from 'vitest';
import { MockNotionApiAdapter } from '../testing/mockNotionApiAdapter.js';

describe('MockNotionApiAdapter', () => {
  let adapter: MockNotionApiAdapter;

  beforeEach(() => {
    adapter = new MockNotionApiAdapter();
  });

  describe('validateToken', () => {
    it('returns ok(true) for valid tokens', async () => {
      const result = await adapter.validateToken('valid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns ok(false) for invalid-token', async () => {
      const result = await adapter.validateToken('invalid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('getPageWithPreview', () => {
    it('returns stub page and blocks', async () => {
      const pageId = 'test-page-123';
      const result = await adapter.getPageWithPreview('token', pageId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.page.id).toBe(pageId);
        expect(result.value.page.title).toBe('Prompt Vault');
        expect(result.value.page.url).toBe(`https://notion.so/${pageId}`);
        expect(result.value.blocks).toHaveLength(4);
        expect(result.value.blocks[0]?.type).toBe('heading_1');
      }
    });
  });

  describe('createPromptVaultNote', () => {
    it('creates note with incrementing counter', async () => {
      const result1 = await adapter.createPromptVaultNote({
        token: 'token',
        parentPageId: 'parent',
        title: 'Title 1',
        prompt: 'Prompt 1',
        userId: 'user-1',
      });
      const result2 = await adapter.createPromptVaultNote({
        token: 'token',
        parentPageId: 'parent',
        title: 'Title 2',
        prompt: 'Prompt 2',
        userId: 'user-2',
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value.id).toBe('note_000001');
        expect(result2.value.id).toBe('note_000002');
        expect(result1.value.title).toBe('Title 1');
        expect(result2.value.title).toBe('Title 2');
      }
    });

    it('generates URL from id', async () => {
      const result = await adapter.createPromptVaultNote({
        token: 'token',
        parentPageId: 'parent',
        title: 'Title',
        prompt: 'Prompt',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/note-000001');
      }
    });

    it('captures params for test assertions', async () => {
      const params = {
        token: 'my-token',
        parentPageId: 'my-parent',
        title: 'My Title',
        prompt: '  verbatim prompt with whitespace  ',
        userId: 'my-user-id',
      };

      await adapter.createPromptVaultNote(params);

      const captured = adapter.getLastCapturedNote();
      expect(captured).toBeDefined();
      expect(captured?.params.token).toBe(params.token);
      expect(captured?.params.parentPageId).toBe(params.parentPageId);
      expect(captured?.params.title).toBe(params.title);
      expect(captured?.params.prompt).toBe(params.prompt);
      expect(captured?.params.userId).toBe(params.userId);
    });

    it('captures all notes', async () => {
      await adapter.createPromptVaultNote({
        token: 'token',
        parentPageId: 'parent',
        title: 'Note 1',
        prompt: 'Prompt 1',
        userId: 'user-1',
      });
      await adapter.createPromptVaultNote({
        token: 'token',
        parentPageId: 'parent',
        title: 'Note 2',
        prompt: 'Prompt 2',
        userId: 'user-2',
      });

      const allCaptured = adapter.getCapturedNotes();
      expect(allCaptured).toHaveLength(2);
      expect(allCaptured[0]?.params.title).toBe('Note 1');
      expect(allCaptured[1]?.params.title).toBe('Note 2');
    });
  });

  describe('reset', () => {
    it('resets the page counter and captured notes', async () => {
      await adapter.createPromptVaultNote({
        token: 'token',
        parentPageId: 'parent',
        title: 'Title',
        prompt: 'Prompt',
        userId: 'user-1',
      });
      await adapter.createPromptVaultNote({
        token: 'token',
        parentPageId: 'parent',
        title: 'Title',
        prompt: 'Prompt',
        userId: 'user-2',
      });

      adapter.reset();

      const result = await adapter.createPromptVaultNote({
        token: 'token',
        parentPageId: 'parent',
        title: 'Title',
        prompt: 'Prompt',
        userId: 'user-3',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('note_000001');
      }

      // Also verify captured notes were reset
      const captured = adapter.getCapturedNotes();
      expect(captured).toHaveLength(1);
    });
  });
});
