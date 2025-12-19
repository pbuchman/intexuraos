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

  describe('createPage', () => {
    it('creates page with incrementing counter', async () => {
      const result1 = await adapter.createPage('token', 'parent', 'Title 1', 'Content');
      const result2 = await adapter.createPage('token', 'parent', 'Title 2', 'Content');

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
      const result = await adapter.createPage('token', 'parent', 'Title', 'Content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/note-000001');
      }
    });
  });

  describe('reset', () => {
    it('resets the page counter', async () => {
      await adapter.createPage('token', 'parent', 'Title', 'Content');
      await adapter.createPage('token', 'parent', 'Title', 'Content');

      adapter.reset();

      const result = await adapter.createPage('token', 'parent', 'Title', 'Content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('note_000001');
      }
    });
  });
});
