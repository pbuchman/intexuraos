import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, OPEN_API_SOURCE_CATALOG } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };
  const openApiEnvVarKeys = new Set<string>(
    OPEN_API_SOURCE_CATALOG.map((entry) => entry.openApiUrlEnvVar)
  );
  const retiredOpenApiNames = ['Todos', 'Chat', 'Cron'].map((name) => `${name} Agent API`);
  const retiredOpenApiEnvVars = ['TODOS', 'CHAT', 'CRON'].map(
    (suffix) => `INTEXURAOS_${suffix}_AGENT_OPENAPI_URL`
  );

  beforeEach(() => {
    process.env = Object.fromEntries(
      Object.entries(originalEnv).filter(
        ([key]) =>
          key !== 'PORT' &&
          key !== 'HOST' &&
          key !== 'INTEXURAOS_API_DOCS_EXPECTED_SERVICES' &&
          !openApiEnvVarKeys.has(key)
      )
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not require removed agent OpenAPI sources', () => {
    const openApiNames = OPEN_API_SOURCE_CATALOG.map((entry) => entry.name);
    const openApiEnvVars = OPEN_API_SOURCE_CATALOG.map((entry) => entry.openApiUrlEnvVar);

    expect(openApiNames).not.toEqual(expect.arrayContaining(retiredOpenApiNames));
    expect(openApiEnvVars).not.toEqual(expect.arrayContaining(retiredOpenApiEnvVars));
  });

  it('registers Message Digest as a required OpenAPI source', () => {
    expect(OPEN_API_SOURCE_CATALOG).toContainEqual({
      service: 'message-digest-service',
      name: 'Message Digest Service API',
      openApiUrlEnvVar: 'INTEXURAOS_MESSAGE_DIGEST_SERVICE_OPENAPI_URL',
    });
  });

  it('throws when required OpenAPI source URLs are missing', () => {
    expect(() => {
      loadConfig();
    }).toThrow('Missing required environment variables');
  });

  it('requires and exposes only the OpenAPI sources selected by the runtime profile', () => {
    process.env['INTEXURAOS_API_DOCS_EXPECTED_SERVICES'] =
      'user-service,app-settings-service';
    process.env['INTEXURAOS_USER_SERVICE_OPENAPI_URL'] =
      'http://127.0.0.1:18110/openapi.json';
    process.env['INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL'] =
      'http://127.0.0.1:18122/openapi.json';

    expect(loadConfig().openApiSources).toEqual([
      { name: 'User Service API', url: 'http://127.0.0.1:18110/openapi.json' },
      {
        name: 'Application Settings API',
        url: 'http://127.0.0.1:18122/openapi.json',
      },
    ]);
  });

  it.each([
    ['', 'must contain at least one service'],
    ['user-service,user-service', 'contains duplicate service: user-service'],
    ['user-service,unknown-service', 'contains unknown service: unknown-service'],
  ])('rejects an invalid runtime OpenAPI allowlist %j', (allowlist, message) => {
    process.env['INTEXURAOS_API_DOCS_EXPECTED_SERVICES'] = allowlist;

    expect(() => loadConfig()).toThrow(
      `INTEXURAOS_API_DOCS_EXPECTED_SERVICES ${message}`
    );
  });

  it('trims configured OpenAPI URLs into the generated source list', () => {
    for (const entry of OPEN_API_SOURCE_CATALOG) {
      process.env[entry.openApiUrlEnvVar] = ` https://example.com/${entry.openApiUrlEnvVar.toLowerCase()}/openapi.json `;
    }

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.host).toBe('0.0.0.0');
    expect(config.openApiSources).toHaveLength(OPEN_API_SOURCE_CATALOG.length);
    expect(config.openApiSources[0]).toEqual({
      name: OPEN_API_SOURCE_CATALOG[0]?.name,
      url: `https://example.com/${OPEN_API_SOURCE_CATALOG[0]?.openApiUrlEnvVar.toLowerCase()}/openapi.json`,
    });
  });
});
