import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['PORT'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
    delete process.env['INTEXURAOS_SENTRY_DSN'];
    delete process.env['INTEXURAOS_ENVIRONMENT'];
    delete process.env['INTEXURAOS_USER_SERVICE_URL'];
    delete process.env['INTEXURAOS_NOTION_SERVICE_URL'];
    delete process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'];
    delete process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'];
    delete process.env['INTEXURAOS_RESEARCH_AGENT_URL'];
    delete process.env['INTEXURAOS_COMMANDS_AGENT_URL'];
    delete process.env['INTEXURAOS_ACTIONS_AGENT_URL'];
    delete process.env['INTEXURAOS_DATA_INSIGHTS_AGENT_URL'];
    delete process.env['INTEXURAOS_IMAGE_SERVICE_URL'];
    delete process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'];
    delete process.env['INTEXURAOS_NOTES_AGENT_URL'];
    delete process.env['INTEXURAOS_TODOS_AGENT_URL'];
    delete process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'];
    delete process.env['INTEXURAOS_CALENDAR_AGENT_URL'];
    delete process.env['INTEXURAOS_CHAT_AGENT_URL'];
    delete process.env['INTEXURAOS_CODE_AGENT_URL'];
    delete process.env['INTEXURAOS_LINEAR_AGENT_URL'];
    delete process.env['INTEXURAOS_WEB_AGENT_URL'];
    delete process.env['INTEXURAOS_CRON_AGENT_URL'];
    delete process.env['INTEXURAOS_HELLSCRIPT_AGENT_URL'];
    delete process.env['INTEXURAOS_CODE_AGENT_OPENAPI_URL'];
    delete process.env['INTEXURAOS_GEMINI_APP_API_KEY'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default values when env vars are not set', () => {
    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.gcpProjectId).toBe('');
    expect(config.internalAuthToken).toBe('');
    expect(config.authAudience).toBe('');
    expect(config.authIssuer).toBe('');
    expect(config.authJwksUrl).toBe('');
    expect(config.sentryDsn).toBe('');
    expect(config.environment).toBe('development');
    expect(config.allowedServices).toEqual([]);
    expect(config.geminiApiKey).toBe('');
  });

  it('loads values from environment variables', () => {
    process.env['PORT'] = '3000';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/.well-known/jwks.json';
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://sentry.example.com/123';
    process.env['INTEXURAOS_ENVIRONMENT'] = 'production';
    process.env['INTEXURAOS_GEMINI_APP_API_KEY'] = 'gemini-key';

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.gcpProjectId).toBe('test-project');
    expect(config.internalAuthToken).toBe('secret-token');
    expect(config.authAudience).toBe('test-audience');
    expect(config.authIssuer).toBe('https://auth.example.com/');
    expect(config.authJwksUrl).toBe('https://auth.example.com/.well-known/jwks.json');
    expect(config.sentryDsn).toBe('https://sentry.example.com/123');
    expect(config.environment).toBe('production');
    expect(config.geminiApiKey).toBe('gemini-key');
  });

  it('populates allowedServices when INTEXURAOS_CODE_AGENT_URL is set', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'https://code-agent.example.com';

    const config = loadConfig();

    expect(config.allowedServices).toHaveLength(1);
    expect(config.allowedServices[0]?.key).toBe('code-agent');
    expect(config.allowedServices[0]?.name).toBe('Code Agent');
    expect(config.allowedServices[0]?.url).toBe('https://code-agent.example.com');
    expect(config.allowedServices[0]?.openapiUrl).toBe('https://code-agent.example.com/openapi.json');
    expect(config.allowedServices[0]?.allowedOperations).toEqual(['getTaskDispatchMetadata', 'getLinearIssueContext']);
  });

  it('uses explicit OpenAPI URL when provided for a configured service', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'https://code-agent.example.com';
    process.env['INTEXURAOS_CODE_AGENT_OPENAPI_URL'] = 'https://docs.example.com/code-agent/openapi.json';

    const config = loadConfig();

    expect(config.allowedServices).toHaveLength(1);
    expect(config.allowedServices[0]?.openapiUrl).toBe('https://docs.example.com/code-agent/openapi.json');
  });

  it('populates allowedServices for every configured internal service url', () => {
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'https://user-service.example.com';
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'https://code-agent.example.com';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_CRON_AGENT_URL'] = 'https://cron-agent.example.com';

    const config = loadConfig();

    expect(config.allowedServices).toEqual([
      {
        key: 'user-service',
        name: 'User Service',
        url: 'https://user-service.example.com',
        openapiUrl: 'https://user-service.example.com/openapi.json',
        allowedOperations: [],
      },
      {
        key: 'code-agent',
        name: 'Code Agent',
        url: 'https://code-agent.example.com',
        openapiUrl: 'https://code-agent.example.com/openapi.json',
        allowedOperations: ['getTaskDispatchMetadata', 'getLinearIssueContext'],
      },
      {
        key: 'web-agent',
        name: 'Web Agent',
        url: 'https://web-agent.example.com',
        openapiUrl: 'https://web-agent.example.com/openapi.json',
        allowedOperations: ['fetchLinkPreviewsInternal', 'summarizePageInternal'],
      },
      {
        key: 'cron-agent',
        name: 'Cron Agent',
        url: 'https://cron-agent.example.com',
        openapiUrl: 'https://cron-agent.example.com/openapi.json',
        allowedOperations: [],
      },
    ]);
  });

  it('does not add code-agent to allowedServices when URL is empty string', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = '';

    const config = loadConfig();

    expect(config.allowedServices).toEqual([]);
  });

  it('every catalog entry propagates allowedOperations to built services', () => {
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'https://user-service.example.com';
    process.env['INTEXURAOS_NOTION_SERVICE_URL'] = 'https://notion-service.example.com';
    process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'] = 'https://whatsapp-service.example.com';
    process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'] = 'https://mobile-notifications-service.example.com';
    process.env['INTEXURAOS_RESEARCH_AGENT_URL'] = 'https://research-agent.example.com';
    process.env['INTEXURAOS_COMMANDS_AGENT_URL'] = 'https://commands-agent.example.com';
    process.env['INTEXURAOS_ACTIONS_AGENT_URL'] = 'https://actions-agent.example.com';
    process.env['INTEXURAOS_DATA_INSIGHTS_AGENT_URL'] = 'https://data-insights-agent.example.com';
    process.env['INTEXURAOS_IMAGE_SERVICE_URL'] = 'https://image-service.example.com';
    process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] = 'https://app-settings-service.example.com';
    process.env['INTEXURAOS_NOTES_AGENT_URL'] = 'https://notes-agent.example.com';
    process.env['INTEXURAOS_TODOS_AGENT_URL'] = 'https://todos-agent.example.com';
    process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'] = 'https://bookmarks-agent.example.com';
    process.env['INTEXURAOS_CALENDAR_AGENT_URL'] = 'https://calendar-agent.example.com';
    process.env['INTEXURAOS_CHAT_AGENT_URL'] = 'https://chat-agent.example.com';
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'https://code-agent.example.com';
    process.env['INTEXURAOS_LINEAR_AGENT_URL'] = 'https://linear-agent.example.com';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_CRON_AGENT_URL'] = 'https://cron-agent.example.com';
    process.env['INTEXURAOS_HELLSCRIPT_AGENT_URL'] = 'https://hellscript-agent.example.com';

    const config = loadConfig();

    for (const service of config.allowedServices) {
      expect(service).toHaveProperty('allowedOperations');
      expect(Array.isArray(service.allowedOperations)).toBe(true);
    }
  });

  it('blocked services have empty allowedOperations arrays', () => {
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'https://user-service.example.com';
    process.env['INTEXURAOS_COMMANDS_AGENT_URL'] = 'https://commands-agent.example.com';
    process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] = 'https://app-settings-service.example.com';
    process.env['INTEXURAOS_CRON_AGENT_URL'] = 'https://cron-agent.example.com';
    process.env['INTEXURAOS_CHAT_AGENT_URL'] = 'https://chat-agent.example.com';
    process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'] = 'https://whatsapp-service.example.com';
    process.env['INTEXURAOS_HELLSCRIPT_AGENT_URL'] = 'https://hellscript-agent.example.com';

    const config = loadConfig();

    const blockedKeys = [
      'user-service', 'commands-agent', 'app-settings-service',
      'cron-agent', 'chat-agent', 'whatsapp-service', 'hellscript-agent',
    ];

    for (const key of blockedKeys) {
      const service = config.allowedServices.find((s) => s.key === key);
      expect(service?.allowedOperations).toEqual([]);
    }
  });
});
