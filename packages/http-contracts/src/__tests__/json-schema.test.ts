import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

describe('json-schema helpers', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('zod-to-json-schema');
  });

  it('throws when zod-to-json-schema does not return the requested definition', async () => {
    vi.doMock('zod-to-json-schema', () => ({
      zodToJsonSchema: vi.fn(() => ({})),
    }));

    const { toOpenApiComponentSchema } = await import('../zod/json-schema.js');

    expect(() =>
      toOpenApiComponentSchema('MissingDefinition', z.object({ ok: z.boolean() }))
    ).toThrow('Failed to derive JSON schema definition for MissingDefinition');
  });
});
