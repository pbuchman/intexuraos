/**
 * Tests for NotionResearchExporter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@notionhq/client';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { exportResearchToNotion } from '../../../infra/notion/notionResearchExporter.js';
import type { Research } from '../../../domain/research/models/Research.js';

// Mock the @intexuraos/infra-notion package
vi.mock('@intexuraos/infra-notion', () => ({
  createNotionClient: vi.fn(() => mockClient),
  mapNotionError: vi.fn((error) => ({
    code: error.code || 'INTERNAL_ERROR',
    message: error.message || 'Unknown error',
  })),
  extractPageTitle: vi.fn(() => 'Test Page'),
}));

const mockClient = {
  pages: {
    create: vi.fn(),
    update: vi.fn(),
  },
  blocks: {
    children: {
      list: vi.fn(),
      append: vi.fn(),
    },
  },
} as unknown as Client;

describe('exportResearchToNotion', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockNotionToken = 'test-token';
  const mockTargetPageId = 'target-page-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create a valid Research model - use Partial to allow overriding synthesizedResult
  const createMockResearch = (overrides: Partial<Omit<Research, 'synthesizedResult'>> & { synthesizedResult?: string } = {}): Research => {
    const base: Research = {
      id: 'research-123',
      userId: 'user-123',
      title: 'Test Research',
      prompt: 'Test prompt',
      selectedModels: [LlmModels.GPT52],
      synthesisModel: LlmModels.GPT52,
      status: 'completed',
      llmResults: [],
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T01:00:00Z',
      synthesizedResult: '# Test Result\n\nThis is a test synthesis.',
    };

    // Handle synthesizedResult separately for exactOptionalPropertyTypes
    const { synthesizedResult, ...otherOverrides } = overrides;
    const result = { ...base, ...otherOverrides };
    if (synthesizedResult !== undefined) {
      (result as Research & { synthesizedResult: string }).synthesizedResult = synthesizedResult;
    }
    return result;
  };

  describe('successful export', () => {
    it('creates main research page with synthesis', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);
      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
        url: 'https://notion.so/main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis result.',
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mainPageId).toBe('main-page-123');
        expect(result.value.mainPageUrl).toBe('https://notion.so/main-page-123');
        expect(result.value.llmReportPages).toHaveLength(0);
      }

      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
      const createCall = mockPagesCreate.mock.calls[0];
      if (createCall === undefined) {
        throw new Error('createCall is undefined');
      }
      expect(createCall[0]).toEqual({
        parent: { page_id: mockTargetPageId },
        properties: {
          title: { title: [{ text: { content: 'Test Research' } }] },
        },
        children: [
          { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Synthesis' } }] } },
          { object: 'block', type: 'code', code: { rich_text: [{ type: 'text', text: { content: 'Test synthesis result.' } }], language: 'markdown' } },
          { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Sources' } }] } },
        ],
      });
    });

    it('creates child pages for completed LLM results', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);
      const mockBlocksAppend = vi.mocked(mockClient.blocks.children.append);

      mockPagesCreate
        .mockResolvedValueOnce({
          id: 'main-page-123',
          url: 'https://notion.so/main-page-123',
        } as never)
        .mockResolvedValueOnce({
          id: 'llm-page-123',
          url: 'https://notion.so/llm-page-123',
        } as never)
        .mockResolvedValueOnce({
          id: 'llm-page-456',
          url: 'https://notion.so/llm-page-456',
        } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        llmResults: [
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.GPT52,
            status: 'completed',
            result: 'GPT result here.',
            sources: ['https://example.com/1'],
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:05:00Z',
          },
          {
            provider: LlmProviders.Anthropic,
            model: LlmModels.ClaudeOpus45,
            status: 'completed',
            result: 'Claude result here.',
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:05:00Z',
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.GPT52,
            status: 'failed',
            error: 'API error',
            startedAt: '2024-01-01T00:00:00Z',
          },
        ],
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.llmReportPages).toHaveLength(2);
        expect(result.value.llmReportPages[0]?.model).toBe(LlmModels.GPT52);
        expect(result.value.llmReportPages[1]?.model).toBe(LlmModels.ClaudeOpus45);
      }

      // Main page + 2 LLM report pages created
      expect(mockPagesCreate).toHaveBeenCalledTimes(3);

      // Source links appended
      expect(mockBlocksAppend).toHaveBeenCalledTimes(1);
    });

    it('includes sources section in LLM report when sources exist', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate
        .mockResolvedValueOnce({
          id: 'main-page-123',
        } as never)
        .mockResolvedValueOnce({
          id: 'llm-page-123',
        } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        llmResults: [
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.GPT52,
            status: 'completed',
            result: 'Result content.',
            sources: ['https://example.com/1', 'https://example.com/2'],
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:05:00Z',
          },
        ],
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const llmPageCall = mockPagesCreate.mock.calls[1];
      if (llmPageCall === undefined) {
        throw new Error('llmPageCall is undefined');
      }
      const children = llmPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }

      // Should have Response heading, code block, and Sources heading + list items
      expect(children).toHaveLength(5);
      expect(children[0]).toEqual({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Response' } }] } });
      expect(children[1]).toEqual({ object: 'block', type: 'code', code: { rich_text: [{ type: 'text', text: { content: 'Result content.' } }], language: 'markdown' } });
      expect(children[2]).toEqual({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Sources' } }] } });
      expect(children[3]).toEqual({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            { type: 'text', text: { content: 'Source: ' } },
            { type: 'text', text: { content: 'https://example.com/1', link: { url: 'https://example.com/1' } } },
          ],
        },
      });
    });

    it('chunks large content into multiple code blocks', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const longContent = 'A'.repeat(4000); // Exceeds MAX_CHUNK_SIZE
      const research = createMockResearch({
        synthesizedResult: longContent,
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const mainPageCall = mockPagesCreate.mock.calls[0];
      if (mainPageCall === undefined) {
        throw new Error('mainPageCall is undefined');
      }
      const children = mainPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }

      // Should have heading + multiple code blocks + sources heading
      const codeBlocks = children.filter((b: unknown) => (b as { type: string }).type === 'code');
      expect(codeBlocks.length).toBeGreaterThan(1);
    });
  });

  describe('content filtering', () => {
    it('strips <details> tags from synthesis content', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const contentWithDetails = `
        Visible content

        <details>
          <summary>Hidden content</summary>
          This should be removed.
        </details>

        More visible content
      `;

      const research = createMockResearch({
        synthesizedResult: contentWithDetails,
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const mainPageCall = mockPagesCreate.mock.calls[0];
      if (mainPageCall === undefined) {
        throw new Error('mainPageCall is undefined');
      }
      const children = mainPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }
      const codeBlock = children.find((b: unknown) => (b as { type: string }).type === 'code');
      if (codeBlock === undefined) {
        throw new Error('codeBlock is undefined');
      }

      // Use unknown to safely narrow to the expected block type
      const codeBlockWithType = codeBlock as unknown as { code: { rich_text: { text: { content: string } }[] } };
      const blockContent = codeBlockWithType.code.rich_text[0]?.text.content ?? '';
      expect(blockContent).not.toContain('<details>');
      expect(blockContent).toContain('Visible content');
      expect(blockContent).toContain('More visible content');
    });

    it('strips <details> tags from LLM result content', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate
        .mockResolvedValueOnce({
          id: 'main-page-123',
        } as never)
        .mockResolvedValueOnce({
          id: 'llm-page-123',
        } as never);

      const resultWithDetails = `
        Answer here

        <details>
          <summary>Thinking process</summary>
          This should be removed.
        </details>

        More answer
      `;

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        llmResults: [
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.GPT52,
            status: 'completed',
            result: resultWithDetails,
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:05:00Z',
          },
        ],
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const llmPageCall = mockPagesCreate.mock.calls[1];
      if (llmPageCall === undefined) {
        throw new Error('llmPageCall is undefined');
      }
      const children = llmPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }
      const codeBlock = children.find((b: unknown) => (b as { type: string }).type === 'code');
      if (codeBlock === undefined) {
        throw new Error('codeBlock is undefined');
      }

      // Use unknown to safely narrow to the expected block type
      const codeBlockWithType = codeBlock as unknown as { code: { rich_text: { text: { content: string } }[] } };
      const blockContent = codeBlockWithType.code.rich_text[0]?.text.content ?? '';
      expect(blockContent).not.toContain('<details>');
      expect(blockContent).toContain('Answer here');
      expect(blockContent).toContain('More answer');
    });
  });

  describe('error handling', () => {
    it('returns error when synthesis is not completed', async () => {
      // Create research without synthesizedResult - use type assertion to bypass exactOptionalPropertyTypes for test
      const research: Omit<Research, 'synthesizedResult'> & { synthesizedResult?: string } = {
        id: 'research-123',
        userId: 'user-123',
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.GPT52],
        synthesisModel: LlmModels.GPT52,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
      };
      // Explicitly omit synthesizedResult
      const { synthesizedResult: _, ...researchWithoutSynthesis } = research;

      const result = await exportResearchToNotion(
        researchWithoutSynthesis as Research,
        mockNotionToken,
        mockTargetPageId,
        mockLogger
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('not completed');
      }
    });

    it('returns error when synthesis is empty string', async () => {
      const research = createMockResearch({
        synthesizedResult: '',
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('maps NOT_FOUND errors correctly', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      const { mapNotionError } = await import('@intexuraos/infra-notion');
      vi.mocked(mapNotionError).mockReturnValueOnce({
        code: 'NOT_FOUND',
        message: 'Page not found',
      });

      mockPagesCreate.mockRejectedValueOnce({ code: 'NOT_FOUND', message: 'Not found' });

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('maps UNAUTHORIZED errors correctly', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      const { mapNotionError } = await import('@intexuraos/infra-notion');
      vi.mocked(mapNotionError).mockReturnValueOnce({
        code: 'UNAUTHORIZED',
        message: 'Invalid token',
      });

      mockPagesCreate.mockRejectedValueOnce({ code: 'UNAUTHORIZED', message: 'Unauthorized' });

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('maps RATE_LIMITED errors correctly', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      const { mapNotionError } = await import('@intexuraos/infra-notion');
      vi.mocked(mapNotionError).mockReturnValueOnce({
        code: 'RATE_LIMITED',
        message: 'Rate limited',
      });

      mockPagesCreate.mockRejectedValueOnce({ code: 'RATE_LIMITED', message: 'Too many requests' });

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('maps unknown errors to INTERNAL_ERROR', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      const { mapNotionError } = await import('@intexuraos/infra-notion');
      vi.mocked(mapNotionError).mockReturnValueOnce({
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
      });

      mockPagesCreate.mockRejectedValueOnce(new Error('Unknown error'));

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('cover image handling', () => {
    beforeEach(() => {
      // Set up the environment variable for image public base URL
      process.env['INTEXURAOS_IMAGE_PUBLIC_BASE_URL'] = 'https://example.intexuraos.com';
    });

    afterEach(() => {
      delete process.env['INTEXURAOS_IMAGE_PUBLIC_BASE_URL'];
    });

    it('adds image block when research has coverImageId', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        shareInfo: {
          shareToken: 'token-123',
          slug: 'test-slug',
          shareUrl: 'https://example.com/share/test-slug',
          sharedAt: '2024-01-01T00:00:00Z',
          gcsPath: 'shares/test-slug.html',
          coverImageId: 'cover-abc-123',
        },
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const mainPageCall = mockPagesCreate.mock.calls[0];
      if (mainPageCall === undefined) {
        throw new Error('mainPageCall is undefined');
      }
      const children = mainPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }

      // Should have image block, then synthesis heading
      expect(children[0]).toEqual({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: { url: 'https://example.intexuraos.com/images/cover-abc-123/full.png' },
        },
      });
      expect(children[1]).toEqual({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Synthesis' } }] },
      });
    });

    it('does not add image block when shareInfo is undefined', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        // shareInfo undefined
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const mainPageCall = mockPagesCreate.mock.calls[0];
      if (mainPageCall === undefined) {
        throw new Error('mainPageCall is undefined');
      }
      const children = mainPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }

      // First child should be synthesis heading, not image
      expect(children[0]).toEqual({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Synthesis' } }] },
      });
    });

    it('does not add image block when coverImageId is undefined', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        shareInfo: {
          shareToken: 'token-123',
          slug: 'test-slug',
          shareUrl: 'https://example.com/share/test-slug',
          sharedAt: '2024-01-01T00:00:00Z',
          gcsPath: 'shares/test-slug.html',
          // coverImageId undefined
        },
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const mainPageCall = mockPagesCreate.mock.calls[0];
      if (mainPageCall === undefined) {
        throw new Error('mainPageCall is undefined');
      }
      const children = mainPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }

      // First child should be synthesis heading, not image
      expect(children[0]).toEqual({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Synthesis' } }] },
      });
    });

    it('does not add image block when coverImageId is empty string', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        shareInfo: {
          shareToken: 'token-123',
          slug: 'test-slug',
          shareUrl: 'https://example.com/share/test-slug',
          sharedAt: '2024-01-01T00:00:00Z',
          gcsPath: 'shares/test-slug.html',
          coverImageId: '',
        },
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const mainPageCall = mockPagesCreate.mock.calls[0];
      if (mainPageCall === undefined) {
        throw new Error('mainPageCall is undefined');
      }
      const children = mainPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }

      // First child should be synthesis heading, not image
      expect(children[0]).toEqual({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Synthesis' } }] },
      });
    });

    it('does not add image block when coverImageId is whitespace only', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        shareInfo: {
          shareToken: 'token-123',
          slug: 'test-slug',
          shareUrl: 'https://example.com/share/test-slug',
          sharedAt: '2024-01-01T00:00:00Z',
          gcsPath: 'shares/test-slug.html',
          coverImageId: '   ',
        },
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const mainPageCall = mockPagesCreate.mock.calls[0];
      if (mainPageCall === undefined) {
        throw new Error('mainPageCall is undefined');
      }
      const children = mainPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }

      // First child should be synthesis heading, not image
      expect(children[0]).toEqual({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: 'Synthesis' } }] },
      });
    });

    it('logs info when including cover image', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        shareInfo: {
          shareToken: 'token-123',
          slug: 'test-slug',
          shareUrl: 'https://example.com/share/test-slug',
          sharedAt: '2024-01-01T00:00:00Z',
          gcsPath: 'shares/test-slug.html',
          coverImageId: 'cover-xyz-789',
        },
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Including cover image in Notion export',
        {
          coverImageId: 'cover-xyz-789',
          coverImageUrl: 'https://example.intexuraos.com/images/cover-xyz-789/full.png',
        }
      );
    });

    it('throws error when INTEXURAOS_IMAGE_PUBLIC_BASE_URL is not set', async () => {
      // Clear the env var to test error behavior
      delete process.env['INTEXURAOS_IMAGE_PUBLIC_BASE_URL'];

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        shareInfo: {
          shareToken: 'token-123',
          slug: 'test-slug',
          shareUrl: 'https://example.com/share/test-slug',
          sharedAt: '2024-01-01T00:00:00Z',
          gcsPath: 'shares/test-slug.html',
          coverImageId: 'cover-def-456',
        },
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('INTEXURAOS_IMAGE_PUBLIC_BASE_URL');
      }
    });
  });

  describe('edge cases', () => {
    it('handles research with no completed LLM results', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);
      const mockBlocksAppend = vi.mocked(mockClient.blocks.children.append);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        llmResults: [
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.GPT52,
            status: 'failed',
            error: 'Failed',
            startedAt: '2024-01-01T00:00:00Z',
          },
        ],
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.llmReportPages).toHaveLength(0);
      }

      // No blocks appended since no LLM reports
      expect(mockBlocksAppend).not.toHaveBeenCalled();
    });

    it('handles empty LLM result gracefully', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate
        .mockResolvedValueOnce({
          id: 'main-page-123',
        } as never)
        .mockResolvedValueOnce({
          id: 'llm-page-123',
        } as never);

      // Omit 'result' property from LlmResult
      const llmResultWithoutResult: Omit<{ provider: typeof LlmProviders.OpenAI; model: typeof LlmModels.GPT52; status: 'completed'; result: string; startedAt: string; completedAt: string }, 'result'> = {
        provider: LlmProviders.OpenAI,
        model: LlmModels.GPT52,
        status: 'completed',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:05:00Z',
      };

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        llmResults: [llmResultWithoutResult as typeof llmResultWithoutResult & { result?: string }],
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);

      const llmPageCall = mockPagesCreate.mock.calls[1];
      if (llmPageCall === undefined) {
        throw new Error('llmPageCall is undefined');
      }
      const children = llmPageCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }

      // Should only have heading, no code blocks
      expect(children).toHaveLength(1);
      expect(children[0]).toEqual({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Response' } }] } });
    });

    it('uses default title when research title is empty', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const research = createMockResearch({
        title: '',
        synthesizedResult: 'Test synthesis.',
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      const mainPageCall = mockPagesCreate.mock.calls[0];
      if (mainPageCall === undefined) {
        throw new Error('mainPageCall is undefined');
      }
      const properties = mainPageCall[0].properties;
      if (properties === undefined) {
        throw new Error('properties is undefined');
      }
      expect(properties['title']).toEqual({
        title: [{ text: { content: 'Research' } }],
      });
    });

    it('generates page URL when url is not in response', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
        // No url property
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mainPageUrl).toBe('https://notion.so/main-page-123');
      }
    });
  });
});
