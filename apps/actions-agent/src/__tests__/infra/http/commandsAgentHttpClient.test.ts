/**
 * Tests for commands agent HTTP client.
 * Tests fetching commands from the commands-agent service.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createCommandsAgentHttpClient } from '../../../infra/http/commandsAgentHttpClient.js';

describe('createCommandsAgentHttpClient', () => {
  const baseUrl = 'http://commands-agent.local';
  const internalAuthToken = 'test-internal-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getCommand', () => {
    it('returns command with text on successful fetch', async () => {
      nock(baseUrl)
        .get('/internal/commands/cmd-123')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            command: {
              id: 'cmd-123',
              text: 'Research AI trends',
            },
          },
        });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });
      const result = await client.getCommand('cmd-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('cmd-123');
      expect(result?.text).toBe('Research AI trends');
    });

    it('returns null when command not found (404)', async () => {
      nock(baseUrl)
        .get('/internal/commands/nonexistent')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(404);

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });
      const result = await client.getCommand('nonexistent');

      expect(result).toBeNull();
    });

    it('throws error on HTTP 500', async () => {
      nock(baseUrl)
        .get('/internal/commands/cmd-500')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(500, { error: 'Internal server error' });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });

      await expect(client.getCommand('cmd-500')).rejects.toThrow('HTTP 500');
    });

    it('throws error on HTTP 401', async () => {
      nock(baseUrl).get('/internal/commands/cmd-401').reply(401, { error: 'Unauthorized' });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });

      await expect(client.getCommand('cmd-401')).rejects.toThrow('HTTP 401');
    });

    it('throws error on HTTP 403', async () => {
      nock(baseUrl).get('/internal/commands/cmd-403').reply(403, { error: 'Forbidden' });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });

      await expect(client.getCommand('cmd-403')).rejects.toThrow('HTTP 403');
    });

    it('throws error when response success is false', async () => {
      nock(baseUrl)
        .get('/internal/commands/cmd-fail')
        .reply(200, {
          success: false,
          error: { message: 'Command processing failed' },
        });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });

      await expect(client.getCommand('cmd-fail')).rejects.toThrow('Invalid response');
    });

    it('throws error when response data is undefined', async () => {
      nock(baseUrl).get('/internal/commands/cmd-nodata').reply(200, {
        success: true,
      });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });

      await expect(client.getCommand('cmd-nodata')).rejects.toThrow('Invalid response');
    });

    it('throws error on network failure', async () => {
      nock(baseUrl)
        .get('/internal/commands/cmd-network')
        .replyWithError('Connection refused');

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });

      await expect(client.getCommand('cmd-network')).rejects.toThrow();
    });

    it('sends correct authorization header', async () => {
      const customToken = 'custom-auth-token-xyz';
      const scope = nock(baseUrl)
        .get('/internal/commands/cmd-auth')
        .matchHeader('X-Internal-Auth', customToken)
        .reply(200, {
          success: true,
          data: { command: { id: 'cmd-auth', text: 'Test' } },
        });

      const client = createCommandsAgentHttpClient({
        baseUrl,
        internalAuthToken: customToken,
      });
      await client.getCommand('cmd-auth');

      expect(scope.isDone()).toBe(true);
    });

    it('constructs correct URL with command id', async () => {
      const commandId = 'command-id-with-special-chars-123';
      const scope = nock(baseUrl)
        .get(`/internal/commands/${commandId}`)
        .reply(200, {
          success: true,
          data: { command: { id: commandId, text: 'Test command' } },
        });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });
      await client.getCommand(commandId);

      expect(scope.isDone()).toBe(true);
    });

    it('handles command with long text', async () => {
      const longText = 'A'.repeat(5000);
      nock(baseUrl)
        .get('/internal/commands/cmd-long')
        .reply(200, {
          success: true,
          data: {
            command: { id: 'cmd-long', text: longText },
          },
        });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });
      const result = await client.getCommand('cmd-long');

      expect(result?.text).toBe(longText);
    });

    it('handles command with special characters in text', async () => {
      const specialText = 'Test with émojis 🎉 and "quotes" & ampersands <html>';
      nock(baseUrl)
        .get('/internal/commands/cmd-special')
        .reply(200, {
          success: true,
          data: {
            command: { id: 'cmd-special', text: specialText },
          },
        });

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });
      const result = await client.getCommand('cmd-special');

      expect(result?.text).toBe(specialText);
    });

    it('uses different base URLs correctly', async () => {
      const customBaseUrl = 'https://api.production.example.com';
      const scope = nock(customBaseUrl)
        .get('/internal/commands/cmd-prod')
        .reply(200, {
          success: true,
          data: { command: { id: 'cmd-prod', text: 'Production command' } },
        });

      const client = createCommandsAgentHttpClient({
        baseUrl: customBaseUrl,
        internalAuthToken,
      });
      const result = await client.getCommand('cmd-prod');

      expect(scope.isDone()).toBe(true);
      expect(result?.id).toBe('cmd-prod');
    });

    it('throws error on HTTP 502 Bad Gateway', async () => {
      nock(baseUrl).get('/internal/commands/cmd-502').reply(502, 'Bad Gateway');

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });

      await expect(client.getCommand('cmd-502')).rejects.toThrow('HTTP 502');
    });

    it('throws error on HTTP 503 Service Unavailable', async () => {
      nock(baseUrl).get('/internal/commands/cmd-503').reply(503, 'Service Unavailable');

      const client = createCommandsAgentHttpClient({ baseUrl, internalAuthToken });

      await expect(client.getCommand('cmd-503')).rejects.toThrow('HTTP 503');
    });
  });
});
