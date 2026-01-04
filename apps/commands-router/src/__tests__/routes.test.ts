import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeCommandRepository,
  FakeActionsAgentClient,
  FakeClassifier,
  FakeUserServiceClient,
  FakeEventPublisher,
  createFakeServices,
} from './fakes.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';
const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Commands Router Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let jwksUrl: string;
  let privateKey: jose.KeyLike;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  let fakeCommandRepo: FakeCommandRepository;
  let fakeActionsAgentClient: FakeActionsAgentClient;
  let fakeClassifier: FakeClassifier;
  let fakeUserServiceClient: FakeUserServiceClient;
  let fakeEventPublisher: FakeEventPublisher;

  async function createAccessToken(sub: string): Promise<string> {
    return await new jose.SignJWT({
      sub,
      aud: INTEXURAOS_AUTH_AUDIENCE,
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
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = jwksUrl;
    process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

    clearJwksCache();

    fakeCommandRepo = new FakeCommandRepository();
    fakeActionsAgentClient = new FakeActionsAgentClient();
    fakeClassifier = new FakeClassifier();
    fakeUserServiceClient = new FakeUserServiceClient();
    fakeEventPublisher = new FakeEventPublisher();

    fakeUserServiceClient.setApiKeys('user-1', { google: 'test-gemini-key' });
    fakeUserServiceClient.setApiKeys('user-123', { google: 'test-gemini-key' });
    fakeUserServiceClient.setApiKeys('user-456', { google: 'test-gemini-key' });
    fakeUserServiceClient.setApiKeys('user-789', { google: 'test-gemini-key' });
    fakeUserServiceClient.setApiKeys('user-fail', { google: 'test-gemini-key' });

    setServices(
      createFakeServices({
        commandRepository: fakeCommandRepo,
        actionsAgentClient: fakeActionsAgentClient,
        classifier: fakeClassifier,
        userServiceClient: fakeUserServiceClient,
        eventPublisher: fakeEventPublisher,
      })
    );
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

    describe('Pub/Sub OIDC authentication', () => {
      it('accepts Pub/Sub push with from: noreply@google.com header (no x-internal-auth)', async () => {
        app = await buildServer();

        fakeUserServiceClient.setApiKeys('test-user', { google: 'test-gemini-key' });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/router/commands',
          headers: {
            'content-type': 'application/json',
            from: 'noreply@google.com',
            // NOTE: NO x-internal-auth header - should still work via OIDC
          },
          payload: {
            message: {
              data: Buffer.from(
                JSON.stringify({
                  type: 'command.ingest',
                  userId: 'test-user',
                  sourceType: 'whatsapp_text',
                  externalId: 'wa-msg-123',
                  text: 'Test command',
                  timestamp: '2025-01-01T12:00:00.000Z',
                })
              ).toString('base64'),
              messageId: 'pubsub-msg-123',
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as { success: boolean; commandId: string };
        expect(body.success).toBe(true);
        expect(body.commandId).toBeDefined();
      });

      it('rejects direct calls without x-internal-auth or Pub/Sub from header', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/internal/router/commands',
          headers: {
            'content-type': 'application/json',
            // NO from: noreply@google.com
            // NO x-internal-auth
          },
          payload: validMessagePayload,
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body) as { error: string };
        expect(body.error).toBe('Unauthorized');
      });
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
        reasoning: 'Contains grocery shopping task',
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
      const actions = fakeActionsAgentClient
        .getCreatedActions()
        .filter((a) => a.userId === 'user-456');
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
        reasoning: 'No clear intent detected',
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

      const actions = fakeActionsAgentClient
        .getCreatedActions()
        .filter((a) => a.userId === 'user-789');
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

    it('marks command as pending_classification when user has no Gemini key', async () => {
      app = await buildServer();

      const event = {
        type: 'command.ingest',
        userId: 'user-no-key',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.nokey',
        text: 'Buy groceries',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { message: { data: messageData, messageId: 'pubsub-nokey' } },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; isNew: boolean };
      expect(body.success).toBe(true);
      expect(body.isNew).toBe(true);

      const commands = await fakeCommandRepo.listByUserId('user-no-key');
      expect(commands).toHaveLength(1);
      expect(commands[0]?.status).toBe('pending_classification');
    });

    it('marks command as pending_classification when user service fails', async () => {
      app = await buildServer();

      fakeUserServiceClient.setFailNext(true);

      const event = {
        type: 'command.ingest',
        userId: 'user-123',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.svcfail',
        text: 'Service will fail',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { message: { data: messageData, messageId: 'pubsub-svcfail' } },
      });

      expect(response.statusCode).toBe(200);

      const commands = await fakeCommandRepo.listByUserId('user-123');
      const command = commands.find((c) => c.externalId === 'wamid.svcfail');
      expect(command?.status).toBe('pending_classification');
    });

    it('classifies command when user has Gemini key configured', async () => {
      app = await buildServer();

      fakeUserServiceClient.setApiKeys('user-with-key', { google: 'valid-gemini-key' });
      fakeClassifier.setResult({
        type: 'todo',
        confidence: 0.9,
        title: 'Test Task',
        reasoning: 'Contains task indicator',
      });

      const event = {
        type: 'command.ingest',
        userId: 'user-with-key',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.withkey',
        text: 'Buy groceries',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { message: { data: messageData, messageId: 'pubsub-withkey' } },
      });

      expect(response.statusCode).toBe(200);

      const commands = await fakeCommandRepo.listByUserId('user-with-key');
      expect(commands).toHaveLength(1);
      expect(commands[0]?.status).toBe('classified');

      const actions = fakeActionsAgentClient
        .getCreatedActions()
        .filter((a) => a.userId === 'user-with-key');
      expect(actions).toHaveLength(1);
      expect(actions[0]?.title).toBe('Test Task');
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
        classification: {
          type: 'note',
          confidence: 0.8,
          reasoning: 'Information storage request',
          classifiedAt: '2025-01-01T12:00:01.000Z',
        },
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
        data: { commands: { id: string; text: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.commands).toHaveLength(1);
      expect(body.data.commands[0]?.text).toBe('Test command');
    });
  });

  describe('POST /router/commands (create command)', () => {
    it('returns 401 when no auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/router/commands',
        payload: { text: 'Test shared content', source: 'pwa-shared' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when text is missing', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-pwa-1');

      const response = await app.inject({
        method: 'POST',
        url: '/router/commands',
        headers: { authorization: `Bearer ${token}` },
        payload: { source: 'pwa-shared' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when source is missing', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-pwa-2');

      const response = await app.inject({
        method: 'POST',
        url: '/router/commands',
        headers: { authorization: `Bearer ${token}` },
        payload: { text: 'Test content' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('creates command from pwa-shared source', async () => {
      app = await buildServer();
      const userId = 'user-pwa-create';
      const token = await createAccessToken(userId);
      fakeUserServiceClient.setApiKeys(userId, { google: 'test-key' });

      fakeClassifier.setResult({
        type: 'note',
        confidence: 0.85,
        title: 'Shared Note',
        reasoning: 'General information to note',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/router/commands',
        headers: { authorization: `Bearer ${token}` },
        payload: { text: 'Test shared content from PWA', source: 'pwa-shared' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { command: { id: string; text: string; sourceType: string; status: string } };
      };
      expect(body.success).toBe(true);
      expect(body.data.command.text).toBe('Test shared content from PWA');
      expect(body.data.command.sourceType).toBe('pwa-shared');
    });

    it('processes command and classifies it', async () => {
      app = await buildServer();
      const userId = 'user-pwa-classify';
      const token = await createAccessToken(userId);
      fakeUserServiceClient.setApiKeys(userId, { google: 'test-key' });

      fakeClassifier.setResult({
        type: 'research',
        confidence: 0.9,
        title: 'Research Topic',
        reasoning: 'Research request',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/router/commands',
        headers: { authorization: `Bearer ${token}` },
        payload: { text: 'Research the latest news', source: 'pwa-shared' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { command: { status: string; classification?: { type: string } } };
      };
      expect(body.data.command.status).toBe('classified');
      expect(body.data.command.classification?.type).toBe('research');
    });
  });

  //   describe('GET /router/actions (authenticated)', () => {
  //     it('returns 401 when no auth header', async () => {
  //       app = await buildServer();
  //
  //       const response = await app.inject({
  //         method: 'GET',
  //         url: '/router/actions',
  //       });
  //
  //       expect(response.statusCode).toBe(401);
  //     });
  //
  //     it('returns empty list when no actions', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-no-actions');
  //
  //       const response = await app.inject({
  //         method: 'GET',
  //         url: '/router/actions',
  //         headers: {
  //           authorization: `Bearer ${token}`,
  //         },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as { success: boolean; data: { actions: unknown[] } };
  //       expect(body.success).toBe(true);
  //       expect(body.data.actions).toHaveLength(0);
  //     });
  //
  //     it('returns user actions', async () => {
  //       app = await buildServer();
  //       const userId = 'user-with-actions';
  //       const token = await createAccessToken(userId);
  //
  //       // Add action for this user
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-1',
  //         userId,
  //         commandId: 'cmd-1',
  //         type: 'todo',
  //         confidence: 0.9,
  //         title: 'Buy milk',
  //         status: 'pending',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'GET',
  //         url: '/router/actions',
  //         headers: {
  //           authorization: `Bearer ${token}`,
  //         },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as {
  //         success: boolean;
  //         data: { actions: { id: string; title: string; type: string }[] };
  //       };
  //       expect(body.success).toBe(true);
  //       expect(body.data.actions).toHaveLength(1);
  //       expect(body.data.actions[0]?.title).toBe('Buy milk');
  //       expect(body.data.actions[0]?.type).toBe('todo');
  //     });
  //   });
  //
  //   describe('PATCH /internal/actions/:actionId', () => {
  //     it('returns 401 when no internal auth header', async () => {
  //       app = await buildServer();
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/internal/actions/action-1',
  //         payload: { status: 'completed' },
  //       });
  //
  //       expect(response.statusCode).toBe(401);
  //     });
  //
  //     it('returns 401 when internal auth token is wrong', async () => {
  //       app = await buildServer();
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/internal/actions/action-1',
  //         headers: { 'x-internal-auth': 'wrong-token' },
  //         payload: { status: 'completed' },
  //       });
  //
  //       expect(response.statusCode).toBe(401);
  //     });
  //
  //     it('returns 404 when action not found', async () => {
  //       app = await buildServer();
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/internal/actions/nonexistent',
  //         headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
  //         payload: { status: 'completed' },
  //       });
  //
  //       expect(response.statusCode).toBe(404);
  //       const body = JSON.parse(response.body) as { error: string };
  //       expect(body.error).toBe('Action not found');
  //     });
  //
  //     it('updates action status successfully', async () => {
  //       app = await buildServer();
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-update-1',
  //         userId: 'user-1',
  //         commandId: 'cmd-1',
  //         type: 'research',
  //         confidence: 0.9,
  //         title: 'Test Research',
  //         status: 'pending',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/internal/actions/action-update-1',
  //         headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
  //         payload: { status: 'processing' },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as { success: boolean };
  //       expect(body.success).toBe(true);
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-update-1');
  //       expect(updatedAction?.status).toBe('processing');
  //     });
  //
  //     it('updates action status and merges payload', async () => {
  //       app = await buildServer();
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-update-2',
  //         userId: 'user-1',
  //         commandId: 'cmd-1',
  //         type: 'research',
  //         confidence: 0.9,
  //         title: 'Test Research',
  //         status: 'processing',
  //         payload: { existing: 'data' },
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/internal/actions/action-update-2',
  //         headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
  //         payload: {
  //           status: 'completed',
  //           payload: { result: 'Research completed', sources: ['source1', 'source2'] },
  //         },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-update-2');
  //       expect(updatedAction?.status).toBe('completed');
  //       expect(updatedAction?.payload).toEqual({
  //         existing: 'data',
  //         result: 'Research completed',
  //         sources: ['source1', 'source2'],
  //       });
  //     });
  //
  //     it('updates action to failed status', async () => {
  //       app = await buildServer();
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-fail',
  //         userId: 'user-1',
  //         commandId: 'cmd-1',
  //         type: 'research',
  //         confidence: 0.9,
  //         title: 'Test Research',
  //         status: 'processing',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/internal/actions/action-fail',
  //         headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
  //         payload: {
  //           status: 'failed',
  //           payload: { error: 'LLM API error' },
  //         },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-fail');
  //       expect(updatedAction?.status).toBe('failed');
  //       expect(updatedAction?.payload).toEqual({ error: 'LLM API error' });
  //     });
  //   });
  //
  describe('Event publishing', () => {
    it('publishes event when action is created', async () => {
      app = await buildServer();

      fakeClassifier.setResult({
        type: 'research',
        confidence: 0.95,
        title: 'Research AI trends',
        reasoning: 'Research query about AI trends',
      });

      const event = {
        type: 'command.ingest',
        userId: 'user-event-1',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.event1',
        text: 'Research the latest AI trends',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      fakeUserServiceClient.setApiKeys('user-event-1', { google: 'test-key' });

      await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { message: { data: messageData, messageId: 'pubsub-event1' } },
      });

      const publishedEvents = fakeEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.type).toBe('action.created');
      expect(publishedEvents[0]?.actionType).toBe('research');
      expect(publishedEvents[0]?.title).toBe('Research AI trends');
      expect(publishedEvents[0]?.payload.prompt).toBe('Research the latest AI trends');
    });

    it('does not publish event for unclassified commands', async () => {
      app = await buildServer();

      fakeClassifier.setResult({
        type: 'unclassified',
        confidence: 0.3,
        title: 'Unknown',
        reasoning: 'No clear intent detected',
      });

      const event = {
        type: 'command.ingest',
        userId: 'user-event-2',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.event2',
        text: 'Random gibberish',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      fakeUserServiceClient.setApiKeys('user-event-2', { google: 'test-key' });

      await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { message: { data: messageData, messageId: 'pubsub-event2' } },
      });

      const publishedEvents = fakeEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(0);
    });

    it('includes selectedModels in event payload', async () => {
      app = await buildServer();

      fakeClassifier.setResult({
        type: 'research',
        confidence: 0.95,
        title: 'Research topic',
        reasoning: 'Research query with model selection',
        selectedModels: ['gemini-2.5-flash', 'claude-sonnet-4-5-20250929'],
      });

      const event = {
        type: 'command.ingest',
        userId: 'user-event-3',
        sourceType: 'whatsapp_text',
        externalId: 'wamid.event3',
        text: 'Research this with gemini and claude',
        timestamp: '2025-01-01T12:00:00.000Z',
      };
      const messageData = Buffer.from(JSON.stringify(event)).toString('base64');

      fakeUserServiceClient.setApiKeys('user-event-3', { google: 'test-key' });

      await app.inject({
        method: 'POST',
        url: '/internal/router/commands',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { message: { data: messageData, messageId: 'pubsub-event3' } },
      });

      const publishedEvents = fakeEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.payload.selectedModels).toEqual([
        'gemini-2.5-flash',
        'claude-sonnet-4-5-20250929',
      ]);
    });
  });

  describe('POST /internal/router/retry-pending', () => {
    it('returns 401 when no internal auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when internal auth token is wrong', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
        headers: { 'x-internal-auth': 'wrong-token' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts OIDC Bearer token authentication (Cloud Scheduler)', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
        headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.fake-oidc-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns success with zero counts when no pending commands', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        processed: number;
        skipped: number;
        failed: number;
        total: number;
      };
      expect(body.success).toBe(true);
      expect(body.processed).toBe(0);
      expect(body.skipped).toBe(0);
      expect(body.failed).toBe(0);
      expect(body.total).toBe(0);
    });

    it('classifies pending command when user now has API key', async () => {
      app = await buildServer();

      fakeCommandRepo.addCommand({
        id: 'whatsapp_text:retry-1',
        userId: 'user-retry-1',
        sourceType: 'whatsapp_text',
        externalId: 'retry-1',
        text: 'Buy groceries',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'pending_classification',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      fakeUserServiceClient.setApiKeys('user-retry-1', { google: 'new-gemini-key' });
      fakeClassifier.setResult({
        type: 'todo',
        confidence: 0.9,
        title: 'Buy groceries',
        reasoning: 'Shopping task',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        processed: number;
        skipped: number;
        failed: number;
        total: number;
      };
      expect(body.success).toBe(true);
      expect(body.processed).toBe(1);
      expect(body.skipped).toBe(0);
      expect(body.failed).toBe(0);
      expect(body.total).toBe(1);

      const command = await fakeCommandRepo.getById('whatsapp_text:retry-1');
      expect(command?.status).toBe('classified');
      expect(command?.classification?.type).toBe('todo');

      const actions = fakeActionsAgentClient
        .getCreatedActions()
        .filter((a) => a.userId === 'user-retry-1');
      expect(actions).toHaveLength(1);
      expect(actions[0]?.title).toBe('Buy groceries');
    });

    it('skips pending command when user still has no API key', async () => {
      app = await buildServer();

      fakeCommandRepo.addCommand({
        id: 'whatsapp_text:retry-2',
        userId: 'user-no-key-yet',
        sourceType: 'whatsapp_text',
        externalId: 'retry-2',
        text: 'Research topic',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'pending_classification',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        processed: number;
        skipped: number;
      };
      expect(body.success).toBe(true);
      expect(body.processed).toBe(0);
      expect(body.skipped).toBe(1);

      const command = await fakeCommandRepo.getById('whatsapp_text:retry-2');
      expect(command?.status).toBe('pending_classification');
    });

    it('marks command as failed when classification fails', async () => {
      app = await buildServer();

      fakeCommandRepo.addCommand({
        id: 'whatsapp_text:retry-3',
        userId: 'user-retry-fail',
        sourceType: 'whatsapp_text',
        externalId: 'retry-3',
        text: 'This will fail',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'pending_classification',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      fakeUserServiceClient.setApiKeys('user-retry-fail', { google: 'gemini-key' });
      fakeClassifier.setFailNext(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        processed: number;
        failed: number;
      };
      expect(body.success).toBe(true);
      expect(body.processed).toBe(0);
      expect(body.failed).toBe(1);

      const command = await fakeCommandRepo.getById('whatsapp_text:retry-3');
      expect(command?.status).toBe('failed');
      expect(command?.failureReason).toBe('Simulated classification failure');
    });

    it('processes multiple pending commands', async () => {
      app = await buildServer();

      fakeCommandRepo.addCommand({
        id: 'whatsapp_text:multi-1',
        userId: 'user-multi-1',
        sourceType: 'whatsapp_text',
        externalId: 'multi-1',
        text: 'First task',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'pending_classification',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      fakeCommandRepo.addCommand({
        id: 'whatsapp_text:multi-2',
        userId: 'user-multi-2',
        sourceType: 'whatsapp_text',
        externalId: 'multi-2',
        text: 'Second task',
        timestamp: '2025-01-01T12:01:00.000Z',
        status: 'pending_classification',
        createdAt: '2025-01-01T12:01:00.000Z',
        updatedAt: '2025-01-01T12:01:00.000Z',
      });

      fakeUserServiceClient.setApiKeys('user-multi-1', { google: 'key-1' });
      fakeClassifier.setResult({
        type: 'todo',
        confidence: 0.9,
        title: 'Task',
        reasoning: 'General task',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        processed: number;
        skipped: number;
        total: number;
      };
      expect(body.success).toBe(true);
      expect(body.total).toBe(2);
      expect(body.processed).toBe(1);
      expect(body.skipped).toBe(1);
    });

    it('publishes action.created event for classified commands', async () => {
      app = await buildServer();

      fakeCommandRepo.addCommand({
        id: 'whatsapp_text:retry-event',
        userId: 'user-retry-event',
        sourceType: 'whatsapp_text',
        externalId: 'retry-event',
        text: 'Research AI trends',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'pending_classification',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      fakeUserServiceClient.setApiKeys('user-retry-event', { google: 'gemini-key' });
      fakeClassifier.setResult({
        type: 'research',
        confidence: 0.95,
        title: 'AI Trends Research',
        reasoning: 'Research query about AI trends',
        selectedModels: ['gemini-2.5-flash', 'claude-sonnet-4-5-20250929'],
      });

      await app.inject({
        method: 'POST',
        url: '/internal/router/retry-pending',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      const publishedEvents = fakeEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.type).toBe('action.created');
      expect(publishedEvents[0]?.actionType).toBe('research');
      expect(publishedEvents[0]?.payload.prompt).toBe('Research AI trends');
      expect(publishedEvents[0]?.payload.selectedModels).toEqual([
        'gemini-2.5-flash',
        'claude-sonnet-4-5-20250929',
      ]);
    });
  });

  //   describe('PATCH /router/actions/:actionId (authenticated)', () => {
  //     it('returns 401 when no auth header', async () => {
  //       app = await buildServer();
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/action-1',
  //         payload: { status: 'processing' },
  //       });
  //
  //       expect(response.statusCode).toBe(401);
  //     });
  //
  //     it('returns 404 when action not found', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-1');
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/nonexistent',
  //         headers: { authorization: `Bearer ${token}` },
  //         payload: { status: 'processing' },
  //       });
  //
  //       expect(response.statusCode).toBe(404);
  //     });
  //
  //     it('returns 404 when action belongs to different user', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-1');
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-other-user',
  //         userId: 'other-user',
  //         commandId: 'cmd-1',
  //         type: 'todo',
  //         confidence: 0.9,
  //         title: 'Other user action',
  //         status: 'pending',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/action-other-user',
  //         headers: { authorization: `Bearer ${token}` },
  //         payload: { status: 'processing' },
  //       });
  //
  //       expect(response.statusCode).toBe(404);
  //     });
  //
  //     it('updates action status to processing (proceed)', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-proceed');
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-proceed',
  //         userId: 'user-proceed',
  //         commandId: 'cmd-1',
  //         type: 'todo',
  //         confidence: 0.9,
  //         title: 'Test Action',
  //         status: 'pending',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/action-proceed',
  //         headers: { authorization: `Bearer ${token}` },
  //         payload: { status: 'processing' },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as {
  //         success: boolean;
  //         data: { action: { status: string } };
  //       };
  //       expect(body.success).toBe(true);
  //       expect(body.data.action.status).toBe('processing');
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-proceed');
  //       expect(updatedAction?.status).toBe('processing');
  //     });
  //
  //     it('updates action status to rejected', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-reject');
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-reject',
  //         userId: 'user-reject',
  //         commandId: 'cmd-1',
  //         type: 'todo',
  //         confidence: 0.9,
  //         title: 'Test Action',
  //         status: 'pending',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/action-reject',
  //         headers: { authorization: `Bearer ${token}` },
  //         payload: { status: 'rejected' },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as {
  //         success: boolean;
  //         data: { action: { status: string } };
  //       };
  //       expect(body.success).toBe(true);
  //       expect(body.data.action.status).toBe('rejected');
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-reject');
  //       expect(updatedAction?.status).toBe('rejected');
  //     });
  //
  //     it('updates action status to archived from pending', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-archive-pending');
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-archive-pending',
  //         userId: 'user-archive-pending',
  //         commandId: 'cmd-1',
  //         type: 'research',
  //         confidence: 0.9,
  //         title: 'Test Research',
  //         status: 'pending',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/action-archive-pending',
  //         headers: { authorization: `Bearer ${token}` },
  //         payload: { status: 'archived' },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as {
  //         success: boolean;
  //         data: { action: { status: string } };
  //       };
  //       expect(body.success).toBe(true);
  //       expect(body.data.action.status).toBe('archived');
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-archive-pending');
  //       expect(updatedAction?.status).toBe('archived');
  //     });
  //
  //     it('updates action status to archived from completed', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-archive-completed');
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-archive-completed',
  //         userId: 'user-archive-completed',
  //         commandId: 'cmd-1',
  //         type: 'research',
  //         confidence: 0.9,
  //         title: 'Test Research',
  //         status: 'completed',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/action-archive-completed',
  //         headers: { authorization: `Bearer ${token}` },
  //         payload: { status: 'archived' },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as {
  //         success: boolean;
  //         data: { action: { status: string } };
  //       };
  //       expect(body.success).toBe(true);
  //       expect(body.data.action.status).toBe('archived');
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-archive-completed');
  //       expect(updatedAction?.status).toBe('archived');
  //     });
  //
  //     it('updates action status to archived from failed', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-archive-failed');
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-archive-failed',
  //         userId: 'user-archive-failed',
  //         commandId: 'cmd-1',
  //         type: 'research',
  //         confidence: 0.9,
  //         title: 'Test Research',
  //         status: 'failed',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/action-archive-failed',
  //         headers: { authorization: `Bearer ${token}` },
  //         payload: { status: 'archived' },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as {
  //         success: boolean;
  //         data: { action: { status: string } };
  //       };
  //       expect(body.success).toBe(true);
  //       expect(body.data.action.status).toBe('archived');
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-archive-failed');
  //       expect(updatedAction?.status).toBe('archived');
  //     });
  //
  //     it('updates action status to archived from rejected', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-archive-rejected');
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-archive-rejected',
  //         userId: 'user-archive-rejected',
  //         commandId: 'cmd-1',
  //         type: 'research',
  //         confidence: 0.9,
  //         title: 'Test Research',
  //         status: 'rejected',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'PATCH',
  //         url: '/router/actions/action-archive-rejected',
  //         headers: { authorization: `Bearer ${token}` },
  //         payload: { status: 'archived' },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as {
  //         success: boolean;
  //         data: { action: { status: string } };
  //       };
  //       expect(body.success).toBe(true);
  //       expect(body.data.action.status).toBe('archived');
  //
  //       const updatedAction = await fakeActionsAgentClient.getById('action-archive-rejected');
  //       expect(updatedAction?.status).toBe('archived');
  //     });
  //   });
  //
  //   describe('DELETE /router/actions/:actionId (authenticated)', () => {
  //     it('returns 401 when no auth header', async () => {
  //       app = await buildServer();
  //
  //       const response = await app.inject({
  //         method: 'DELETE',
  //         url: '/router/actions/action-1',
  //       });
  //
  //       expect(response.statusCode).toBe(401);
  //     });
  //
  //     it('returns 404 when action not found', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-1');
  //
  //       const response = await app.inject({
  //         method: 'DELETE',
  //         url: '/router/actions/nonexistent',
  //         headers: { authorization: `Bearer ${token}` },
  //       });
  //
  //       expect(response.statusCode).toBe(404);
  //     });
  //
  //     it('deletes action successfully', async () => {
  //       app = await buildServer();
  //       const token = await createAccessToken('user-delete-action');
  //
  //       fakeActionsAgentClient.addAction({
  //         id: 'action-to-delete',
  //         userId: 'user-delete-action',
  //         commandId: 'cmd-1',
  //         type: 'todo',
  //         confidence: 0.9,
  //         title: 'Action to delete',
  //         status: 'pending',
  //         payload: {},
  //         createdAt: '2025-01-01T12:00:00.000Z',
  //         updatedAt: '2025-01-01T12:00:00.000Z',
  //       });
  //
  //       const response = await app.inject({
  //         method: 'DELETE',
  //         url: '/router/actions/action-to-delete',
  //         headers: { authorization: `Bearer ${token}` },
  //       });
  //
  //       expect(response.statusCode).toBe(200);
  //       const body = JSON.parse(response.body) as { success: boolean };
  //       expect(body.success).toBe(true);
  //
  //       const deletedAction = await fakeActionsAgentClient.getById('action-to-delete');
  //       expect(deletedAction).toBeNull();
  //     });
  //   });
  //
  describe('DELETE /router/commands/:commandId (authenticated)', () => {
    it('returns 401 when no auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/commands/cmd-1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when command not found', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-1');

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/commands/nonexistent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('deletes command with received status', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-delete-cmd');

      fakeCommandRepo.addCommand({
        id: 'cmd-received',
        userId: 'user-delete-cmd',
        sourceType: 'whatsapp_text',
        externalId: 'ext-1',
        text: 'Test command',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'received',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/commands/cmd-received',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const deletedCmd = await fakeCommandRepo.getById('cmd-received');
      expect(deletedCmd).toBeNull();
    });

    it('deletes command with pending_classification status', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-delete-pending');

      fakeCommandRepo.addCommand({
        id: 'cmd-pending',
        userId: 'user-delete-pending',
        sourceType: 'whatsapp_text',
        externalId: 'ext-2',
        text: 'Pending command',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'pending_classification',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/commands/cmd-pending',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('deletes command with failed status', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-delete-failed');

      fakeCommandRepo.addCommand({
        id: 'cmd-failed',
        userId: 'user-delete-failed',
        sourceType: 'whatsapp_text',
        externalId: 'ext-3',
        text: 'Failed command',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'failed',
        failureReason: 'Test failure',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/commands/cmd-failed',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 when trying to delete classified command', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-delete-classified');

      fakeCommandRepo.addCommand({
        id: 'cmd-classified',
        userId: 'user-delete-classified',
        sourceType: 'whatsapp_text',
        externalId: 'ext-4',
        text: 'Classified command',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'classified',
        classification: {
          type: 'todo',
          confidence: 0.9,
          reasoning: 'Task detected',
          classifiedAt: '2025-01-01T12:00:01.000Z',
        },
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:01.000Z',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/commands/cmd-classified',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toContain('Cannot delete classified command');
    });
  });

  describe('PATCH /router/commands/:commandId (authenticated)', () => {
    it('returns 401 when no auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/router/commands/cmd-1',
        payload: { status: 'archived' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when command not found', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-1');

      const response = await app.inject({
        method: 'PATCH',
        url: '/router/commands/nonexistent',
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'archived' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('archives classified command', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-archive');

      fakeCommandRepo.addCommand({
        id: 'cmd-to-archive',
        userId: 'user-archive',
        sourceType: 'whatsapp_text',
        externalId: 'ext-archive',
        text: 'Command to archive',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'classified',
        classification: {
          type: 'todo',
          confidence: 0.9,
          reasoning: 'Task detected',
          classifiedAt: '2025-01-01T12:00:01.000Z',
        },
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:01.000Z',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/router/commands/cmd-to-archive',
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'archived' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { command: { status: string } };
      };
      expect(body.success).toBe(true);
      expect(body.data.command.status).toBe('archived');

      const archivedCmd = await fakeCommandRepo.getById('cmd-to-archive');
      expect(archivedCmd?.status).toBe('archived');
    });

    it('returns 400 when trying to archive non-classified command', async () => {
      app = await buildServer();
      const token = await createAccessToken('user-archive-fail');

      fakeCommandRepo.addCommand({
        id: 'cmd-not-classified',
        userId: 'user-archive-fail',
        sourceType: 'whatsapp_text',
        externalId: 'ext-not-classified',
        text: 'Not classified command',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'received',
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/router/commands/cmd-not-classified',
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'archived' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toContain('Can only archive classified commands');
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
