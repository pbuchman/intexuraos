import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import { buildServer } from '../../../server.js';
import { getServices, resetServices } from '../../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../../helpers/mockServices.js';
import crypto from 'node:crypto';

describe('POST /internal/turn-metrics', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    setupTestServices();
    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  function generateWebhookSignature(
    body: object,
    secret: string
  ): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
    return { timestamp, signature };
  }

  const validMetrics = {
    taskId: 'task-123',
    attempt: 1,
    timestamp: '2025-01-01T01:00:00Z',
    cpuTimeSeconds: 3600,
    cpuCores: 2,
    peakMemoryMB: 2048,
    wallTimeSeconds: 3600,
    apiWaitSeconds: 1368,
    toolExecSeconds: 612,
    backgroundWaitSeconds: 1620,
    overheadSeconds: 0,
    totalInputTokens: 50000,
    totalOutputTokens: 10000,
    totalCacheReadTokens: 40000,
    totalCacheCreationTokens: 5000,
    apiCallCount: 25,
    cpuUtilizationPercent: 50,
    idlePercent: 83,
  };

  it('rejects request without signature headers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/turn-metrics',
      payload: validMetrics,
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects request with invalid task signature', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/turn-metrics',
      headers: {
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Request-Signature': 'invalid-signature',
      },
      payload: validMetrics,
    });

    expect(response.statusCode).toBe(401);
  });

  it('stores metrics and returns received:true on valid request', async () => {
    await getServices().codeTaskRepo.create({
      id: validMetrics.taskId,
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_metrics_valid',
      webhookSecret: 'test-webhook-secret',
    });
    const { timestamp, signature } = generateWebhookSignature(
      validMetrics,
      'test-webhook-secret'
    );

    const response = await app.inject({
      method: 'POST',
      url: '/internal/turn-metrics',
      headers: {
        'X-Request-Timestamp': timestamp,
        'X-Request-Signature': signature,
      },
      payload: validMetrics,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { received: boolean };
    expect(body.received).toBe(true);
  });

  it('rejects request without timestamp header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/turn-metrics',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
        'X-Request-Signature': 'some-sig',
      },
      payload: validMetrics,
    });

    expect(response.statusCode).toBe(401);
  });
});
