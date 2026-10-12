import { afterEach, beforeEach, vi } from 'vitest';
import { err } from '@intexuraos/common-core';
import { MESSAGE_DIGEST_EVENT_MESSAGE } from '@intexuraos/whatsapp-pubsub-client';
import {
  createFakeFirestore,
  getFirestore,
  setFirestore,
  resetFirestore,
} from '@intexuraos/infra-firestore';
import { getServices } from '../services.js';
import { createNotificationDeliveryRepository } from '../infra/firestore/notificationDeliveryRepository.js';
import type { WebhookPayload } from '../routes/schemas.js';
import {
  createSignature,
  createWebhookPayload,
  describe,
  expect,
  it,
  setupTestContext,
  testConfig,
} from './testUtils.js';

const phoneNumberId = '123456789012345';
const source = 'calendar';
const runId = 'user-123_calendar_daily_lookahead_2026-10-12';
function receiptPayload(statuses: ('sent' | 'delivered' | 'read' | 'failed')[]): WebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15551234567', phone_number_id: phoneNumberId },
              statuses: statuses.map((status, index) => ({
                id: `w${String(index)}`,
                status,
                timestamp: String(Math.floor(Date.now() / 1000)),
                recipient_id: '15551234567',
              })),
            },
          },
        ],
      },
    ],
  };
}

describe('notification transport boundary', () => {
  const ctx = setupTestContext();
  beforeEach(() => {
    setFirestore(createFakeFirestore() as unknown as Parameters<typeof setFirestore>[0]);
    getServices().notificationDeliveryRepository = createNotificationDeliveryRepository();
    getServices().outboundPhoneNumberId = phoneNumberId;
  });
  afterEach(() => resetFirestore());
  async function receive(payload: WebhookPayload, signature?: string): Promise<number> {
    const raw = JSON.stringify(payload);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature ?? createSignature(raw, testConfig.appSecret),
      },
      payload: raw,
    });
    return response.statusCode;
  }
  function activateMatrixAccount(): void {
    const now = new Date().toISOString();
    ctx.privateWhatsAppRepository.setAccount({
      id: 'user-123',
      userId: 'user-123',
      sourceAccountId: 'private-source',
      phoneNumberNormalized: '15551234567',
      displayName: 'User',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    });
  }
  function heartbeat(): NonNullable<ReturnType<typeof getServices>['jobHeartbeatStore']> {
    return {
      start: vi
        .fn()
        .mockResolvedValue({
          key: 'retry_pending_whatsapp_webhooks',
          runId: 'r',
          startedAt: new Date().toISOString(),
        }),
      finish: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    };
  }
  function digestExtra(): Record<string, unknown> {
    return {
      message: MESSAGE_DIGEST_EVENT_MESSAGE,
      correlationId: 'mdr_tracked',
      important: true,
      presentation: {
        kind: 'message_digest_v1',
        digestName: 'Daily digest',
        digestExcerpt: 'Stable excerpt',
        runUrlSuffix: '#/whatsapp/message-digests/md_definition_tracked/history/mdr_tracked',
      },
      deliveryAuthorization: {
        kind: 'message_digest_delivery_v1',
        definitionId: 'md_definition_tracked',
        runId: 'mdr_tracked',
      },
      retainMessageText: false,
    };
  }
  it('handles every status in statuses-only, mixed and multi-entry batches', async () => {
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing test repository');
    const now = new Date().toISOString();
    for (let index = 0; index < 4; index++) {
      const intent = await repo.begin({
        userId: 'user-123',
        correlationId: 'session',
        idempotencyKey: `k${String(index)}`,
        now,
      });
      await repo.accepted({
        intentId: intent.id,
        phoneNumberId,
        wamid: `w${String(index)}`,
        at: now,
      });
    }
    const first = receiptPayload(['delivered', 'read']);
    const second = receiptPayload(['sent', 'failed']);
    const secondChange = second.entry[0]?.changes[0];
    if (secondChange === undefined) throw new Error('missing change');
    secondChange.value.statuses?.forEach((status, index) => {
      status.id = `w${String(index + 2)}`;
    });
    first.entry.push(...second.entry);
    const mixed = createWebhookPayload() as WebhookPayload;
    first.entry[0]?.changes.push(...(mixed.entry[0]?.changes ?? []));
    expect(await receive(first)).toBe(200);
    expect((await repo.getConfirmation({ userId: 'user-123', idempotencyKey: 'k0' }))?.status).toBe(
      'delivered'
    );
    expect((await repo.getConfirmation({ userId: 'user-123', idempotencyKey: 'k1' }))?.status).toBe(
      'read'
    );
    expect((await repo.getConfirmation({ userId: 'user-123', idempotencyKey: 'k2' }))?.status).toBe(
      'pending'
    );
    expect((await repo.getConfirmation({ userId: 'user-123', idempotencyKey: 'k3' }))?.status).toBe(
      'failed'
    );
    expect(await receive(receiptPayload(['delivered']))).toBe(200);
  });
  it('rejects bad HMAC and foreign phone/WABA in later entries before any receipt writes', async () => {
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing test repository');
    const spy = vi.spyOn(repo, 'recordReceipt');
    expect(await receive(receiptPayload(['delivered']), 'sha256=bad')).toBe(403);
    const payload = receiptPayload(['delivered']);
    const foreign = receiptPayload(['read']).entry[0];
    if (foreign === undefined) throw new Error('missing entry');
    foreign.id = 'foreign-waba';
    payload.entry.push(foreign);
    expect(await receive(payload)).toBe(403);
    foreign.id = '102290129340398';
    const change = foreign.changes[0];
    if (change === undefined) throw new Error('missing change');
    change.value.metadata.phone_number_id = 'foreign-phone';
    expect(await receive(payload)).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it('registers before Matrix send, strips the marker on authenticated ingestion and preserves run context', async () => {
    ctx.privateWhatsAppRepository.setAccount({
      id: 'user-123',
      userId: 'user-123',
      sourceAccountId: 'private-source',
      phoneNumberNormalized: '15551234567',
      displayName: 'User',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    });
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    const send = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        text: 'next 24 hours',
        startNewSession: true,
        idempotencyKey: 'calendar:schedule:2026-10-12',
        scheduledFor: new Date().toISOString(),
        notificationContext: { source, runId, phase: 'ack' },
      },
    });
    expect(send.statusCode).toBe(200);
    const outbound = ctx.matrixOutboundGateway.sendCalls[0];
    expect(outbound?.text).toMatch(/\n\[intex-notification:[a-f0-9]{64}\]$/u);
    const incoming = createWebhookPayload() as WebhookPayload;
    const message = incoming.entry[0]?.changes[0]?.value.messages?.[0];
    if (message === undefined || outbound === undefined) throw new Error('missing message');
    message.text = { body: outbound.text };
    expect(await receive(incoming)).toBe(200);
    const saved = ctx.webhookEventRepository.getAll()[0];
    if (saved === undefined) throw new Error('missing saved event');
    const process = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/pubsub/process-webhook',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        message: {
          data: Buffer.from(
            JSON.stringify({
              type: 'whatsapp.webhook.process',
              eventId: saved.id,
              payload: JSON.stringify(incoming),
              phoneNumberId,
            })
          ).toString('base64'),
          messageId: 'ingest',
          publishTime: new Date().toISOString(),
        },
        subscription: 'test',
      },
    });
    expect(process.statusCode).toBe(200);
    const ingest = ctx.eventPublisher.getIntexMessageIngestEvents()[0];
    expect(ingest?.text).toBe('new session: next 24 hours');
    expect(ingest?.notificationContext).toEqual({ source, runId, phase: 'ack' });
  });
  async function sendOutbound(
    idempotencyKey = 'receipt-test',
    extra: Record<string, unknown> = {}
  ): Promise<number> {
    const result = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/pubsub/send-message',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        message: {
          data: Buffer.from(
            JSON.stringify({
              type: 'whatsapp.message.send',
              userId: 'user-123',
              correlationId: 's',
              message: 'Summary',
              idempotencyKey,
              ...extra,
            })
          ).toString('base64'),
          messageId: 'outbound-id',
          publishTime: new Date().toISOString(),
        },
        subscription: 'test',
      },
    });
    return result.statusCode;
  }
  it('retries a definitely unsent rate-limited message and suppresses another accepted send', async () => {
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    ctx.messageSender.setFail(true, {
      code: 'INTERNAL_ERROR',
      message: 'Rate limited',
      httpStatus: 429,
    });
    expect(await sendOutbound()).toBe(502);
    ctx.messageSender.setFail(false);
    expect(await sendOutbound()).toBe(200);
    expect(await sendOutbound()).toBe(200);
    expect(ctx.messageSender.getSentMessages()).toHaveLength(1);
  });
  it('preserves pending monitoring and never duplicates a send when acceptance persistence fails', async () => {
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    vi.spyOn(repo, 'accepted').mockRejectedValueOnce(new Error('Storage temporarily unavailable'));
    expect(await sendOutbound()).toBeGreaterThanOrEqual(500);
    expect(await sendOutbound()).toBe(200);
    expect(ctx.messageSender.getSentMessages()).toHaveLength(1);
    expect(await repo.monitoring(new Date().toISOString())).toMatchObject({
      pendingCount: 1,
      failedCount: 0,
    });
    const observation = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/outbound-deliveries/get',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: { userId: 'user-123', idempotencyKey: 'receipt-test' },
    });
    expect(observation.json()).toMatchObject({ data: { status: 'ambiguous' } });
  });
  it('observes durable delivery proof after legacy acceptance completion fails without resending', async () => {
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    const accepted = vi.spyOn(repo, 'accepted');
    ctx.outboundMessageRepository.setFailIdempotentCompletion(true);
    expect(await sendOutbound('legacy-completion-failure')).toBe(503);
    const send = accepted.mock.calls[0]?.[0];
    if (send === undefined) throw new Error('missing accepted send');
    expect(
      await ctx.outboundMessageRepository.getIdempotentDeliveryState({
        userId: 'user-123',
        idempotencyKey: 'legacy-completion-failure',
      })
    ).toMatchObject({ ok: true, value: { status: 'pending' } });
    const status = receiptPayload(['delivered']);
    const receipt = status.entry[0]?.changes[0]?.value.statuses?.[0];
    if (receipt === undefined) throw new Error('missing receipt');
    receipt.id = send.wamid;
    expect(await receive(status)).toBe(200);
    const observation = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/outbound-deliveries/get',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: { userId: 'user-123', idempotencyKey: 'legacy-completion-failure' },
    });
    expect(observation.statusCode).toBe(200);
    expect(observation.json()).toMatchObject({
      data: { status: 'sent', acceptedAt: send.at, transportConfirmation: { status: 'delivered' } },
    });
    expect(await sendOutbound('legacy-completion-failure')).toBe(503);
    expect(ctx.messageSender.getSentMessages()).toHaveLength(1);
  });
  it('suppresses retired calendar acknowledgments and final replies before provider dispatch', async () => {
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    const now = new Date().toISOString();
    const registration = await repo.register({
      userId: 'user-123',
      source,
      runId,
      scheduledFor: now,
      now,
    });
    await repo.consume({
      marker: registration.marker,
      userId: 'user-123',
      messageId: 'incoming',
      now,
    });
    const markers = await getFirestore()
      .collection('whatsapp_notification_markers')
      .where('userId', '==', 'user-123')
      .get();
    const marker = markers.docs[0];
    if (marker === undefined) throw new Error('missing marker');
    await marker.ref.update({ skippedBeforeResume: new Date(Date.parse(now) + 1).toISOString() });
    expect(
      await sendOutbound('retired-ack', {
        replyToMessageId: 'incoming',
        notificationContext: { source, runId, phase: 'ack' },
      })
    ).toBe(200);
    expect(
      await sendOutbound('retired-final', {
        replyToMessageId: 'incoming',
        notificationContext: {
          source,
          runId,
          phase: 'final',
          outcome: 'succeeded',
          partIndex: 0,
          partCount: 1,
        },
      })
    ).toBe(200);
    expect(ctx.messageSender.getSentMessages()).toHaveLength(0);
    expect(await repo.monitoring(now)).toMatchObject({ pendingCount: 0, failedCount: 0 });
  });
  it('fails the receipt webhook before acknowledgement when durable receipt storage fails', async () => {
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    vi.spyOn(repo, 'recordReceipt').mockRejectedValueOnce(new Error('Storage unavailable'));
    expect(await receive(receiptPayload(['delivered']))).toBe(500);
    expect(ctx.webhookEventRepository.getAll()).toHaveLength(0);
  });
  it('protects run-state queries with internal auth and isolates another user', async () => {
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    await repo.register({
      userId: 'user-123',
      source,
      runId,
      scheduledFor: new Date().toISOString(),
      now: new Date().toISOString(),
    });
    const request = {
      method: 'POST' as const,
      url: '/internal/whatsapp/notification-runs/get',
      payload: { userId: 'user-123', source, runId },
    };
    expect((await ctx.app.inject(request)).statusCode).toBe(401);
    const owned = await ctx.app.inject({
      ...request,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });
    expect(owned.statusCode).toBe(200);
    expect(owned.json().data).toEqual({ status: 'pending', stage: 'awaiting_ingress' });
    const other = await ctx.app.inject({
      ...request,
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: { ...request.payload, userId: 'other' },
    });
    expect(other.json().data).toEqual({ status: 'pending', stage: 'awaiting_ingress' });
  });

  it.each(['missing', 'disconnected'])(
    'records %s final-reply mapping failure immediately in run state',
    async (mappingState) => {
      const repo = getServices().notificationDeliveryRepository;
      if (repo === undefined) throw new Error('missing repository');
      const now = new Date().toISOString();
      const marker = await repo.register({
        userId: 'user-123',
        source,
        runId,
        scheduledFor: now,
        now,
      });
      await repo.consume({ marker: marker.marker, userId: 'user-123', messageId: 'incoming', now });
      if (mappingState === 'disconnected') {
        await ctx.userMappingRepository.saveMapping('user-123', ['15551234567']);
        await ctx.userMappingRepository.disconnectMapping('user-123');
      }
      expect(
        await sendOutbound('final-failure', {
          replyToMessageId: 'incoming',
          notificationContext: {
            source,
            runId,
            phase: 'final',
            outcome: 'succeeded',
            partIndex: 0,
            partCount: 1,
          },
        })
      ).toBe(200);
      expect(await repo.getRun({ userId: 'user-123', source, runId })).toMatchObject({
        status: 'failed',
        stage: 'failed',
      });
      expect(ctx.messageSender.getSentMessages()).toHaveLength(0);
    }
  );

  it('persists retry heartbeats on empty work and reports internal-only monitoring', async () => {
    const store = {
      start: vi.fn().mockResolvedValue({
        key: 'retry_pending_whatsapp_webhooks',
        runId: 'r',
        startedAt: new Date().toISOString(),
      }),
      finish: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([
        {
          key: 'retry_pending_whatsapp_webhooks',
          lastStartedAt: null,
          lastFinishedAt: null,
          lastSucceededAt: null,
          lastOutcome: 'never',
        },
      ]),
    };
    getServices().jobHeartbeatStore = store;
    const headers = { 'x-internal-auth': 'test-internal-token' };
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/internal/whatsapp/webhooks/retry-pending',
          headers,
        })
      ).statusCode
    ).toBe(200);
    expect(store.finish).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'retry_pending_whatsapp_webhooks' }),
      'succeeded'
    );
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/internal/monitoring/status' })).statusCode
    ).toBe(401);
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/monitoring/status',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      schemaVersion: 1,
      notifications: { pendingCount: 0, failedCount: 0 },
      jobs: [{ key: 'retry_pending_whatsapp_webhooks' }],
    });
    expect(store.list).toHaveBeenCalledWith(['retry_pending_whatsapp_webhooks']);
    store.list.mockRejectedValueOnce(new Error('storage unavailable'));
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/internal/monitoring/status', headers }))
        .statusCode
    ).toBe(500);
    delete getServices().jobHeartbeatStore;
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/internal/monitoring/status', headers }))
        .statusCode
    ).toBe(503);
  });
  it('records a failed retry heartbeat when the pending-event query returns an error', async () => {
    const store = heartbeat();
    getServices().jobHeartbeatStore = store;
    vi.spyOn(ctx.webhookEventRepository, 'findRetryableEvents').mockResolvedValueOnce(
      err({ code: 'INTERNAL_ERROR', message: 'query failed' })
    );
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/webhooks/retry-pending',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });
    expect(response.json()).toMatchObject({ data: { failed: 1, processed: 0 } });
    expect(store.finish).toHaveBeenCalledWith(expect.objectContaining({ runId: 'r' }), 'failed');
  });
  it.each([true, false])(
    'propagates a retry query exception with heartbeat configured=%s',
    async (configured) => {
      const store = heartbeat();
      if (configured) getServices().jobHeartbeatStore = store;
      vi.spyOn(ctx.webhookEventRepository, 'findRetryableEvents').mockRejectedValueOnce(
        new Error('query unavailable')
      );
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/whatsapp/webhooks/retry-pending',
        headers: { 'x-internal-auth': 'test-internal-token' },
      });
      expect(response.statusCode).toBe(500);
      if (configured)
        expect(store.finish).toHaveBeenCalledWith(
          expect.objectContaining({ runId: 'r' }),
          'failed'
        );
      else expect(store.finish).not.toHaveBeenCalled();
    }
  );
  it('reports missing notification repository configuration on the owned run query', async () => {
    delete getServices().notificationDeliveryRepository;
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/notification-runs/get',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: { userId: 'user-123', source, runId },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'MISCONFIGURED' } });
  });
  it('exposes legacy acceptance alongside still-unlinked transport state without claiming delivery', async () => {
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    const now = new Date().toISOString();
    const idempotencyKey = 'legacy-sent-unlinked';
    const payloadDigest = 'a'.repeat(64);
    await repo.begin({ userId: 'user-123', correlationId: 's', idempotencyKey, now });
    await ctx.outboundMessageRepository.reserveIdempotentDelivery({
      userId: 'user-123',
      idempotencyKey,
      payloadDigest,
      now,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    await ctx.outboundMessageRepository.completeIdempotentDelivery({
      idempotencyKey,
      payloadDigest,
      outboundMessage: {
        userId: 'user-123',
        correlationId: 's',
        wamid: 'legacy',
        sentAt: now,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/outbound-deliveries/get',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: { userId: 'user-123', idempotencyKey },
    });
    expect(response.json()).toMatchObject({
      data: { status: 'sent', acceptedAt: now, transportConfirmation: { status: 'pending' } },
    });
  });
  it.each([
    { source: 'other', runId, phase: 'ack' },
    { source, runId: '', phase: 'ack' },
  ])('rejects invalid tracked Matrix trigger context: %j', async (notificationContext) => {
    activateMatrixAccount();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        text: 'summary',
        idempotencyKey: 'calendar:test',
        notificationContext,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(ctx.matrixOutboundGateway.sendCalls).toHaveLength(0);
  });
  it('requires idempotency for a tracked Matrix trigger', async () => {
    activateMatrixAccount();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        text: 'summary',
        notificationContext: { source, runId, phase: 'ack' },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(ctx.matrixOutboundGateway.sendCalls).toHaveLength(0);
  });
  it('reports unavailable Matrix notification tracking before sending', async () => {
    activateMatrixAccount();
    delete getServices().notificationDeliveryRepository;
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        text: 'summary',
        idempotencyKey: 'calendar:test',
        notificationContext: { source, runId, phase: 'ack' },
      },
    });
    expect(response.statusCode).toBe(503);
    expect(ctx.matrixOutboundGateway.sendCalls).toHaveLength(0);
  });
  it('uses the trigger observation time when scheduledFor is omitted', async () => {
    activateMatrixAccount();
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    const register = vi.spyOn(repo, 'register');
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/outbound-matrix-messages',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        text: 'summary',
        idempotencyKey: 'calendar:test',
        notificationContext: { source, runId, phase: 'ack' },
      },
    });
    expect(response.statusCode).toBe(200);
    const registration = register.mock.calls[0]?.[0];
    expect(registration?.scheduledFor).toBe(registration?.now);
    expect(ctx.matrixOutboundGateway.sendCalls).toHaveLength(1);
  });
  it('rejects invalid Pub/Sub notification context before provider calls', async () => {
    expect(
      await sendOutbound('invalid-context', {
        notificationContext: { source, runId, phase: 'final' },
      })
    ).toBe(400);
    expect(ctx.messageSender.getSentMessages()).toHaveLength(0);
  });
  it('tracks a digest producer and marks revoked renewal as definitely unsent', async () => {
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    getServices().messageDigestDeliveryAuthorizationClient = {
      acquire: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 1,
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        })
        .mockResolvedValueOnce({ ok: true, disposition: 'denied' }),
      release: vi.fn().mockResolvedValue({ ok: true }),
    };
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    const begin = vi.spyOn(repo, 'begin');
    expect(await sendOutbound('message-digest:mdr_tracked', digestExtra())).toBe(200);
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({ producerKey: 'message_digest:md_definition_tracked' })
    );
    expect(
      await repo.getConfirmation({
        userId: 'user-123',
        idempotencyKey: 'message-digest:mdr_tracked',
      })
    ).toMatchObject({ status: 'failed', failureCode: 'DELIVERY_AUTHORIZATION_REVOKED' });
    expect(ctx.messageSender.getSentMessages()).toHaveLength(0);
  });
  it('retries definitely unsent ordinary notifications using their stable Pub/Sub identity', async () => {
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    ctx.messageSender.setFail(true, {
      code: 'INTERNAL_ERROR',
      message: 'rate limited',
      httpStatus: 429,
    });
    expect(await sendOutbound('unused', { idempotencyKey: undefined })).toBe(502);
    ctx.messageSender.setFail(false);
    expect(await sendOutbound('unused', { idempotencyKey: undefined })).toBe(200);
    expect(ctx.messageSender.getSentMessages()).toHaveLength(1);
  });
  it.each(['markIdempotentDeliveryFailed', 'authorizeIdempotentDeliveryRetry'] as const)(
    'fails closed when %s cannot preserve an unsent retry',
    async (method) => {
      ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
      ctx.messageSender.setFail(true, {
        code: 'INTERNAL_ERROR',
        message: 'rate limited',
        httpStatus: 429,
      });
      vi.spyOn(ctx.outboundMessageRepository, method).mockResolvedValueOnce({
        ok: false,
        code: 'PERSISTENCE_ERROR',
      });
      expect(await sendOutbound('retry-persistence-failure')).toBe(500);
      expect(ctx.messageSender.getSentMessages()).toHaveLength(0);
    }
  );
  it('records permanent provider rejection in notification tracking', async () => {
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    ctx.messageSender.setFail(true, {
      code: 'INTERNAL_ERROR',
      message: 'recipient rejected',
      httpStatus: 400,
    });
    expect(await sendOutbound('permanent-provider-failure')).toBe(200);
    expect(
      await getServices().notificationDeliveryRepository?.getConfirmation({
        userId: 'user-123',
        idempotencyKey: 'permanent-provider-failure',
      })
    ).toMatchObject({ status: 'failed', failureCode: 'PROVIDER_REJECTED' });
  });
  it('suppresses an ordinary replay after tracker acceptance persistence fails without a legacy key', async () => {
    ctx.userMappingRepository.setMappingForPhone('15551234567', 'user-123');
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    vi.spyOn(repo, 'accepted').mockRejectedValueOnce(new Error('write unavailable'));
    expect(await sendOutbound('unused', { idempotencyKey: undefined })).toBe(500);
    expect(await sendOutbound('unused', { idempotencyKey: undefined })).toBe(200);
    expect(ctx.messageSender.getSentMessages()).toHaveLength(1);
  });
  it.each(['status', 'timestamp'])(
    'rejects an invalid receipt %s before durable writes',
    async (field) => {
      const repo = getServices().notificationDeliveryRepository;
      if (repo === undefined) throw new Error('missing repository');
      const write = vi.spyOn(repo, 'recordReceipt');
      const payload = receiptPayload(['delivered']);
      const receipt = payload.entry[0]?.changes[0]?.value.statuses?.[0];
      if (receipt === undefined) throw new Error('missing receipt');
      if (field === 'timestamp') receipt.timestamp = 'not-a-number';
      else receipt.status = 'unknown' as typeof receipt.status;
      expect(await receive(payload)).toBe(400);
      expect(write).not.toHaveBeenCalled();
    }
  );
  it('stores the provider failure code from a failed status receipt', async () => {
    const repo = getServices().notificationDeliveryRepository;
    if (repo === undefined) throw new Error('missing repository');
    const now = new Date().toISOString();
    const intent = await repo.begin({
      userId: 'user-123',
      correlationId: 's',
      idempotencyKey: 'failed-receipt',
      now,
    });
    await repo.accepted({ intentId: intent.id, phoneNumberId, wamid: 'w0', at: now });
    const payload = receiptPayload(['failed']);
    const receipt = payload.entry[0]?.changes[0]?.value.statuses?.[0];
    if (receipt === undefined) throw new Error('missing receipt');
    receipt.errors = [{ code: 131026 }];
    expect(await receive(payload)).toBe(200);
    expect(
      await repo.getConfirmation({ userId: 'user-123', idempotencyKey: 'failed-receipt' })
    ).toMatchObject({ status: 'failed', failureCode: '131026' });
  });
});
