import { vi } from 'vitest';
import { Writable } from 'node:stream';

const commonHttpState = vi.hoisted(() => ({
  logIncomingRequest: vi.fn(),
}));

vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/common-http')>();
  return { ...actual, logIncomingRequest: commonHttpState.logIncomingRequest };
});

import {
  beforeEach,
  createSignature,
  createWebhookPayload,
  describe,
  expect,
  it,
  setupTestContext,
  testConfig,
} from './testUtils.js';
import { buildServer } from '../server.js';

describe('POST /webhooks privacy logging', () => {
  const ctx = setupTestContext();

  beforeEach(() => {
    commonHttpState.logIncomingRequest.mockClear();
  });

  it('never includes the WhatsApp payload in the incoming-request preview', async () => {
    const payloadString = JSON.stringify(createWebhookPayload());

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': createSignature(payloadString, testConfig.appSecret),
      },
      payload: payloadString,
    });

    expect(response.statusCode).toBe(200);
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bodyPreviewLength: 0 })
    );
  });

  it('redacts private WhatsApp identifiers at the service logger boundary', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback): void {
        chunks.push(String(chunk));
        callback();
      },
    });
    const app = await buildServer(testConfig, stream);
    const privateValues = {
      userId: 'auth0|private-user-id',
      sourceAccountId: 'private-source-account',
      chatId: 'private-chat-id',
      matrixEventId: 'private-matrix-event',
      matrixRoomId: 'private-matrix-room',
      phoneNumber: '+48111111111',
      fromNumber: '+48222222222',
      recipientPhone: '+48333333333',
      phoneNumberId: 'private-provider-phone-id',
      waMessageId: 'private-inbound-wamid',
      wamid: 'private-outbound-wamid',
      bodyPreview: 'private message content',
    };

    app.log.info(privateValues, 'privacy boundary probe');
    await new Promise((resolve) => setImmediate(resolve));
    await app.close();

    const logOutput = chunks.join('');
    for (const privateValue of Object.values(privateValues)) {
      expect(logOutput).not.toContain(privateValue);
    }
    expect(logOutput).toContain('[Redacted]');
  });
});
