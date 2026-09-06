import { describe, expect, it, vi } from 'vitest';
import { createFrozenPayloadPublisher, type FrozenPayloadTopic } from './frozenPayloadPublisher.js';

describe('FrozenPayloadPublisher', () => {
  it('publishes the exact persisted UTF-8 bytes on the initial and retry paths', async () => {
    const publishMessage = vi.fn<FrozenPayloadTopic['publishMessage']>(
      async () => 'synthetic-message-id'
    );
    const publisher = createFrozenPayloadPublisher({ publishMessage });
    const payloadJson =
      '{"type":"message-digest.run","version":1,"userId":"synthetic-user-001","runId":"mdr_run_001"}';

    await expect(publisher.publish(payloadJson)).resolves.toEqual({
      ok: true,
      messageId: 'synthetic-message-id',
    });
    await expect(publisher.publish(payloadJson)).resolves.toEqual({
      ok: true,
      messageId: 'synthetic-message-id',
    });
    expect(publishMessage).toHaveBeenCalledTimes(2);
    for (const [request] of publishMessage.mock.calls) {
      expect(request).toEqual({ data: Buffer.from(payloadJson, 'utf8') });
      expect(request.data.toString('utf8')).toBe(payloadJson);
    }
  });

  it('treats a missing acknowledgement as unknown and does not expose the provider error', async () => {
    const publishMessage = vi.fn<FrozenPayloadTopic['publishMessage']>(async () => {
      throw new Error('sensitive provider transport failure');
    });
    const publisher = createFrozenPayloadPublisher({ publishMessage });

    await expect(publisher.publish('{"safe":true}')).resolves.toEqual({
      ok: false,
      code: 'ACK_UNKNOWN',
    });
  });

  it('rejects invalid local payloads before calling Pub/Sub', async () => {
    const publishMessage = vi.fn<FrozenPayloadTopic['publishMessage']>(async () => 'unused');
    const publisher = createFrozenPayloadPublisher({ publishMessage });

    await expect(publisher.publish('')).resolves.toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    await expect(publisher.publish('not-json')).resolves.toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it('treats a blank provider message ID as an unknown acknowledgement', async () => {
    const publishMessage = vi.fn<FrozenPayloadTopic['publishMessage']>(async () => '   ');
    const publisher = createFrozenPayloadPublisher({ publishMessage });

    await expect(publisher.publish('{"safe":true}')).resolves.toEqual({
      ok: false,
      code: 'ACK_UNKNOWN',
    });
  });
});
