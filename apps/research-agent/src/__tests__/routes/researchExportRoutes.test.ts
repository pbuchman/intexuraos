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
  createFakeNotionExporter,
  createFailingNotionExporter,
} from '../fakes.js';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { LlmModels } from '@intexuraos/llm-contract';
import type { ResearchModel } from '@intexuraos/llm-contract';
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
      notionExporter: createFakeNotionExporter(),
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
        researchPageTitle: 'Test',
        researchPageUrl: 'https://notion.so/test',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /research/settings/notion/validate returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/research/settings/notion/validate',
      payload: {
        researchPageId: 'abc123',
      },
    });

    // Returns 401 from auth middleware
    expect(response.statusCode).toBe(401);
    // The response body format depends on the auth middleware
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
        notionExporter: createFakeNotionExporter(),
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
        data: { researchPageId: string | null; researchPageTitle: string | null; researchPageUrl: string | null };
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
        data: { researchPageId: string | null; researchPageTitle: string | null; researchPageUrl: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.researchPageId).toBeNull();
      expect(body.data.researchPageTitle).toBeNull();
      expect(body.data.researchPageUrl).toBeNull();
    });

    it('returns INTERNAL_ERROR when service returns error', async () => {
      // Create a fake that returns an error with proper type
      class FailingFakeResearchExportSettings {
        async getResearchPageId(): Promise<Result<string | null, ResearchExportSettingsError>> {
          return err({ code: 'INTERNAL_ERROR', message: 'Database connection failed' });
        }

        async getResearchSettings(): Promise<Result<null, ResearchExportSettingsError>> {
          return err({ code: 'INTERNAL_ERROR', message: 'Database connection failed' });
        }

        async saveResearchPageId(): Promise<Result<never, ResearchExportSettingsError>> {
          return err({ code: 'INTERNAL_ERROR', message: 'Not implemented' });
        }

        async saveResearchSettings(): Promise<Result<never, ResearchExportSettingsError>> {
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
        notionExporter: createFakeNotionExporter(),
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

  describe('POST /research/settings/notion/validate', () => {
    let fakeNotionServiceClient: FakeNotionServiceClient;

    beforeEach(async () => {
      clearJwksCache();
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = `${jwksUrl}/.well-known/jwks.json`;
      process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
      process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

      fakeNotionServiceClient = new FakeNotionServiceClient();

      const services: ServiceContainer = {
        researchRepo: new FakeResearchRepository(),
        researchExportSettings: new FakeResearchExportSettings(),
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: fakeNotionServiceClient,
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
        notionExporter: createFakeNotionExporter(),
      };
      setServices(services);

      app = await buildServer();
    });

    afterEach(async () => {
      await app.close();
      resetServices();
      clearJwksCache();
    });

    it('returns page title and url when page is valid and accessible', async () => {
      const pageId = 'abc123def4567890abc123def4567890';
      fakeNotionServiceClient.setPagePreview(pageId, 'My Research Page', 'https://notion.so/page');

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion/validate',
        headers: { authorization: `Bearer ${token}` },
        payload: { researchPageId: pageId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { title: string; url: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('My Research Page');
      expect(body.data.url).toBe('https://notion.so/page');
    });

    it('accepts UUID format with dashes', async () => {
      const pageId = 'abc123de-4567-890a-bcde-1234567890ab';
      fakeNotionServiceClient.setPagePreview(
        'abc123de4567890abcde1234567890ab',
        'My Page',
        'https://notion.so/page'
      );

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion/validate',
        headers: { authorization: `Bearer ${token}` },
        payload: { researchPageId: pageId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { title: string } };
      expect(body.success).toBe(true);
    });

    it('returns 400 when page ID format is invalid (too short)', async () => {
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion/validate',
        headers: { authorization: `Bearer ${token}` },
        payload: { researchPageId: 'abc' },
      });

      // Format validation happens in our handler, so we expect our custom error
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('Invalid page ID format');
    });

    it('returns 400 when page ID format is invalid (invalid characters)', async () => {
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion/validate',
        headers: { authorization: `Bearer ${token}` },
        payload: { researchPageId: 'gggg1234567890123456789012345678' }, // contains 'g'
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 404 when page is not accessible', async () => {
      const pageId = 'abc123def4567890abc123def4567890';
      // Don't set up a page preview - will return NOT_FOUND

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion/validate',
        headers: { authorization: `Bearer ${token}` },
        payload: { researchPageId: pageId },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns DOWNSTREAM_ERROR on service error', async () => {
      const pageId = 'abc123def4567890abc123def4567890';
      fakeNotionServiceClient.setNextError({ code: 'INTERNAL_ERROR', message: 'Service error' });

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion/validate',
        headers: { authorization: `Bearer ${token}` },
        payload: { researchPageId: pageId },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
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
        notionExporter: createFakeNotionExporter(),
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
      const testPageTitle = 'My Research Page';
      const testPageUrl = 'https://notion.so/notion-page-456';
      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: '/research/settings/notion',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchPageId: testPageId,
          researchPageTitle: testPageTitle,
          researchPageUrl: testPageUrl,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          researchPageId: string;
          researchPageTitle: string;
          researchPageUrl: string;
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.researchPageId).toBe(testPageId);
      expect(body.data.researchPageTitle).toBe(testPageTitle);
      expect(body.data.researchPageUrl).toBe(testPageUrl);
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
          // All fields are missing - should fail schema validation
          researchPageTitle: 'Test',
          researchPageUrl: 'https://notion.so/test',
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
          researchPageTitle: 'Test',
          researchPageUrl: 'https://notion.so/test',
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
          researchPageTitle: 'Test',
          researchPageUrl: 'https://notion.so/test',
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

        async getResearchSettings(): Promise<Result<null, ResearchExportSettingsError>> {
          return ok(null);
        }

        async saveResearchPageId(): Promise<Result<never, ResearchExportSettingsError>> {
          return err({ code: 'INTERNAL_ERROR', message: 'Failed to save to database' });
        }

        async saveResearchSettings(): Promise<Result<never, ResearchExportSettingsError>> {
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
        notionExporter: createFakeNotionExporter(),
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
          researchPageTitle: 'Test',
          researchPageUrl: 'https://notion.so/test',
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

  describe('POST /research/:id/export-notion', () => {
    let fakeResearchRepo: FakeResearchRepository;
    let fakeNotionServiceClient: FakeNotionServiceClient;
    let fakeResearchExportSettings: FakeResearchExportSettings;

    beforeEach(async () => {
      clearJwksCache();
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = `${jwksUrl}/.well-known/jwks.json`;
      process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
      process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

      fakeResearchRepo = new FakeResearchRepository();
      fakeNotionServiceClient = new FakeNotionServiceClient();
      fakeResearchExportSettings = new FakeResearchExportSettings();

      const services: ServiceContainer = {
        researchRepo: fakeResearchRepo,
        researchExportSettings: fakeResearchExportSettings,
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: fakeNotionServiceClient,
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
        notionExporter: createFakeNotionExporter(),
      };
      setServices(services);

      app = await buildServer();
    });

    afterEach(async () => {
      await app.close();
      resetServices();
      clearJwksCache();
    });

    it('exports research to Notion successfully', async () => {
      const researchId = 'research-123';
      const testPageId = 'notion-page-123';
      const testNotionToken = 'secret-notion-token';

      // Set up completed research
      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis result',
      });

      // Set up Notion token and page ID
      fakeNotionServiceClient.setToken(testNotionToken);
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, testPageId);

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { success: boolean; notionPageUrl: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.success).toBe(true);
      expect(body.data.notionPageUrl).toBeDefined();
    });

    it('returns 401 without authentication', async () => {
      const researchId = 'research-123';
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when research not found', async () => {
      const researchId = 'nonexistent-research';
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, 'notion-page-123');
      fakeNotionServiceClient.setToken('token');

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 when accessing another user research', async () => {
      const researchId = 'research-123';
      const otherUserId = 'auth0|other-user-456';

      fakeResearchRepo.addResearch({
        id: researchId,
        userId: otherUserId,
        title: 'Other User Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis',
      });

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns RESEARCH_NOT_COMPLETED when research is not completed', async () => {
      const researchId = 'research-123';
      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Pending Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'pending',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
      });

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RESEARCH_NOT_COMPLETED');
    });

    it('returns NOTION_NOT_CONNECTED when Notion is not connected', async () => {
      const researchId = 'research-123';
      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis',
      });

      // No Notion token set
      fakeNotionServiceClient.setToken(null);
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, 'notion-page-123');

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOTION_NOT_CONNECTED');
    });

    it('returns PAGE_NOT_CONFIGURED when Notion page ID is not set', async () => {
      const researchId = 'research-123';
      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis',
      });

      fakeNotionServiceClient.setToken('notion-token');
      // No page ID set - will return null
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, null);

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PAGE_NOT_CONFIGURED');
    });

    it('returns ALREADY_EXPORTED when research has already been exported', async () => {
      const researchId = 'research-123';
      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis',
        notionExportInfo: {
          mainPageId: 'notion-page-123',
          mainPageUrl: 'https://notion.so/page-123',
          llmReportPageIds: [],
          exportedAt: '2024-01-01T01:00:00Z',
        },
      });

      fakeNotionServiceClient.setToken('notion-token');
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, 'notion-page-123');

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ALREADY_EXPORTED');
    });

    it('returns NO_SYNTHESIS when research has no synthesis', async () => {
      const researchId = 'research-123';
      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: '', // Empty synthesis
      });

      fakeNotionServiceClient.setToken('notion-token');
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, 'notion-page-123');

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NO_SYNTHESIS');
    });

    it('returns 401 NOTION_UNAUTHORIZED when Notion token is invalid', async () => {
      const researchId = 'research-123';

      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis',
      });

      fakeNotionServiceClient.setToken('invalid-token');
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, 'notion-page-123');

      // Set the exporter to return unauthorized error
      const unauthorizedExporter = createFailingNotionExporter('UNAUTHORIZED', 'Invalid Notion token');

      const services: ServiceContainer = {
        researchRepo: fakeResearchRepo,
        researchExportSettings: fakeResearchExportSettings,
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: fakeNotionServiceClient,
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
        notionExporter: unauthorizedExporter,
      };
      setServices(services);

      clearJwksCache();
      app = await buildServer();

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOTION_UNAUTHORIZED');
    });

    it('returns 429 RATE_LIMITED when Notion API rate limit is exceeded', async () => {
      const researchId = 'research-123';

      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis',
      });

      fakeNotionServiceClient.setToken('notion-token');
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, 'notion-page-123');

      // Set the exporter to return rate limited error
      const rateLimitedExporter = createFailingNotionExporter('RATE_LIMITED', 'Notion API rate limit exceeded');

      const services: ServiceContainer = {
        researchRepo: fakeResearchRepo,
        researchExportSettings: fakeResearchExportSettings,
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: fakeNotionServiceClient,
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
        notionExporter: rateLimitedExporter,
      };
      setServices(services);

      clearJwksCache();
      app = await buildServer();

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('returns INTERNAL_ERROR when Notion API returns unknown error', async () => {
      const researchId = 'research-123';

      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis',
      });

      fakeNotionServiceClient.setToken('notion-token');
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, 'notion-page-123');

      // Set the exporter to return NOT_FOUND error (should map to INTERNAL_ERROR in default case)
      const internalErrorExporter = createFailingNotionExporter('NOT_FOUND', 'Page not found');

      const services: ServiceContainer = {
        researchRepo: fakeResearchRepo,
        researchExportSettings: fakeResearchExportSettings,
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: fakeNotionServiceClient,
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
        notionExporter: internalErrorExporter,
      };
      setServices(services);

      clearJwksCache();
      app = await buildServer();

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
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
    });

    it('returns success when export succeeds but saving metadata fails', async () => {
      const researchId = 'research-123';

      fakeResearchRepo.addResearch({
        id: researchId,
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as ResearchModel],
        synthesisModel: LlmModels.Gemini25Pro as ResearchModel,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        synthesizedResult: 'Test synthesis',
      });

      fakeNotionServiceClient.setToken('notion-token');
      fakeResearchExportSettings.setResearchPageId(TEST_USER_ID, 'notion-page-123');

      // Make the repo update fail after successful export
      fakeResearchRepo.setFailNextUpdate(true);

      const services: ServiceContainer = {
        researchRepo: fakeResearchRepo,
        researchExportSettings: fakeResearchExportSettings,
        pricingContext: new FakePricingContext(),
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: new FakeUserServiceClient(),
        imageServiceClient: null,
        notionServiceClient: fakeNotionServiceClient,
        notificationSender: new FakeNotificationSender(),
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: vi.fn(),
        createSynthesizer: vi.fn(),
        createTitleGenerator: vi.fn(),
        createContextInferrer: vi.fn(),
        createInputValidator: vi.fn(),
        notionExporter: createFakeNotionExporter(),
      };
      setServices(services);

      clearJwksCache();
      app = await buildServer();

      const token = await generateJwt(TEST_USER_ID);
      const response = await app.inject({
        method: 'POST',
        url: `/research/${researchId}/export-notion`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      // Should still return success even though metadata save failed
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { success: boolean; notionPageUrl: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.notionPageUrl).toBeDefined();
    });
  });
});
