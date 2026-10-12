import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/infra-firestore';
import { createNotificationDeliveryRepository } from '../../infra/firestore/notificationDeliveryRepository.js';

const now = '2026-10-12T13:30:00.000Z';
const context = {
  source: 'calendar',
  runId: 'schedule_2026-10-12',
  phase: 'final' as const,
  outcome: 'succeeded' as const,
  partIndex: 0,
  partCount: 2,
};
describe('notification delivery correlation and receipts', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
  });
  afterEach(() => {
    resetFirestore();
    vi.useRealTimers();
  });
  it('registers a stable opaque marker, rejects foreign/expired senders and consumes one message idempotently', async () => {
    const repo = createNotificationDeliveryRepository();
    const registered = await repo.register({
      userId: 'u',
      source: 'calendar',
      runId: 'r',
      scheduledFor: now,
      now,
    });
    expect(registered.marker).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      await repo.register({ userId: 'u', source: 'calendar', runId: 'r', scheduledFor: now, now })
    ).toEqual(registered);
    expect(
      await repo.consume({ marker: registered.marker, userId: 'other', messageId: 'm', now })
    ).toBeNull();
    expect(
      await repo.consume({
        marker: registered.marker,
        userId: 'u',
        messageId: 'm',
        now: '2026-10-13T13:30:00.000Z',
      })
    ).toBeNull();
    expect(
      await repo.consume({ marker: registered.marker, userId: 'u', messageId: 'm', now })
    ).toEqual({ source: 'calendar', runId: 'r', phase: 'ack' });
    expect(
      await repo.consume({ marker: registered.marker, userId: 'u', messageId: 'm', now })
    ).not.toBeNull();
    expect(
      await repo.consume({ marker: registered.marker, userId: 'u', messageId: 'different', now })
    ).toBeNull();
  });
  it('links early receipts atomically, rejects another phone identity and never regresses read', async () => {
    const repo = createNotificationDeliveryRepository();
    const registration = await repo.register({
      userId: 'u',
      source: 'calendar',
      runId: context.runId,
      scheduledFor: now,
      now,
    });
    await repo.consume({ marker: registration.marker, userId: 'u', messageId: 'incoming', now });
    await repo.recordReceipt({ phoneNumberId: 'phone', wamid: 'w', status: 'read', at: now });
    const intent = await repo.begin({
      userId: 'u',
      idempotencyKey: 'k',
      correlationId: 'session',
      notificationContext: context,
      replyToMessageId: 'incoming',
      now,
    });
    await repo.accepted({ intentId: intent.id, phoneNumberId: 'phone', wamid: 'w', at: now });
    expect(await repo.getConfirmation({ userId: 'u', idempotencyKey: 'k' })).toMatchObject({
      status: 'read',
      deliveredAt: now,
      readAt: now,
    });
    await repo.recordReceipt({
      phoneNumberId: 'phone',
      wamid: 'w',
      status: 'failed',
      at: now,
      failureCode: '131047',
    });
    await repo.recordReceipt({ phoneNumberId: 'phone', wamid: 'w', status: 'sent', at: now });
    expect((await repo.getConfirmation({ userId: 'u', idempotencyKey: 'k' }))?.status).toBe('read');
    expect(await repo.getConfirmation({ userId: 'other', idempotencyKey: 'k' })).toBeUndefined();
    const foreign = await repo.begin({
      userId: 'u',
      idempotencyKey: 'k2',
      correlationId: 'session',
      now,
    });
    await repo.accepted({
      intentId: foreign.id,
      phoneNumberId: 'other-phone',
      wamid: 'w',
      at: now,
    });
    expect((await repo.getConfirmation({ userId: 'u', idempotencyKey: 'k2' }))?.status).toBe(
      'pending'
    );
  });
  it('requires every successful final part and excludes acknowledgments and failed finals from success', async () => {
    const repo = createNotificationDeliveryRepository();
    const registration = await repo.register({
      userId: 'u',
      source: 'calendar',
      runId: context.runId,
      scheduledFor: now,
      now,
    });
    await repo.consume({ marker: registration.marker, userId: 'u', messageId: 'incoming', now });
    const ack = await repo.begin({
      userId: 'u',
      idempotencyKey: 'ack',
      correlationId: 'session',
      notificationContext: { ...context, phase: 'ack' },
      replyToMessageId: 'incoming',
      now,
    });
    await repo.accepted({ intentId: ack.id, phoneNumberId: 'phone', wamid: 'ack-w', at: now });
    await repo.recordReceipt({
      phoneNumberId: 'phone',
      wamid: 'ack-w',
      status: 'delivered',
      at: now,
    });
    expect(
      (await repo.getRun({ userId: 'u', source: 'calendar', runId: context.runId })).status
    ).toBe('pending');
    const first = await repo.begin({
      userId: 'u',
      idempotencyKey: 'p0',
      correlationId: 'session',
      notificationContext: context,
      replyToMessageId: 'incoming',
      now,
    });
    await repo.accepted({ intentId: first.id, phoneNumberId: 'phone', wamid: 'w0', at: now });
    await repo.recordReceipt({ phoneNumberId: 'phone', wamid: 'w0', status: 'delivered', at: now });
    expect(
      (await repo.getRun({ userId: 'u', source: 'calendar', runId: context.runId })).status
    ).toBe('pending');
    const second = await repo.begin({
      userId: 'u',
      idempotencyKey: 'p1',
      correlationId: 'session',
      notificationContext: { ...context, partIndex: 1 },
      replyToMessageId: 'incoming',
      now,
    });
    await repo.accepted({ intentId: second.id, phoneNumberId: 'phone', wamid: 'w1', at: now });
    await repo.recordReceipt({ phoneNumberId: 'phone', wamid: 'w1', status: 'read', at: now });
    expect(await repo.getRun({ userId: 'u', source: 'calendar', runId: context.runId })).toEqual({
      status: 'delivered',
      stage: 'delivered',
      deliveredAt: now,
    });
    const badRegistration = await repo.register({
      userId: 'u',
      source: 'calendar',
      runId: 'bad-run',
      scheduledFor: now,
      now,
    });
    await repo.consume({ marker: badRegistration.marker, userId: 'u', messageId: 'incoming', now });
    const bad = await repo.begin({
      userId: 'u',
      idempotencyKey: 'bad',
      correlationId: 'session',
      notificationContext: { ...context, runId: 'bad-run', outcome: 'failed' },
      replyToMessageId: 'incoming',
      now,
    });
    await repo.accepted({ intentId: bad.id, phoneNumberId: 'phone', wamid: 'wb', at: now });
    await repo.recordReceipt({ phoneNumberId: 'phone', wamid: 'wb', status: 'delivered', at: now });
    expect((await repo.getRun({ userId: 'u', source: 'calendar', runId: 'bad-run' })).status).toBe(
      'failed'
    );
  });
  it('permits an explicitly unsent retry while keeping ambiguous sends suppressed', async () => {
    const repo = createNotificationDeliveryRepository();
    const input = { userId: 'u', correlationId: 's', idempotencyKey: 'retry', now };
    const first = await repo.begin(input);
    await repo.failed({
      intentId: first.id,
      at: now,
      failureCode: 'PROVIDER_REJECTED',
      retryable: true,
    });
    expect((await repo.begin(input)).acquired).toBe(true);
    expect((await repo.begin(input)).acquired).toBe(false);
  });

  it('suppresses repeated intent sends and retains ambiguous sends without blind retries', async () => {
    const repo = createNotificationDeliveryRepository();
    const input = { userId: 'u', idempotencyKey: 'one', correlationId: 's', now };
    expect((await repo.begin(input)).acquired).toBe(true);
    expect((await repo.begin(input)).acquired).toBe(false);
    expect((await repo.getConfirmation({ userId: 'u', idempotencyKey: 'one' }))?.status).toBe(
      'pending'
    );
    expect(await repo.getDeliveryObservation({ userId: 'u', idempotencyKey: 'one' })).toEqual({
      transportConfirmation: { status: 'pending' },
    });
    expect(
      await repo.getDeliveryObservation({ userId: 'foreign', idempotencyKey: 'one' })
    ).toBeUndefined();
    const intents = await fakeFirestore.collection('whatsapp_notification_intents').get();
    const intent = intents.docs[0];
    if (intent === undefined) throw new Error('missing intent');
    await fakeFirestore
      .collection('whatsapp_notification_intents')
      .doc(intent.id)
      .update({ userId: 'foreign' });
    expect(
      await repo.getDeliveryObservation({ userId: 'u', idempotencyKey: 'one' })
    ).toBeUndefined();
  });
  it('projects ingress, processing and final delivery stages and reports expired markers explicitly', async () => {
    const repo = createNotificationDeliveryRepository();
    const identity = { userId: 'u', source: 'calendar', runId: 'stages' };
    const registration = await repo.register({ ...identity, scheduledFor: now, now });
    expect(await repo.getRun(identity)).toMatchObject({
      status: 'pending',
      stage: 'awaiting_ingress',
    });
    await repo.consume({ marker: registration.marker, userId: 'u', messageId: 'incoming', now });
    expect(await repo.getRun(identity)).toMatchObject({ status: 'pending', stage: 'processing' });
    const ack = await repo.begin({
      userId: 'u',
      correlationId: 's',
      idempotencyKey: 'ack-stage',
      replyToMessageId: 'incoming',
      notificationContext: { source: 'calendar', runId: 'stages', phase: 'ack' },
      now,
    });
    await repo.accepted({ intentId: ack.id, phoneNumberId: 'p', wamid: 'a', at: now });
    await repo.recordReceipt({ phoneNumberId: 'p', wamid: 'a', status: 'delivered', at: now });
    expect(await repo.getRun(identity)).toMatchObject({ status: 'pending', stage: 'processing' });
    const final = await repo.begin({
      userId: 'u',
      correlationId: 's',
      idempotencyKey: 'final-stage',
      replyToMessageId: 'incoming',
      notificationContext: { ...context, runId: 'stages', partCount: 1 },
      now,
    });
    await repo.accepted({ intentId: final.id, phoneNumberId: 'p', wamid: 'f', at: now });
    expect(await repo.getRun(identity)).toMatchObject({
      status: 'pending',
      stage: 'awaiting_delivery',
    });
    vi.setSystemTime('2026-10-12T20:30:00.000Z');
    expect(await repo.getRun(identity)).toMatchObject({
      status: 'failed',
      stage: 'failed',
      failureCode: 'DELIVERY_EXPIRED',
    });
    await repo.recordReceipt({ phoneNumberId: 'p', wamid: 'f', status: 'read', at: now });
    expect(await repo.getRun(identity)).toMatchObject({ status: 'delivered', stage: 'delivered' });
  });

  it('rejects absent, unconsumed, foreign and wrong-inbound calendar ownership before sending', async () => {
    const repo = createNotificationDeliveryRepository();
    const identity = { userId: 'u', source: 'calendar', runId: 'owner' };
    const input = {
      userId: 'u',
      correlationId: 's',
      idempotencyKey: 'owned',
      notificationContext: { source: 'calendar', runId: 'owner', phase: 'ack' as const },
      replyToMessageId: 'm',
      now,
    };
    await expect(repo.begin(input)).rejects.toThrow('Notification ownership unavailable');
    const registration = await repo.register({ ...identity, scheduledFor: now, now });
    await expect(repo.begin(input)).rejects.toThrow('Notification ownership unavailable');
    await repo.consume({ marker: registration.marker, userId: 'u', messageId: 'm', now });
    await expect(repo.begin({ ...input, userId: 'other' })).rejects.toThrow(
      'Notification ownership unavailable'
    );
    await expect(repo.begin({ ...input, replyToMessageId: 'different' })).rejects.toThrow(
      'Notification ownership unavailable'
    );
    await expect(repo.begin({ ...input, now: '2026-10-12T20:00:00.000Z' })).rejects.toThrow(
      'Notification ownership unavailable'
    );
    expect((await repo.begin(input)).acquired).toBe(true);
    expect(
      await repo.consume({ marker: 'a'.repeat(64), userId: 'u', messageId: 'm', now })
    ).toBeNull();
  });
  it('never downgrades delivered/read evidence through late provider failures', async () => {
    const repo = createNotificationDeliveryRepository();
    const intent = await repo.begin({
      userId: 'u',
      correlationId: 's',
      idempotencyKey: 'monotonic',
      now,
    });
    await repo.accepted({ intentId: intent.id, phoneNumberId: 'p', wamid: 'w', at: now });
    await repo.recordReceipt({ phoneNumberId: 'p', wamid: 'w', status: 'failed', at: now });
    await repo.recordReceipt({ phoneNumberId: 'p', wamid: 'w', status: 'delivered', at: now });
    await repo.recordReceipt({ phoneNumberId: 'p', wamid: 'w', status: 'failed', at: now });
    await repo.failed({
      intentId: intent.id,
      at: now,
      failureCode: 'LATE_FAILURE',
      retryable: true,
    });
    expect((await repo.getConfirmation({ userId: 'u', idempotencyKey: 'monotonic' }))?.status).toBe(
      'delivered'
    );
    expect(
      (await repo.begin({ userId: 'u', correlationId: 's', idempotencyKey: 'monotonic', now }))
        .acquired
    ).toBe(false);
    await expect(
      repo.accepted({ intentId: 'missing', phoneNumberId: 'p', wamid: 'unknown', at: now })
    ).rejects.toThrow('Notification intent missing');
    await expect(
      repo.failed({ intentId: 'missing', at: now, failureCode: 'FAIL' })
    ).rejects.toThrow('Notification intent missing');
  });
  it('counts unresolved runs, expires explicitly, and clears superseded failures only after a later final delivery', async () => {
    const repo = createNotificationDeliveryRepository();
    const older = { userId: 'u', source: 'calendar', runId: 'old' };
    await repo.register({ ...older, scheduledFor: now, now });
    const later = '2026-10-13T13:30:00.000Z';
    expect(await repo.monitoring(now)).toMatchObject({
      pendingCount: 1,
      failedCount: 0,
      oldestPendingScheduledFor: now,
    });
    expect(await repo.monitoring(later)).toMatchObject({ pendingCount: 0, failedCount: 1 });
    const registration = await repo.register({
      userId: 'u',
      source: 'calendar',
      runId: 'new',
      scheduledFor: later,
      now: later,
    });
    await repo.consume({ marker: registration.marker, userId: 'u', messageId: 'm', now: later });
    const final = await repo.begin({
      userId: 'u',
      correlationId: 's',
      idempotencyKey: 'newfinal',
      notificationContext: { ...context, runId: 'new', partCount: 1 },
      replyToMessageId: 'm',
      now: later,
    });
    await repo.accepted({ intentId: final.id, phoneNumberId: 'p', wamid: 'new', at: later });
    expect(await repo.monitoring(later)).toMatchObject({ pendingCount: 1, failedCount: 1 });
    await repo.recordReceipt({ phoneNumberId: 'p', wamid: 'new', status: 'delivered', at: later });
    expect(await repo.monitoring(later)).toEqual({
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: later,
    });
    const ordinary = await repo.begin({
      userId: 'u',
      correlationId: 's',
      producerKey: 'digest:d',
      idempotencyKey: 'ordinary',
      now,
    });
    await repo.failed({ intentId: ordinary.id, at: now, failureCode: 'REJECTED' });
    expect((await repo.monitoring(later)).failedCount).toBe(1);
    const recovered = await repo.begin({
      userId: 'u',
      correlationId: 's',
      producerKey: 'digest:d',
      idempotencyKey: 'recovered',
      now: later,
    });
    await repo.accepted({
      intentId: recovered.id,
      phoneNumberId: 'p',
      wamid: 'recovered',
      at: later,
    });
    await repo.recordReceipt({
      phoneNumberId: 'p',
      wamid: 'recovered',
      status: 'delivered',
      at: later,
    });
    expect((await repo.monitoring(later)).failedCount).toBe(0);
  });
  it('retires pre-resume markers without dispatching stale ack/final or losing late receipt history', async () => {
    const repo = createNotificationDeliveryRepository();
    const identity = { userId: 'u', source: 'calendar', runId: context.runId };
    const registration = await repo.register({ ...identity, scheduledFor: now, now });
    await repo.consume({ marker: registration.marker, userId: 'u', messageId: 'incoming', now });
    const input = {
      userId: 'u',
      correlationId: 's',
      idempotencyKey: 'retained-final',
      replyToMessageId: 'incoming',
      notificationContext: { ...context, partCount: 1 },
      now,
    };
    const accepted = await repo.begin(input);
    await repo.accepted({ intentId: accepted.id, phoneNumberId: 'p', wamid: 'retained', at: now });
    const cutoff = '2026-10-12T20:00:00.000Z';
    const markers = await fakeFirestore.collection('whatsapp_notification_markers').get();
    const marker = markers.docs[0];
    if (marker === undefined) throw new Error('missing marker');
    await fakeFirestore.collection('whatsapp_notification_markers').doc(marker.id).update({
      skippedBeforeResume: cutoff,
    });
    expect(await repo.monitoring(cutoff)).toEqual({
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: null,
    });
    expect(
      await repo.consume({
        marker: registration.marker,
        userId: 'u',
        messageId: 'incoming',
        now: cutoff,
      })
    ).toBeNull();
    expect(
      (await repo.begin({ ...input, idempotencyKey: 'stale-final', now: cutoff })).acquired
    ).toBe(false);
    expect(
      (
        await repo.begin({
          ...input,
          idempotencyKey: 'stale-ack',
          notificationContext: {
            source: 'calendar',
            runId: context.runId,
            phase: 'ack',
          },
          now: cutoff,
        })
      ).acquired
    ).toBe(false);
    await expect(
      repo.begin({ ...input, replyToMessageId: 'foreign', now: cutoff })
    ).rejects.toThrow('Notification ownership unavailable');
    expect(
      (await fakeFirestore.collection('whatsapp_notification_intents').get()).docs
    ).toHaveLength(1);
    await repo.recordReceipt({ phoneNumberId: 'p', wamid: 'retained', status: 'read', at: cutoff });
    expect(await repo.getRun(identity)).toMatchObject({ status: 'delivered', deliveredAt: cutoff });
    expect(await repo.monitoring(cutoff)).toEqual({
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: cutoff,
    });
    expect(
      (await fakeFirestore.collection('whatsapp_notification_markers').doc(marker.id).get()).data()
    ).toMatchObject({
      consumedMessageId: 'incoming',
      skippedBeforeResume: cutoff,
    });
  });
  it('rejects consumption when TTL cleanup deletes a marker between lookup and transaction', async () => {
    const repo = createNotificationDeliveryRepository();
    const registration = await repo.register({
      userId: 'u',
      source: 'calendar',
      runId: 'ttl-race',
      scheduledFor: now,
      now,
    });
    const markers = await fakeFirestore.collection('whatsapp_notification_markers').get();
    const marker = markers.docs[0];
    if (marker === undefined) throw new Error('missing marker');
    const runTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
    vi.spyOn(fakeFirestore, 'runTransaction').mockImplementationOnce(async (update) => {
      await fakeFirestore.collection('whatsapp_notification_markers').doc(marker.id).delete();
      return await runTransaction(update);
    });
    expect(
      await repo.consume({ marker: registration.marker, userId: 'u', messageId: 'm', now })
    ).toBeNull();
    expect(
      (await fakeFirestore.collection('whatsapp_notification_markers').get()).docs
    ).toHaveLength(0);
  });
  it('reopens a failed intent only with explicit byte-identical retry authorization', async () => {
    const repo = createNotificationDeliveryRepository();
    const input = { userId: 'u', correlationId: 's', idempotencyKey: 'authorized-retry', now };
    const intent = await repo.begin(input);
    await repo.failed({ intentId: intent.id, at: now, failureCode: 'DEFINITELY_UNSENT' });
    expect((await repo.begin(input)).acquired).toBe(false);
    expect((await repo.begin({ ...input, retryAuthorized: true })).acquired).toBe(true);
    expect(await repo.getConfirmation(input)).toEqual({ status: 'pending' });
  });
  it('keeps the oldest pending timestamp across unsorted marker and ordinary notification runs', async () => {
    const repo = createNotificationDeliveryRepository();
    const times = [
      '2026-10-12T13:31:00.000Z',
      '2026-10-12T13:32:00.000Z',
      '2026-10-12T13:29:00.000Z',
    ];
    for (const [index, scheduledFor] of times.entries()) {
      await repo.register({
        userId: `marker-${String(index)}`,
        source: 'calendar',
        runId: 'r',
        scheduledFor,
        now,
      });
    }
    expect(await repo.monitoring(now)).toMatchObject({
      pendingCount: 3,
      oldestPendingScheduledFor: times[2],
    });
    const ordinaryTimes = [times[1] as string, '2026-10-12T13:28:00.000Z', times[0] as string];
    for (const [index, createdAt] of ordinaryTimes.entries()) {
      await repo.begin({
        userId: `ordinary-${String(index)}`,
        correlationId: 's',
        idempotencyKey: 'k',
        now: createdAt,
      });
    }
    expect(await repo.monitoring(now)).toEqual({
      pendingCount: 6,
      failedCount: 0,
      oldestPendingScheduledFor: ordinaryTimes[1],
      lastDeliveredAt: null,
    });
  });
  it('keeps the newest confirmed delivery across unsorted marker and ordinary transport evidence', async () => {
    const repo = createNotificationDeliveryRepository();
    async function ordinary(userId: string, deliveredAt: string): Promise<void> {
      const intent = await repo.begin({ userId, correlationId: 's', idempotencyKey: 'k', now });
      await repo.accepted({ intentId: intent.id, phoneNumberId: 'p', wamid: userId, at: now });
      await repo.recordReceipt({
        phoneNumberId: 'p',
        wamid: userId,
        status: 'delivered',
        at: deliveredAt,
      });
    }
    await ordinary('ordinary-first', '2026-10-12T13:45:00.000Z');
    expect((await repo.monitoring(now)).lastDeliveredAt).toBe('2026-10-12T13:45:00.000Z');
    const times = [
      '2026-10-12T13:40:00.000Z',
      '2026-10-12T13:35:00.000Z',
      '2026-10-12T13:50:00.000Z',
    ];
    for (const [index, deliveredAt] of times.entries()) {
      const userId = `marker-${String(index)}`;
      const marker = await repo.register({
        userId,
        source: 'calendar',
        runId: 'r',
        scheduledFor: now,
        now,
      });
      await repo.consume({ marker: marker.marker, userId, messageId: 'm', now });
      const intent = await repo.begin({
        userId,
        correlationId: 's',
        idempotencyKey: 'k',
        replyToMessageId: 'm',
        notificationContext: { ...context, runId: 'r', partCount: 1 },
        now,
      });
      await repo.accepted({ intentId: intent.id, phoneNumberId: 'p', wamid: userId, at: now });
      await repo.recordReceipt({
        phoneNumberId: 'p',
        wamid: userId,
        status: 'read',
        at: deliveredAt,
      });
    }
    await ordinary('ordinary-latest', '2026-10-12T14:00:00.000Z');
    expect(await repo.monitoring(now)).toEqual({
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: '2026-10-12T14:00:00.000Z',
    });
  });
});
