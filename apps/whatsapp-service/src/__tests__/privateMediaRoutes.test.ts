import { createHash, createHmac } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { beforeEach, createToken, describe, expect, it, setupTestContext } from './testUtils.js';
import { FakeThumbnailGeneratorPort } from './fakes.js';
import { createPrivateWhatsAppMessageId } from '../domain/whatsapp/index.js';
import { getServices, setServices } from '../services.js';

function createOpaqueAccessTokenForTest(input: {
  messageId: string;
  variantCode?: 'o' | 't' | 'x';
  expiresAtEpochSeconds?: number;
  payloadOverride?: Buffer;
}): string {
  const compressedPayload =
    input.payloadOverride ??
    deflateRawSync(
      Buffer.from(
        `${input.messageId}\n${input.variantCode ?? 'o'}\n${String(
          input.expiresAtEpochSeconds ?? Math.floor(Date.now() / 1000) + 900
        )}`,
        'utf8'
      )
    );
  const signature = createHmac(
    'sha256',
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? ''
  )
    .update(compressedPayload)
    .digest()
    .subarray(0, 8);
  return Buffer.concat([signature, compressedPayload]).toString('base64url');
}

describe('Private WhatsApp Media Routes', () => {
  const ctx = setupTestContext();

  beforeEach(() => {
    ctx.privateWhatsAppRepository.setAccount({
      id: 'user-123',
      userId: 'user-123',
      sourceAccountId: 'private-source-123',
      phoneNumberNormalized: '48123456789',
      displayName: '+48123456789',
      status: 'active',
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
      schemaVersion: 1,
    });
  });

  it('requires internal auth for private media upload', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mediaId=image',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(401);
  });

  it('uploads private image originals and thumbnails to the secure media bucket', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg&fileName=image.jpg&mediaId=home-dev-image',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: {
        media: {
          mxcUri: string;
          mimeType: string;
          fileName: string;
          sizeBytes: number;
          storageStatus: string;
          gcsPath: string;
          thumbnailGcsPath: string;
          storedMimeType: string;
          storedSizeBytes: number;
          storedAt: string;
        };
      };
    };
    const messageId = createPrivateWhatsAppMessageId('private-source-123', '$image');
    expect(body.data.media).toStrictEqual({
      mxcUri: 'mxc://home-dev/image',
      mimeType: 'image/jpeg',
      fileName: 'image.jpg',
      sizeBytes: 'image-bytes'.length,
      storageStatus: 'stored',
      gcsPath: `whatsapp/private/user-123/${messageId}/home-dev-image.jpg`,
      thumbnailGcsPath: `whatsapp/private/user-123/${messageId}/home-dev-image_thumb.jpg`,
      storedMimeType: 'image/jpeg',
      storedSizeBytes: 'image-bytes'.length,
      storedAt: expect.any(String),
    });
    expect(ctx.mediaStorage.getFile(body.data.media.gcsPath)?.buffer.toString()).toBe(
      'image-bytes'
    );
    expect(ctx.mediaStorage.getFile(body.data.media.thumbnailGcsPath)).toBeDefined();
  });

  it('uploads private audio originals without generating thumbnails', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24audio&mxcUri=mxc%3A%2F%2Fhome-dev%2Faudio&mimeType=audio%2Fogg&fileName=voice.ogg&mediaId=home-dev-audio',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('audio-bytes'),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: {
        media: {
          mxcUri: string;
          mimeType: string;
          fileName: string;
          sizeBytes: number;
          storageStatus: string;
          gcsPath: string;
          thumbnailGcsPath?: string;
          storedMimeType: string;
          storedSizeBytes: number;
          storedAt: string;
        };
      };
    };
    const messageId = createPrivateWhatsAppMessageId('private-source-123', '$audio');
    expect(body.data.media).toStrictEqual({
      mxcUri: 'mxc://home-dev/audio',
      mimeType: 'audio/ogg',
      fileName: 'voice.ogg',
      sizeBytes: 'audio-bytes'.length,
      storageStatus: 'stored',
      gcsPath: `whatsapp/private/user-123/${messageId}/home-dev-audio.ogg`,
      storedMimeType: 'audio/ogg',
      storedSizeBytes: 'audio-bytes'.length,
      storedAt: expect.any(String),
    });
    expect(ctx.mediaStorage.getFile(body.data.media.gcsPath)?.buffer.toString()).toBe(
      'audio-bytes'
    );
    expect(body.data.media.thumbnailGcsPath).toBeUndefined();
  });

  it('uploads private video originals without generating thumbnails', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24video&mxcUri=mxc%3A%2F%2Fhome-dev%2Fvideo&mimeType=video%2Fmp4&fileName=clip.mp4&mediaId=home-dev-video',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('video-bytes'),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: {
        media: {
          mxcUri: string;
          mimeType: string;
          fileName: string;
          sizeBytes: number;
          storageStatus: string;
          gcsPath: string;
          thumbnailGcsPath?: string;
          storedMimeType: string;
          storedSizeBytes: number;
          storedAt: string;
        };
      };
    };
    const messageId = createPrivateWhatsAppMessageId('private-source-123', '$video');
    expect(body.data.media).toStrictEqual({
      mxcUri: 'mxc://home-dev/video',
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
      sizeBytes: 'video-bytes'.length,
      storageStatus: 'stored',
      gcsPath: `whatsapp/private/user-123/${messageId}/home-dev-video.mp4`,
      storedMimeType: 'video/mp4',
      storedSizeBytes: 'video-bytes'.length,
      storedAt: expect.any(String),
    });
    expect(ctx.mediaStorage.getFile(body.data.media.gcsPath)?.buffer.toString()).toBe(
      'video-bytes'
    );
    expect(body.data.media.thumbnailGcsPath).toBeUndefined();
  });

  it('rejects uploads for unknown private source accounts', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=missing&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg&mediaId=image',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 500 when private account lookup fails for otherwise valid requests', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private account lookup failure',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(500);
  });

  it('validates required query params before repository lookup', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Repository should not be hit for malformed query input',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects uploads with an empty media body before repository lookup', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Repository should not be hit for empty media bodies',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.alloc(0),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects uploads when the parsed body is not a buffer before repository lookup', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Repository should not be hit for non-buffer media bodies',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/json',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects uploads when mimeType is missing', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&fileName=image.bin&mediaId=image',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects uploads when mimeType is not image, audio, or video', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=application%2Fpdf&fileName=image.pdf&mediaId=image',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(400);
  });

  it('hashes long media identifiers when the sanitized value exceeds the path budget', async () => {
    const oversizedMediaId = 'A'.repeat(81);
    const expectedMediaId = createHash('sha256').update(oversizedMediaId).digest('hex').slice(0, 32);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg&mediaId=${oversizedMediaId}`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { media: { gcsPath: string; thumbnailGcsPath: string } };
    };
    expect(body.data.media.gcsPath).toContain(`/${expectedMediaId}.jpg`);
    expect(body.data.media.thumbnailGcsPath).toContain(`/${expectedMediaId}_thumb.jpg`);
  });

  it('uses the mxc uri as the media identifier when mediaId is omitted', async () => {
    const mxcUri = 'mxc://home-dev/media/with spaces';
    const sanitizedFallbackMediaId = 'mxc-home-dev-media-with-spaces';
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fmedia%2Fwith%20spaces&mimeType=image%2Fjpeg',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { media: { mxcUri: string; gcsPath: string } };
    };
    expect(body.data.media.mxcUri).toBe(mxcUri);
    expect(body.data.media.gcsPath).toContain(`/${sanitizedFallbackMediaId}.jpg`);
  });

  it('returns 502 when original media upload fails', async () => {
    ctx.mediaStorage.setFailUpload(true);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg&mediaId=image',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(502);
  });

  it('returns 502 when thumbnail generation fails', async () => {
    const thumbnailGenerator = new FakeThumbnailGeneratorPort();
    thumbnailGenerator.setFail(true);
    setServices({
      ...getServices(),
      thumbnailGenerator,
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg&mediaId=image',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(502);
  });

  it('returns 502 when thumbnail upload fails', async () => {
    ctx.mediaStorage.setFailThumbnailUpload(true);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/media?sourceAccountId=private-source-123&matrixEventId=%24image&mxcUri=mxc%3A%2F%2Fhome-dev%2Fimage&mimeType=image%2Fjpeg&mediaId=image',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('image-bytes'),
    });

    expect(response.statusCode).toBe(502);
  });

  it('returns owner-checked signed URLs for private image thumbnails', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: {
        matrixRoomId: '!room:home-dev',
        type: 'direct',
        displayName: 'Alice',
      },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        eventDayKey: '2026-06-26',
        eventTimeZone: 'Europe/Warsaw',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image',
          mimeType: 'image/jpeg',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image.jpg',
          thumbnailGcsPath: 'whatsapp/private/user-123/message/image_thumb.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/thumbnail`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: { url: string; expiresAt: string };
    };
    expect(body.data).toStrictEqual({
      url: expect.stringMatching(/^\/private\/media-access\?token=[A-Za-z0-9_-]+$/),
      expiresAt: expect.any(String),
    });
    expect(Date.parse(body.data.expiresAt)).toBeGreaterThan(Date.now());
    expect(body.data.url).not.toContain('whatsapp/private');
    expect(body.data.url).not.toContain('image_thumb.jpg');
    expect(body.data.url).not.toContain('image.jpg');
    expect(response.body).not.toContain('"media"');
    expect(response.body).not.toContain('gcsPath');
    expect(response.body).not.toContain('userId');
    expect(response.body).not.toContain('sourceAccountId');
    expect(response.body).not.toContain('matrixRoomId');
    expect(response.body).not.toContain('matrixEventId');
    expect(response.body).not.toContain('rawMatrixEvent');
  });

  it('does not return signed URLs for another user private message', async () => {
    const token = await createToken({ sub: 'other-user' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-other-user-test',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns internal signed URLs for processing after source account validation', async () => {
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-internal',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/internal/whatsapp/private/messages/${stored.value.messageId}/media?sourceAccountId=private-source-123&variant=original`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: { url: string; media: { gcsPath: string } };
    };
    expect(body.data.url).toContain('whatsapp/private/user-123/message/image.jpg');
    expect(body.data.media.gcsPath).toBe('whatsapp/private/user-123/message/image.jpg');
  });

  it('returns owner-checked signed URLs for private image originals', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-original',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-original',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-original.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: { url: string; expiresAt: string };
    };
    expect(body.data).toStrictEqual({
      url: expect.stringMatching(/^\/private\/media-access\?token=[A-Za-z0-9_-]+$/),
      expiresAt: expect.any(String),
    });
    expect(Date.parse(body.data.expiresAt)).toBeGreaterThan(Date.now());
    expect(body.data.url).not.toContain('whatsapp/private');
    expect(body.data.url).not.toContain('image-original.jpg');
    expect(response.body).not.toContain('"media"');
    expect(response.body).not.toContain('gcsPath');
    expect(response.body).not.toContain('userId');
    expect(response.body).not.toContain('sourceAccountId');
    expect(response.body).not.toContain('matrixRoomId');
    expect(response.body).not.toContain('matrixEventId');
    expect(response.body).not.toContain('rawMatrixEvent');
  });

  it('returns owner-checked signed URLs for private audio originals', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-audio-original',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'audio',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/audio-original',
          mimeType: 'audio/ogg',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/audio-original.ogg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: { url: string; expiresAt: string };
    };
    expect(body.data).toStrictEqual({
      url: expect.stringMatching(/^\/private\/media-access\?token=[A-Za-z0-9_-]+$/),
      expiresAt: expect.any(String),
    });
    expect(Date.parse(body.data.expiresAt)).toBeGreaterThan(Date.now());
    expect(body.data.url).not.toContain('whatsapp/private');
    expect(body.data.url).not.toContain('audio-original.ogg');
  });

  it('redirects opaque public private video access tokens to storage signed URLs', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-video-access-route',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'video',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/video-access-route',
          mimeType: 'video/mp4',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/video-access-route.mp4',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const publicResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publicResponse.statusCode).toBe(200);
    const publicBody = JSON.parse(publicResponse.body) as {
      data: { url: string };
    };

    const accessResponse = await ctx.app.inject({
      method: 'GET',
      url: publicBody.data.url,
    });

    expect(accessResponse.statusCode).toBe(302);
    expect(accessResponse.headers.location).toContain(
      'whatsapp/private/user-123/message/video-access-route.mp4'
    );
  });

  it('returns internal signed URLs for private audio and video originals after source account validation', async () => {
    const audio = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-audio-internal',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'audio',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/audio-internal',
          mimeType: 'audio/ogg',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/audio-internal.ogg',
        },
      },
    });
    const video = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:02.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-video-internal',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'video',
        eventTimestamp: '2026-06-26T10:00:01.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/video-internal',
          mimeType: 'video/mp4',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/video-internal.mp4',
        },
      },
    });
    expect(audio.ok).toBe(true);
    expect(video.ok).toBe(true);
    if (!audio.ok || !video.ok) {
      throw new Error('Failed to store private media messages');
    }

    const audioResponse = await ctx.app.inject({
      method: 'GET',
      url: `/internal/whatsapp/private/messages/${audio.value.messageId}/media?sourceAccountId=private-source-123`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });
    const videoResponse = await ctx.app.inject({
      method: 'GET',
      url: `/internal/whatsapp/private/messages/${video.value.messageId}/media?sourceAccountId=private-source-123`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(audioResponse.statusCode).toBe(200);
    expect(videoResponse.statusCode).toBe(200);
    const audioBody = JSON.parse(audioResponse.body) as {
      data: { url: string; media: { gcsPath: string; mimeType: string } };
    };
    const videoBody = JSON.parse(videoResponse.body) as {
      data: { url: string; media: { gcsPath: string; mimeType: string } };
    };
    expect(audioBody.data.url).toContain('whatsapp/private/user-123/message/audio-internal.ogg');
    expect(audioBody.data.media).toMatchObject({
      gcsPath: 'whatsapp/private/user-123/message/audio-internal.ogg',
      mimeType: 'audio/ogg',
    });
    expect(videoBody.data.url).toContain('whatsapp/private/user-123/message/video-internal.mp4');
    expect(videoBody.data.media).toMatchObject({
      gcsPath: 'whatsapp/private/user-123/message/video-internal.mp4',
      mimeType: 'video/mp4',
    });
  });

  it('redirects opaque public private media access tokens to storage signed URLs', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-access-route',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-access-route',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-access-route.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const publicResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publicResponse.statusCode).toBe(200);
    const publicBody = JSON.parse(publicResponse.body) as {
      data: { url: string };
    };

    const accessResponse = await ctx.app.inject({
      method: 'GET',
      url: publicBody.data.url,
    });

    expect(accessResponse.statusCode).toBe(302);
    expect(accessResponse.headers.location).toContain(
      'whatsapp/private/user-123/message/image-access-route.jpg'
    );
  });

  it('redirects opaque public thumbnail access tokens to thumbnail signed URLs', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-thumbnail-access-route',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-thumbnail-access-route',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-thumbnail-access-route.jpg',
          thumbnailGcsPath:
            'whatsapp/private/user-123/message/image-thumbnail-access-route_thumb.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const publicResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/thumbnail`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publicResponse.statusCode).toBe(200);
    const publicBody = JSON.parse(publicResponse.body) as { data: { url: string } };

    const accessResponse = await ctx.app.inject({
      method: 'GET',
      url: publicBody.data.url,
    });

    expect(accessResponse.statusCode).toBe(302);
    expect(accessResponse.headers.location).toContain(
      'whatsapp/private/user-123/message/image-thumbnail-access-route_thumb.jpg'
    );
  });

  it('requires bearer auth for public private original media routes', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages/message:private-source-123:missing/media',
    });

    expect(response.statusCode).toBe(401);
  });

  it('requires bearer auth for public private thumbnail routes', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages/message:private-source-123:missing/thumbnail',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns not found for original private media when the authenticated user has no mirror', async () => {
    const token = await createToken({ sub: 'user-without-private-mirror' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages/message:private-source-123:missing/media',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns not found for thumbnail private media when the authenticated user has no mirror', async () => {
    const token = await createToken({ sub: 'user-without-private-mirror' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages/message:private-source-123:missing/thumbnail',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('does not return signed URLs when an authenticated user has a different active private mirror', async () => {
    ctx.privateWhatsAppRepository.setAccount({
      id: 'other-user',
      userId: 'other-user',
      sourceAccountId: 'private-source-other',
      phoneNumberNormalized: '48987654321',
      displayName: '+48987654321',
      status: 'active',
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
      schemaVersion: 1,
    });
    const token = await createToken({ sub: 'other-user' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-owner-mismatch',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-owner-mismatch',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-owner-mismatch.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 when the owner requests original media for a message without stored media', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-no-original',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-no-original',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 when stored private audio media has no MIME type', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-audio-no-mime',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'audio',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/audio-no-mime',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/audio-no-mime.ogg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 when the owner requests a thumbnail that was never stored', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-no-thumbnail',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-no-thumbnail',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-no-thumbnail.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/thumbnail`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for public original media requests when the stored private message is not an image', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-non-image-public-original',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'file',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/file-public-original',
          mimeType: 'application/pdf',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/private-document.pdf',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for public thumbnail requests when the stored private message is not an image', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-non-image-public-thumbnail',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'file',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/file-public-thumbnail',
          mimeType: 'application/pdf',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/private-document-thumbnail.pdf',
          thumbnailGcsPath: 'whatsapp/private/user-123/message/private-document-thumbnail.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/thumbnail`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 502 when storage signed URL generation fails for opaque public media access', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-access-signed-url-fail',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-access-signed-url-fail',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-access-signed-url-fail.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const publicResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publicResponse.statusCode).toBe(200);

    ctx.mediaStorage.setFailGetSignedUrl(true);
    const publicBody = JSON.parse(publicResponse.body) as {
      data: { url: string };
    };

    const accessResponse = await ctx.app.inject({
      method: 'GET',
      url: publicBody.data.url,
    });

    expect(accessResponse.statusCode).toBe(502);
  });

  it('returns 404 for invalid opaque public media access tokens', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/media-access?token=invalid-token',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for too-short opaque public media access tokens', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/media-access?token=${Buffer.from('short').toString('base64url')}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for expired opaque public media access tokens', async () => {
    const expiredToken = createOpaqueAccessTokenForTest({
      messageId: 'message:private-source-123:$expired-access',
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) - 60,
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/media-access?token=${expiredToken}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for opaque public media access tokens with invalid variants', async () => {
    const invalidVariantToken = createOpaqueAccessTokenForTest({
      messageId: 'message:private-source-123:$invalid-variant-access',
      variantCode: 'x',
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/media-access?token=${invalidVariantToken}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for opaque public media access tokens with malformed payloads', async () => {
    const malformedToken = createOpaqueAccessTokenForTest({
      messageId: 'message:private-source-123:$malformed-access',
      payloadOverride: Buffer.from('not-deflate-payload'),
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/media-access?token=${malformedToken}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for opaque public media access tokens without an expiry field', async () => {
    const missingExpiryToken = createOpaqueAccessTokenForTest({
      messageId: 'message:private-source-123:$missing-expiry-access',
      payloadOverride: deflateRawSync(
        Buffer.from('message:private-source-123:$missing-expiry-access\no', 'utf8')
      ),
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/media-access?token=${missingExpiryToken}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 500 when opaque public media access message lookup fails', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-access-message-lookup-fail',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-access-message-lookup-fail',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-access-message-lookup-fail.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const publicResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publicResponse.statusCode).toBe(200);
    const publicBody = JSON.parse(publicResponse.body) as { data: { url: string } };

    const services = getServices();
    setServices({
      ...services,
      privateWhatsAppRepository: {
        ...services.privateWhatsAppRepository,
        getMessageById: async () => ({
          ok: false as const,
          error: {
            code: 'PERSISTENCE_ERROR' as const,
            message: 'Simulated access-route message lookup failure',
          },
        }),
      },
    });

    const accessResponse = await ctx.app.inject({
      method: 'GET',
      url: publicBody.data.url,
    });

    expect(accessResponse.statusCode).toBe(500);
  });

  it('returns 404 when opaque public media access resolves to a missing message', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-access-missing-message',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-access-missing-message',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-access-missing-message.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const publicResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publicResponse.statusCode).toBe(200);
    const publicBody = JSON.parse(publicResponse.body) as { data: { url: string } };

    const services = getServices();
    setServices({
      ...services,
      privateWhatsAppRepository: {
        ...services.privateWhatsAppRepository,
        getMessageById: async () => ({
          ok: true as const,
          value: null,
        }),
      },
    });

    const accessResponse = await ctx.app.inject({
      method: 'GET',
      url: publicBody.data.url,
    });

    expect(accessResponse.statusCode).toBe(404);
  });

  it('returns 404 when opaque public media access resolves to non-image stored media', async () => {
    const token = await createToken({ sub: 'user-123' });
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-access-non-image',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-access-non-image',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-access-non-image.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const publicResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/messages/${stored.value.messageId}/media`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publicResponse.statusCode).toBe(200);
    const publicBody = JSON.parse(publicResponse.body) as { data: { url: string } };

    const services = getServices();
    const originalMessageResult = await services.privateWhatsAppRepository.getMessageById(
      stored.value.messageId
    );
    expect(originalMessageResult.ok).toBe(true);
    if (!originalMessageResult.ok || originalMessageResult.value === null) {
      throw new Error('Expected stored private message to exist before access-route override');
    }
    const originalMessage = originalMessageResult.value;
    setServices({
      ...services,
      privateWhatsAppRepository: {
        ...services.privateWhatsAppRepository,
        getMessageById: async () => ({
          ok: true as const,
          value: {
            ...originalMessage,
            messageType: 'file' as const,
            media: {
              mxcUri: 'mxc://home-dev/file-access-non-image',
              mimeType: 'application/pdf',
              storageStatus: 'stored' as const,
              gcsPath: 'whatsapp/private/user-123/message/private-document-access.pdf',
            },
          },
        }),
      },
    });

    const accessResponse = await ctx.app.inject({
      method: 'GET',
      url: publicBody.data.url,
    });

    expect(accessResponse.statusCode).toBe(404);
  });

  it('returns 500 when public private media account resolution fails', async () => {
    const services = getServices();
    setServices({
      ...services,
      privateWhatsAppRepository: {
        ...services.privateWhatsAppRepository,
        getAccountByUserId: async () => ({
          ok: false as const,
          error: {
            code: 'PERSISTENCE_ERROR' as const,
            message: 'Simulated public account lookup failure',
          },
        }),
      },
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages/message:private-source-123:missing/media',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns 500 when public private media message lookup fails', async () => {
    const services = getServices();
    const privateWhatsAppRepository = Object.assign(
      Object.create(Object.getPrototypeOf(services.privateWhatsAppRepository)) as object,
      services.privateWhatsAppRepository,
      {
        getMessageById: async () => ({
          ok: false as const,
          error: {
            code: 'PERSISTENCE_ERROR' as const,
            message: 'Simulated public message lookup failure',
          },
        }),
      }
    );
    setServices({
      ...services,
      privateWhatsAppRepository: privateWhatsAppRepository,
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages/message:private-source-123:missing/media',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
  });

  it('requires internal auth for private media signed URL reads', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/messages/message:private-source-123:missing/media?sourceAccountId=private-source-123',
    });

    expect(response.statusCode).toBe(401);
  });

  it('validates internal private media signed URL query params', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/messages/message:private-source-123:missing/media',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 500 when internal private media message lookup fails', async () => {
    const services = getServices();
    setServices({
      ...services,
      privateWhatsAppRepository: {
        ...services.privateWhatsAppRepository,
        getMessageById: async () => ({
          ok: false as const,
          error: {
            code: 'PERSISTENCE_ERROR' as const,
            message: 'Simulated internal message lookup failure',
          },
        }),
      },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/messages/message:private-source-123:missing/media?sourceAccountId=private-source-123',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns 502 when internal private media signed URL generation fails', async () => {
    ctx.mediaStorage.setFailGetSignedUrl(true);
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-internal-signed-url-fail',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-internal-signed-url-fail',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-internal-signed-url-fail.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/internal/whatsapp/private/messages/${stored.value.messageId}/media?sourceAccountId=private-source-123`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(502);
  });

  it('returns 404 when internal private media source account validation fails', async () => {
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-source-account-mismatch',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-source-account-mismatch',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-source-account-mismatch.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/internal/whatsapp/private/messages/${stored.value.messageId}/media?sourceAccountId=wrong-source-account`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('defaults internal private media signed URLs to the original variant when variant is omitted', async () => {
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-default-variant',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-default-variant',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-default-variant.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/internal/whatsapp/private/messages/${stored.value.messageId}/media?sourceAccountId=private-source-123`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: { url: string; media: { gcsPath: string } };
    };
    expect(body.data.url).toContain('whatsapp/private/user-123/message/image-default-variant.jpg');
    expect(body.data.media.gcsPath).toBe(
      'whatsapp/private/user-123/message/image-default-variant.jpg'
    );
  });

  it('returns internal signed URLs for thumbnail variants after source account validation', async () => {
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-image-thumbnail-variant',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'image',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/image-thumbnail-variant',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/image-thumbnail-variant.jpg',
          thumbnailGcsPath: 'whatsapp/private/user-123/message/image-thumbnail-variant_thumb.jpg',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/internal/whatsapp/private/messages/${stored.value.messageId}/media?sourceAccountId=private-source-123&variant=thumbnail`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: true;
      data: { url: string; media: { gcsPath: string } };
    };
    expect(body.data.url).toContain(
      'whatsapp/private/user-123/message/image-thumbnail-variant_thumb.jpg'
    );
    expect(body.data.media.gcsPath).toBe(
      'whatsapp/private/user-123/message/image-thumbnail-variant_thumb.jpg'
    );
  });

  it('returns 404 for internal private media requests when the stored private message is not an image', async () => {
    const stored = await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'private-source-123',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: { matrixRoomId: '!room:home-dev', type: 'direct' },
      message: {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$stored-non-image-internal',
        matrixSenderId: '@alice:home-dev',
        senderKey: 'matrix:@alice:home-dev',
        direction: 'incoming',
        type: 'file',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        rawMatrixEvent: {},
        media: {
          mxcUri: 'mxc://home-dev/file-internal',
          mimeType: 'application/pdf',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/message/private-document-internal.pdf',
        },
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/internal/whatsapp/private/messages/${stored.value.messageId}/media?sourceAccountId=private-source-123`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(404);
  });
});
