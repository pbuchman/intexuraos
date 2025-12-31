/**
 * Tests for Notion client utilities.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIErrorCode, Client, isNotionClientError } from '@notionhq/client';
import {
  createNotionClient,
  extractPageTitle,
  getPageWithPreview,
  mapNotionError,
  type NotionLogger,
  validateNotionToken,
} from '../notion.js';

// Create mock client instance holder
let mockClientInstance: {
  users: { me: ReturnType<typeof vi.fn> };
  pages: { retrieve: ReturnType<typeof vi.fn> };
  blocks: { children: { list: ReturnType<typeof vi.fn> } };
};

// Mock the entire @notionhq/client module
vi.mock('@notionhq/client', () => {
  const MockClient = vi.fn().mockImplementation(function (this: unknown) {
    return mockClientInstance;
  });
  return {
    Client: MockClient,
    isNotionClientError: vi.fn(),
    APIErrorCode: {
      Unauthorized: 'unauthorized',
      ObjectNotFound: 'object_not_found',
      RateLimited: 'rate_limited',
      ValidationError: 'validation_error',
      InvalidJSON: 'invalid_json',
      InternalServerError: 'internal_server_error',
    },
    LogLevel: {
      DEBUG: 'debug',
    },
  };
});

describe('Notion utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock client instance
    mockClientInstance = {
      users: { me: vi.fn() },
      pages: { retrieve: vi.fn() },
      blocks: { children: { list: vi.fn() } },
    };
  });

  describe('mapNotionError', () => {
    beforeEach(() => {
      vi.mocked(isNotionClientError).mockReturnValue(false);
    });

    it('maps Unauthorized error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.Unauthorized, message: 'Invalid token' };

      const result = mapNotionError(error);

      expect(result.code).toBe('UNAUTHORIZED');
      expect(result.message).toBe('Invalid token');
    });

    it('maps ObjectNotFound error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.ObjectNotFound, message: 'Page not found' };

      const result = mapNotionError(error);

      expect(result.code).toBe('NOT_FOUND');
    });

    it('maps RateLimited error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.RateLimited, message: 'Too many requests' };

      const result = mapNotionError(error);

      expect(result.code).toBe('RATE_LIMITED');
    });

    it('maps ValidationError error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.ValidationError, message: 'Invalid input' };

      const result = mapNotionError(error);

      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('maps InvalidJSON error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.InvalidJSON, message: 'Malformed JSON' };

      const result = mapNotionError(error);

      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('maps other Notion errors to INTERNAL_ERROR', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.InternalServerError, message: 'Server error' };

      const result = mapNotionError(error);

      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Server error');
    });

    it('maps non-Notion Error to INTERNAL_ERROR', () => {
      vi.mocked(isNotionClientError).mockReturnValue(false);
      const error = new Error('Network failure');

      const result = mapNotionError(error);

      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Network failure');
    });

    it('maps non-Error object to INTERNAL_ERROR with fallback message', () => {
      vi.mocked(isNotionClientError).mockReturnValue(false);

      const result = mapNotionError({ some: 'object' });

      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Unknown Notion API error');
    });

    it('maps null/undefined to INTERNAL_ERROR', () => {
      vi.mocked(isNotionClientError).mockReturnValue(false);

      expect(mapNotionError(null).code).toBe('INTERNAL_ERROR');
      expect(mapNotionError(undefined).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('extractPageTitle', () => {
    it('extracts title from title property', () => {
      const properties = {
        title: {
          title: [{ plain_text: 'My Page Title' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('My Page Title');
    });

    it('extracts title from Title property (capitalized)', () => {
      const properties = {
        Title: {
          title: [{ plain_text: 'Capitalized Title' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Capitalized Title');
    });

    it('extracts title from Name property', () => {
      const properties = {
        Name: {
          title: [{ plain_text: 'Name Property' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Name Property');
    });

    it('extracts title from name property (lowercase)', () => {
      const properties = {
        name: {
          title: [{ plain_text: 'Lowercase Name' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Lowercase Name');
    });

    it('concatenates multiple title segments', () => {
      const properties = {
        title: {
          title: [{ plain_text: 'Part 1 ' }, { plain_text: 'Part 2' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Part 1 Part 2');
    });

    it('handles missing plain_text in segments', () => {
      const properties = {
        title: {
          title: [{ plain_text: 'Text' }, { other: 'data' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Text');
    });

    it('returns Untitled when no title property exists', () => {
      const properties = {
        other: 'value',
      };

      expect(extractPageTitle(properties)).toBe('Untitled');
    });

    it('returns Untitled when title property has wrong format', () => {
      const properties = {
        title: 'string value',
      };

      expect(extractPageTitle(properties)).toBe('Untitled');
    });

    it('returns empty string when title array is empty', () => {
      const properties = {
        title: {
          title: [],
        },
      };

      expect(extractPageTitle(properties)).toBe('');
    });

    it('handles null title property', () => {
      const properties = {
        title: null,
      };

      expect(extractPageTitle(properties)).toBe('Untitled');
    });
  });

  describe('createNotionClient', () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      mockFetch = vi.fn();
      global.fetch = mockFetch as unknown as typeof global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('creates client without logger', () => {
      const client = createNotionClient('test-token');

      expect(Client).toHaveBeenCalledWith({ auth: 'test-token' });
      expect(client).toBeDefined();
    });

    it('creates client with logger and custom fetch', () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: 'test-token',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          fetch: expect.any(Function),
        })
      );
    });

    it('logging fetch logs requests with Headers object', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;
      expect(fetchFn).toBeDefined();

      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Authorization', 'Bearer secret-token-12345678901234567890');

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await fetchFn('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: '{"test": true}',
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          method: 'POST',
          bodyLength: 14,
        })
      );
    });

    it('logging fetch logs requests with array headers', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await fetchFn('https://api.notion.com/v1/pages', {
        method: 'GET',
        headers: [
          ['Content-Type', 'application/json'],
          ['Authorization', 'Bearer secret-token-12345678901234567890'],
        ],
      });

      expect(logger.info).toHaveBeenCalledWith('Notion API request', expect.any(Object));
    });

    it('logging fetch logs requests with record headers', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await fetchFn('https://api.notion.com/v1/pages', {
        headers: { 'Content-Type': 'application/json' },
      });

      expect(logger.info).toHaveBeenCalled();
    });

    it('logging fetch handles URL object', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await fetchFn(new URL('https://api.notion.com/v1/pages'), {});

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({ url: 'https://api.notion.com/v1/pages' })
      );
    });

    it('logging fetch handles Request object', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const request = new Request('https://api.notion.com/v1/pages');
      await fetchFn(request, {});

      expect(logger.info).toHaveBeenCalled();
    });

    it('logging fetch handles ArrayBuffer body', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const buffer = new ArrayBuffer(100);
      await fetchFn('https://api.notion.com/v1/pages', { body: buffer });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({ bodyLength: 100 })
      );
    });

    it('logging fetch logs error responses', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
      );

      await fetchFn('https://api.notion.com/v1/pages', { method: 'GET' });

      expect(logger.warn).toHaveBeenCalledWith(
        'Notion API error response',
        expect.objectContaining({ status: 404 })
      );
    });

    it('logging fetch truncates long response bodies', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      const longBody = 'x'.repeat(600);
      mockFetch.mockResolvedValueOnce(new Response(longBody, { status: 400 }));

      await fetchFn('https://api.notion.com/v1/pages', { method: 'GET' });

      expect(logger.warn).toHaveBeenCalledWith(
        'Notion API error response',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          body: expect.stringContaining('[TRUNCATED]'),
        })
      );
    });

    it('logging fetch handles network errors', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      await expect(fetchFn('https://api.notion.com/v1/pages', { method: 'GET' })).rejects.toThrow(
        'Network failure'
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Notion API network error',
        expect.objectContaining({ error: 'Network failure' })
      );
    });

    it('logging fetch handles response body read failure', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      // Create a response that fails when cloned and read
      const mockResponse = new Response('error body', { status: 400 });
      const mockClone = {
        text: vi.fn().mockRejectedValue(new Error('Body read failed')),
      };
      vi.spyOn(mockResponse, 'clone').mockReturnValue(mockClone as unknown as Response);

      mockFetch.mockResolvedValueOnce(mockResponse);

      await fetchFn('https://api.notion.com/v1/pages', { method: 'GET' });

      expect(logger.warn).toHaveBeenCalledWith(
        'Notion API error response',
        expect.objectContaining({ body: '[unable to read response body]' })
      );
    });

    it('logging fetch logs success response info correctly', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      await fetchFn('https://api.notion.com/v1/pages/test', { method: 'GET' });

      // Should have been called twice: once for request, once for response
      expect(logger.info).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenLastCalledWith(
        'Notion API response',
        expect.objectContaining({
          status: 200,
          method: 'GET',
          url: 'https://api.notion.com/v1/pages/test',
        })
      );
    });

    it('logging fetch uses default GET method when not specified', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      // Call without method specified
      await fetchFn('https://api.notion.com/v1/pages', undefined);

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('logging fetch handles undefined init', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      createNotionClient('test-token', logger);

      const callArgs = vi.mocked(Client).mock.calls[0]?.[0];
      const fetchFn = callArgs?.fetch as (
        url: string | URL | Request,
        init?: RequestInit
      ) => Promise<Response>;

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await fetchFn('https://api.notion.com/v1/pages');

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          method: 'GET',
          headers: {},
          bodyLength: 0,
        })
      );
    });
  });

  describe('validateNotionToken', () => {
    beforeEach(() => {
      vi.mocked(isNotionClientError).mockReturnValue(false);
    });

    it('returns ok(true) for valid token', async () => {
      mockClientInstance.users.me.mockResolvedValue({ id: 'user-123' });

      const result = await validateNotionToken('valid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns ok(false) for unauthorized token', async () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      mockClientInstance.users.me.mockRejectedValue({
        code: APIErrorCode.Unauthorized,
        message: 'Invalid token',
      });

      const result = await validateNotionToken('invalid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns err for other API errors', async () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      mockClientInstance.users.me.mockRejectedValue({
        code: APIErrorCode.RateLimited,
        message: 'Rate limited',
      });

      const result = await validateNotionToken('token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('passes logger to createNotionClient', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      mockClientInstance.users.me.mockResolvedValue({ id: 'user-123' });

      await validateNotionToken('token', logger);

      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: 'token',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          fetch: expect.any(Function),
        })
      );
    });
  });

  describe('getPageWithPreview', () => {
    beforeEach(() => {
      vi.mocked(isNotionClientError).mockReturnValue(false);
    });

    it('returns page preview with title and blocks', async () => {
      mockClientInstance.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: {
          title: { title: [{ plain_text: 'My Page' }] },
        },
        url: 'https://notion.so/my-page',
      });
      mockClientInstance.blocks.children.list.mockResolvedValue({
        results: [
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Hello world' }] },
          },
          {
            type: 'heading_1',
            heading_1: { rich_text: [{ plain_text: 'Title' }] },
          },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('page-123');
        expect(result.value.title).toBe('My Page');
        expect(result.value.url).toBe('https://notion.so/my-page');
        expect(result.value.blocks).toHaveLength(2);
        expect(result.value.blocks[0]).toEqual({ type: 'paragraph', content: 'Hello world' });
      }
    });

    it('returns err for page without properties (partial page)', async () => {
      mockClientInstance.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        // No properties field - this is a PartialPageObjectResponse
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Unexpected page response format');
      }
    });

    it('handles page without url field', async () => {
      mockClientInstance.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: { title: { title: [{ plain_text: 'Test' }] } },
        // No url field
      });
      mockClientInstance.blocks.children.list.mockResolvedValue({ results: [] });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/page-123');
      }
    });

    it('handles blocks without type', async () => {
      mockClientInstance.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: { title: { title: [] } },
        url: 'https://notion.so/page',
      });
      mockClientInstance.blocks.children.list.mockResolvedValue({
        results: [
          { id: 'block-1' }, // No type field
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Text' }] } },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only the block with type should be included
        expect(result.value.blocks).toHaveLength(1);
        expect(result.value.blocks[0]?.type).toBe('paragraph');
      }
    });

    it('handles blocks without rich_text', async () => {
      mockClientInstance.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: { title: { title: [] } },
        url: 'https://notion.so/page',
      });
      mockClientInstance.blocks.children.list.mockResolvedValue({
        results: [{ type: 'divider', divider: {} }], // No rich_text
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.blocks).toHaveLength(1);
        expect(result.value.blocks[0]).toEqual({ type: 'divider', content: '' });
      }
    });

    it('returns err on API error', async () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      mockClientInstance.pages.retrieve.mockRejectedValue({
        code: APIErrorCode.ObjectNotFound,
        message: 'Page not found',
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('handles rich_text with missing plain_text in segments', async () => {
      mockClientInstance.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: { title: { title: [{ plain_text: 'Test' }] } },
        url: 'https://notion.so/page',
      });
      mockClientInstance.blocks.children.list.mockResolvedValue({
        results: [
          {
            type: 'paragraph',
            paragraph: {
              rich_text: [
                { plain_text: 'Hello' },
                { bold: true }, // Missing plain_text
                { plain_text: ' World' },
              ],
            },
          },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.blocks[0]?.content).toBe('Hello World');
      }
    });

    it('handles block data being undefined', async () => {
      mockClientInstance.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: { title: { title: [] } },
        url: 'https://notion.so/page',
      });
      mockClientInstance.blocks.children.list.mockResolvedValue({
        results: [
          {
            type: 'unsupported_block',
            // unsupported_block property doesn't exist
          },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.blocks).toHaveLength(1);
        expect(result.value.blocks[0]).toEqual({ type: 'unsupported_block', content: '' });
      }
    });

    it('passes logger to createNotionClient', async () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      mockClientInstance.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: { title: { title: [] } },
        url: 'https://notion.so/page',
      });
      mockClientInstance.blocks.children.list.mockResolvedValue({ results: [] });

      await getPageWithPreview('token', 'page-123', logger);

      // Verify Client was called with options including fetch (meaning logger was used)
      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: 'token',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          fetch: expect.any(Function),
        })
      );
    });
  });
});
