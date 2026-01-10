import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['PORT'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_WEB_AGENT_URL'];
    delete process.env['INTEXURAOS_PUBSUB_BOOKMARK_ENRICH'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default values when env vars are not set', () => {
    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.gcpProjectId).toBe('');
    expect(config.auth.jwksUrl).toBe('');
    expect(config.auth.issuer).toBe('');
    expect(config.auth.audience).toBe('');
    expect(config.internalAuthKey).toBe('');
    expect(config.webAgentUrl).toBe('');
    expect(config.bookmarkEnrichTopic).toBeNull();
  });

  it('loads values from environment variables', () => {
    process.env['PORT'] = '3000';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret-key';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_PUBSUB_BOOKMARK_ENRICH'] = 'bookmark-enrich-topic';

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.gcpProjectId).toBe('test-project');
    expect(config.auth.jwksUrl).toBe('https://auth.example.com/.well-known/jwks.json');
    expect(config.auth.issuer).toBe('https://auth.example.com/');
    expect(config.auth.audience).toBe('test-audience');
    expect(config.internalAuthKey).toBe('secret-key');
    expect(config.webAgentUrl).toBe('https://web-agent.example.com');
    expect(config.bookmarkEnrichTopic).toBe('bookmark-enrich-topic');
  });

  it('returns null for bookmarkEnrichTopic when set to empty string', () => {
    process.env['INTEXURAOS_PUBSUB_BOOKMARK_ENRICH'] = '';

    const config = loadConfig();

    expect(config.bookmarkEnrichTopic).toBeNull();
  });
});
