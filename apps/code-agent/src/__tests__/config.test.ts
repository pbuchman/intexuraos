/**
 * Tests for config loader.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
// The config file is in src/, so from __tests__/ we need ../config.js

describe('loadConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all INTEXURAOS_ env vars and PORT
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('INTEXURAOS_') || key === 'PORT') {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function setRequiredWebAppUrl(): void {
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://dev.intexuraos.cloud';
  }

  describe('port', () => {
    it('returns default port 8128 when PORT not set', () => {
      setRequiredWebAppUrl();
      const config = loadConfig();
      expect(config.port).toBe(8128);
    });

    it('parses custom PORT from env', () => {
      setRequiredWebAppUrl();
      process.env['PORT'] = '9000';
      const config = loadConfig();
      expect(config.port).toBe(9000);
    });
  });

  describe('env vars', () => {
    it('returns empty strings for missing optional env vars', () => {
      const config = loadConfig();
      expect(config.gcpProjectId).toBe('');
      expect(config.internalAuthToken).toBe('');
      expect(config.firestoreProjectId).toBe('');
      expect(config.whatsappServiceUrl).toBe('');
      expect(config.linearAgentUrl).toBe('');
      expect(config.tokenEncryptionKey).toBe('');
      expect(config.serviceUrl).toBe('');
      expect(config.codeTaskCallbackBaseUrl).toBe('');
      expect(config.webAppUrl).toBe('');
      expect(config.userServiceUrl).toBe('');
      expect(config.openRouterAppApiKey).toBe('');
    });

    it('loads all env vars when set', () => {
      process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-auth-token';
      process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'] = 'http://whatsapp';
      process.env['INTEXURAOS_LINEAR_AGENT_URL'] = 'http://linear';
      process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = 'test-encryption-key-32chars!';
      process.env['INTEXURAOS_SERVICE_URL'] = 'https://code-agent.test.local';
      process.env['INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL'] =
        'https://callbacks.test.local/';
      process.env['INTEXURAOS_WEB_APP_URL'] = 'https://dev.intexuraos.cloud';
      process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service';
      process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'or-platform-key';

      const config = loadConfig();
      expect(config.gcpProjectId).toBe('test-project');
      expect(config.internalAuthToken).toBe('test-auth-token');
      expect(config.firestoreProjectId).toBe('test-project');
      expect(config.whatsappServiceUrl).toBe('http://whatsapp');
      expect(config.linearAgentUrl).toBe('http://linear');
      expect(config.tokenEncryptionKey).toBe('test-encryption-key-32chars!');
      expect(config.serviceUrl).toBe('https://code-agent.test.local');
      expect(config.codeTaskCallbackBaseUrl).toBe('https://callbacks.test.local');
      expect(config.webAppUrl).toBe('https://dev.intexuraos.cloud');
      expect(config.userServiceUrl).toBe('http://user-service');
      expect(config.openRouterAppApiKey).toBe('or-platform-key');
    });

    it('falls back to serviceUrl for callback base when callback env is absent', () => {
      process.env['INTEXURAOS_SERVICE_URL'] = 'https://code-agent.test.local/api/code/';

      const config = loadConfig();

      expect(config.codeTaskCallbackBaseUrl).toBe('https://code-agent.test.local/api/code');
    });
  });
});
