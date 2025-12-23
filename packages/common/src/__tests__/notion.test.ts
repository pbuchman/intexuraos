import { describe, it, expect, vi } from 'vitest';
import { Client } from '@notionhq/client';
import { mapNotionError, createNotionClient, type NotionLogger } from '../notion.js';
describe('notion utilities', () => {
  describe('mapNotionError', () => {
    it('maps unknown error to INTERNAL_ERROR', () => {
      const result = mapNotionError(new Error('Something went wrong'));
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Something went wrong');
    });
    it('maps non-Error objects to INTERNAL_ERROR', () => {
      const result = mapNotionError('string error');
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Unknown Notion API error');
    });
    it('maps null to INTERNAL_ERROR', () => {
      const result = mapNotionError(null);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
    it('maps undefined to INTERNAL_ERROR', () => {
      const result = mapNotionError(undefined);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });
  describe('createNotionClient', () => {
    it('creates a Notion client without logger', () => {
      const client = createNotionClient('test-token');
      expect(client).toBeInstanceOf(Client);
    });
    it('creates a Notion client with logger', () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const client = createNotionClient('test-token', logger);
      expect(client).toBeInstanceOf(Client);
    });
  });
});
