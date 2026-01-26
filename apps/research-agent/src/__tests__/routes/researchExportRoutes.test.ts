/**
 * Tests for research export routes.
 * Uses real JWT signing with jose library for proper authentication.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { err, ok, type Result } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import { resetServices, type ServiceContainer, setServices } from '../../services.js';
import {
  FakeResearchExportSettings,
  FakeResearchRepository,
  FakeUserServiceClient,
  FakeLlmCallPublisher,
  FakeResearchEventPublisher,
  FakeNotificationSender,
  FakeNotionServiceClient,
} from '../fakes.js';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import type { ResearchExportSettingsError } from '../../infra/firestore/researchExportSettingsRepository.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';
const TEST_USER_ID = 'auth0|test-user-123';

describe('Research Export Routes - Unauthenticated', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

    const services: ServiceContainer = {
      researchRepo: new FakeResearchRepository(),
      researchExportSettings: new FakeResearchExportSettings(),
      pricingContext: new FakePricingContext(),
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: new FakeResearchEventPublisher(),
      llmCallPublisher: new FakeLlmCallPublisher(),
      userServiceClient: new FakeUserServiceClient(),
      imageServiceClient: null,
      notionServiceClient: new FakeNotionServiceClient(),
      notificationSender: new FakeNotificationSender(),
      shareStorage: null,
      shareConfig: null,
      webAppUrl: 'https://app.example.com',
      createResearchProvider: vi.fn(),
      createSynthesizer: vi.fn(),
      createTitleGenerator: vi.fn(),
      createContextInferrer: vi.fn(),
      createInputValidator: vi.fn(),
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    clearJwksCache();
  });

  it('GET /research/settings/notion returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/research/settings/notion',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /research/settings/notion returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/research/settings/notion',
      payload: {
        researchPageId: 'notion-page-123',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('Research Export Routes - Authenticated', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  async function generateJwt(sub: string = TEST_USER_ID): Promise<string> {
    const builder = new jose.SignJWT({ sub })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(INTEXURAOS_AUTH_AUDIENCE)
      .setSubject(sub)
      .setExpirationTime('1h');

    return await builder.sign(privateKey);
  }

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const publicKey = keyPair.publicKey;

    // Set up JWKS server
    jwksServer = Fastify();
    jwksServer.get('/.well-known/jwks.json', async (_request, reply) => {
      const publicJwk = await jose.exportJWK(publicKey);
      reply.send({
        keys: [
          {
            ...publicJwk,
            kid: 'test-key-id',
            alg: 'RS256',
          },
        ],
      });
    });

    await jwksServer.listen({ port: 0, host: '127.0.0.1' });
    const address = jwksServer.server.address();
    if (typeof address === 'object' && address !== null) {
      jwksUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  describe('GET /research/settings/notion', () => {
    let fakeResearchExportSettings: FakeResearchExportSettings;

    beforeEach(async () => {
      clearJwksCache();
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = `${jwksUrl}/.well-known/jwks.json`;
      process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
      process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

      fakeResearchExportSettings = new FakeResearchExportSettings();

      const services: ServiceContainer = {
        researchRepo: new FakeResearchRepository(),
        researchExportSettings: fakeResearchExportSettings,
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: new FakeNotionServiceClient(),
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
      };
      setServices(services);

      app = await buildServer();
    });

    afterEach(async () => {
      await app.close();
      resetServices();
      clearJwksCache();
    });

    it('returns research page ID when found', async () => {
      const testPageId = 'notion-page-123';
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, testPageId);

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'GET',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { researchPageId: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.researchPageId).toBe(testPageId);
    });

    it('returns null when no research page ID is set', async () => {
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'GET',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { researchPageId: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.researchPageId).toBeNull();
    });

    it('returns INTERNAL_ERROR when service returns error', async () => {
      // Create a fake that returns an error with proper type
      class FailingFakeResearchExportSettings {
        async getResearchPageId(): Promise<Result<string | null, ResearchExportSettingsError>> {
          return err({ code: 'INTERNAL_ERROR', message: 'Database connection failed' });
        }

        async saveResearchPageId(): Promise<Result<never, ResearchExportSettingsError>> {
          return err({ code: 'INTERNAL_ERROR', message: 'Not implemented' });
        }
      }

      const services: ServiceContainer = {
        researchRepo: new FakeResearchRepository(),
        researchExportSettings: new FailingFakeResearchExportSettings(),
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: new FakeNotionServiceClient(),
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
      };
      setServices(services);

      // Clear cache and rebuild app with new services
      clearJwksCache();
      app = await buildServer();

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'GET',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Database connection failed');
    });
  });

  describe('POST /research/settings/notion', () => {
    let fakeResearchExportSettings: FakeResearchExportSettings;

    beforeEach(async () => {
      clearJwksCache();
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = `${jwksUrl}/.well-known/jwks.json`;
      process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
      process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

      fakeResearchExportSettings = new FakeResearchExportSettings();

      const services: ServiceContainer = {
        researchRepo: new FakeResearchRepository(),
        researchExportSettings: fakeResearchExportSettings,
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: new FakeNotionServiceClient(),
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
      };
      setServices(services);

      app = await buildServer();
    });

    afterEach(async () => {
      await app.close();
      resetServices();
      clearJwksCache();
    });

    it('saves research page ID successfully', async () => {
      const testPageId = 'notion-page-456';
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchPageId: testPageId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          researchPageId: string;
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.researchPageId).toBe(testPageId);
      expect(body.data.createdAt).toBeDefined();
      expect(body.data.updatedAt).toBeDefined();
    });

    it('returns 400 when researchPageId is missing (Fastify schema validation)', async () => {
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          // researchPageId is missing
        },
      });

      // Fastify schema validation rejects missing required fields
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as unknown;
      // Fastify returns its own validation error format
      expect(body).toBeDefined();
    });

    it('returns INVALID_ERROR when researchPageId is empty string', async () => {
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchPageId: '',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('researchPageId is required and must be a string');
    });

    it('saves successfully when researchPageId is a number (coerced to string by Fastify)', async () => {
      // Note: Fastify's schema validation coerces numbers to strings when type is 'string'
      // This test documents the actual behavior - numbers are accepted and converted
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchPageId: 12345, // number gets coerced to string "12345"
        },
      });

      // Fastify coerces the number to string, so the request succeeds
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { researchPageId: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.researchPageId).toBe('12345');
    });

    it('returns INTERNAL_ERROR when service returns error', async () => {
      // Create a fake that returns an error with proper type
      class FailingFakeResearchExportSettings {
        async getResearchPageId(): Promise<Result<string | null, ResearchExportSettingsError>> {
          return ok(null);
        }

        async saveResearchPageId(): Promise<Result<never, ResearchExportSettingsError>> {
          return err({ code: 'INTERNAL_ERROR', message: 'Failed to save to database' });
        }
      }

      const services: ServiceContainer = {
        researchRepo: new FakeResearchRepository(),
        researchExportSettings: new FailingFakeResearchExportSettings(),
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: new FakeNotionServiceClient(),
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
      };
      setServices(services);

      // Clear cache and rebuild app with new services
      clearJwksCache();
      app = await buildServer();

      const testPageId = 'notion-page-456';
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchPageId: testPageId,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to save to database');
    });
  });
});
