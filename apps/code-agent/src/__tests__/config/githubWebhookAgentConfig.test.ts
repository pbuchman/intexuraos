import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadGitHubWebhookAgentConfig,
  type GitHubWebhookAgentConfig,
} from '../../config/githubWebhookAgentConfig.js';

describe('loadGitHubWebhookAgentConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('INTEXURAOS_GH_AGENT_')) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('default flags', () => {
    it('returns safe defaults when no env vars are set', () => {
      const config = loadGitHubWebhookAgentConfig();

      expect(config.enabled).toBe(false);
      expect(config.observeOnly).toBe(true);
      expect(config.notifyOnly).toBe(false);
      expect(config.executeComments).toBe(false);
      expect(config.ownsProcessingMarker).toBe(false);
      expect(config.ownsFinalReply).toBe(false);
    });
  });

  describe('invalid boolean value rejected', () => {
    it('throws for unsupported string on enabled flag', () => {
      process.env['INTEXURAOS_GH_AGENT_ENABLED'] = 'yes';
      expect(() => loadGitHubWebhookAgentConfig()).toThrow();
    });

    it('throws for unsupported string on observeOnly flag', () => {
      process.env['INTEXURAOS_GH_AGENT_OBSERVE_ONLY'] = 'maybe';
      expect(() => loadGitHubWebhookAgentConfig()).toThrow();
    });

    it('throws for numeric string', () => {
      process.env['INTEXURAOS_GH_AGENT_ENABLED'] = '1';
      expect(() => loadGitHubWebhookAgentConfig()).toThrow();
    });

    it('throws for empty string', () => {
      process.env['INTEXURAOS_GH_AGENT_ENABLED'] = '';
      expect(() => loadGitHubWebhookAgentConfig()).toThrow();
    });
  });

  describe('ownership flags parsed', () => {
    it('returns true for both ownership flags when enabled', () => {
      process.env['INTEXURAOS_GH_AGENT_OWNS_PROCESSING_MARKER'] = 'true';
      process.env['INTEXURAOS_GH_AGENT_OWNS_FINAL_REPLY'] = 'true';

      const config = loadGitHubWebhookAgentConfig();

      expect(config.ownsProcessingMarker).toBe(true);
      expect(config.ownsFinalReply).toBe(true);
    });

    it('returns false for ownership flags when explicitly disabled', () => {
      process.env['INTEXURAOS_GH_AGENT_OWNS_PROCESSING_MARKER'] = 'false';
      process.env['INTEXURAOS_GH_AGENT_OWNS_FINAL_REPLY'] = 'false';

      const config = loadGitHubWebhookAgentConfig();

      expect(config.ownsProcessingMarker).toBe(false);
      expect(config.ownsFinalReply).toBe(false);
    });
  });

  describe('mixed-case boolean strings', () => {
    it('accepts TRUE (uppercase)', () => {
      process.env['INTEXURAOS_GH_AGENT_ENABLED'] = 'TRUE';
      const config = loadGitHubWebhookAgentConfig();
      expect(config.enabled).toBe(true);
    });

    it('accepts True (title case)', () => {
      process.env['INTEXURAOS_GH_AGENT_EXECUTE_COMMENTS'] = 'True';
      const config = loadGitHubWebhookAgentConfig();
      expect(config.executeComments).toBe(true);
    });

    it('accepts FALSE (uppercase)', () => {
      process.env['INTEXURAOS_GH_AGENT_OBSERVE_ONLY'] = 'FALSE';
      const config = loadGitHubWebhookAgentConfig();
      expect(config.observeOnly).toBe(false);
    });
  });

  describe('whitespace-padded values', () => {
    it('trims leading and trailing whitespace', () => {
      process.env['INTEXURAOS_GH_AGENT_ENABLED'] = '  true  ';
      const config = loadGitHubWebhookAgentConfig();
      expect(config.enabled).toBe(true);
    });

    it('rejects whitespace-only value', () => {
      process.env['INTEXURAOS_GH_AGENT_ENABLED'] = '   ';
      expect(() => loadGitHubWebhookAgentConfig()).toThrow();
    });
  });

  describe('all flags configurable via env', () => {
    it('loads full rollout configuration', () => {
      process.env['INTEXURAOS_GH_AGENT_ENABLED'] = 'true';
      process.env['INTEXURAOS_GH_AGENT_OBSERVE_ONLY'] = 'false';
      process.env['INTEXURAOS_GH_AGENT_NOTIFY_ONLY'] = 'true';
      process.env['INTEXURAOS_GH_AGENT_EXECUTE_COMMENTS'] = 'true';
      process.env['INTEXURAOS_GH_AGENT_OWNS_PROCESSING_MARKER'] = 'true';
      process.env['INTEXURAOS_GH_AGENT_OWNS_FINAL_REPLY'] = 'true';

      const config = loadGitHubWebhookAgentConfig();

      expect(config).toEqual({
        enabled: true,
        observeOnly: false,
        notifyOnly: true,
        executeComments: true,
        ownsProcessingMarker: true,
        ownsFinalReply: true,
      } satisfies GitHubWebhookAgentConfig);
    });
  });
});
