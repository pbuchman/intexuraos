import { describe, expect, it } from 'vitest';
import {
  buildInternalApiOpenApiSources,
  buildInternalApiServiceDefinitions,
  INTERNAL_API_SERVICE_CATALOG,
} from '../internalServiceCatalog.js';

describe('buildInternalApiOpenApiSources', () => {
  it('registers the Message Digest internal service and OpenAPI environment contract', () => {
    expect(INTERNAL_API_SERVICE_CATALOG).toContainEqual({
      key: 'message-digest-service',
      name: 'Message Digest Service',
      apiDocsName: 'Message Digest Service API',
      baseUrlEnvVar: 'INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL',
      openApiUrlEnvVar: 'INTEXURAOS_MESSAGE_DIGEST_SERVICE_OPENAPI_URL',
    });
  });

  it('does not include removed agent services', () => {
    const catalogKeys = INTERNAL_API_SERVICE_CATALOG.map((entry) => entry.key);
    const retiredKeys = ['todo', 'chat', 'cron', 'command', 'action'].map(
      (name) => `${name}s-agent`
    );

    for (const retiredKey of retiredKeys) {
      expect(catalogKeys).not.toContain(retiredKey);
    }
  });

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
