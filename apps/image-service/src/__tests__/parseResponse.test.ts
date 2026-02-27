import { describe, it, expect } from 'vitest';
import { parseThumbnailPromptResponse } from '../infra/llm/parseResponse.js';

describe('parseThumbnailPromptResponse', () => {
  it('parses valid JSON response', () => {
    const response = JSON.stringify({
      title: 'Test Title',
      visualSummary: 'A visual summary',
      prompt: 'A detailed prompt',
      negativePrompt: 'blurry, low quality',
      parameters: {
        framing: 'center subject',
        realism: 'photorealistic',
        people: 'generic silhouettes',
      },
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Test Title');
      expect(result.value.visualSummary).toBe('A visual summary');
      expect(result.value.prompt).toBe('A detailed prompt');
      expect(result.value.negativePrompt).toBe('blurry, low quality');
      expect(result.value.parameters.realism).toBe('photorealistic');
    }
  });

  it('parses JSON wrapped in markdown code block', () => {
    const response = `\`\`\`json
{
  "title": "Test Title",
  "visualSummary": "A visual summary",
  "prompt": "A detailed prompt",
  "negativePrompt": "blurry",
  "parameters": {
    "framing": "center",
    "realism": "cinematic illustration",
    "people": "none"
  }
}
\`\`\``;

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Test Title');
      expect(result.value.parameters.realism).toBe('cinematic illustration');
    }
  });

  it('parses JSON wrapped in plain code block', () => {
    const response = `\`\`\`
{"title":"Title","visualSummary":"Summary","prompt":"Prompt","negativePrompt":"Negative","parameters":{"framing":"center","realism":"clean vector","people":"none"}}
\`\`\``;

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parameters.realism).toBe('clean vector');
    }
  });

  it('returns error for invalid JSON', () => {
    const response = 'not valid json';

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARSE_ERROR');
      expect(result.error.message).toContain('Failed to parse JSON');
    }
  });

  it('returns error for non-object response', () => {
    const response = '"just a string"';

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARSE_ERROR');
      expect(result.error.message).toBe('Response is not a valid object');
    }
  });

  it('returns error for missing title', () => {
    const response = JSON.stringify({
      visualSummary: 'Summary',
      prompt: 'Prompt',
      negativePrompt: 'Negative',
      parameters: {},
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Missing or invalid title');
    }
  });

  it('returns error for empty title', () => {
    const response = JSON.stringify({
      title: '',
      visualSummary: 'Summary',
      prompt: 'Prompt',
      negativePrompt: 'Negative',
      parameters: {},
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Missing or invalid title');
    }
  });

  it('returns error for missing visualSummary', () => {
    const response = JSON.stringify({
      title: 'Title',
      prompt: 'Prompt',
      negativePrompt: 'Negative',
      parameters: {},
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Missing or invalid visualSummary');
    }
  });

  it('returns error for missing prompt', () => {
    const response = JSON.stringify({
      title: 'Title',
      visualSummary: 'Summary',
      negativePrompt: 'Negative',
      parameters: {},
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Missing or invalid prompt');
    }
  });

  it('returns error for missing negativePrompt', () => {
    const response = JSON.stringify({
      title: 'Title',
      visualSummary: 'Summary',
      prompt: 'Prompt',
      parameters: {},
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Missing or invalid negativePrompt');
    }
  });

  it('returns error for missing parameters', () => {
    const response = JSON.stringify({
      title: 'Title',
      visualSummary: 'Summary',
      prompt: 'Prompt',
      negativePrompt: 'Negative',
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Missing or invalid parameters');
    }
  });

  it('returns error for missing framing in parameters', () => {
    const response = JSON.stringify({
      title: 'Title',
      visualSummary: 'Summary',
      prompt: 'Prompt',
      negativePrompt: 'Negative',
      parameters: {
        realism: 'photorealistic',
        people: 'none',
      },
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Missing or invalid parameters.framing');
    }
  });

  it('returns error for invalid realism value', () => {
    const response = JSON.stringify({
      title: 'Title',
      visualSummary: 'Summary',
      prompt: 'Prompt',
      negativePrompt: 'Negative',
      parameters: {
        framing: 'center',
        realism: 'invalid-realism',
        people: 'none',
      },
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Invalid realism value');
    }
  });

  it('returns error for missing people in parameters', () => {
    const response = JSON.stringify({
      title: 'Title',
      visualSummary: 'Summary',
      prompt: 'Prompt',
      negativePrompt: 'Negative',
      parameters: {
        framing: 'center',
        realism: 'photorealistic',
      },
    });

    const result = parseThumbnailPromptResponse(response);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Missing or invalid parameters.people');
    }
  });

  describe('F-011 contract alignment', () => {
    it('output contract only contains consumed fields (no aspectRatio, textOnImage, logosTrademarks)', () => {
      const response = JSON.stringify({
        title: 'Title',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: {
          framing: 'center',
          realism: 'photorealistic',
          people: 'none',
        },
      });

      const result = parseThumbnailPromptResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const paramKeys = Object.keys(result.value.parameters);
        expect(paramKeys).toEqual(['framing', 'realism', 'people']);
        expect(paramKeys).not.toContain('aspectRatio');
        expect(paramKeys).not.toContain('textOnImage');
        expect(paramKeys).not.toContain('logosTrademarks');
      }
    });

    it('parser gracefully handles model responses that include removed fields (regression)', () => {
      const response = JSON.stringify({
        title: 'Title With Extras',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: {
          aspectRatio: '16:9',
          framing: 'wide shot',
          textOnImage: 'none',
          realism: 'cinematic illustration',
          people: 'silhouettes',
          logosTrademarks: 'none',
        },
      });

      const result = parseThumbnailPromptResponse(response);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const params = result.value.parameters;
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
