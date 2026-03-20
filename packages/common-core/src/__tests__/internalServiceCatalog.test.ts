import { describe, expect, it } from 'vitest';
import {
  buildInternalApiOpenApiSources,
  INTERNAL_API_SERVICE_CATALOG,
} from '../internalServiceCatalog.js';

describe('buildInternalApiOpenApiSources', () => {
  it('trims configured URLs and skips blank values', () => {
    const [includedEntry, skippedEntry] = INTERNAL_API_SERVICE_CATALOG;
    if (includedEntry === undefined || skippedEntry === undefined) {
      throw new Error('expected at least two internal API service catalog entries');
    }

    const sources = buildInternalApiOpenApiSources({
      [includedEntry.baseUrlEnvVar]: 'https://unused.example',
      [includedEntry.openApiUrlEnvVar]: '  https://example.com/included/openapi.json  ',
      [skippedEntry.baseUrlEnvVar]: 'https://unused.example',
      [skippedEntry.openApiUrlEnvVar]: '   ',
    });

    expect(sources).toContainEqual({
      key: includedEntry.key,
      name: includedEntry.apiDocsName,
      url: 'https://example.com/included/openapi.json',
    });
    expect(sources.some((source) => source.key === skippedEntry.key)).toBe(false);
  });
});
