import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { LLMClient, NormalizedUsage } from '@intexuraos/llm-contract';
import { generateThumbnailPrompt } from '../generateThumbnailPrompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceFilePath = resolve(__dirname, '../generateThumbnailPrompt.ts');

const mockUsage: NormalizedUsage = {
  inputTokens: 100,
  outputTokens: 200,
  totalTokens: 300,
  costUsd: 0.01,
};

function createMockClient(response: string): LLMClient {
  return {
    research: vi.fn(),
    generate: vi.fn().mockResolvedValue(ok({ content: response, usage: mockUsage })),
  };
}

function createErrorClient(code: string, message: string): LLMClient {
  return {
    research: vi.fn(),
    generate: vi.fn().mockResolvedValue(err({ code, message })),
  };
}

const validResponse = JSON.stringify({
  title: 'Test Title',
  visualSummary: 'A test visual summary',
  prompt: 'A detailed prompt for image generation',
  negativePrompt: 'Things to avoid in the image',
  parameters: {
    framing: 'centered composition',
    realism: 'photorealistic',
    people: 'generic silhouettes',
  },
});

describe('generateThumbnailPrompt', () => {
  describe('F-012 version metadata contract', () => {
    it('contains a valid prompt version comment', () => {
      const source = readFileSync(sourceFilePath, 'utf8');
      const versionPattern = /\/\/ Prompt version: \d+\.\d+\.\d+/;
      expect(source).toMatch(versionPattern);
    });

    it('uses valid semver format in version comment', () => {
      const source = readFileSync(sourceFilePath, 'utf8');
      const match = /\/\/ Prompt version: (\d+\.\d+\.\d+)/.exec(source);
      expect(match).not.toBeNull();
      const version = match?.[1] ?? '';
      const parts = version.split('.').map(Number);
      expect(parts[0]).toBeGreaterThanOrEqual(1);
      expect(parts[1]).toBeGreaterThanOrEqual(0);
      expect(parts[2]).toBeGreaterThanOrEqual(0);
    });
  });

  describe('F-012 version metadata regression', () => {
    it('version comment is not missing (regression: previously absent)', () => {
      const source = readFileSync(sourceFilePath, 'utf8');
      // The audit found this file lacked a version comment entirely.
      // This test ensures the failure path (no version) cannot recur.
      expect(source).toMatch(/\/\/ Prompt version:/);
    });
  });

  describe('successful generation', () => {
    it('returns thumbnail prompt with usage on success', async () => {
      const client = createMockClient(validResponse);
      const result = await generateThumbnailPrompt(client, 'Test text content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.thumbnailPrompt.title).toBe('Test Title');
        expect(result.value.thumbnailPrompt.visualSummary).toBe('A test visual summary');
        expect(result.value.thumbnailPrompt.prompt).toBe('A detailed prompt for image generation');
        expect(result.value.thumbnailPrompt.negativePrompt).toBe('Things to avoid in the image');
        expect(result.value.thumbnailPrompt.parameters.realism).toBe('photorealistic');
        expect(result.value.usage).toEqual(mockUsage);
      }
    });

    it('parses response wrapped in markdown code block', async () => {
      const client = createMockClient('```json\n' + validResponse + '\n```');
      const result = await generateThumbnailPrompt(client, 'Test text');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.thumbnailPrompt.title).toBe('Test Title');
      }
    });

    it('parses response wrapped in code block without json tag', async () => {
      const client = createMockClient('```\n' + validResponse + '\n```');
      const result = await generateThumbnailPrompt(client, 'Test text');

      expect(result.ok).toBe(true);
    });

    it('handles cinematic illustration realism style', async () => {
      const response = JSON.stringify({
        title: 'Cinematic Test',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: {
          framing: 'wide shot',
          realism: 'cinematic illustration',
          people: 'none',
        },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.thumbnailPrompt.parameters.realism).toBe('cinematic illustration');
      }
    });

    it('handles clean vector realism style', async () => {
      const response = JSON.stringify({
        title: 'Vector Test',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: {
          framing: 'flat',
          realism: 'clean vector',
          people: 'icons',
        },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.thumbnailPrompt.parameters.realism).toBe('clean vector');
      }
    });
  });

  describe('LLM client errors', () => {
    it('returns error when client generate fails', async () => {
      const client = createErrorClient('API_ERROR', 'Connection failed');
      const result = await generateThumbnailPrompt(client, 'Test text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Connection failed');
      }
    });

    it('returns rate limit error from client', async () => {
      const client = createErrorClient('RATE_LIMITED', 'Too many requests');
      const result = await generateThumbnailPrompt(client, 'Test text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });
  });

  describe('JSON parse errors', () => {
    it('returns parse error for invalid JSON', async () => {
      const client = createMockClient('not valid json');
      const result = await generateThumbnailPrompt(client, 'Test text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
        expect(result.error.message).toContain('Failed to parse JSON');
      }
    });

    it('returns parse error when response is not an object', async () => {
      const client = createMockClient('"just a string"');
      const result = await generateThumbnailPrompt(client, 'Test text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
        expect(result.error.message).toBe('Response is not a valid object');
      }
    });

    it('returns parse error when response is null', async () => {
      const client = createMockClient('null');
      const result = await generateThumbnailPrompt(client, 'Test text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
        expect(result.error.message).toBe('Response is not a valid object');
      }
    });
  });

  describe('missing field errors', () => {
    it('returns error when title is missing', async () => {
      const response = JSON.stringify({
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid title');
      }
    });

    it('returns error when title is empty string', async () => {
      const response = JSON.stringify({
        title: '',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid title');
      }
    });

    it('returns error when visualSummary is missing', async () => {
      const response = JSON.stringify({
        title: 'Title',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid visualSummary');
      }
    });

    it('returns error when visualSummary is empty', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: '',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid visualSummary');
      }
    });

    it('returns error when prompt is missing', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid prompt');
      }
    });

    it('returns error when prompt is empty', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: '',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid prompt');
      }
    });

    it('returns error when negativePrompt is missing', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        parameters: { framing: 'f', realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid negativePrompt');
      }
    });

    it('returns error when negativePrompt is empty', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: '',
        parameters: { framing: 'f', realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid negativePrompt');
      }
    });
  });

  describe('parameters validation errors', () => {
    it('returns error when parameters is missing', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid parameters');
      }
    });

    it('returns error when parameters is null', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: null,
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid parameters');
      }
    });

    it('returns error when parameters.framing is missing', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid parameters.framing');
      }
    });

    it('returns error when parameters.framing is not a string', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 123, realism: 'photorealistic', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid parameters.framing');
      }
    });

    it('returns error when parameters.realism is invalid', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'invalid-style', people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid realism value');
        expect(result.error.message).toContain('photorealistic');
        expect(result.error.message).toContain('cinematic illustration');
        expect(result.error.message).toContain('clean vector');
      }
    });

    it('returns error when parameters.realism is not a string', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 123, people: 'p' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid realism value');
      }
    });

    it('returns error when parameters.people is missing', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'photorealistic' },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid parameters.people');
      }
    });

    it('returns error when parameters.people is not a string', async () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: { framing: 'f', realism: 'photorealistic', people: 456 },
      });
      const client = createMockClient(response);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing or invalid parameters.people');
      }
    });
  });

  describe('F-011 contract alignment', () => {
    it('output contract only contains consumed fields (no aspectRatio, textOnImage, logosTrademarks)', async () => {
      const client = createMockClient(validResponse);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const paramKeys = Object.keys(result.value.thumbnailPrompt.parameters);
        expect(paramKeys).toEqual(['framing', 'realism', 'people']);
        expect(paramKeys).not.toContain('aspectRatio');
        expect(paramKeys).not.toContain('textOnImage');
        expect(paramKeys).not.toContain('logosTrademarks');
      }
    });

    it('parser gracefully handles model responses that include removed fields (regression)', async () => {
      const responseWithExtraFields = JSON.stringify({
        title: 'Title With Extras',
        visualSummary: 'Summary with extra fields',
        prompt: 'A prompt from a model that includes extra fields',
        negativePrompt: 'Negative prompt',
        parameters: {
          aspectRatio: '16:9',
          framing: 'wide shot',
          textOnImage: 'none',
          realism: 'cinematic illustration',
          people: 'silhouettes',
          logosTrademarks: 'none',
        },
      });
      const client = createMockClient(responseWithExtraFields);
      const result = await generateThumbnailPrompt(client, 'Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const params = result.value.thumbnailPrompt.parameters;
        expect(params.framing).toBe('wide shot');
        expect(params.realism).toBe('cinematic illustration');
        expect(params.people).toBe('silhouettes');
        const paramKeys = Object.keys(params);
        expect(paramKeys).not.toContain('aspectRatio');
        expect(paramKeys).not.toContain('textOnImage');
        expect(paramKeys).not.toContain('logosTrademarks');
      }
    });
  });
});
