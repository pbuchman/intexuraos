import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import { FakeCommandRepository, FakeActionRepository, FakeClassifier } from './fakes.js';

const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH_AUDIENCE = 'urn:intexuraos:api';
const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Commands Router Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let jwksUrl: string;
  let privateKey: jose.KeyLike;
  const issuer = `https://${AUTH0_DOMAIN}/`;

  let fakeCommandRepo: FakeCommandRepository;
  let fakeActionRepo: FakeActionRepository;
  let fakeClassifier: FakeClassifier;

  async function createAccessToken(sub: string): Promise<string> {
    return await new jose.SignJWT({
      sub,
      aud: AUTH_AUDIENCE,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer(issuer)
      .sign(privateKey);
  }

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256');
    privateKey = keyPair.privateKey;

    const publicKeyJwk = await jose.exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = 'test-key-1';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    jwksServer = Fastify({ logger: false });

    jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
      return await reply.send({
        keys: [publicKeyJwk],
      });
    });

    await jwksServer.listen({ port: 0, host: '127.0.0.1' });
    const address = jwksServer.server.address();
    if (address !== null && typeof address === 'object') {
      jwksUrl = `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  beforeEach(() => {
    process.env['AUTH_JWKS_URL'] = jwksUrl;
    process.env['AUTH_ISSUER'] = issuer;
    process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

    clearJwksCache();

    fakeCommandRepo = new FakeCommandRepository();
    fakeActionRepo = new FakeActionRepository();
    fakeClassifier = new FakeClassifier();
    setServices({
      commandRepository: fakeCommandRepo,
      actionRepository: fakeActionRepo,
      classifier: fakeClassifier,
    });
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('POST /internal/router/commands (PubSub push endpoint)', () => {
    const validMessagePayload = {
      message: {
        data: Buffer.from(
          JSON.stringify({
            type: 'command.ingest',
            userId: 'user-1',
            sourceType: 'whatsapp_text',
            externalId: 'msg-1',
            text: 'Test',
            timestamp: '2025-01-01T12:00:00.000Z',
          })
        ).toString('base64'),
        messageId: 'pubsub-msg-1',
      },
    };

    it('returns 401 when no internal auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        payload: validMessagePayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when internal auth token is wrong', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
        payload: validMessagePayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': 'any-token',
        },
        payload: validMessagePayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when message data is invalid base64', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: {
            data: 'not-valid-base64!!!',
            messageId: 'pubsub-invalid',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Invalid message format');
    });

    it('returns 400 when message is missing', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('processes valid command and returns 200', async () => {
      app = await buildServer();

      const event = {
        type: 'command.ingest',
        userId: 'user-123',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.abc123',
        text: 'Buy groceries tomorrow',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: {
            data: messageData,
            messageId: 'pubsub-123',
          },
          subscription: 'projects/test/subscriptions/commands-ingest',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify command was saved
      const commands = await fakeCommandRepo.listByUserId('user-123');
      expect(commands).toHaveLength(1);
      expect(commands[0]?.text).toBe('Buy groceries tomorrow');
    });

    it('handles idempotency - skips duplicate commands', async () => {
      app = await buildServer();

      const event = {
        type: 'command.ingest',
        userId: 'user-123',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.duplicate',
        text: 'Duplicate command',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      // First request
      await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: { data: messageData, messageId: 'pubsub-1' },
        },
      });

      // Second request (duplicate)
      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: { data: messageData, messageId: 'pubsub-2' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      // Should only have one command
      const commands = await fakeCommandRepo.listByUserId('user-123');
      expect(commands).toHaveLength(1);
    });

    it('classifies command and creates action', async () => {
      app = await buildServer();

      fakeClassifier.setResult({
        type: 'todo',
        confidence: 0.95,
        title: 'Buy groceries',
      });

      const event = {
        type: 'command.ingest',
        userId: 'user-456',
        sourceType: 'whatsapp_voice',
        externalId: 'wamid.voice123',
        text: 'Remind me to buy groceries',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: { data: messageData, messageId: 'pubsub-voice' },
        },
      });

      // Verify action was created
      const actions = await fakeActionRepo.listByUserId('user-456');
      expect(actions).toHaveLength(1);
      expect(actions[0]?.type).toBe('todo');
      expect(actions[0]?.title).toBe('Buy groceries');
      expect(actions[0]?.confidence).toBe(0.95);
    });

    it('handles unclassified commands without creating action', async () => {
      app = await buildServer();

      fakeClassifier.setResult({
        type: 'unclassified',
        confidence: 0.3,
        title: 'Unknown',
      });

      const event = {
        type: 'command.ingest',
        userId: 'user-789',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.unclass',
        text: 'Random gibberish',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: { data: messageData, messageId: 'pubsub-unclass' },
        },
      });

      expect(response.statusCode).toBe(200);

      // Command should be saved but no action created
      const commands = await fakeCommandRepo.listByUserId('user-789');
      expect(commands).toHaveLength(1);
      expect(commands[0]?.status).toBe('classified');

      const actions = await fakeActionRepo.listByUserId('user-789');
      expect(actions).toHaveLength(0);
    });

    it('handles classifier failure gracefully', async () => {
      app = await buildServer();

      fakeClassifier.setFailNext(true);

      const event = {
        type: 'command.ingest',
        userId: 'user-fail',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.fail',
        text: 'This will fail',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: { data: messageData, messageId: 'pubsub-fail' },
        },
      });

      expect(response.statusCode).toBe(200);

      // Command should be saved with failed status
      const commands = await fakeCommandRepo.listByUserId('user-fail');
      expect(commands).toHaveLength(1);
      expect(commands[0]?.status).toBe('failed');
    });
  });

  describe('GET /router/commands (authenticated)', () => {
    it('returns 401 when no auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/router/commands',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns empty list when no commands', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-empty');

      const response = await app.inject({
        method: 'GET',
        url: '/router/commands',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { commands: unknown[] } };
      expect(body.success).toBe(true);
      expect(body.data.commands).toHaveLength(0);
    });

    it('returns user commands', async () => {
      app = await buildServer();
      const userId = 'user-with-commands';
      const token = await createAccessToken(userId);

      // Add command for this user
      fakeCommandRepo.addCommand({
        id: 'whatsapp_text:cmd1',
        userId,
        sourceType: 'whatsapp_text',
        externalId: 'cmd1',
        text: 'Test command',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'classified',
        classification: { type: 'note', confidence: 0.8, classifiedAt: '2025-01-01T12:00:01.000Z' },
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:01.000Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/router/commands',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { commands: Array<{ id: string; text: string }> };
      };
      expect(body.success).toBe(true);
      expect(body.data.commands).toHaveLength(1);
      expect(body.data.commands[0]?.text).toBe('Test command');
    });
  });

  describe('GET /router/actions (authenticated)', () => {
    it('returns 401 when no auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/router/actions',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns empty list when no actions', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-no-actions');

      const response = await app.inject({
        method: 'GET',
        url: '/router/actions',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { actions: unknown[] } };
      expect(body.success).toBe(true);
      expect(body.data.actions).toHaveLength(0);
    });

    it('returns user actions', async () => {
      app = await buildServer();
      const userId = 'user-with-actions';
      const token = await createAccessToken(userId);

      // Add action for this user
      fakeActionRepo.addAction({
        id: 'action-1',
        userId,
        commandId: 'cmd-1',
        type: 'todo',
        confidence: 0.9,
        title: 'Buy milk',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/router/actions',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { actions: Array<{ id: string; title: string; type: string }> };
      };
      expect(body.success).toBe(true);
      expect(body.data.actions).toHaveLength(1);
      expect(body.data.actions[0]?.title).toBe('Buy milk');
      expect(body.data.actions[0]?.type).toBe('todo');
    });
  });

  describe('System endpoints', () => {
    it('GET /health returns 200', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
    });

    it('GET /openapi.json returns 200', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { openapi: string };
      expect(body.openapi).toBe('3.1.1');
    });
  });
});
