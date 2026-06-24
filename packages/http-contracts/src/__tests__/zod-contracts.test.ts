import { describe, expect, it } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import {
  bookmarksCreateBookmarkRequestSchema,
  imageGenerateImageRequestSchema,
  imageGeneratePromptRequestSchema,
  notionPagePreviewSchema,
  notionTokenContextSchema,
  calendarPreviewSchema,
  commandsCommandWithTextSchema,
  notesCreateNoteRequestSchema,
  researchCreateDraftRequestSchema,
  serviceFeedbackZodSchema,
  webAgentFetchLinkPreviewsRequestSchema,
  webAgentPageSummarySchema,
  webAgentSummarizePageRequestSchema,
} from '../index.js';

describe('Zod contracts', () => {
  it('parses the shared service feedback envelope payload', () => {
    expect(
      serviceFeedbackZodSchema.parse({
        status: 'completed',
        message: 'Created note',
        resourceUrl: 'https://example.com/resource',
      })
    ).toEqual({
      status: 'completed',
      message: 'Created note',
      resourceUrl: 'https://example.com/resource',
    });
  });

  it('rejects unknown fields in request contracts', () => {
    expect(() =>
      notesCreateNoteRequestSchema.parse({
        userId: 'user-1',
        title: 'Title',
        content: 'Body',
        tags: ['tag'],
        source: 'command',
        sourceId: 'source-1',
        extra: true,
      })
    ).toThrow();
  });

  it('accepts nullable optional fields where the current clients do', () => {
    expect(
      notionTokenContextSchema.parse({
        connected: false,
        token: null,
      }).token
    ).toBeNull();
  });

  it('parses commands, research, and calendar payloads', () => {
    expect(
      commandsCommandWithTextSchema.parse({
        id: 'cmd-1',
        text: 'do it',
        sourceType: 'whatsapp',
      }).sourceType
    ).toBe('whatsapp');

    expect(
      researchCreateDraftRequestSchema.parse({
        userId: 'user-1',
        title: 'Research',
        prompt: 'Find sources',
        originalMessage: 'find sources',
      }).prompt
    ).toBe('Find sources');

    expect(
      calendarPreviewSchema.parse({
        actionId: 'act-1',
        userId: 'user-1',
        status: 'ready',
        generatedAt: '2026-05-10T12:00:00.000Z',
      }).status
    ).toBe('ready');
  });

  it('parses the remaining internal-client request and response payloads', () => {
    expect(
      bookmarksCreateBookmarkRequestSchema.parse({
        userId: 'user-1',
        url: 'https://example.com',
        source: 'command',
        sourceId: 'source-1',
      }).url
    ).toBe('https://example.com');

    expect(
      webAgentFetchLinkPreviewsRequestSchema.parse({
        urls: ['https://example.com'],
      }).urls
    ).toEqual(['https://example.com']);

    expect(
      webAgentSummarizePageRequestSchema.parse({
        url: 'https://example.com',
        userId: 'user-1',
      }).userId
    ).toBe('user-1');

    expect(
      webAgentPageSummarySchema.parse({
        url: 'https://example.com',
        summary: 'Short summary',
        wordCount: 12,
        estimatedReadingMinutes: 1,
      }).wordCount
    ).toBe(12);

    expect(
      imageGeneratePromptRequestSchema.parse({
        text: 'Generate a useful image prompt for this article',
        model: 'gpt-4.1',
        userId: 'user-1',
      }).model
    ).toBe('gpt-4.1');

    expect(
      imageGenerateImageRequestSchema.parse({
        prompt: 'A detailed illustration of a lighthouse during a storm',
        model: LlmModels.GPTImage1,
        userId: 'user-1',
      }).userId
    ).toBe('user-1');

    expect(
      notionTokenContextSchema.parse({
        connected: true,
        token: 'secret-token',
      }).connected
    ).toBe(true);

    expect(
      notionPagePreviewSchema.parse({
        title: 'Design Notes',
        url: 'https://www.notion.so/page',
      }).title
    ).toBe('Design Notes');
  });
});
