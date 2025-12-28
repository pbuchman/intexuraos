import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to ensure mock functions are available before vi.mock is hoisted
const {
  mockUsersMe,
  mockPagesRetrieve,
  mockBlocksChildrenList,
  mockIsNotionClientError,
  capturedState,
} = vi.hoisted(() => ({
  mockUsersMe: vi.fn(),
  mockPagesRetrieve: vi.fn(),
  mockBlocksChildrenList: vi.fn(),
  mockIsNotionClientError: vi.fn(),
  capturedState: {
    fetch: null as ((url: string | URL | Request, init?: RequestInit) => Promise<Response>) | null,
    options: null as { auth?: string; logLevel?: string; fetch?: unknown } | null,
  },
}));

// Define APIErrorCode values for use in tests (these match the mock)
const APIErrorCode = {
  Unauthorized: 'unauthorized',
  ObjectNotFound: 'object_not_found',
  RateLimited: 'rate_limited',
  ValidationError: 'validation_error',
  InvalidJSON: 'invalid_json',
};

// Mock the entire @notionhq/client module with factory pattern
vi.mock('@notionhq/client', () => {
  class MockClient {
    users = { me: mockUsersMe };
    pages = { retrieve: mockPagesRetrieve };
    blocks = { children: { list: mockBlocksChildrenList } };

    constructor(options?: { auth?: string; logLevel?: string; fetch?: unknown }) {
      capturedState.options = options ?? null;
      if (options?.fetch !== undefined) {
        capturedState.fetch = options.fetch as (
          url: string | URL | Request,
          init?: RequestInit
        ) => Promise<Response>;
      }
    }
  }

  return {
    Client: MockClient,
    isNotionClientError: mockIsNotionClientError,
    APIErrorCode: {
      Unauthorized: 'unauthorized',
      ObjectNotFound: 'object_not_found',
      RateLimited: 'rate_limited',
      ValidationError: 'validation_error',
      InvalidJSON: 'invalid_json',
    },
    LogLevel: {
      DEBUG: 'debug',
    },
  };
});

// Import after mock is set up
import {
  mapNotionError,
  createNotionClient,
  validateNotionToken,
  getPageWithPreview,
  extractPageTitle,
  type NotionLogger,
} from '../notion.js';

describe('notion utilities', () => {
  beforeEach(() => {
    mockUsersMe.mockReset();
    mockPagesRetrieve.mockReset();
    mockBlocksChildrenList.mockReset();
    mockIsNotionClientError.mockReset();
    mockIsNotionClientError.mockReturnValue(false);
    capturedState.fetch = null;
    capturedState.options = null;
  });

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

    describe('with NotionClientError', () => {
      it('maps Unauthorized error code', () => {
        const notionError = { code: APIErrorCode.Unauthorized, message: 'Invalid token' };
        mockIsNotionClientError.mockReturnValue(true);

        const result = mapNotionError(notionError);

        expect(result.code).toBe('UNAUTHORIZED');
        expect(result.message).toBe('Invalid token');
      });

      it('maps ObjectNotFound error code', () => {
        const notionError = { code: APIErrorCode.ObjectNotFound, message: 'Page not found' };
        mockIsNotionClientError.mockReturnValue(true);

        const result = mapNotionError(notionError);

        expect(result.code).toBe('NOT_FOUND');
        expect(result.message).toBe('Page not found');
      });

      it('maps RateLimited error code', () => {
        const notionError = { code: APIErrorCode.RateLimited, message: 'Too many requests' };
        mockIsNotionClientError.mockReturnValue(true);

        const result = mapNotionError(notionError);

        expect(result.code).toBe('RATE_LIMITED');
        expect(result.message).toBe('Too many requests');
      });

      it('maps ValidationError error code', () => {
        const notionError = { code: APIErrorCode.ValidationError, message: 'Invalid input' };
        mockIsNotionClientError.mockReturnValue(true);

        const result = mapNotionError(notionError);

        expect(result.code).toBe('VALIDATION_ERROR');
        expect(result.message).toBe('Invalid input');
      });

      it('maps InvalidJSON error code', () => {
        const notionError = { code: APIErrorCode.InvalidJSON, message: 'Malformed JSON' };
        mockIsNotionClientError.mockReturnValue(true);

        const result = mapNotionError(notionError);

        expect(result.code).toBe('VALIDATION_ERROR');
        expect(result.message).toBe('Malformed JSON');
      });

      it('maps unknown Notion error codes to INTERNAL_ERROR', () => {
        const notionError = { code: 'unknown_error_code', message: 'Something unexpected' };
        mockIsNotionClientError.mockReturnValue(true);

        const result = mapNotionError(notionError);

        expect(result.code).toBe('INTERNAL_ERROR');
        expect(result.message).toBe('Something unexpected');
      });
    });
  });

  describe('createNotionClient', () => {
    it('creates a Notion client without logger', () => {
      const client = createNotionClient('test-token');
      expect(client).toBeDefined();
    });
    it('creates a Notion client with logger', () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const client = createNotionClient('test-token', logger);
      expect(client).toBeDefined();
    });
  });

  describe('validateNotionToken', () => {
    it('returns true when token is valid', async () => {
      mockUsersMe.mockResolvedValue({ object: 'user', id: 'user-123' });

      const result = await validateNotionToken('valid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns error when API call fails', async () => {
      mockUsersMe.mockRejectedValue(new Error('Network error'));

      const result = await validateNotionToken('invalid-token');

      // Generic errors map to INTERNAL_ERROR, which is not UNAUTHORIZED
      // so validateNotionToken returns error (not ok(false))
      expect(result.ok).toBe(false);
    });

    it('returns ok(false) when token is unauthorized', async () => {
      const unauthorizedError = { code: APIErrorCode.Unauthorized, message: 'Invalid token' };
      mockIsNotionClientError.mockReturnValue(true);
      mockUsersMe.mockRejectedValue(unauthorizedError);

      const result = await validateNotionToken('invalid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('getPageWithPreview', () => {
    it('returns page with title and blocks', async () => {
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: {
          title: {
            title: [{ plain_text: 'My Page Title' }],
          },
        },
      });

      mockBlocksChildrenList.mockResolvedValue({
        results: [
          {
            type: 'paragraph',
            paragraph: {
              rich_text: [{ plain_text: 'First paragraph content' }],
            },
          },
          {
            type: 'heading_1',
            heading_1: {
              rich_text: [{ plain_text: 'A heading' }],
            },
          },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('page-123');
        expect(result.value.title).toBe('My Page Title');
        expect(result.value.url).toBe('https://notion.so/page-123');
        expect(result.value.blocks).toHaveLength(2);
        expect(result.value.blocks[0]?.type).toBe('paragraph');
        expect(result.value.blocks[0]?.content).toBe('First paragraph content');
      }
    });

    it('handles page with no title property', async () => {
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: {},
      });

      mockBlocksChildrenList.mockResolvedValue({ results: [] });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Untitled');
      }
    });

    it('returns error when API fails', async () => {
      mockPagesRetrieve.mockRejectedValue(new Error('Page not found'));

      const result = await getPageWithPreview('token', 'nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Page not found');
      }
    });

    it('returns error when page response has no properties', async () => {
      // Simulate a partial response (e.g., PartialBlockObjectResponse or PartialDatabaseObjectResponse)
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        // No 'properties' key
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Unexpected page response format');
      }
    });

    it('generates fallback URL when url is not in response', async () => {
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        properties: { title: { title: [] } },
        // No 'url' key
      });

      mockBlocksChildrenList.mockResolvedValue({ results: [] });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/page-123');
      }
    });

    it('handles blocks without type property', async () => {
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: {},
      });

      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { id: 'partial-block' }, // PartialBlockObjectResponse without 'type'
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Content' }] },
          },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only the block with 'type' should be included
        expect(result.value.blocks).toHaveLength(1);
        expect(result.value.blocks[0]?.type).toBe('paragraph');
      }
    });

    it('handles blocks without rich_text', async () => {
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: {},
      });

      mockBlocksChildrenList.mockResolvedValue({
        results: [
          {
            type: 'divider',
            divider: {}, // No rich_text
          },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.blocks).toHaveLength(1);
        expect(result.value.blocks[0]?.type).toBe('divider');
        expect(result.value.blocks[0]?.content).toBe('');
      }
    });

    it('handles rich_text items without plain_text', async () => {
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: {},
      });

      mockBlocksChildrenList.mockResolvedValue({
        results: [
          {
            type: 'paragraph',
            paragraph: {
              rich_text: [
                { plain_text: 'Hello' },
                {}, // No plain_text
                { plain_text: 'World' },
              ],
            },
          },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.blocks[0]?.content).toBe('HelloWorld');
      }
    });
  });

  describe('extractPageTitle', () => {
    it('extracts title from "title" property', () => {
      const properties = {
        title: { title: [{ plain_text: 'My Title' }] },
      };
      expect(extractPageTitle(properties)).toBe('My Title');
    });

    it('extracts title from "Title" property', () => {
      const properties = {
        Title: { title: [{ plain_text: 'My Title' }] },
      };
      expect(extractPageTitle(properties)).toBe('My Title');
    });

    it('extracts title from "Name" property', () => {
      const properties = {
        Name: { title: [{ plain_text: 'My Name' }] },
      };
      expect(extractPageTitle(properties)).toBe('My Name');
    });

    it('extracts title from "name" property', () => {
      const properties = {
        name: { title: [{ plain_text: 'My name' }] },
      };
      expect(extractPageTitle(properties)).toBe('My name');
    });

    it('returns Untitled for empty properties', () => {
      expect(extractPageTitle({})).toBe('Untitled');
    });

    it('returns Untitled when title property is null', () => {
      const properties = { title: null };
      expect(extractPageTitle(properties as Record<string, unknown>)).toBe('Untitled');
    });

    it('returns Untitled when title property is not an object', () => {
      const properties = { title: 'string value' };
      expect(extractPageTitle(properties as Record<string, unknown>)).toBe('Untitled');
    });

    it('returns Untitled when title array is not present', () => {
      const properties = { title: { notTitle: [] } };
      expect(extractPageTitle(properties as Record<string, unknown>)).toBe('Untitled');
    });

    it('returns Untitled when title array is not an array', () => {
      const properties = { title: { title: 'not an array' } };
      expect(extractPageTitle(properties as Record<string, unknown>)).toBe('Untitled');
    });

    it('handles title items without plain_text', () => {
      const properties = {
        title: { title: [{ plain_text: 'Hello' }, {}, { plain_text: 'World' }] },
      };
      expect(extractPageTitle(properties)).toBe('HelloWorld');
    });

    it('concatenates multiple title segments', () => {
      const properties = {
        title: {
          title: [{ plain_text: 'Part 1' }, { plain_text: ' - ' }, { plain_text: 'Part 2' }],
        },
      };
      expect(extractPageTitle(properties)).toBe('Part 1 - Part 2');
    });

    it('prefers "title" over "Title"', () => {
      const properties = {
        title: { title: [{ plain_text: 'lowercase title' }] },
        Title: { title: [{ plain_text: 'Uppercase Title' }] },
      };
      expect(extractPageTitle(properties)).toBe('lowercase title');
    });
  });

  describe('createLoggingFetch', () => {
    let mockGlobalFetch: ReturnType<typeof vi.fn>;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      mockGlobalFetch = vi.fn();
      globalThis.fetch = mockGlobalFetch as typeof globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function createMockResponse(options: {
      ok?: boolean;
      status?: number;
      text?: string;
      textError?: boolean;
    }): Response {
      const response = {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        clone: vi.fn(),
      } as unknown as Response;

      // Set up clone to return a response that can be read
      const clonedResponse = {
        text:
          options.textError === true
            ? vi.fn().mockRejectedValue(new Error('Read error'))
            : vi.fn().mockResolvedValue(options.text ?? ''),
      };
      (response.clone as ReturnType<typeof vi.fn>).mockReturnValue(clonedResponse);

      return response;
    }

    it('logs request with string URL', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      expect(capturedState.fetch).not.toBeNull();

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/users/me', { method: 'GET' });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          method: 'GET',
          url: 'https://api.notion.com/v1/users/me',
        })
      );
    });

    it('logs request with URL object', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const url = new URL('https://api.notion.com/v1/pages');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!(url, { method: 'POST' });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          method: 'POST',
          url: 'https://api.notion.com/v1/pages',
        })
      );
    });

    it('logs request with Request object', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const request = new Request('https://api.notion.com/v1/blocks');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!(request, { method: 'GET' });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          url: 'https://api.notion.com/v1/blocks',
        })
      );
    });

    it('uses GET as default method', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/users/me');

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('handles Headers object in request', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Authorization', 'Bearer secret_1234567890abcdef');

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/users/me', { method: 'GET', headers });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          headers: expect.objectContaining({
            'content-type': 'application/json',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            authorization: expect.stringContaining('...[REDACTED]'),
          }),
        })
      );
    });

    it('handles array headers in request', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const headers: [string, string][] = [
        ['Content-Type', 'application/json'],
        ['X-Custom', 'value'],
      ];

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/users/me', { method: 'GET', headers });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Custom': 'value',
          }),
        })
      );
    });

    it('handles plain object headers in request', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_token_12345678901234567890',
      };

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/users/me', { method: 'GET', headers });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            // First 20 chars of 'Bearer test_token_12345678901234567890' = 'Bearer test_token_12'
            Authorization: 'Bearer test_token_12...[REDACTED]',
          }),
        })
      );
    });

    it('calculates body length for string body', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const body = '{"key": "value"}';
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/pages', { method: 'POST', body });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          bodyLength: 16,
        })
      );
    });

    it('calculates body length for ArrayBuffer body', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const body = new ArrayBuffer(42);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/pages', { method: 'POST', body });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          bodyLength: 42,
        })
      );
    });

    it('handles undefined body', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true }));

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/pages', { method: 'GET' });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API request',
        expect.objectContaining({
          bodyLength: 0,
        })
      );
    });

    it('logs successful response', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200 }));

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/users/me', { method: 'GET' });

      expect(logger.info).toHaveBeenCalledWith(
        'Notion API response',
        expect.objectContaining({
          status: 200,
          method: 'GET',
          url: 'https://api.notion.com/v1/users/me',
        })
      );
    });

    it('logs error response with body preview', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 400,
          text: '{"error": "Bad request"}',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/pages', { method: 'POST' });

      expect(logger.warn).toHaveBeenCalledWith(
        'Notion API error response',
        expect.objectContaining({
          status: 400,
          body: '{"error": "Bad request"}',
        })
      );
    });

    it('truncates long response body in error log', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      const longText = 'x'.repeat(600);
      mockGlobalFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          text: longText,
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/pages', { method: 'POST' });

      expect(logger.warn).toHaveBeenCalledWith(
        'Notion API error response',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          body: expect.stringContaining('...[TRUNCATED]'),
        })
      );
    });

    it('handles response body read failure', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      mockGlobalFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          textError: true,
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedState.fetch!('https://api.notion.com/v1/pages', { method: 'POST' });

      expect(logger.warn).toHaveBeenCalledWith(
        'Notion API error response',
        expect.objectContaining({
          body: '[unable to read response body]',
        })
      );
    });

    it('logs and rethrows network errors', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      const networkError = new Error('Network failure');
      mockGlobalFetch.mockRejectedValue(networkError);

      // Ensure fetch is defined before using
      if (capturedState.fetch === null) {
        throw new Error('Expected capturedState.fetch to be defined');
      }

      await expect(
        capturedState.fetch('https://api.notion.com/v1/users/me', { method: 'GET' })
      ).rejects.toThrow('Network failure');

      expect(logger.error).toHaveBeenCalledWith(
        'Notion API network error',
        expect.objectContaining({
          method: 'GET',
          url: 'https://api.notion.com/v1/users/me',
          error: 'Network failure',
        })
      );
    });

    it('returns the original response', async () => {
      const logger: NotionLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      createNotionClient('token', logger);

      const mockResponse = createMockResponse({ ok: true, status: 200 });
      mockGlobalFetch.mockResolvedValue(mockResponse);

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const response = await capturedState.fetch!('https://api.notion.com/v1/users/me', {
        method: 'GET',
      });

      expect(response).toBe(mockResponse);
    });

    it('does not set fetch when no logger provided', () => {
      capturedState.fetch = null;
      capturedState.options = null;

      createNotionClient('token');

      expect(capturedState.fetch).toBeNull();
      // The mock sets capturedState.options when Client is constructed
      // TypeScript doesn't track mutations from createNotionClient, so we need to cast
      interface CapturedOptions {
        auth?: string;
        logLevel?: string;
        fetch?: unknown;
      }
      const opts = capturedState.options as CapturedOptions | null;
      expect(opts).not.toBeNull();
      // Verify fetch is not set when no logger provided
      if (opts !== null) {
        expect(opts.fetch).toBeUndefined();
      }
    });
  });
});
