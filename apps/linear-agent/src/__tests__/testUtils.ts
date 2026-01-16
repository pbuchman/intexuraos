import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { buildServer } from '../server.js';
import { clearJwksCache } from '@intexuraos/common-http';
import {
  FakeLinearConnectionRepository,
  FakeLinearApiClient,
  FakeLinearActionExtractionService,
  FakeFailedIssueRepository,
  FakeProcessedActionRepository,
} from './fakes.js';
import { resetServices, setServices } from '../services.js';

export const issuer = 'https://test-issuer.example.com/';
export const audience = 'test-audience';

let jwksServer: FastifyInstance;
let privateKey: jose.KeyLike;

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
  connectionRepository: FakeLinearConnectionRepository;
  linearApiClient: FakeLinearApiClient;
  extractionService: FakeLinearActionExtractionService;
  failedIssueRepository: FakeFailedIssueRepository;
  processedActionRepository: FakeProcessedActionRepository;
}

export function setupTestContext(): TestContext {
  const context: TestContext = {
    app: null as unknown as FastifyInstance,
    connectionRepository: null as unknown as FakeLinearConnectionRepository,
    linearApiClient: null as unknown as FakeLinearApiClient,
    extractionService: null as unknown as FakeLinearActionExtractionService,
    failedIssueRepository: null as unknown as FakeFailedIssueRepository,
    processedActionRepository: null as unknown as FakeProcessedActionRepository,
  };

  beforeAll(async () => {
    await setupJwksServer();
  });

  afterAll(async () => {
    await teardownJwksServer();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    context.connectionRepository = new FakeLinearConnectionRepository();
    context.linearApiClient = new FakeLinearApiClient();
    context.extractionService = new FakeLinearActionExtractionService();
    context.failedIssueRepository = new FakeFailedIssueRepository();
    context.processedActionRepository = new FakeProcessedActionRepository();
    setServices({
      connectionRepository: context.connectionRepository,
      linearApiClient: context.linearApiClient,
      extractionService: context.extractionService,
      failedIssueRepository: context.failedIssueRepository,
      processedActionRepository: context.processedActionRepository,
    });
    clearJwksCache();
    context.app = await buildServer();
    await context.app.ready();
  });

  afterEach(async () => {
    await context.app.close();
    resetServices();
    context.connectionRepository.reset();
    context.linearApiClient.reset();
    context.extractionService.reset();
    context.failedIssueRepository.reset();
    context.processedActionRepository.reset();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  return context;
}

export { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach };
