import { describe, expect, it } from 'vitest';
import {
  buildInternalApiOpenApiSources,
  buildInternalApiServiceDefinitions,
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

describe('buildInternalApiServiceDefinitions', () => {
  it('uses explicit openApiUrlEnvVar when set', () => {
    const [entry] = INTERNAL_API_SERVICE_CATALOG;
    if (entry === undefined) {
      throw new Error('expected at least one internal API service catalog entry');
    }

    const definitions = buildInternalApiServiceDefinitions({
      [entry.baseUrlEnvVar]: 'https://service.example.com',
      [entry.openApiUrlEnvVar]: '  https://custom.example.com/api/openapi.json  ',
    });

    expect(definitions).toContainEqual({
      key: entry.key,
      name: entry.name,
      url: 'https://service.example.com',
      openapiUrl: 'https://custom.example.com/api/openapi.json',
    });
  });

  it('falls back to base URL + /openapi.json when openApiUrlEnvVar is unset', () => {
    const [entry] = INTERNAL_API_SERVICE_CATALOG;
    if (entry === undefined) {
      throw new Error('expected at least one internal API service catalog entry');
    }

    const definitions = buildInternalApiServiceDefinitions({
      [entry.baseUrlEnvVar]: 'https://service.example.com',
    });

    expect(definitions).toContainEqual({
      key: entry.key,
      name: entry.name,
      url: 'https://service.example.com',
      openapiUrl: 'https://service.example.com/openapi.json',
    });
  });
});
