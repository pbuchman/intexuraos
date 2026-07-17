import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMatrixClient, isWhatsAppPuppetSender } from '../live/matrixClient.js';

const TARGET_ROOM_ID = '!agent-room:home-dev';

function targetSyncBody(
  events: readonly unknown[] = [],
  options: { nextBatch?: unknown; limited?: unknown } = {}
): Record<string, unknown> {
  return {
    next_batch: options.nextBatch ?? 'next-cursor',
    rooms: {
      join: {
        [TARGET_ROOM_ID]: {
          timeline: {
            events,
            ...(options.limited !== undefined ? { limited: options.limited } : {}),
          },
        },
      },
    },
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createMatrixClient', () => {
  it('calls the exact whoami endpoint with bearer auth and accepts documented optional fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        user_id: '@operator:home-dev',
        device_id: 'SYNTHETIC-DEVICE',
        is_guest: false,
      })
    );
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 4096 });

    await expect(
      client.whoAmI({
        homeserverUrl: 'https://matrix.synthetic.test/base/path',
        accessToken: 'private-token-sentinel',
      })
    ).resolves.toEqual({ ok: true, userId: '@operator:home-dev' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://matrix.synthetic.test/_matrix/client/v3/account/whoami',
      expect.objectContaining({
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer private-token-sentinel',
        },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('maps HTTP 401 separately and closes every other non-200 status', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'private unauthorized body' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'private unavailable body' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ location: 'private redirect body' }, { status: 302 }));
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 4096 });
    const input = {
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
    };

    await expect(client.whoAmI(input)).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    await expect(client.whoAmI(input)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    const redirect = await client.whoAmI(input);
    expect(redirect).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(redirect)).not.toContain('private redirect body');
  });

  it.each([
    [{}, 'missing user ID'],
    [{ user_id: 'operator' }, 'invalid user ID'],
    [{ user_id: '@operator:home-dev', unknown: 'private body sentinel' }, 'unknown key'],
    [{ user_id: '@operator:home-dev', device_id: '' }, 'invalid device ID'],
    [{ user_id: '@operator:home-dev', is_guest: 'false' }, 'invalid guest flag'],
  ] as const)('strictly rejects %s', async (body, _label) => {
    const client = createMatrixClient({
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(body)),
      timeoutMs: 50,
      maxBytes: 4096,
    });

    const result = await client.whoAmI({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_response' });
    expect(JSON.stringify(result)).not.toContain('private body sentinel');
    expect(JSON.stringify(result)).not.toContain('private-token-sentinel');
  });

  it.each([
    [new Response('{not-json', { headers: { 'content-type': 'application/json' } }), 4096],
    [new Response('{}', { headers: { 'content-type': 'text/plain' } }), 4096],
    [jsonResponse({ user_id: '@operator:home-dev' }), 4],
  ] as const)(
    'rejects malformed, wrong-content-type, or oversized bodies',
    async (response, maxBytes) => {
      const client = createMatrixClient({
        fetchImpl: vi.fn<typeof fetch>(async () => response),
        timeoutMs: 50,
        maxBytes,
      });

      await expect(
        client.whoAmI({
          homeserverUrl: 'https://matrix.synthetic.test',
          accessToken: 'private-token-sentinel',
        })
      ).resolves.toEqual({ ok: false, reason: 'invalid_response' });
    }
  );

  it('maps network failure and an invalid homeserver without exposing raw details', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('private network sentinel');
    });
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 4096 });

    const network = await client.whoAmI({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
    });
    expect(network).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(network)).not.toContain('private network sentinel');

    const invalidUrl = await client.whoAmI({
      homeserverUrl: 'not-a-url',
      accessToken: 'private-token-sentinel',
    });
    expect(invalidUrl).toEqual({ ok: false, reason: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts at the configured timeout and returns only the timeout reason', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('private timeout sentinel', 'AbortError'));
          });
        })
    );
    const client = createMatrixClient({ fetchImpl, timeoutMs: 1, maxBytes: 4096 });

    const result = await client.whoAmI({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
    });

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(JSON.stringify(result)).not.toContain('private timeout sentinel');
  });

  it('captures a target-room cursor with the exact filter and caller-owned signal', async () => {
    const event = {
      type: 'm.room.message',
      sender: '@whatsapp_48123123123:home-dev',
      content: {
        msgtype: 'm.text',
        body: 'synthetic reply',
        'm.relates_to': { rel_type: 'm.annotation' },
      },
      unsigned: {
        redacted_because: {
          event_id: '$private-redaction-target',
          content: 'private redacted content sentinel',
        },
      },
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(targetSyncBody([event], { limited: false }))
    );
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 16_384 });
    const controller = new AbortController();

    const result = await client.syncTargetRoom({
      homeserverUrl: 'https://matrix.synthetic.test/base/path',
      accessToken: 'private-token-sentinel',
      targetRoomId: TARGET_ROOM_ID,
      timeoutMs: 0,
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: true,
      nextBatch: 'next-cursor',
      limited: false,
      events: [
        {
          type: event.type,
          sender: event.sender,
          content: event.content,
          unsigned: { redacted_because: true },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('$private-redaction-target');
    expect(JSON.stringify(result)).not.toContain('private redacted content sentinel');

    const requestUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      'https://matrix.synthetic.test/_matrix/client/v3/sync'
    );
    expect(Object.fromEntries(requestUrl.searchParams.entries())).toEqual({
      timeout: '0',
      set_presence: 'offline',
      filter: expect.any(String),
    });
    expect(JSON.parse(requestUrl.searchParams.get('filter') ?? '')).toEqual({
      event_fields: [
        'type',
        'sender',
        'content.msgtype',
        'content.body',
        'content.m\\.relates_to',
        'unsigned.redacted_because',
      ],
      presence: { types: [] },
      account_data: { types: [] },
      room: {
        rooms: [TARGET_ROOM_ID],
        account_data: { types: [] },
        ephemeral: { types: [] },
        state: { types: [] },
        timeline: {
          limit: 100,
          types: ['m.room.message', 'm.reaction', 'm.room.redaction', 'm.sticker'],
        },
      },
    });
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual({
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer private-token-sentinel',
      },
      redirect: 'error',
      signal: controller.signal,
    });
  });

  it('adds since only for a poll and keeps the exact target-room filter', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(targetSyncBody()));
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 4096 });
    const controller = new AbortController();

    await client.syncTargetRoom({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
      targetRoomId: TARGET_ROOM_ID,
      since: 'previous-cursor',
      timeoutMs: 30_000,
      signal: controller.signal,
    });

    const requestUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get('timeout')).toBe('30000');
    expect(requestUrl.searchParams.get('since')).toBe('previous-cursor');
    expect(requestUrl.searchParams.get('set_presence')).toBe('offline');
    expect(JSON.parse(requestUrl.searchParams.get('filter') ?? '').room.rooms).toEqual([
      TARGET_ROOM_ID,
    ]);
  });

  it('ignores unrelated top-level sections and joined rooms without inspecting their events', async () => {
    const body = targetSyncBody([
      {
        type: 'm.room.message',
        sender: '@whatsapp_lid-AbC_123:home-dev',
        content: { msgtype: 'm.text', body: 'eligible' },
      },
    ]);
    const rooms = body['rooms'] as { join: Record<string, unknown> };
    rooms.join['!unrelated:home-dev'] = {
      timeline: { events: 'private malformed unrelated-room sentinel', limited: 'wrong' },
    };
    body['presence'] = { events: 'private malformed top-level sentinel' };
    const client = createMatrixClient({
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(body)),
      timeoutMs: 50,
      maxBytes: 16_384,
    });

    const result = await client.syncTargetRoom({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
      targetRoomId: TARGET_ROOM_ID,
      timeoutMs: 0,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      ok: true,
      nextBatch: 'next-cursor',
      limited: false,
      events: [
        {
          type: 'm.room.message',
          sender: '@whatsapp_lid-AbC_123:home-dev',
          content: { msgtype: 'm.text', body: 'eligible' },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private malformed');
  });

  it.each([
    { next_batch: 'empty-cursor' },
    { next_batch: 'empty-cursor', rooms: {} },
    { next_batch: 'empty-cursor', rooms: { join: {} } },
    {
      next_batch: 'empty-cursor',
      rooms: { join: { [TARGET_ROOM_ID]: {} } },
    },
  ])('treats an omitted target timeline level as a valid empty update', async (body) => {
    const client = createMatrixClient({
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(body)),
      timeoutMs: 50,
      maxBytes: 4096,
    });

    await expect(
      client.syncTargetRoom({
        homeserverUrl: 'https://matrix.synthetic.test',
        accessToken: 'private-token-sentinel',
        targetRoomId: TARGET_ROOM_ID,
        timeoutMs: 0,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      ok: true,
      nextBatch: 'empty-cursor',
      limited: false,
      events: [],
    });
  });

  it('accepts realistic reaction/edit relations and immediately projects away their target metadata', async () => {
    const body = targetSyncBody([
      {
        type: 'm.reaction',
        sender: '@whatsapp_48123:home-dev',
        content: {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: '$private-reaction-target',
            key: 'synthetic reaction',
          },
        },
      },
      {
        type: 'm.room.message',
        sender: '@whatsapp_48123:home-dev',
        content: {
          msgtype: 'm.text',
          body: 'edited body',
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: '$private-edit-target',
          },
        },
      },
    ]);
    const client = createMatrixClient({
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(body)),
      timeoutMs: 50,
      maxBytes: 16_384,
    });

    const result = await client.syncTargetRoom({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
      targetRoomId: TARGET_ROOM_ID,
      timeoutMs: 0,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      ok: true,
      nextBatch: 'next-cursor',
      limited: false,
      events: [
        {
          type: 'm.reaction',
          sender: '@whatsapp_48123:home-dev',
          content: { 'm.relates_to': { rel_type: 'm.annotation' } },
        },
        {
          type: 'm.room.message',
          sender: '@whatsapp_48123:home-dev',
          content: {
            msgtype: 'm.text',
            body: 'edited body',
            'm.relates_to': { rel_type: 'm.replace' },
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('$private');
    expect(JSON.stringify(result)).not.toContain('synthetic reaction');
  });

  it('accepts the exact cursor, event, and body string limits', async () => {
    const body = targetSyncBody(
      [
        {
          type: 't'.repeat(255),
          sender: `@${'s'.repeat(252)}:x`,
          content: { msgtype: 'm', body: 'b'.repeat(8_192) },
        },
      ],
      { nextBatch: 'c'.repeat(4_096) }
    );
    const client = createMatrixClient({
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(body)),
      timeoutMs: 50,
      maxBytes: 32_768,
    });

    const result = await client.syncTargetRoom({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
      targetRoomId: TARGET_ROOM_ID,
      timeoutMs: 0,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ ok: true, limited: false });
  });

  it.each([
    [targetSyncBody([], { nextBatch: '' }), 'blank next batch'],
    [targetSyncBody([], { nextBatch: 'c'.repeat(4_097) }), 'oversized next batch'],
    [targetSyncBody([], { limited: 'false' }), 'non-boolean limited'],
    [
      targetSyncBody([
        {
          type: 'm.room.message',
          sender: '@whatsapp_48123:home-dev',
          content: { msgtype: 'm.text', body: 'text' },
          unknown: 'private event sentinel',
        },
      ]),
      'unknown event field',
    ],
    [
      targetSyncBody([
        {
          type: 'm.room.message',
          sender: '@whatsapp_48123:home-dev',
          content: { msgtype: 'm.text', body: 'text', unknown: 'private content sentinel' },
        },
      ]),
      'unknown content field',
    ],
    [
      targetSyncBody([
        {
          type: 'm.room.message',
          sender: '@whatsapp_48123:home-dev',
          content: { 'm.relates_to': { rel_type: 'r'.repeat(256) } },
        },
      ]),
      'oversized relation type',
    ],
    [
      targetSyncBody([
        {
          type: 't'.repeat(256),
          sender: '@whatsapp_48123:home-dev',
        },
      ]),
      'oversized event type',
    ],
    [
      targetSyncBody([
        {
          type: 'm.room.message',
          sender: 's'.repeat(256),
        },
      ]),
      'oversized sender',
    ],
    [
      targetSyncBody([
        {
          type: 'm.room.message',
          sender: '@whatsapp_48123:home-dev',
          content: { body: 'b'.repeat(8_193) },
        },
      ]),
      'oversized body',
    ],
    [
      targetSyncBody([
        {
          type: 'm.room.message',
          sender: '@whatsapp_48123:home-dev',
          unsigned: { other: 'private unsigned sentinel' },
        },
      ]),
      'unknown unsigned field',
    ],
  ] as const)('closes malformed consumed sync data: %s', async (body, _label) => {
    const client = createMatrixClient({
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(body)),
      timeoutMs: 50,
      maxBytes: 16_384,
    });

    const result = await client.syncTargetRoom({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
      targetRoomId: TARGET_ROOM_ID,
      timeoutMs: 0,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_response' });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('maps status, transport, caller abort, malformed JSON, and oversized bodies to closed failures', async () => {
    const controller = new AbortController();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'private unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'private forbidden' }, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'private unavailable' }, { status: 503 }))
      .mockRejectedValueOnce(new Error('private network'))
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException('private abort', 'AbortError');
      })
      .mockResolvedValueOnce(
        new Response('{not-json', { headers: { 'content-type': 'application/json' } })
      )
      .mockResolvedValueOnce(jsonResponse(targetSyncBody()));
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 4 });
    const baseInput = {
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
      targetRoomId: TARGET_ROOM_ID,
      timeoutMs: 0 as const,
    };

    await expect(
      client.syncTargetRoom({ ...baseInput, signal: new AbortController().signal })
    ).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    await expect(
      client.syncTargetRoom({ ...baseInput, signal: new AbortController().signal })
    ).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    await expect(
      client.syncTargetRoom({ ...baseInput, signal: new AbortController().signal })
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(
      client.syncTargetRoom({ ...baseInput, signal: new AbortController().signal })
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(
      client.syncTargetRoom({ ...baseInput, signal: controller.signal })
    ).resolves.toEqual({ ok: false, reason: 'timeout' });
    await expect(
      client.syncTargetRoom({ ...baseInput, signal: new AbortController().signal })
    ).resolves.toEqual({ ok: false, reason: 'invalid_response' });
    await expect(
      client.syncTargetRoom({ ...baseInput, signal: new AbortController().signal })
    ).resolves.toEqual({ ok: false, reason: 'invalid_response' });
  });
});

describe('isWhatsAppPuppetSender', () => {
  it.each([
    '@whatsapp_48123123123:home-dev',
    '@whatsapp_0:matrix.example',
    '@whatsapp_lid-AbC_123:home-dev',
  ])('accepts the exact WhatsApp puppet shape %s', (value) => {
    expect(isWhatsAppPuppetSender(value)).toBe(true);
  });

  it.each([
    '@whatsapp_:home-dev',
    '@whatsapp_+48123:home-dev',
    '@whatsapp_lid-:home-dev',
    '@whatsapp_lid-AbC.123:home-dev',
    '@whatsapp_48123',
    '@bridge_bot:home-dev',
    ' @whatsapp_48123:home-dev',
  ])('rejects non-puppet sender %s', (value) => {
    expect(isWhatsAppPuppetSender(value)).toBe(false);
  });
});
