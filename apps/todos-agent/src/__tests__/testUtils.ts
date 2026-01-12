import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { buildServer } from '../server.js';
import { clearJwksCache } from '@intexuraos/common-http';
import { FakeTodoRepository } from './fakeTodoRepository.js';
import { resetServices, setServices } from '../services.js';
import type { TodosProcessingPublisher } from '@intexuraos/infra-pubsub';
import type { UserServiceClient } from '../infra/user/userServiceClient.js';
import type { TodoItemExtractionService } from '../infra/gemini/todoItemExtractionService.js';

export class FakeTodosProcessingPublisher implements TodosProcessingPublisher {
  public publishedEvents: { todoId: string; userId: string; title: string; correlationId?: string }[] = [];

  async publishTodoCreated(params: {
    todoId: string;
    userId: string;
    title: string;
    correlationId?: string;
  }): Promise<{ readonly ok: true; readonly value: undefined }> {
    this.publishedEvents.push(params);
    return { ok: true, value: undefined };
  }

  reset(): void {
    this.publishedEvents = [];
  }
}

export class FakeUserServiceClient implements UserServiceClient {
  public getGeminiApiKeyResult?: { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: { code: 'NETWORK_ERROR' | 'API_ERROR' | 'NO_API_KEY'; message: string } };

  async getGeminiApiKey(_userId: string): Promise<{ readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: { code: 'NETWORK_ERROR' | 'API_ERROR' | 'NO_API_KEY'; message: string } }> {
    if (this.getGeminiApiKeyResult) return this.getGeminiApiKeyResult;
    return { ok: false, error: { code: 'NO_API_KEY', message: 'No API key' } };
  }
}

export class FakeTodoItemExtractionService implements TodoItemExtractionService {
  public extractItemsResult?: { readonly ok: true; readonly value: Array<{ title: string; priority: 'low' | 'medium' | 'high' | 'urgent' | null; dueDate: Date | null; reasoning: string }> } | { readonly ok: false; readonly error: { code: 'NO_API_KEY' | 'USER_SERVICE_ERROR' | 'GENERATION_ERROR' | 'INVALID_RESPONSE'; message: string; details?: { llmErrorCode?: string; parseError?: string; rawResponsePreview?: string; userServiceError?: string } } };

  async extractItems(_userId: string, _description: string): Promise<{ readonly ok: true; readonly value: Array<{ title: string; priority: 'low' | 'medium' | 'high' | 'urgent' | null; dueDate: Date | null; reasoning: string }> } | { readonly ok: false; readonly error: { code: 'NO_API_KEY' | 'USER_SERVICE_ERROR' | 'GENERATION_ERROR' | 'INVALID_RESPONSE'; message: string; details?: { llmErrorCode?: string; parseError?: string; rawResponsePreview?: string; userServiceError?: string } } }> {
    if (this.extractItemsResult) return this.extractItemsResult;
    return { ok: true, value: [] };
  }
}

export const issuer = 'https://test-issuer.example.com/';
export const audience = 'test-audience';

let jwksServer: FastifyInstance;
let privateKey: Awaited<ReturnType<typeof jose.generateKeyPair>>['privateKey'];

export async function createToken(
  claims: Record<string, unknown>,
  options?: { expiresIn?: string }
): Promise<string> {
  const builder = new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience);

  if (options?.expiresIn !== undefined) {
    builder.setExpirationTime(options.expiresIn);
  } else {
    builder.setExpirationTime('1h');
  }

  return await builder.sign(privateKey);
}

export async function setupJwksServer(): Promise<void> {
  const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
  privateKey = privKey;

  const publicKeyJwk = await jose.exportJWK(publicKey);
  publicKeyJwk.kid = 'test-key-1';
  publicKeyJwk.alg = 'RS256';
  publicKeyJwk.use = 'sig';

  jwksServer = Fastify({ logger: false });

  jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
    return await reply.send({ keys: [publicKeyJwk] });
  });

  await jwksServer.listen({ port: 0, host: '127.0.0.1' });
  const address = jwksServer.server.address();
  if (address !== null && typeof address === 'object') {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] =
      `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = audience;
  }
}

export async function teardownJwksServer(): Promise<void> {
  await jwksServer.close();
  delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
  delete process.env['INTEXURAOS_AUTH_ISSUER'];
  delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
}

export interface TestContext {
  app: FastifyInstance;
  todoRepository: FakeTodoRepository;
  todosProcessingPublisher: FakeTodosProcessingPublisher;
  userServiceClient: FakeUserServiceClient;
  todoItemExtractionService: FakeTodoItemExtractionService;
}

export function setupTestContext(): TestContext {
  const context: TestContext = {
    app: null as unknown as FastifyInstance,
    todoRepository: null as unknown as FakeTodoRepository,
    todosProcessingPublisher: null as unknown as FakeTodosProcessingPublisher,
    userServiceClient: null as unknown as FakeUserServiceClient,
    todoItemExtractionService: null as unknown as FakeTodoItemExtractionService,
  };

  beforeAll(async () => {
    await setupJwksServer();
  });

  afterAll(async () => {
    await teardownJwksServer();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    context.todoRepository = new FakeTodoRepository();
    context.todosProcessingPublisher = new FakeTodosProcessingPublisher();
    context.userServiceClient = new FakeUserServiceClient();
    context.todoItemExtractionService = new FakeTodoItemExtractionService();
    setServices({
      todoRepository: context.todoRepository,
      todosProcessingPublisher: context.todosProcessingPublisher,
      userServiceClient: context.userServiceClient,
      todoItemExtractionService: context.todoItemExtractionService,
    });
    clearJwksCache();
    context.app = await buildServer();
    await context.app.ready();
  });

  afterEach(async () => {
    await context.app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  return context;
}

export { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach };
