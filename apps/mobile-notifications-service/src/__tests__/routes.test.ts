/**
 * Tests for connect routes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';
import { resetServices } from '../services.js';
import { setMockServices } from './helpers/mockServices.js';
import {
  FakeNotificationFiltersRepository,
  FakeNotificationRepository,
  FakeSignatureConnectionRepository,
} from './fakes.js';
import { hashSignature } from '../domain/notifications/index.js';

const TEST_USER_ID = 'auth0|test-user-123';

describe('Connect Routes', () => {
  let app: FastifyInstance;
  let fakeSignatureRepo: FakeSignatureConnectionRepository;
  let fakeNotificationRepo: FakeNotificationRepository;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';

    fakeSignatureRepo = new FakeSignatureConnectionRepository();
    fakeNotificationRepo = new FakeNotificationRepository();

    setMockServices({
      signatureConnectionRepository: fakeSignatureRepo,
      notificationRepository: fakeNotificationRepo,
      notificationFiltersRepository: new FakeNotificationFiltersRepository(),
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    nock.cleanAll();
  });

  it('POST /mobile-notifications/connect returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/connect',
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

});

describe('Status Routes', () => {
  let app: FastifyInstance;
  let fakeSignatureRepo: FakeSignatureConnectionRepository;
  let fakeNotificationRepo: FakeNotificationRepository;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';

    fakeSignatureRepo = new FakeSignatureConnectionRepository();
    fakeNotificationRepo = new FakeNotificationRepository();

    setMockServices({
      signatureConnectionRepository: fakeSignatureRepo,
      notificationRepository: fakeNotificationRepo,
      notificationFiltersRepository: new FakeNotificationFiltersRepository(),
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    nock.cleanAll();
  });

  it('GET /mobile-notifications/status returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

});

describe('Webhook Routes', () => {
  let app: FastifyInstance;
  let fakeSignatureRepo: FakeSignatureConnectionRepository;
  let fakeNotificationRepo: FakeNotificationRepository;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';

    fakeSignatureRepo = new FakeSignatureConnectionRepository();
    fakeNotificationRepo = new FakeNotificationRepository();

    setMockServices({
      signatureConnectionRepository: fakeSignatureRepo,
      notificationRepository: fakeNotificationRepo,
      notificationFiltersRepository: new FakeNotificationFiltersRepository(),
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    nock.cleanAll();
  });

  it('POST /mobile-notifications/webhooks returns 400 without signature header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks',
      payload: {
        source: 'tasker',
        device: 'test-phone',
        timestamp: Date.now(),
        notification_id: 'notif-123',
        post_time: '2024-01-01T00:00:00Z',
        app: 'com.example.app',
        title: 'Test Title',
        text: 'Test Text',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('POST /mobile-notifications/webhooks returns ignored for invalid signature', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {
        'x-mobile-notifications-signature': 'invalid-signature',
      },
      payload: {
        source: 'tasker',
        device: 'test-phone',
        timestamp: Date.now(),
        notification_id: 'notif-123',
        post_time: '2024-01-01T00:00:00Z',
        app: 'com.example.app',
        title: 'Test Title',
        text: 'Test Text',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid signature');
  });

  it('POST /mobile-notifications/webhooks accepts notification with valid signature', async () => {
    // Create a connection first
    const signature = 'test-signature-token';
    const signatureHash = hashSignature(signature);
    await fakeSignatureRepo.save({
      userId: TEST_USER_ID,
      signatureHash,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {
        'x-mobile-notifications-signature': signature,
      },
      payload: {
        source: 'tasker',
        device: 'test-phone',
        timestamp: Date.now(),
        notification_id: 'notif-123',
        post_time: '2024-01-01T00:00:00Z',
        app: 'com.example.app',
        title: 'Test Title',
        text: 'Test Text',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { status: string; id?: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('accepted');
    expect(body.data.id).toBeDefined();

    // Verify notification was saved
    const notifications = fakeNotificationRepo.getAll();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.userId).toBe(TEST_USER_ID);
  });

  it('POST /mobile-notifications/webhooks ignores duplicate notification', async () => {
    // Create a connection first
    const signature = 'test-signature-token';
    const signatureHash = hashSignature(signature);
    await fakeSignatureRepo.save({
      userId: TEST_USER_ID,
      signatureHash,
    });

    // Add existing notification
    fakeNotificationRepo.addNotification({
      id: 'existing-notif',
      userId: TEST_USER_ID,
      source: 'tasker',
      device: 'test-phone',
      app: 'com.example.app',
      title: 'Old Title',
      text: 'Old Text',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'notif-123', // Same ID
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {
        'x-mobile-notifications-signature': signature,
      },
      payload: {
        source: 'tasker',
        device: 'test-phone',
        timestamp: Date.now(),
        notification_id: 'notif-123', // Duplicate
        post_time: '2024-01-01T00:00:00Z',
        app: 'com.example.app',
        title: 'Test Title',
        text: 'Test Text',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { status: string; reason?: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ignored');
    expect(body.data.reason).toBe('duplicate');

    // Verify no new notification was saved
    const notifications = fakeNotificationRepo.getAll();
    expect(notifications).toHaveLength(1);
  });

  it('POST /mobile-notifications/webhooks returns 500 on signature lookup failure', async () => {
    fakeSignatureRepo.setFailNextFind(true);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {
        'x-mobile-notifications-signature': 'some-signature',
      },
      payload: {
        source: 'tasker',
        device: 'test-phone',
        timestamp: Date.now(),
        notification_id: 'notif-123',
        post_time: '2024-01-01T00:00:00Z',
        app: 'com.example.app',
        title: 'Test Title',
        text: 'Test Text',
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

  it('POST /mobile-notifications/webhooks returns 500 on duplicate check failure', async () => {
    // Create a connection first
    const signature = 'test-signature-token';
    const signatureHash = hashSignature(signature);
    await fakeSignatureRepo.save({
      userId: TEST_USER_ID,
      signatureHash,
    });

    fakeNotificationRepo.setFailNextFind(true);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {
        'x-mobile-notifications-signature': signature,
      },
      payload: {
        source: 'tasker',
        device: 'test-phone',
        timestamp: Date.now(),
        notification_id: 'notif-123',
        post_time: '2024-01-01T00:00:00Z',
        app: 'com.example.app',
        title: 'Test Title',
        text: 'Test Text',
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

  it('POST /mobile-notifications/webhooks returns 500 on notification save failure', async () => {
    // Create a connection first
    const signature = 'test-signature-token';
    const signatureHash = hashSignature(signature);
    await fakeSignatureRepo.save({
      userId: TEST_USER_ID,
      signatureHash,
    });

    fakeNotificationRepo.setFailNextSave(true);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {
        'x-mobile-notifications-signature': signature,
      },
      payload: {
        source: 'tasker',
        device: 'test-phone',
        timestamp: Date.now(),
        notification_id: 'notif-123',
        post_time: '2024-01-01T00:00:00Z',
        app: 'com.example.app',
        title: 'Test Title',
        text: 'Test Text',
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
});

describe('Notification Routes', () => {
  let app: FastifyInstance;
  let fakeSignatureRepo: FakeSignatureConnectionRepository;
  let fakeNotificationRepo: FakeNotificationRepository;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';

    fakeSignatureRepo = new FakeSignatureConnectionRepository();
    fakeNotificationRepo = new FakeNotificationRepository();

    setMockServices({
      signatureConnectionRepository: fakeSignatureRepo,
      notificationRepository: fakeNotificationRepo,
      notificationFiltersRepository: new FakeNotificationFiltersRepository(),
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    nock.cleanAll();
  });

  it('GET /mobile-notifications returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(401);
  });

  it('DELETE /mobile-notifications/:notification_id returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/notif-123',
    });

    expect(response.statusCode).toBe(401);
  });

});
