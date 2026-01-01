import { describe, expect, it, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { shouldLogRequest, logIncomingRequest } from '../http/logger.js';

describe('Logger utilities', () => {
  describe('shouldLogRequest', () => {
    it('returns true for non-health-check paths', () => {
      expect(shouldLogRequest('/api/users')).toBe(true);
      expect(shouldLogRequest('/internal/actions')).toBe(true);
      expect(shouldLogRequest('/')).toBe(true);
    });

    it('returns false for health check paths', () => {
      expect(shouldLogRequest('/health')).toBe(false);
    });

    it('handles undefined url', () => {
      expect(shouldLogRequest(undefined)).toBe(true);
    });

    it('extracts path from query string', () => {
      expect(shouldLogRequest('/health?foo=bar')).toBe(false);
      expect(shouldLogRequest('/api/test?query=value')).toBe(true);
    });
  });

  describe('logIncomingRequest', () => {
    let mockRequest: Partial<FastifyRequest>;
    let loggedPayloads: { payload: unknown; message: string }[];
    let debugLogs: { payload: unknown; message: string }[];

    beforeEach(() => {
      loggedPayloads = [];
      debugLogs = [];

      mockRequest = {
        headers: {
          'content-type': 'application/json',
          'x-internal-auth': 'secret-token-12345',
          authorization: 'Bearer user-token-67890',
          'user-agent': 'test-client',
        },
        body: {
          message: {
            data: 'base64encodeddata',
            messageId: 'msg-123',
          },
        },
        params: { actionId: 'act-456' },
        log: {
          info: (payload: unknown, message: string) => {
            loggedPayloads.push({ payload, message });
          },
          debug: (payload: unknown, message: string) => {
            debugLogs.push({ payload, message });
          },
        } as unknown as FastifyRequest['log'],
      };
    });

    it('logs request with default options', () => {
      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];

      expect(logged?.message).toBe('Incoming request');
      expect(logged?.payload).toMatchObject({
        event: 'incoming_request',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'test-client',
        },
      });

      // Sensitive headers redacted
      const payload = logged?.payload as Record<string, unknown>;
      const headers = payload.headers as Record<string, unknown>;
      expect(headers['x-internal-auth']).toContain('...');
      expect(headers['x-internal-auth']).not.toBe('secret-token-12345');
      expect(headers['authorization']).toContain('...');
      expect(headers['authorization']).not.toBe('Bearer user-token-67890');
    });

    it('includes params when requested', () => {
      logIncomingRequest(mockRequest as FastifyRequest, { includeParams: true });

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload.params).toEqual({ actionId: 'act-456' });
    });

    it('excludes params by default', () => {
      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload.params).toBeUndefined();
    });

    it('truncates body preview to specified length', () => {
      const longBody = 'a'.repeat(1000);
      mockRequest.body = { text: longBody };

      logIncomingRequest(mockRequest as FastifyRequest, { bodyPreviewLength: 100 });

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;
      const preview = payload.bodyPreview as string;

      expect(preview.length).toBe(100);
    });

    it('uses custom message', () => {
      logIncomingRequest(mockRequest as FastifyRequest, {
        message: 'Received PubSub push to /internal/router/commands',
      });

      expect(loggedPayloads[0]?.message).toBe('Received PubSub push to /internal/router/commands');
    });

    it('includes additional fields', () => {
      logIncomingRequest(mockRequest as FastifyRequest, {
        additionalFields: { userId: 'user-123', correlationId: 'corr-789' },
      });

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload.userId).toBe('user-123');
      expect(payload.correlationId).toBe('corr-789');
    });

    it('handles logging errors gracefully with circular reference', () => {
      const circular: { self?: unknown } = {};
      circular.self = circular;
      mockRequest.body = circular;

      // Should handle gracefully by catching JSON.stringify error
      logIncomingRequest(mockRequest as FastifyRequest);

      // Will log debug message due to circular reference error
      expect(debugLogs.length).toBeGreaterThan(0);
      expect(debugLogs[0]?.message).toBe('Failed to log incoming request');
    });

    it('handles empty headers', () => {
      mockRequest.headers = {};

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload.headers).toEqual({});
    });

    it('handles info logging error gracefully', () => {
      mockRequest.log = {
        info: () => {
          throw new Error('Logging infrastructure failure');
        },
        debug: (payload: unknown, message: string) => {
          debugLogs.push({ payload, message });
        },
      } as unknown as FastifyRequest['log'];

      // Should not throw
      expect(() => {
        logIncomingRequest(mockRequest as FastifyRequest);
      }).not.toThrow();

      expect(debugLogs.length).toBeGreaterThan(0);
      expect(debugLogs[0]?.message).toBe('Failed to log incoming request');
    });

    it('combines all options correctly', () => {
      logIncomingRequest(mockRequest as FastifyRequest, {
        bodyPreviewLength: 50,
        includeParams: true,
        message: 'Custom message',
        additionalFields: { extra: 'field' },
      });

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];

      expect(logged?.message).toBe('Custom message');

      const payload = logged?.payload as Record<string, unknown>;
      expect(payload.event).toBe('incoming_request');
      expect(payload.params).toEqual({ actionId: 'act-456' });
      expect(payload.extra).toBe('field');
      expect((payload.bodyPreview as string).length).toBeLessThanOrEqual(50);
    });

    it('redacts x-goog-iap-jwt-assertion header', () => {
      mockRequest.headers = {
        'x-goog-iap-jwt-assertion': 'sensitive-jwt-token-value',
      };

      logIncomingRequest(mockRequest as FastifyRequest);

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;
      const headers = payload.headers as Record<string, unknown>;

      expect(headers['x-goog-iap-jwt-assertion']).toContain('...');
      expect(headers['x-goog-iap-jwt-assertion']).not.toBe('sensitive-jwt-token-value');
    });

    it('handles undefined body gracefully', () => {
      mockRequest.body = undefined;

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      // undefined becomes "undefined" string when JSON.stringified
      expect(payload.bodyPreview).toBe('undefined');
    });

    it('handles null body gracefully', () => {
      mockRequest.body = null;

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload.bodyPreview).toBe('null');
    });

    it('handles empty object body', () => {
      mockRequest.body = {};

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload.bodyPreview).toBe('{}');
    });

    it('respects bodyPreviewLength of 0', () => {
      logIncomingRequest(mockRequest as FastifyRequest, { bodyPreviewLength: 0 });

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload.bodyPreview).toBe('');
    });

    it('handles very long headers without error', () => {
      const longValue = 'a'.repeat(10000);
      mockRequest.headers = {
        'x-custom-header': longValue,
      };

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;
      const headers = payload.headers as Record<string, unknown>;

      // Header should be included (not redacted since it's not sensitive)
      expect(headers['x-custom-header']).toBe(longValue);
    });
  });
});
