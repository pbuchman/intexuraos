/**
 * Shared test utilities for mobile-notifications-service tests.
 * Provides JWT token generation and test setup helpers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { buildServer } from '../server.js';
import { clearJwksCache } from '@intexuraos/common-http';
import { FakeSignatureConnectionRepository, FakeNotificationRepository } from './fakes.js';
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
 */
export async function teardownJwksServer(): Promise<void> {
  await jwksServer.close();
  delete process.env['AUTH_JWKS_URL'];
  delete process.env['AUTH_ISSUER'];
  delete process.env['AUTH_AUDIENCE'];
}

export interface TestContext {
  app: FastifyInstance;
  signatureRepo: FakeSignatureConnectionRepository;
  notificationRepo: FakeNotificationRepository;
}

/**
 * Setup test environment with mock services.
 */
export function setupTestContext(): TestContext {
  const context: TestContext = {
    app: null as unknown as FastifyInstance,
    signatureRepo: null as unknown as FakeSignatureConnectionRepository,
    notificationRepo: null as unknown as FakeNotificationRepository,
  };

  beforeAll(async () => {
    await setupJwksServer();
  });

  afterAll(async () => {
    await teardownJwksServer();
  });

  beforeEach(async () => {
    context.signatureRepo = new FakeSignatureConnectionRepository();
    context.notificationRepo = new FakeNotificationRepository();

    setServices({
      signatureConnectionRepository: context.signatureRepo,
      notificationRepository: context.notificationRepo,
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
