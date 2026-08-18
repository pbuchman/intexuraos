import { describe, expect, it } from 'vitest';
import { LegacyGoogleModels, LlmModels } from '@intexuraos/llm-contract';
import { supportedModelSchema } from '../common.js';

describe('supportedModelSchema', () => {
  it('does not offer any direct-provider model for executable requests', () => {
    expect(supportedModelSchema.enum).not.toContain(LegacyGoogleModels.Gemini25Pro);
    expect(supportedModelSchema.enum).not.toContain(LegacyGoogleModels.Gemini25Flash);
    expect(supportedModelSchema.enum).not.toContain(LlmModels.GPT54);
  });

  it('accepts only curated OpenRouter models', () => {
    expect(supportedModelSchema.enum).toContain('or:google/gemini-3.6-flash');
    expect(supportedModelSchema.enum).toContain('or:openai/gpt-5.4');
    expect(supportedModelSchema.enum).not.toContain('or:unknown/model');
  });
});
