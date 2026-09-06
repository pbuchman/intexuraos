import { beforeEach, describe, expect, it, setupTestContext } from './testUtils.js';

describe('Private Matrix outbound routes', () => {
  const ctx = setupTestContext();

  beforeEach(() => {
    ctx.privateWhatsAppRepository.setAccount({
      id: 'user-123',
      userId: 'user-123',
      sourceAccountId: 'private-source-123',
      phoneNumberNormalized: '48123456789',
      displayName: '+48123456789',
      status: 'active',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
      schemaVersion: 1,
    });
  });

  it('rejects delivery-status requests without internal auth', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/matrix-delivery-status/user-123',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns setup_required when the user has no active private WhatsApp account', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/matrix-delivery-status/missing-user',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'setup_required',
        deliverable: false,
        reason: 'Private WhatsApp account is not configured',
      },
    });
  });

  it('returns internal errors when delivery-status account lookup fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'INTERNAL_ERROR',
      message: 'account lookup failed',
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/matrix-delivery-status/user-123',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns ready only when the matrix adapter reports readiness for the intex_agent target', async () => {
    ctx.matrixOutboundGateway.setReadinessResult({
      status: 'ready',
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/matrix-delivery-status/user-123',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'ready',
        deliverable: true,
      },
    });
    expect(ctx.matrixOutboundGateway.readinessCalls).toEqual([
      {
        sourceAccountId: 'private-source-123',
        target: 'intex_agent',
      },
    ]);
  });

  it('returns setup_required when the matrix adapter target mapping is not configured', async () => {
    ctx.matrixOutboundGateway.setReadinessResult({
      status: 'setup_required',
      reason: 'Matrix outbound target is not configured',
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/matrix-delivery-status/user-123',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'setup_required',
        deliverable: false,
        reason: 'Matrix outbound target is not configured',
      },
    });
  });

  it('returns error when the matrix adapter readiness check fails unexpectedly', async () => {
    ctx.matrixOutboundGateway.setReadinessResult({
      status: 'error',
      message: 'Matrix adapter request failed',
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/matrix-delivery-status/user-123',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'error',
        deliverable: false,
        message: 'Matrix adapter request failed',
      },
    });
  });

  it('rejects outbound sends without internal auth', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        userId: 'user-123',
        text: 'hello',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects invalid outbound send bodies after internal auth', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        userId: '',
        text: 'hello',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('sends outbound matrix messages for the active private account', async () => {
    ctx.matrixOutboundGateway.setSendResult({
      status: 'sent',
      matrixEventId: '$matrix-event-123',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        userId: 'user-123',
        text: 'Send me events that they have in the calendar in the next 24 hours.',
        startNewSession: true,
        idempotencyKey: 'schedule:user-123:2026-07-04',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'sent',
        matrixEventId: '$matrix-event-123',
      },
    });
    expect(ctx.matrixOutboundGateway.sendCalls).toEqual([
      {
        sourceAccountId: 'private-source-123',
        target: 'intex_agent',
        text: 'new session: Send me events that they have in the calendar in the next 24 hours.',
        idempotencyKey: 'schedule:user-123:2026-07-04',
      },
    ]);
  });

  it('returns setup_required for outbound sends when the private account is missing', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        userId: 'missing-user',
        text: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'setup_required',
        reason: 'Private WhatsApp account is not configured',
      },
    });
  });

  it('returns internal errors when outbound send account lookup fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'INTERNAL_ERROR',
      message: 'account lookup failed',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        userId: 'user-123',
        text: 'hello',
      },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns setup_required when the matrix adapter send target is not configured', async () => {
    ctx.matrixOutboundGateway.setSendResult({
      status: 'setup_required',
      reason: 'Matrix outbound target is not configured',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        userId: 'user-123',
        text: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'setup_required',
        reason: 'Matrix outbound target is not configured',
      },
    });
  });

  it('returns error when the matrix adapter send fails unexpectedly', async () => {
    ctx.matrixOutboundGateway.setSendResult({
      status: 'error',
      message: 'Matrix adapter request failed',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        userId: 'user-123',
        text: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'error',
        message: 'Matrix adapter request failed',
      },
    });
  });
});
