import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, setupTestContext } from './testUtils.js';
import { FakeThumbnailGeneratorPort } from './fakes.js';
import { createPrivateWhatsAppMessageId } from '../infra/firestore/privateWhatsAppRepository.js';
import { getServices, setServices } from '../services.js';

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
    expect(body.data.media).toMatchObject({
      mxcUri: 'mxc://home-dev/image',
      mimeType: 'image/jpeg',
      fileName: 'image.jpg',
      sizeBytes: 'image-bytes'.length,
      storageStatus: 'stored',
      gcsPath: `whatsapp/private/user-123/${messageId}/home-dev-image.jpg`,
      thumbnailGcsPath: `whatsapp/private/user-123/${messageId}/home-dev-image_thumb.jpg`,
      storedMimeType: 'image/jpeg',
      storedSizeBytes: 'image-bytes'.length,
    });
    expect(ctx.mediaStorage.getFile(body.data.media.gcsPath)?.buffer.toString()).toBe(
      'image-bytes'
    );
    expect(ctx.mediaStorage.getFile(body.data.media.thumbnailGcsPath)).toBeDefined();
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

  it('rejects uploads when mimeType is not an image', async () => {
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
});
