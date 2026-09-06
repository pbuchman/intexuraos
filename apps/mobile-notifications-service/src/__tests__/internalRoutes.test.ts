import { beforeEach, describe, expect, it, setupTestContext } from './testUtils.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('POST /internal/mobile-notifications/query', () => {
  const ctx = setupTestContext();

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
  });

  it('rejects a missing internal-auth header', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/mobile-notifications/query',
      payload: { userId: 'synthetic-user' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid internal-auth token', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/mobile-notifications/query',
      headers: { 'x-internal-auth': 'wrong-token' },
      payload: { userId: 'synthetic-user' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns an empty list for a user without notifications', async () => {
    const response = await query(ctx, { userId: 'synthetic-empty-user' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { notifications: [] },
    });
  });

  it('filters and maps ordinary notifications without exposing repository fields', async () => {
    ctx.notificationRepo.addNotification({
      id: 'notification-one',
      userId: 'synthetic-user',
      source: 'tasker',
      device: 'synthetic-phone',
      app: 'com.example.chat',
      title: 'Important update',
      text: 'Visible body',
      timestamp: 1_775_000_000,
      postTime: '1775000000',
      receivedAt: '2026-04-01T10:00:00.000Z',
      notificationId: 'external-one',
    });
    ctx.notificationRepo.addNotification({
      id: 'notification-two',
      userId: 'synthetic-user',
      source: 'other',
      device: 'synthetic-phone',
      app: 'com.example.mail',
      title: 'Other update',
      text: 'Excluded body',
      timestamp: 1_775_000_001,
      postTime: '1775000001',
      receivedAt: '2026-04-01T10:01:00.000Z',
      notificationId: 'external-two',
    });

    const response = await query(ctx, {
      userId: 'synthetic-user',
      filter: { app: ['com.example.chat'], source: 'tasker', title: 'important' },
      limit: 10,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        notifications: [
          {
            app: 'com.example.chat',
            title: 'Important update',
            body: 'Visible body',
            timestamp: expect.any(String),
            source: 'tasker',
          },
        ],
      },
    });
    expect(response.body).not.toContain('synthetic-phone');
    expect(response.body).not.toContain('external-one');
  });

  it('respects the requested result limit', async () => {
    for (let index = 0; index < 3; index += 1) {
      ctx.notificationRepo.addNotification({
        id: `notification-${String(index)}`,
        userId: 'synthetic-user',
        source: 'tasker',
        device: 'synthetic-phone',
        app: 'com.example.chat',
        title: `Update ${String(index)}`,
        text: 'Visible body',
        timestamp: 1_775_000_000 + index,
        postTime: String(1_775_000_000 + index),
        receivedAt: `2026-04-01T10:0${String(index)}:00.000Z`,
        notificationId: `external-${String(index)}`,
      });
    }

    const response = await query(ctx, { userId: 'synthetic-user', limit: 2 });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { notifications: unknown[] } }>().data.notifications).toHaveLength(2);
  });

  it('ignores empty filter values', async () => {
    ctx.notificationRepo.addNotification({
      id: 'notification-one',
      userId: 'synthetic-user',
      source: 'tasker',
      device: 'synthetic-phone',
      app: 'com.example.chat',
      title: 'Visible update',
      text: 'Visible body',
      timestamp: 1_775_000_000,
      postTime: '1775000000',
      receivedAt: '2026-04-01T10:00:00.000Z',
      notificationId: 'external-one',
    });

    const response = await query(ctx, {
      userId: 'synthetic-user',
      filter: { app: [], source: '', title: '' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { notifications: unknown[] } }>().data.notifications).toHaveLength(1);
  });

  it('validates the required user identifier before the handler', async () => {
    const response = await query(ctx, {});

    expect(response.statusCode).toBe(400);
  });

  it('returns a safe internal error when notification lookup fails', async () => {
    ctx.notificationRepo.setFailNextFind(true);
    const response = await query(ctx, { userId: 'synthetic-user' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });
});

async function query(
  ctx: ReturnType<typeof setupTestContext>,
  payload: Record<string, unknown>
): Promise<Awaited<ReturnType<typeof ctx.app.inject>>> {
  return await ctx.app.inject({
    method: 'POST',
    url: '/internal/mobile-notifications/query',
    headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    payload,
  });
}
