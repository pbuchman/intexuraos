import { describe, expect, it } from 'vitest';
import { LegacyGoogleModels, LlmModels } from '@intexuraos/llm-contract';
import { supportedModelSchema } from '../common.js';

describe('supportedModelSchema', () => {
  it('does not offer direct Google models for executable requests', () => {
    const staticModels = supportedModelSchema.anyOf[0].enum;

    expect(staticModels).not.toContain(LegacyGoogleModels.Gemini25Pro);
    expect(staticModels).not.toContain(LegacyGoogleModels.Gemini25Flash);
    expect(staticModels).toContain(LlmModels.GPT54);
  });

  it('still accepts Google models through the OpenRouter namespace', () => {
    expect(supportedModelSchema.anyOf[1].enum).toContain('or:google/gemini-3-flash-preview');
    expect(supportedModelSchema.anyOf[1].enum).not.toContain('or:unknown/model');
  });
});
