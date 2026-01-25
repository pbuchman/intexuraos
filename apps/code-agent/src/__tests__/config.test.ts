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

  describe('port', () => {
    it('returns default port 8095 when PORT not set', () => {
      const config = loadConfig();
      expect(config.port).toBe(8095);
    });

    it('parses custom PORT from env', () => {
      process.env['PORT'] = '9000';
      const config = loadConfig();
      expect(config.port).toBe(9000);
    });
  });

  describe('env vars', () => {
    it('returns empty strings for missing env vars', () => {
      const config = loadConfig();
      expect(config.gcpProjectId).toBe('');
      expect(config.internalAuthToken).toBe('');
      expect(config.firestoreProjectId).toBe('');
      expect(config.whatsappServiceUrl).toBe('');
      expect(config.linearAgentUrl).toBe('');
      expect(config.actionsAgentUrl).toBe('');
      expect(config.dispatchSecret).toBe('');
      expect(config.webhookVerifySecret).toBe('');
      expect(config.cfAccessClientId).toBe('');
      expect(config.cfAccessClientSecret).toBe('');
    });

    it('loads all env vars when set', () => {
      process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
      process.env['INTEXURAOS_INTERNAL_AUTH_SECRET'] = 'test-auth-token';
      process.env['INTEXURAOS_FIRESTORE_PROJECT_ID'] = 'test-firestore-project';
      process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'] = 'http://whatsapp';
      process.env['INTEXURAOS_LINEAR_AGENT_URL'] = 'http://linear';
      process.env['INTEXURAOS_ACTIONS_AGENT_URL'] = 'http://actions';
      process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch';
      process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'] = 'test-webhook';
      process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
      process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';

      const config = loadConfig();
      expect(config.gcpProjectId).toBe('test-project');
      expect(config.internalAuthToken).toBe('test-auth-token');
      expect(config.firestoreProjectId).toBe('test-firestore-project');
      expect(config.whatsappServiceUrl).toBe('http://whatsapp');
      expect(config.linearAgentUrl).toBe('http://linear');
      expect(config.actionsAgentUrl).toBe('http://actions');
      expect(config.dispatchSecret).toBe('test-dispatch');
      expect(config.webhookVerifySecret).toBe('test-webhook');
      expect(config.cfAccessClientId).toBe('test-client-id');
      expect(config.cfAccessClientSecret).toBe('test-client-secret');
    });
  });

  describe('codeWorkers', () => {
    it('parses INTEXURAOS_CODE_WORKERS as JSON', () => {
      process.env['INTEXURAOS_CODE_WORKERS'] = JSON.stringify({
        mac: { url: 'https://mac-worker', priority: 1 },
        vm: { url: 'https://vm-worker', priority: 2 },
      });

      const config = loadConfig();
      expect(config.codeWorkers.mac).toEqual({ url: 'https://mac-worker', priority: 1 });
      expect(config.codeWorkers.vm).toEqual({ url: 'https://vm-worker', priority: 2 });
    });

    it('returns empty codeWorkers when env var not set', () => {
      const config = loadConfig();
      expect(config.codeWorkers).toEqual({});
    });

    it('handles complex worker config', () => {
      process.env['INTEXURAOS_CODE_WORKERS'] = JSON.stringify({
        mac: { url: 'https://cc-mac.intexuraos.cloud', priority: 1 },
        vm: { url: 'https://cc-vm.intexuraos.cloud', priority: 2 },
      });

      const config = loadConfig();
      expect(config.codeWorkers.mac?.url).toBe('https://cc-mac.intexuraos.cloud');
      expect(config.codeWorkers.mac?.priority).toBe(1);
      expect(config.codeWorkers.vm?.url).toBe('https://cc-vm.intexuraos.cloud');
      expect(config.codeWorkers.vm?.priority).toBe(2);
    });

    it('throws on invalid JSON in CODE_WORKERS', () => {
      process.env['INTEXURAOS_CODE_WORKERS'] = 'invalid{json';

      expect(() => loadConfig()).toThrow();
    });
  });
});
