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
      selectedModels: [LlmModels.GPT54],
      synthesisModel: LlmModels.GPT54,
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
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Test synthesis result.' } }] } },
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
            model: LlmModels.GPT54,
            status: 'completed',
            result: 'GPT result here.',
            sources: ['https://example.com/1'],
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:05:00Z',
          },
          {
            provider: LlmProviders.Anthropic,
            model: LlmModels.ClaudeOpus46,
            status: 'completed',
            result: 'Claude result here.',
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:05:00Z',
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.GPT54,
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
        expect(result.value.llmReportPages[0]?.model).toBe(LlmModels.GPT54);
        expect(result.value.llmReportPages[1]?.model).toBe(LlmModels.ClaudeOpus46);
      }

      // Main page + 2 LLM report pages created
      expect(mockPagesCreate).toHaveBeenCalledTimes(3);

      // Source links are NOT appended as separate blocks - child pages appear as document references automatically
      expect(mockBlocksAppend).not.toHaveBeenCalled();
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
            model: LlmModels.GPT54,
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

      // Should have Response heading, paragraph block, and Sources heading + list items
      expect(children).toHaveLength(5);
      expect(children[0]).toEqual({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Response' } }] } });
      expect(children[1]).toEqual({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Result content.' } }] } });
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

      // Should have heading + multiple paragraph blocks + sources heading
      const paragraphBlocks = children.filter((b: unknown) => (b as { type: string }).type === 'paragraph');
      expect(paragraphBlocks.length).toBeGreaterThan(1);
    });
  });

  describe('content filtering', () => {
    it('strips attribution lines from synthesis content', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
      } as never);

      const contentWithAttribution = `
## Section One

Content here.

Attribution: Primary=S1,S2; Secondary=; Constraints=; UNK=false

## Section Two

More content.

Attribution: Primary=S3; Secondary=U1; Constraints=; UNK=true
      `;

      const research = createMockResearch({
        synthesizedResult: contentWithAttribution,
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

      // Collect all content from paragraphs
      const allContent = children
        .filter((b: unknown) => (b as { type: string }).type === 'paragraph')
        .map((b: unknown) => {
          const block = b as { paragraph: { rich_text: { text: { content: string } }[] } };
          return block.paragraph.rich_text[0]?.text.content ?? '';
        })
        .join(' ');

      // Should not contain Attribution lines
      expect(allContent).not.toContain('Attribution:');
      expect(allContent).not.toContain('Primary=');
      expect(allContent).toContain('Content here');
      expect(allContent).toContain('More content');
    });

    it('strips attribution lines from LLM result content', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);

      mockPagesCreate
        .mockResolvedValueOnce({
          id: 'main-page-123',
        } as never)
        .mockResolvedValueOnce({
          id: 'llm-page-123',
        } as never);

      const llmResultWithAttribution = `
## Analysis

Analysis content here.

Attribution: Primary=S1; Secondary=; Constraints=; UNK=false
      `;

      const research = createMockResearch({
        synthesizedResult: 'Test synthesis.',
        llmResults: [
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.GPT54,
            status: 'completed',
            result: llmResultWithAttribution,
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

      // Collect all content from paragraphs
      const allContent = children
        .filter((b: unknown) => (b as { type: string }).type === 'paragraph')
        .map((b: unknown) => {
          const block = b as { paragraph: { rich_text: { text: { content: string } }[] } };
          return block.paragraph.rich_text[0]?.text.content ?? '';
        })
        .join(' ');

      // Should not contain Attribution lines
      expect(allContent).not.toContain('Attribution:');
      expect(allContent).toContain('Analysis content here');
    });

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
      const paragraphBlocks = children.filter((b: unknown) => (b as { type: string }).type === 'paragraph');
      expect(paragraphBlocks.length).toBeGreaterThan(0);

      // Check all paragraph content combined doesn't contain details tags
      const allContent = paragraphBlocks
        .map((b: unknown) => {
          const block = b as { paragraph: { rich_text: { text: { content: string } }[] } };
          return block.paragraph.rich_text[0]?.text.content ?? '';
        })
        .join(' ');
      expect(allContent).not.toContain('<details>');
      expect(allContent).toContain('Visible content');
      expect(allContent).toContain('More visible content');
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
            model: LlmModels.GPT54,
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
      const paragraphBlocks = children.filter((b: unknown) => (b as { type: string }).type === 'paragraph');
      expect(paragraphBlocks.length).toBeGreaterThan(0);

      // Check all paragraph content combined doesn't contain details tags
      const allContent = paragraphBlocks
        .map((b: unknown) => {
          const block = b as { paragraph: { rich_text: { text: { content: string } }[] } };
          return block.paragraph.rich_text[0]?.text.content ?? '';
        })
        .join(' ');
      expect(allContent).not.toContain('<details>');
      expect(allContent).toContain('Answer here');
      expect(allContent).toContain('More answer');
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
        selectedModels: [LlmModels.GPT54],
        synthesisModel: LlmModels.GPT54,
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
    it('adds image block when research has coverImageUrl', async () => {
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
          coverImageUrl: 'https://intexuraos.cloud/images/cover-abc-123-my-research-title.png',
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
          external: { url: 'https://intexuraos.cloud/images/cover-abc-123-my-research-title.png' },
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

    it('does not add image block when coverImageUrl is undefined', async () => {
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
          // coverImageUrl undefined
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

    it('does not add image block when coverImageUrl is empty string', async () => {
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
          coverImageUrl: '',
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

    it('does not add image block when coverImageUrl is whitespace only', async () => {
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
          coverImageUrl: '   ',
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
          coverImageUrl: 'https://intexuraos.cloud/images/cover-xyz-789-my-slug.png',
        },
      });

      await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Including cover image in Notion export',
        {
          coverImageUrl: 'https://intexuraos.cloud/images/cover-xyz-789-my-slug.png',
        }
      );
    });

  });

  describe('block batching', () => {
    it('creates page with batched blocks when exceeding 100 block limit', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);
      const mockBlocksAppend = vi.mocked(mockClient.blocks.children.append);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
        url: 'https://notion.so/main-page-123',
      } as never);

      mockBlocksAppend.mockResolvedValue({} as never);

      // Create content that generates more than 100 blocks
      // Each paragraph is one block, plus we have 2 headings (Synthesis, Sources)
      // So we need ~102+ paragraphs to exceed the limit
      const paragraphs = Array.from({ length: 110 }, (_, i) => `Paragraph ${String(i + 1)}.`).join('\n\n');
      const research = createMockResearch({
        synthesizedResult: paragraphs,
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mainPageId).toBe('main-page-123');
      }

      // pages.create should be called with at most 100 blocks
      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
      const createCall = mockPagesCreate.mock.calls[0];
      if (createCall === undefined) {
        throw new Error('createCall is undefined');
      }
      const children = createCall[0].children;
      if (children === undefined) {
        throw new Error('children is undefined');
      }
      expect(children.length).toBeLessThanOrEqual(100);

      // blocks.children.append should be called for remaining blocks
      expect(mockBlocksAppend).toHaveBeenCalled();
      const appendCall = mockBlocksAppend.mock.calls[0];
      if (appendCall === undefined) {
        throw new Error('appendCall is undefined');
      }
      expect(appendCall[0].block_id).toBe('main-page-123');
    });

    it('does not call append when blocks are under 100 limit', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);
      const mockBlocksAppend = vi.mocked(mockClient.blocks.children.append);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
        url: 'https://notion.so/main-page-123',
      } as never);

      const research = createMockResearch({
        synthesizedResult: 'Short content that generates few blocks.',
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);

      // blocks.children.append should NOT be called
      expect(mockBlocksAppend).not.toHaveBeenCalled();
    });

    it('handles multiple append batches for very large content (250+ blocks)', async () => {
      const mockPagesCreate = vi.mocked(mockClient.pages.create);
      const mockBlocksAppend = vi.mocked(mockClient.blocks.children.append);

      mockPagesCreate.mockResolvedValueOnce({
        id: 'main-page-123',
        url: 'https://notion.so/main-page-123',
      } as never);

      mockBlocksAppend.mockResolvedValue({} as never);

      // Create content that generates ~252 blocks (250 paragraphs + 2 headings)
      const paragraphs = Array.from({ length: 250 }, (_, i) => `Paragraph ${String(i + 1)}.`).join('\n\n');
      const research = createMockResearch({
        synthesizedResult: paragraphs,
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);

      // Should call append twice: once for blocks 101-200, once for blocks 201-252
      expect(mockBlocksAppend).toHaveBeenCalledTimes(2);

      // Verify each append call has at most 100 blocks
      for (const call of mockBlocksAppend.mock.calls) {
        if (call === undefined) continue;
        const appendChildren = call[0].children;
        if (appendChildren !== undefined) {
          expect(appendChildren.length).toBeLessThanOrEqual(100);
        }
      }
    });

    it('batches LLM child page blocks when exceeding limit', async () => {
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
        } as never);

      mockBlocksAppend.mockResolvedValue({} as never);

      // Create LLM result with >100 blocks
      const llmParagraphs = Array.from({ length: 110 }, (_, i) => `LLM paragraph ${String(i + 1)}.`).join('\n\n');
      const research = createMockResearch({
        synthesizedResult: 'Short synthesis.',
        llmResults: [
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.GPT54,
            status: 'completed',
            result: llmParagraphs,
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:05:00Z',
          },
        ],
      });

      const result = await exportResearchToNotion(research, mockNotionToken, mockTargetPageId, mockLogger);

      expect(result.ok).toBe(true);

      // Check LLM page create call has at most 100 blocks
      const llmPageCall = mockPagesCreate.mock.calls[1];
      if (llmPageCall === undefined) {
        throw new Error('llmPageCall is undefined');
      }
      const llmChildren = llmPageCall[0].children;
      if (llmChildren === undefined) {
        throw new Error('llmChildren is undefined');
      }
      expect(llmChildren.length).toBeLessThanOrEqual(100);

      // blocks.children.append should be called for LLM page overflow
      const appendCalls = mockBlocksAppend.mock.calls.filter(
        (call) => call !== undefined && call[0].block_id === 'llm-page-123'
      );
      expect(appendCalls.length).toBeGreaterThan(0);
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
            model: LlmModels.GPT54,
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
      const llmResultWithoutResult: Omit<{ provider: typeof LlmProviders.OpenAI; model: typeof LlmModels.GPT54; status: 'completed'; result: string; startedAt: string; completedAt: string }, 'result'> = {
        provider: LlmProviders.OpenAI,
        model: LlmModels.GPT54,
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
