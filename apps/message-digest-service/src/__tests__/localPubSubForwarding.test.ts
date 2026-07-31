import type { FastifyInstance } from 'fastify';
import { authenticateInternalPubSub } from '@intexuraos/common-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPubSubPushEnvelope } from '../../../../tools/pubsub-ui/pubsub-forwarding.mjs';
import { processMessageDigestRun } from '../domain/usecases/processMessageDigestRun.js';
import {
  createFrozenPayloadPublisher,
  type FrozenPayloadTopic,
} from '../infra/pubsub/frozenPayloadPublisher.js';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    authenticateInternalPubSub: vi.fn(() => ({
      authenticated: true,
      strategy: 'internal-token',
    })),
  };
});

vi.mock('../domain/usecases/processMessageDigestRun.js', () => ({
  processMessageDigestRun: vi.fn(),
}));

describe('local Message Digest Pub/Sub forwarding', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.mocked(authenticateInternalPubSub).mockReturnValue({
      authenticated: true,
      strategy: 'internal-token',
    });
    vi.mocked(processMessageDigestRun)
      .mockResolvedValueOnce({ ok: true, disposition: 'completed', run: {} as never })
      .mockResolvedValueOnce({ ok: true, disposition: 'already_terminal' });
    setServices(fakeServices());
    app = await buildServer({ healthChecks: [] });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    vi.clearAllMocks();
  });

  it('delivers exact persisted bytes and safely acknowledges a duplicate forward', async () => {
    const persistedPayloadJson =
      '{"type":"message-digest.run","version":1,"userId":"synthetic-user-001","definitionId":"md_definition_001","runId":"mdr_run_001","requestedAt":"2026-07-27T12:00:00.000Z"}';
    const publishedBytes: Buffer[] = [];
    const topic: FrozenPayloadTopic = {
      async publishMessage({ data }) {
        publishedBytes.push(data);
        return 'synthetic-message-001';
      },
    };
    const publisher = createFrozenPayloadPublisher(topic);

    await expect(publisher.publish(persistedPayloadJson)).resolves.toEqual({
      ok: true,
      messageId: 'synthetic-message-001',
    });
    expect(publishedBytes).toHaveLength(1);
    expect(publishedBytes[0]?.toString('utf8')).toBe(persistedPayloadJson);

    const envelope = createPubSubPushEnvelope('message-digest-runs', {
      data: publishedBytes[0] as Buffer,
      id: 'synthetic-message-001',
      publishTime: '2026-07-27T12:01:00.000Z',
    });
    expect(Buffer.from(envelope.message.data, 'base64').toString('utf8')).toBe(
      persistedPayloadJson
    );

    const first = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: envelope,
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/internal/message-digests/pubsub/run',
      payload: envelope,
    });

    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    expect(processMessageDigestRun).toHaveBeenCalledTimes(2);
    expect(processMessageDigestRun).toHaveBeenNthCalledWith(
      2,
      {
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: 'mdr_run_001',
        workerId: 'pubsub:synthetic-message-001',
      },
      expect.any(Object)
    );
  });
});

function fakeServices(): ServiceContainer {
  return {
    config: { webAppUrl: 'https://intexuraos.cloud' } as never,
    logger: {} as never,
    firestore: {} as never,
    whatsappServiceClient: {} as never,
    messageDigestStore: {} as never,
    messageDigestWhatsAppClient: {} as never,
    usageSink: {} as never,
    messageDigestAggregator: {} as never,
    pubsub: {} as never,
    messageDigestRunPublisher: { publish: vi.fn() },
    whatsappSendPublisher: { publish: vi.fn() },
    runPreparationTokens: {} as never,
  };
}
