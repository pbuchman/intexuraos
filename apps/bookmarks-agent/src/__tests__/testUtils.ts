import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { buildServer } from '../server.js';
import { clearJwksCache } from '@intexuraos/common-http';
import { FakeBookmarkRepository } from './fakeBookmarkRepository.js';
import { FakeLinkPreviewFetcher } from './fakeLinkPreviewFetcher.js';
import { FakeEnrichPublisher } from './fakeEnrichPublisher.js';
import { FakeSummarizePublisher } from './fakeSummarizePublisher.js';
import { FakeBookmarkSummaryService } from './fakeBookmarkSummaryService.js';
import { resetServices, setServices } from '../services.js';

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
  bookmarkRepository: FakeBookmarkRepository;
  linkPreviewFetcher: FakeLinkPreviewFetcher;
  enrichPublisher: FakeEnrichPublisher;
  summarizePublisher: FakeSummarizePublisher;
  bookmarkSummaryService: FakeBookmarkSummaryService;
}

export function setupTestContext(): TestContext {
  const context: TestContext = {
    app: null as unknown as FastifyInstance,
    bookmarkRepository: null as unknown as FakeBookmarkRepository,
    linkPreviewFetcher: null as unknown as FakeLinkPreviewFetcher,
    enrichPublisher: null as unknown as FakeEnrichPublisher,
    summarizePublisher: null as unknown as FakeSummarizePublisher,
    bookmarkSummaryService: null as unknown as FakeBookmarkSummaryService,
  };

  beforeAll(async () => {
    await setupJwksServer();
  });

  afterAll(async () => {
    await teardownJwksServer();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    context.bookmarkRepository = new FakeBookmarkRepository();
    context.linkPreviewFetcher = new FakeLinkPreviewFetcher();
    context.enrichPublisher = new FakeEnrichPublisher();
    context.summarizePublisher = new FakeSummarizePublisher();
    context.bookmarkSummaryService = new FakeBookmarkSummaryService();
    setServices({
      bookmarkRepository: context.bookmarkRepository,
      linkPreviewFetcher: context.linkPreviewFetcher,
      enrichPublisher: context.enrichPublisher,
      summarizePublisher: context.summarizePublisher,
      bookmarkSummaryService: context.bookmarkSummaryService,
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

export { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi };
