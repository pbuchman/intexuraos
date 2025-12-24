/**
 * Shared test utilities for notion-service tests.
 * Provides JWT token generation and test setup helpers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { buildServer } from '../server.js';
import { clearJwksCache } from '@intexuraos/common';
import { FakeNotionConnectionRepository, MockNotionApiAdapter } from './fakes.js';
import { setServices, resetServices } from '../services.js';

export const issuer = 'https://test-issuer.example.com/';
export const audience = 'test-audience';

let jwksServer: FastifyInstance;
let privateKey: jose.KeyLike;

/**
 * Create a signed JWT token for tests.
 */
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

/**
 * Setup global JWKS server for all tests.
 * Call this once in beforeAll.
 */
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
    process.env['AUTH_JWKS_URL'] = `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    process.env['AUTH_ISSUER'] = issuer;
    process.env['AUTH_AUDIENCE'] = audience;
  }
}

/**
 * Teardown JWKS server.
 * Call this in afterAll.
 */
export async function teardownJwksServer(): Promise<void> {
  await jwksServer.close();
  delete process.env['AUTH_JWKS_URL'];
  delete process.env['AUTH_ISSUER'];
  delete process.env['AUTH_AUDIENCE'];
}

export interface TestContext {
  app: FastifyInstance;
  connectionRepository: FakeNotionConnectionRepository;
  notionApi: MockNotionApiAdapter;
}

/**
 * Setup test environment with mock services.
 * Returns context that must be used in tests.
 *
 * Note: With colocated infra, service injection isn't supported.
 * Tests need to use the Firestore emulator or mock at the HTTP level.
 */
export function setupTestContext(): TestContext {
  const context: TestContext = {
    app: null as unknown as FastifyInstance,
    connectionRepository: null as unknown as FakeNotionConnectionRepository,
    notionApi: null as unknown as MockNotionApiAdapter,
  };

  beforeAll(async () => {
    await setupJwksServer();
  });

  afterAll(async () => {
    await teardownJwksServer();
  });

  beforeEach(async () => {
    context.connectionRepository = new FakeNotionConnectionRepository();
    context.notionApi = new MockNotionApiAdapter();

    // Inject fake services for testing
    setServices({
      connectionRepository: context.connectionRepository as never,
      notionApi: context.notionApi as never,
    });

    clearJwksCache();
    context.app = await buildServer();
  });

  afterEach(async () => {
    await context.app.close();
    resetServices();
  });

  return context;
}

export { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach };
