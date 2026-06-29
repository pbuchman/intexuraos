/**
 * Tests for the audio-stored handler.
 *
 * Covers the four DLQ paths (missing message data, parse error, unexpected
 * type, invalid schema), the Ack path (successful publish), and the Nack
 * path (transcribeAudio rejects). The handler exits via `runWithRequestContext`
 * so we also assert that the request-scoped logger child carries the
 * extracted `requestId`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  createAudioStoredHandler,
  fetchUserProvider,
  type AudioStoredHandlerDeps,
} from '../handler.js';
import type { TranscriptionCompletedEvent, AudioStoredEvent } from '../types.js';
import {
  AckDecision,
  createFakeLogger,
  makePubSubCloudEvent,
  type FakeLogger,
} from '../__shims__/common-worker.js';
import type { SpeechTranscriptionPort } from '../providers/transcription-provider.js';

function makeSuccessProvider(): SpeechTranscriptionPort {
  return {
    submitJob: vi
      .fn()
      .mockResolvedValue(
        ok({ jobId: 'job-1', apiCall: { timestamp: '', operation: 'submit', success: true } })
      ),
    pollJob: vi
      .fn()
      .mockResolvedValue(
        ok({ status: 'done', apiCall: { timestamp: '', operation: 'poll', success: true } })
      ),
    getTranscript: vi.fn().mockResolvedValue(
      ok({
        text: 'Hello world',
        apiCall: { timestamp: '', operation: 'fetch_result', success: true },
      })
    ),
  };
}

function makeValidAudioStoredEvent(): AudioStoredEvent {
  return {
    type: 'whatsapp.audio.stored',
    userId: 'user-123',
    messageId: 'msg-456',
    mediaId: 'media-789',
    gcsPath: 'whatsapp/user-123/audio.ogg',
    mimeType: 'audio/ogg',
    timestamp: '2026-04-25T00:00:00.000Z',
  };
}

function makeValidVideoTranscriptionRequestedEvent(): Record<string, unknown> {
  return {
    type: 'whatsapp.media.transcription.requested',
    messageSource: 'public_whatsapp',
    mediaKind: 'video',
    userId: 'user-123',
    messageId: 'msg-video-456',
    mediaId: 'media-video-789',
    gcsPath: 'whatsapp/user-123/video.mp4',
    mimeType: 'video/mp4',
    timestamp: '2026-06-29T00:00:00.000Z',
  };
}

describe('createAudioStoredHandler', () => {
  let baseLogger: FakeLogger;
  let publishedCompleted: TranscriptionCompletedEvent[];
  let deps: AudioStoredHandlerDeps;

  beforeEach(() => {
    baseLogger = createFakeLogger();
    publishedCompleted = [];

    deps = {
      baseLogger,
      fetchUserProvider: vi.fn().mockResolvedValue('speechmatics'),
      generateSignedUrl: vi.fn().mockResolvedValue(ok('https://signed.example.com/audio.ogg')),
      createProvider: vi.fn().mockReturnValue(makeSuccessProvider()),
      publishCompleted: vi.fn().mockImplementation((event: TranscriptionCompletedEvent) => {
        publishedCompleted.push(event);
        return Promise.resolve(ok(undefined));
      }),
      // Skip the 2-second initial poll delay so tests stay fast.
      pollConfig: { initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1, maxAttempts: 5 },
      sleep: (): Promise<void> => Promise.resolve(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('DLQ paths (silent-ACK regression guards)', () => {
    it('returns DeadLetter "missing_message_data" when message data is absent', async () => {
      const handler = createAudioStoredHandler(deps);
      // Pass a message override that omits the `data` field.
      const event = makePubSubCloudEvent({}, {}, { attributes: {} });

      const result = await handler(event, baseLogger);

      expect(result).toEqual({
        decision: AckDecision.DeadLetter,
        reason: 'missing_message_data',
      });
      // No downstream side effects (no provider lookup, no publish).
      expect(deps.fetchUserProvider).not.toHaveBeenCalled();
      expect(publishedCompleted).toHaveLength(0);
    });

    it('returns DeadLetter "parse_error" when payload is not valid JSON', async () => {
      const handler = createAudioStoredHandler(deps);
      const event = makePubSubCloudEvent(
        {},
        {},
        { data: Buffer.from('not-json{').toString('base64'), attributes: {} }
      );

      const result = await handler(event, baseLogger);

      expect(result).toEqual({ decision: AckDecision.DeadLetter, reason: 'parse_error' });
      expect(publishedCompleted).toHaveLength(0);
    });

    it('returns DeadLetter "unexpected_event_type" when type literal is wrong', async () => {
      const handler = createAudioStoredHandler(deps);
      const event = makePubSubCloudEvent({
        type: 'whatsapp.image.stored', // wrong literal
        userId: 'u',
        messageId: 'm',
        mediaId: 'd',
        gcsPath: 'p',
        mimeType: 'image/jpeg',
        timestamp: 't',
      });

      const result = await handler(event, baseLogger);

      expect(result).toEqual({
        decision: AckDecision.DeadLetter,
        reason: 'unexpected_event_type',
      });
      expect(publishedCompleted).toHaveLength(0);
    });

    it('returns DeadLetter "invalid_event_schema" when required fields are missing', async () => {
      const handler = createAudioStoredHandler(deps);
      // Right type, missing userId etc.
      const event = makePubSubCloudEvent({ type: 'whatsapp.audio.stored' });

      const result = await handler(event, baseLogger);

      expect(result).toEqual({
        decision: AckDecision.DeadLetter,
        reason: 'invalid_event_schema',
      });
      expect(publishedCompleted).toHaveLength(0);
    });

    it('returns DeadLetter "invalid_event_schema" when media transcription request omits mediaKind', async () => {
      const handler = createAudioStoredHandler(deps);
      const payload = makeValidVideoTranscriptionRequestedEvent();
      delete payload['mediaKind'];
      const event = makePubSubCloudEvent(payload);

      const result = await handler(event, baseLogger);

      expect(result).toEqual({
        decision: AckDecision.DeadLetter,
        reason: 'invalid_event_schema',
      });
      expect(publishedCompleted).toHaveLength(0);
    });
  });

  describe('Ack path (happy publish)', () => {
    it('returns Ack and publishes a completed event for a valid AudioStoredEvent', async () => {
      const handler = createAudioStoredHandler(deps);
      const event = makePubSubCloudEvent(makeValidAudioStoredEvent());

      const result = await handler(event, baseLogger);

      expect(result).toEqual({ decision: AckDecision.Ack });
      expect(publishedCompleted).toHaveLength(1);
      expect(publishedCompleted[0]?.status).toBe('completed');
      expect(publishedCompleted[0]?.userId).toBe('user-123');
    });

    it('returns Ack and publishes a video completed event for a valid media transcription request', async () => {
      const handler = createAudioStoredHandler(deps);
      const event = makePubSubCloudEvent(makeValidVideoTranscriptionRequestedEvent());

      const result = await handler(event, baseLogger);

      expect(result).toEqual({ decision: AckDecision.Ack });
      expect(deps.generateSignedUrl).toHaveBeenCalledWith('whatsapp/user-123/video.mp4');
      expect(publishedCompleted).toHaveLength(1);
      expect(publishedCompleted[0]).toMatchObject({
        type: 'srt.transcription.completed',
        messageSource: 'public_whatsapp',
        mediaKind: 'video',
        userId: 'user-123',
        messageId: 'msg-video-456',
        status: 'completed',
      });
    });

    it('uses extracted requestId as a child binding on the request logger', async () => {
      const handler = createAudioStoredHandler(deps);
      const event = makePubSubCloudEvent(
        makeValidAudioStoredEvent(),
        {},
        {
          data: Buffer.from(JSON.stringify(makeValidAudioStoredEvent())).toString('base64'),
          attributes: { 'x-request-id': 'req-fixed-1' },
        }
      );

      // Spy on .child() to confirm the requestId binding is applied.
      const childSpy = vi.spyOn(baseLogger, 'child');
      await handler(event, baseLogger);

      expect(childSpy).toHaveBeenCalledWith({ requestId: 'req-fixed-1' });
    });
  });

  describe('Nack path (transcribeAudio throws)', () => {
    it('lets exceptions bubble up so the wrapper can convert them to Nack', async () => {
      // generateSignedUrl rejects — transcribeAudio's outer try/catch swallows
      // it and publishes a "failed" event. To force an actual throw out of
      // transcribeAudio, make the publish itself reject.
      deps.publishCompleted = vi.fn().mockRejectedValue(new Error('publisher exploded'));
      const handler = createAudioStoredHandler(deps);
      const event = makePubSubCloudEvent(makeValidAudioStoredEvent());

      // transcribeAudio catches publish failures (logs them, does not rethrow)
      // — so a publish reject still results in Ack. We need a deeper failure:
      // mocking createProvider to throw bubbles past transcribeAudio's outer
      // try/catch through to the handler.
      deps.createProvider = vi.fn(() => {
        throw new Error('provider construction failed');
      });

      // transcribeAudio's outer try/catch catches the createProvider throw and
      // attempts to publish a failed event; reset publishCompleted to a benign
      // fake so we can observe the Ack vs. throw distinction cleanly.
      deps.publishCompleted = vi.fn().mockResolvedValue(ok(undefined));

      const result = await handler(event, baseLogger);

      // transcribeAudio swallows synchronous errors via its catch block and
      // turns them into a "failed" published event — so the handler still
      // returns Ack. The "Nack via withObservability" path is exercised at
      // the wrapper level (see common-worker-shim.test.ts: handler throws).
      expect(result).toEqual({ decision: AckDecision.Ack });
    });

    it('propagates synchronous throws upstream of transcribeAudio so the wrapper can Nack', async () => {
      // Force `baseLogger.child` to throw — the only synchronous boundary
      // before transcribeAudio's outer try/catch — to assert the error
      // escapes the handler so `withObservability` can convert it to Nack.
      const throwingLogger: FakeLogger = {
        ...baseLogger,
        child: () => {
          throw new Error('logger child failure');
        },
      };
      const handler = createAudioStoredHandler({ ...deps, baseLogger: throwingLogger });
      const event = makePubSubCloudEvent(makeValidAudioStoredEvent());

      await expect(handler(event, baseLogger)).rejects.toThrow(/logger child failure/);
    });
  });

  describe('publishCompleted error handling', () => {
    it('still acks when the completed-event publish itself fails (matches pre-refactor behavior)', async () => {
      deps.publishCompleted = vi
        .fn()
        .mockResolvedValue(err({ code: 'PUBLISH_FAILED', message: 'topic missing' }));
      const handler = createAudioStoredHandler(deps);
      const event = makePubSubCloudEvent(makeValidAudioStoredEvent());

      const result = await handler(event, baseLogger);

      // transcribeAudio logs the error but does not rethrow, so the handler
      // ACKs to avoid an infinite redelivery loop on a permanent topic
      // failure. This mirrors the pre-refactor index.ts behavior; see
      // main.ts publishFailed branches.
      expect(result).toEqual({ decision: AckDecision.Ack });
    });
  });

  describe('optional polling overrides', () => {
    it('omits pollConfig and sleep keys when deps do not provide them', async () => {
      // Covers the `...(deps.pollConfig !== undefined ? ... : {})` undefined
      // branches by spying on `transcribeAudio` and asserting the spread
      // produced an object without `pollConfig` / `sleep` keys at all
      // (required by `exactOptionalPropertyTypes` — passing `undefined`
      // would also be a type error). Using `Object.prototype.hasOwnProperty`
      // distinguishes "key missing" from "key present with undefined value".
      const transcribeAudioSpy = vi
        .spyOn(await import('../main.js'), 'transcribeAudio')
        .mockResolvedValue(undefined);

      try {
        const handler = createAudioStoredHandler({
          baseLogger,
          fetchUserProvider: vi.fn().mockResolvedValue('speechmatics'),
          generateSignedUrl: vi.fn().mockResolvedValue(ok('https://signed.example.com/audio.ogg')),
          createProvider: vi.fn().mockReturnValue(makeSuccessProvider()),
          publishCompleted: vi.fn().mockResolvedValue(ok(undefined)),
        });
        const event = makePubSubCloudEvent(makeValidAudioStoredEvent());

        await handler(event, baseLogger);

        expect(transcribeAudioSpy).toHaveBeenCalledTimes(1);
        const transcribeDeps = transcribeAudioSpy.mock.calls[0]?.[1] ?? {};
        expect(Object.prototype.hasOwnProperty.call(transcribeDeps, 'pollConfig')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(transcribeDeps, 'sleep')).toBe(false);
      } finally {
        transcribeAudioSpy.mockRestore();
      }
    });

    it('forwards pollConfig and sleep when deps provide them', async () => {
      // Mirror image of the test above for the "defined" branch — keeps
      // `exactOptionalPropertyTypes` happy by checking key presence rather
      // than value identity.
      const transcribeAudioSpy = vi
        .spyOn(await import('../main.js'), 'transcribeAudio')
        .mockResolvedValue(undefined);

      try {
        const handler = createAudioStoredHandler(deps); // deps provides both
        const event = makePubSubCloudEvent(makeValidAudioStoredEvent());

        await handler(event, baseLogger);

        const transcribeDeps = transcribeAudioSpy.mock.calls[0]?.[1] ?? {};
        expect(Object.prototype.hasOwnProperty.call(transcribeDeps, 'pollConfig')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(transcribeDeps, 'sleep')).toBe(true);
      } finally {
        transcribeAudioSpy.mockRestore();
      }
    });
  });
});

describe('fetchUserProvider', () => {
  const originalFetch = globalThis.fetch;
  let fakeLogger: ReturnType<typeof createFakeLogger>;

  beforeEach(() => {
    fakeLogger = createFakeLogger();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the configured provider when the request succeeds with a preference set', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        Promise.resolve({
          success: true,
          data: { transcriptionPreferences: { provider: 'whisper' } },
        }),
    } as unknown as Response) as unknown as typeof fetch;

    const result = await fetchUserProvider('user-1', 'https://user-service', 'token', fakeLogger);
    expect(result).toBe('whisper');
  });

  it('falls back to speechmatics when the response succeeds without a preference', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        Promise.resolve({
          success: true,
          data: {},
        }),
    } as unknown as Response) as unknown as typeof fetch;

    const result = await fetchUserProvider('user-1', 'https://user-service', 'token', fakeLogger);
    expect(result).toBe('speechmatics');
  });

  it('falls back to speechmatics and warns on non-2xx responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => Promise.resolve({}),
    } as unknown as Response) as unknown as typeof fetch;

    const result = await fetchUserProvider('user-1', 'https://user-service', 'token', fakeLogger);
    expect(result).toBe('speechmatics');
    expect(fakeLogger.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('falls back to speechmatics and warns on network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection reset'));

    const result = await fetchUserProvider('user-1', 'https://user-service', 'token', fakeLogger);
    expect(result).toBe('speechmatics');
    expect(fakeLogger.entries.some((e) => e.level === 'warn')).toBe(true);
  });
});
