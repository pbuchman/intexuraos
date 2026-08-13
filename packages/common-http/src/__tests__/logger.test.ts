import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  shouldLogRequest,
  logIncomingRequest,
  registerQuietHealthCheckLogging,
} from '../http/logger.js';

type Done = () => void;
type OnRequestHook = (request: FastifyRequest, reply: FastifyReply, done: Done) => void;
type OnResponseHook = (request: FastifyRequest, reply: FastifyReply, done: Done) => void;

function makeHookRecorder(): {
  app: FastifyInstance;
  hooks: { onRequest?: OnRequestHook; onResponse?: OnResponseHook };
} {
  const hooks: { onRequest?: OnRequestHook; onResponse?: OnResponseHook } = {};
  const app = {
    addHook: (name: string, handler: unknown) => {
      if (name === 'onRequest') {
        hooks.onRequest = handler as OnRequestHook;
      }
      if (name === 'onResponse') {
        hooks.onResponse = handler as OnResponseHook;
      }
      return app;
    },
  } as unknown as FastifyInstance;
  return { app, hooks };
}

describe('Logger utilities', () => {
  describe('shouldLogRequest', () => {
    it('returns true for non-health-check paths', () => {
      expect(shouldLogRequest('/api/users')).toBe(true);
      expect(shouldLogRequest('/internal/bookmarks')).toBe(true);
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

  describe('registerQuietHealthCheckLogging', () => {
    it('logs request and response details for non-health paths', () => {
      const { app, hooks } = makeHookRecorder();
      registerQuietHealthCheckLogging(app);
      const info = vi.fn();
      const request = {
        method: 'GET',
        url: '/api/users/secret-user-id?active=true&token=secret-query',
        routeOptions: { url: '/api/users/:userId' },
        headers: { host: 'api.example.test' },
        ip: '127.0.0.1',
        log: { info },
      } as unknown as FastifyRequest;
      const reply = { statusCode: 200, elapsedTime: 12.5 } as FastifyReply;
      const done = vi.fn();

      hooks.onRequest?.(request, reply, done);
      hooks.onResponse?.(request, reply, done);

      expect(done).toHaveBeenCalledTimes(2);
      expect(info).toHaveBeenCalledWith(
        {
          req: {
            method: 'GET',
            url: '/api/users/:userId',
            host: 'api.example.test',
            remoteAddress: '127.0.0.1',
          },
        },
        'incoming request'
      );
      expect(JSON.stringify(info.mock.calls)).not.toContain('secret-user-id');
      expect(JSON.stringify(info.mock.calls)).not.toContain('secret-query');
      expect(info).toHaveBeenCalledWith(
        {
          res: { statusCode: 200 },
          responseTime: 12.5,
        },
        'request completed'
      );
    });

    it('uses a content-free label when no route template is available', () => {
      const { app, hooks } = makeHookRecorder();
      registerQuietHealthCheckLogging(app);
      const info = vi.fn();
      const request = {
        method: 'GET',
        url: '/unknown/private-id?question=private-text',
        routeOptions: {},
        headers: { host: 'api.example.test' },
        ip: '127.0.0.1',
        log: { info },
      } as unknown as FastifyRequest;

      hooks.onRequest?.(request, {} as FastifyReply, vi.fn());

      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ req: expect.objectContaining({ url: 'unmatched_route' }) }),
        'incoming request'
      );
      expect(JSON.stringify(info.mock.calls)).not.toContain('private-id');
      expect(JSON.stringify(info.mock.calls)).not.toContain('private-text');
    });

    it('skips request and response logs for health checks', () => {
      const { app, hooks } = makeHookRecorder();
      registerQuietHealthCheckLogging(app);
      const info = vi.fn();
      const request = {
        method: 'GET',
        url: '/health?probe=cloud-run',
        headers: { host: 'api.example.test' },
        ip: '127.0.0.1',
        log: { info },
      } as unknown as FastifyRequest;
      const reply = { statusCode: 200, elapsedTime: 1.5 } as FastifyReply;
      const done = vi.fn();

      hooks.onRequest?.(request, reply, done);
      hooks.onResponse?.(request, reply, done);

      expect(done).toHaveBeenCalledTimes(2);
      expect(info).not.toHaveBeenCalled();
    });

    it('redacts identifiers from configured private request paths', () => {
      const { app, hooks } = makeHookRecorder();
      registerQuietHealthCheckLogging(app, {
        privatePathPrefixes: ['/internal/matrix-corpus/', '/internal/test-runs/'],
      });
      const info = vi.fn();
      const request = {
        method: 'GET',
        url: '/internal/matrix-corpus/runs/RUN_PRIVATE_SENTINEL/scenarios/SCENARIO_PRIVATE_SENTINEL/evidence?token=QUERY_PRIVATE_SENTINEL',
        headers: { host: 'api.example.test' },
        ip: '127.0.0.1',
        log: { info },
      } as unknown as FastifyRequest;
      const reply = { statusCode: 200, elapsedTime: 4 } as FastifyReply;
      const done = vi.fn();

      hooks.onRequest?.(request, reply, done);
      hooks.onResponse?.(request, reply, done);

      const serialized = JSON.stringify(info.mock.calls);
      expect(serialized).toContain('/internal/matrix-corpus/[REDACTED]');
      expect(serialized).not.toContain('RUN_PRIVATE_SENTINEL');
      expect(serialized).not.toContain('SCENARIO_PRIVATE_SENTINEL');
      expect(serialized).not.toContain('QUERY_PRIVATE_SENTINEL');
    });

    it('redacts configured Test Run projection identifiers', () => {
      const { app, hooks } = makeHookRecorder();
      registerQuietHealthCheckLogging(app, {
        privatePathPrefixes: ['/internal/matrix-corpus/', '/internal/test-runs/'],
      });
      const info = vi.fn();
      const request = {
        method: 'PUT',
        url: '/internal/test-runs/RUN_PROJECTION_PRIVATE_SENTINEL/projection',
        headers: { host: 'api.example.test' },
        ip: '127.0.0.1',
        log: { info },
      } as unknown as FastifyRequest;
      const reply = { statusCode: 200, elapsedTime: 4 } as FastifyReply;

      hooks.onRequest?.(request, reply, vi.fn());

      const serialized = JSON.stringify(info.mock.calls);
      expect(serialized).toContain('/internal/test-runs/[REDACTED]');
      expect(serialized).not.toContain('RUN_PROJECTION_PRIVATE_SENTINEL');
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
          'x-internal-auth': '[REDACTED]',
          authorization: '[REDACTED]',
        },
      });

      const payload = logged?.payload as Record<string, unknown>;
      const headers = payload['headers'] as Record<string, unknown>;
      expect(headers['user-agent']).toBeUndefined();
    });

    it('never serializes request body values into logs', () => {
      mockRequest.body = {
        apiKey: 'REQUEST_BODY_SECRET_SENTINEL',
        nested: { refresh_token: 'REQUEST_BODY_REFRESH_SENTINEL' },
      };

      logIncomingRequest(mockRequest as FastifyRequest, { bodyPreviewLength: 500 });

      const serializedPayload = JSON.stringify(loggedPayloads[0]?.payload);
      expect(serializedPayload).not.toContain('REQUEST_BODY_SECRET_SENTINEL');
      expect(serializedPayload).not.toContain('REQUEST_BODY_REFRESH_SENTINEL');
      expect(loggedPayloads[0]?.payload).not.toHaveProperty('bodyPreview');
    });

    it('serializes only coarse diagnostic headers and fixed authentication markers', () => {
      mockRequest.headers = {
        'content-type': 'application/json',
        'content-length': '321',
        authorization: 'Bearer authorization-canary',
        'x-internal-auth': 'internal-auth-canary',
        'x-conversation-assistant-deletion-token': 'deletion-token-canary',
        'x-request-id': 'request-id-canary',
        'x-custom-header': 'custom-header-canary',
        referer: 'https://example.test/referer-canary',
        'user-agent': 'user-agent-canary',
      };

      logIncomingRequest(mockRequest as FastifyRequest);

      const serializedPayload = JSON.stringify(loggedPayloads[0]?.payload);
      const payload = loggedPayloads[0]?.payload as Record<string, unknown>;
      expect(payload['headers']).toEqual({
        'content-type': 'application/json',
        'content-length': '321',
        authorization: '[REDACTED]',
        'x-internal-auth': '[REDACTED]',
      });
      expect(serializedPayload).not.toContain('x-conversation-assistant-deletion-token');
      expect(serializedPayload).not.toContain('deletion-token-canary');
      expect(serializedPayload).not.toContain('x-request-id');
      expect(serializedPayload).not.toContain('request-id-canary');
      expect(serializedPayload).not.toContain('x-custom-header');
      expect(serializedPayload).not.toContain('custom-header-canary');
      expect(serializedPayload).not.toContain('referer');
      expect(serializedPayload).not.toContain('referer-canary');
      expect(serializedPayload).not.toContain('user-agent');
      expect(serializedPayload).not.toContain('user-agent-canary');
      expect(serializedPayload).not.toContain('authorization-canary');
      expect(serializedPayload).not.toContain('internal-auth-canary');
    });

    it('includes params when requested', () => {
      logIncomingRequest(mockRequest as FastifyRequest, { includeParams: true });

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload['params']).toEqual({ actionId: 'act-456' });
    });

    it('excludes params by default', () => {
      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload['params']).toBeUndefined();
    });

    it('ignores the deprecated body preview option', () => {
      const longBody = 'a'.repeat(1000);
      mockRequest.body = { text: longBody };

      logIncomingRequest(mockRequest as FastifyRequest, { bodyPreviewLength: 100 });

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('bodyPreview');
      expect(JSON.stringify(payload)).not.toContain(longBody);
    });

    it('uses custom message', () => {
      logIncomingRequest(mockRequest as FastifyRequest, {
        message: 'Received PubSub push to /internal/bookmarks',
      });

      expect(loggedPayloads[0]?.message).toBe('Received PubSub push to /internal/bookmarks');
    });

    it('includes additional fields', () => {
      logIncomingRequest(mockRequest as FastifyRequest, {
        additionalFields: { userId: 'user-123', correlationId: 'corr-789' },
      });

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload['userId']).toBe('user-123');
      expect(payload['correlationId']).toBe('corr-789');
    });

    it('does not inspect circular request bodies', () => {
      const circular: { self?: unknown } = {};
      circular.self = circular;
      mockRequest.body = circular;

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      expect(debugLogs).toHaveLength(0);
    });

    it('handles empty headers', () => {
      mockRequest.headers = {};

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload['headers']).toEqual({});
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
      expect(payload['event']).toBe('incoming_request');
      expect(payload['params']).toEqual({ actionId: 'act-456' });
      expect(payload['extra']).toBe('field');
      expect(payload).not.toHaveProperty('bodyPreview');
    });

    it('omits x-goog-iap-jwt-assertion header', () => {
      mockRequest.headers = {
        'x-goog-iap-jwt-assertion': 'sensitive-jwt-token-value',
      };

      logIncomingRequest(mockRequest as FastifyRequest);

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;
      const headers = payload['headers'] as Record<string, unknown>;

      expect(headers['x-goog-iap-jwt-assertion']).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain('sensitive-jwt-token-value');
    });

    it('handles undefined body gracefully', () => {
      mockRequest.body = undefined;

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload).not.toHaveProperty('bodyPreview');
    });

    it('handles null body gracefully', () => {
      mockRequest.body = null;

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload).not.toHaveProperty('bodyPreview');
    });

    it('handles empty object body', () => {
      mockRequest.body = {};

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload).not.toHaveProperty('bodyPreview');
    });

    it('respects bodyPreviewLength of 0', () => {
      logIncomingRequest(mockRequest as FastifyRequest, { bodyPreviewLength: 0 });

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(payload).not.toHaveProperty('bodyPreview');
    });

    it('omits headers when includeHeaders is false', () => {
      logIncomingRequest(mockRequest as FastifyRequest, { includeHeaders: false });

      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;

      expect(Object.hasOwn(payload, 'headers')).toBe(false);
    });

    it('omits very long arbitrary headers without error', () => {
      const longValue = 'a'.repeat(10000);
      mockRequest.headers = {
        'x-custom-header': longValue,
      };

      logIncomingRequest(mockRequest as FastifyRequest);

      expect(loggedPayloads).toHaveLength(1);
      const logged = loggedPayloads[0];
      const payload = logged?.payload as Record<string, unknown>;
      const headers = payload['headers'] as Record<string, unknown>;

      expect(headers['x-custom-header']).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain(longValue);
    });
  });
});
