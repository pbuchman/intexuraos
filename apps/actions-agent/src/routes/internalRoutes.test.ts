import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import type { FastifyInstance } from 'fastify';
import { ok, err } from '@intexuraos/common-core';
import { createFakeServices } from './__test-helpers__/fakeServices.js';

function createPubSubBody(
  eventData: Record<string, unknown>
): {
  message: { data: string; messageId: string; publishTime: string };
  subscription: string;
} {
  return {
    message: {
      data: Buffer.from(JSON.stringify(eventData)).toString('base64'),
      messageId: 'msg-1',
      publishTime: '2024-01-01T00:00:00Z',
    },
    subscription: 'projects/test/subscriptions/test',
  };
}

let app: FastifyInstance;

describe('POST /internal/actions/approval-reply', () => {
  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
    process.env['NODE_ENV'] = 'test';
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    resetServices();
    await app.close();
  });

  it('passes all optional fields (actionId, buttonId, buttonTitle) to handleApprovalReplyUseCase', async () => {
    const handleApprovalReplyUseCase = vi.fn().mockResolvedValue(
      ok({ matched: true, actionId: 'a1', intent: 'approve', outcome: 'approved' })
    );
    setServices(createFakeServices({ handleApprovalReplyUseCase }));

    const body = createPubSubBody({
      type: 'action.approval.reply',
      replyToWamid: 'wamid.123',
      replyText: 'yes',
      userId: 'user-1',
      timestamp: '2024-01-01T00:00:00Z',
      actionId: 'action-1',
      buttonId: 'approve:action-1:nonce',
      buttonTitle: 'Approve',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { from: 'noreply@google.com' },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(handleApprovalReplyUseCase).toHaveBeenCalledWith({
      replyToWamid: 'wamid.123',
      replyText: 'yes',
      userId: 'user-1',
      actionId: 'action-1',
      buttonId: 'approve:action-1:nonce',
      buttonTitle: 'Approve',
    });
  });

  it('passes only actionId when buttonId and buttonTitle are absent', async () => {
    const handleApprovalReplyUseCase = vi.fn().mockResolvedValue(
      ok({ matched: true, actionId: 'a1', intent: 'approve', outcome: 'approved' })
    );
    setServices(createFakeServices({ handleApprovalReplyUseCase }));

    const body = createPubSubBody({
      type: 'action.approval.reply',
      replyToWamid: 'wamid.456',
      replyText: 'go ahead',
      userId: 'user-2',
      timestamp: '2024-01-01T00:00:00Z',
      actionId: 'action-2',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { from: 'noreply@google.com' },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(handleApprovalReplyUseCase).toHaveBeenCalledWith({
      replyToWamid: 'wamid.456',
      replyText: 'go ahead',
      userId: 'user-2',
      actionId: 'action-2',
    });
  });

  it('passes only required fields when no optional fields are present', async () => {
    const handleApprovalReplyUseCase = vi.fn().mockResolvedValue(
      ok({ matched: false })
    );
    setServices(createFakeServices({ handleApprovalReplyUseCase }));

    const body = createPubSubBody({
      type: 'action.approval.reply',
      replyToWamid: 'wamid.789',
      replyText: 'random text',
      userId: 'user-3',
      timestamp: '2024-01-01T00:00:00Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { from: 'noreply@google.com' },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(handleApprovalReplyUseCase).toHaveBeenCalledWith({
      replyToWamid: 'wamid.789',
      replyText: 'random text',
      userId: 'user-3',
    });
  });

  it('returns success data when handleApprovalReplyUseCase returns ok', async () => {
    const handleApprovalReplyUseCase = vi.fn().mockResolvedValue(
      ok({ matched: true, actionId: 'a1', intent: 'approve', outcome: 'approved' })
    );
    setServices(createFakeServices({ handleApprovalReplyUseCase }));

    const body = createPubSubBody({
      type: 'action.approval.reply',
      replyToWamid: 'wamid.ok',
      replyText: 'yes',
      userId: 'user-ok',
      timestamp: '2024-01-01T00:00:00Z',
      actionId: 'a1',
      buttonId: 'approve:a1:nonce',
      buttonTitle: 'Approve',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { from: 'noreply@google.com' },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.data.matched).toBe(true);
    expect(json.data.actionId).toBe('a1');
    expect(json.data.intent).toBe('approve');
    expect(json.data.outcome).toBe('approved');
  });

  it('returns 500 when handleApprovalReplyUseCase returns err', async () => {
    const handleApprovalReplyUseCase = vi.fn().mockResolvedValue(
      err(new Error('something went wrong'))
    );
    setServices(createFakeServices({ handleApprovalReplyUseCase }));

    const body = createPubSubBody({
      type: 'action.approval.reply',
      replyToWamid: 'wamid.err',
      replyText: 'yes',
      userId: 'user-err',
      timestamp: '2024-01-01T00:00:00Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { from: 'noreply@google.com' },
      payload: body,
    });

    expect(response.statusCode).toBe(500);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error.message).toBe('something went wrong');
  });

  it('returns 400 for unexpected event type', async () => {
    setServices(createFakeServices());

    const body = createPubSubBody({
      type: 'action.created',
      replyToWamid: 'wamid.bad',
      replyText: 'yes',
      userId: 'user-bad',
      timestamp: '2024-01-01T00:00:00Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { from: 'noreply@google.com' },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error.message).toBe('Unexpected event type for approval reply');
  });

  it('returns 400 for invalid base64 data', async () => {
    setServices(createFakeServices());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { from: 'noreply@google.com' },
      payload: {
        message: {
          data: '!!!not-valid-base64-json!!!',
          messageId: 'msg-bad',
          publishTime: '2024-01-01T00:00:00Z',
        },
        subscription: 'projects/test/subscriptions/test',
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error.message).toBe('Failed to decode PubSub message');
  });

  it('returns 401 when internal auth fails (no PubSub header, wrong token)', async () => {
    setServices(createFakeServices());

    const body = createPubSubBody({
      type: 'action.approval.reply',
      replyToWamid: 'wamid.auth',
      replyText: 'yes',
      userId: 'user-auth',
      timestamp: '2024-01-01T00:00:00Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { 'x-internal-auth': 'wrong-token' },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    const json = response.json();
    expect(json.success).toBe(false);
  });

  it('authenticates via x-internal-auth header', async () => {
    const handleApprovalReplyUseCase = vi.fn().mockResolvedValue(
      ok({ matched: true, actionId: 'a-int', intent: 'approve', outcome: 'approved' })
    );
    setServices(createFakeServices({ handleApprovalReplyUseCase }));

    const body = createPubSubBody({
      type: 'action.approval.reply',
      replyToWamid: 'wamid.internal',
      replyText: 'yes',
      userId: 'user-internal',
      timestamp: '2024-01-01T00:00:00Z',
      actionId: 'a-int',
      buttonId: 'approve:a-int:nonce',
      buttonTitle: 'Approve',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/actions/approval-reply',
      headers: { 'x-internal-auth': 'test-token' },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(handleApprovalReplyUseCase).toHaveBeenCalledWith({
      replyToWamid: 'wamid.internal',
      replyText: 'yes',
      userId: 'user-internal',
      actionId: 'a-int',
      buttonId: 'approve:a-int:nonce',
      buttonTitle: 'Approve',
    });
  });
});
