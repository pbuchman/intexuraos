import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHealthPayload,
  buildImpersonatedIdTokenRequest,
  buildIngestPayload,
  collectPrivateWhatsAppEvents,
  createConfig,
  createProcessingPlan,
  ensureRoomContextsForIncomingEvents,
  extractRoomContexts,
  isIncomingWhatsAppMatrixEvent,
  runSyncIteration,
} from './server.mjs';

const config = createConfig({
  PORT: '8099',
  MATRIX_HOMESERVER_URL: 'http://synapse:8008',
  MATRIX_USER_ID: '@pbuchman:home-dev',
  MATRIX_ACCESS_TOKEN_FILE: '/run/secrets/matrix-access-token',
  INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL:
    'https://intexuraos.cloud/internal/whatsapp/private/events',
  INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE: '/run/secrets/google-source-service-account.json',
  INTEXURAOS_OIDC_AUDIENCE: 'https://intexuraos.cloud',
  INTEXURAOS_OIDC_IMPERSONATE_SERVICE_ACCOUNT:
    'intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
  INTEXURAOS_SOURCE_ACCOUNT_ID: 'pbuchman-private-whatsapp',
  INTEXURAOS_USER_ID: 'pbuchman',
  SOURCE_WHATSAPP_PHONE_NUMBER: '48111222333',
  WHATSAPP_SYNC_STATE_FILE: '/data/state.json',
});

function matrixMessage(overrides = {}) {
  return {
    type: 'm.room.message',
    event_id: '$event',
    sender: '@whatsapp_48536911713:home-dev',
    origin_server_ts: 1782205200123,
    content: {
      msgtype: 'm.text',
      body: 'Pasuje mi',
    },
    ...overrides,
  };
}

test('buildImpersonatedIdTokenRequest requests email-bearing identity tokens for the allowed caller', () => {
  assert.deepEqual(buildImpersonatedIdTokenRequest(config, 'source-access-token'), {
    url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/intexuraos-wa-private-sync-dev%40intexuraos-dev-pbuchman.iam.gserviceaccount.com:generateIdToken',
    init: {
      method: 'POST',
      headers: {
        authorization: 'Bearer source-access-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audience: 'https://intexuraos.cloud',
        includeEmail: true,
      }),
    },
  });
});

test('collectPrivateWhatsAppEvents maps incoming Matrix WhatsApp text messages to production ingest events', () => {
  const syncResponse = {
    rooms: {
      join: {
        '!direct:home-dev': {
          state: {
            events: [
              {
                type: 'm.room.name',
                content: { name: '+48536911713 (WA)' },
              },
              {
                type: 'm.room.topic',
                content: { topic: 'WhatsApp private chat' },
              },
              {
                type: 'm.room.avatar',
                content: { url: 'mxc://home-dev/avatar' },
              },
              {
                type: 'm.room.member',
                state_key: '@whatsapp_48536911713:home-dev',
                content: { displayname: 'Piotrek (WA)' },
              },
            ],
          },
          timeline: {
            events: [
              {
                type: 'm.room.message',
                event_id: '$event-1',
                sender: '@whatsapp_48536911713:home-dev',
                origin_server_ts: 1782205200123,
                content: {
                  msgtype: 'm.text',
                  body: 'Pasuje mi',
                },
              },
            ],
          },
        },
      },
    },
  };

  const events = collectPrivateWhatsAppEvents(syncResponse, config);

  assert.deepEqual(events, [
    {
      matrixRoomId: '!direct:home-dev',
      matrixEventId: '$event-1',
      matrixSenderId: '@whatsapp_48536911713:home-dev',
      eventTimestamp: '2026-06-23T09:00:00.123Z',
      chat: {
        type: 'direct',
        displayName: '+48536911713 (WA)',
        avatarMxcUri: 'mxc://home-dev/avatar',
      },
      sender: {
        displayName: 'Piotrek (WA)',
        phoneNumber: '+48536911713',
      },
      message: {
        direction: 'incoming',
        type: 'text',
        text: 'Pasuje mi',
      },
      rawMatrixEvent: {
        type: 'm.room.message',
        event_id: '$event-1',
        sender: '@whatsapp_48536911713:home-dev',
        origin_server_ts: 1782205200123,
        content: {
          msgtype: 'm.text',
          body: 'Pasuje mi',
        },
      },
    },
  ]);
});

test('collectPrivateWhatsAppEvents maps Matrix media, emote, reaction, and sticker events', () => {
  const baseRoom = {
    state: { events: [] },
    timeline: {
      events: [
        matrixMessage({
          event_id: '$reaction',
          type: 'm.reaction',
          content: { 'm.relates_to': { key: '👍' } },
        }),
        matrixMessage({
          event_id: '$sticker',
          type: 'm.sticker',
          content: {
            body: 'Approved',
            url: 'mxc://home-dev/sticker',
            info: { mimetype: 'image/webp', size: 1234 },
          },
        }),
        matrixMessage({
          event_id: '$image',
          content: {
            msgtype: 'm.image',
            body: 'photo.jpg',
            url: 'mxc://home-dev/image',
            info: { mimetype: 'image/jpeg', size: 4567 },
          },
        }),
        matrixMessage({
          event_id: '$audio',
          content: {
            msgtype: 'm.audio',
            body: 'voice.ogg',
            file: { url: 'mxc://home-dev/audio' },
            info: { mimetype: 'audio/ogg' },
          },
        }),
        matrixMessage({
          event_id: '$video',
          content: {
            msgtype: 'm.video',
            body: 'clip.mp4',
            url: 'mxc://home-dev/video',
          },
        }),
        matrixMessage({
          event_id: '$file',
          content: {
            msgtype: 'm.file',
            body: 'report.pdf',
            filename: 'renamed-report.pdf',
            url: 'mxc://home-dev/file',
          },
        }),
        matrixMessage({
          event_id: '$emote',
          content: { msgtype: 'm.emote', body: 'waves' },
        }),
      ],
    },
  };

  const events = collectPrivateWhatsAppEvents(
    { rooms: { join: { '!direct:home-dev': baseRoom } } },
    config
  );

  assert.deepEqual(
    events.map((event) => event.message),
    [
      { direction: 'incoming', type: 'reaction', text: '👍' },
      {
        direction: 'incoming',
        type: 'sticker',
        text: 'Approved',
        media: {
          mxcUri: 'mxc://home-dev/sticker',
          mimeType: 'image/webp',
          sizeBytes: 1234,
          fileName: 'Approved',
        },
      },
      {
        direction: 'incoming',
        type: 'image',
        text: 'photo.jpg',
        media: {
          mxcUri: 'mxc://home-dev/image',
          mimeType: 'image/jpeg',
          sizeBytes: 4567,
          fileName: 'photo.jpg',
        },
      },
      {
        direction: 'incoming',
        type: 'audio',
        text: 'voice.ogg',
        media: {
          mxcUri: 'mxc://home-dev/audio',
          mimeType: 'audio/ogg',
          fileName: 'voice.ogg',
        },
      },
      {
        direction: 'incoming',
        type: 'video',
        text: 'clip.mp4',
        media: {
          mxcUri: 'mxc://home-dev/video',
          fileName: 'clip.mp4',
        },
      },
      {
        direction: 'incoming',
        type: 'file',
        text: 'report.pdf',
        media: {
          mxcUri: 'mxc://home-dev/file',
          fileName: 'renamed-report.pdf',
        },
      },
      { direction: 'incoming', type: 'text', text: 'waves' },
    ]
  );
});

test('isIncomingWhatsAppMatrixEvent accepts incoming reactions and stickers', () => {
  assert.equal(
    isIncomingWhatsAppMatrixEvent(
      matrixMessage({
        type: 'm.reaction',
        content: { 'm.relates_to': { key: '👍' } },
      }),
      config
    ),
    true
  );
  assert.equal(
    isIncomingWhatsAppMatrixEvent(
      matrixMessage({
        type: 'm.sticker',
        content: { body: 'Approved', url: 'mxc://home-dev/sticker' },
      }),
      config
    ),
    true
  );
});

test('extractRoomContexts merges state from sync rooms with existing context', () => {
  const roomContexts = extractRoomContexts(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: {
              events: [
                { type: 'm.room.name', content: { name: 'Private chat' } },
                { type: 'm.room.topic', content: { topic: 'WhatsApp group' } },
                { type: 'm.room.avatar', content: { url: 'mxc://home-dev/new-avatar' } },
              ],
            },
            timeline: {
              events: [
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_48536911713:home-dev',
                  content: { displayname: 'Piotrek (WA)' },
                },
              ],
            },
          },
        },
      },
    },
    {
      '!direct:home-dev': {
        avatarMxcUri: 'mxc://home-dev/old-avatar',
        memberDisplayNames: { '@whatsapp_48517277952:home-dev': 'Monika (WA)' },
      },
    }
  );

  assert.deepEqual(roomContexts, {
    '!direct:home-dev': {
      displayName: 'Private chat',
      chatType: 'group',
      avatarMxcUri: 'mxc://home-dev/new-avatar',
      memberDisplayNames: {
        '@whatsapp_48517277952:home-dev': 'Monika (WA)',
        '@whatsapp_48536911713:home-dev': 'Piotrek (WA)',
      },
    },
  });
});

test('ensureRoomContextsForIncomingEvents fetches Matrix state for new WhatsApp rooms before mapping', async () => {
  const syncResponse = {
    rooms: {
      join: {
        '!new-room:home-dev': {
          state: { events: [] },
          timeline: {
            events: [
              {
                type: 'm.room.message',
                event_id: '$event-new-room',
                sender: '@whatsapp_48517277952:home-dev',
                origin_server_ts: 1782207524000,
                content: { msgtype: 'm.text', body: '?' },
              },
            ],
          },
        },
      },
    },
  };
  const fetchedPaths = [];
  const fetchRoomState = async (roomId, stateType, stateKey) => {
    fetchedPaths.push({ roomId, stateType, stateKey });
    if (stateType === 'm.room.name') return { name: 'Monika (WA)' };
    if (stateType === 'm.room.topic') return { topic: 'WhatsApp private chat' };
    if (stateType === 'm.room.avatar') return { url: 'mxc://home-dev/avatar-monika' };
    if (stateType === 'm.room.member') return { displayname: 'Monika (WA)' };
    return {};
  };

  const roomContexts = await ensureRoomContextsForIncomingEvents(
    syncResponse,
    {},
    config,
    fetchRoomState
  );
  const events = collectPrivateWhatsAppEvents(syncResponse, config, roomContexts);

  assert.deepEqual(fetchedPaths, [
    { roomId: '!new-room:home-dev', stateType: 'm.room.name', stateKey: undefined },
    { roomId: '!new-room:home-dev', stateType: 'm.room.topic', stateKey: undefined },
    { roomId: '!new-room:home-dev', stateType: 'm.room.avatar', stateKey: undefined },
    {
      roomId: '!new-room:home-dev',
      stateType: 'm.room.member',
      stateKey: '@whatsapp_48517277952:home-dev',
    },
  ]);
  assert.equal(events[0]?.chat.displayName, 'Monika (WA)');
  assert.equal(events[0]?.chat.type, 'direct');
  assert.equal(events[0]?.chat.avatarMxcUri, 'mxc://home-dev/avatar-monika');
  assert.equal(events[0]?.sender?.displayName, 'Monika (WA)');
});

test('collectPrivateWhatsAppEvents ignores local user, bridge bot, own-number ghost, and non-message events', () => {
  const ignoredEvents = [
    {
      type: 'm.room.message',
      event_id: '$from-user',
      sender: '@pbuchman:home-dev',
      origin_server_ts: 1782205200000,
      content: { msgtype: 'm.text', body: 'outgoing from Element' },
    },
    {
      type: 'm.room.message',
      event_id: '$from-bot',
      sender: '@whatsappbot:home-dev',
      origin_server_ts: 1782205200000,
      content: { msgtype: 'm.notice', body: 'bridge status' },
    },
    {
      type: 'm.room.message',
      event_id: '$from-own-phone',
      sender: '@whatsapp_48111222333:home-dev',
      origin_server_ts: 1782205200000,
      content: { msgtype: 'm.text', body: 'sent from my mobile' },
    },
    {
      type: 'm.room.redaction',
      event_id: '$redaction',
      sender: '@whatsapp_48536911713:home-dev',
      origin_server_ts: 1782205200000,
      content: {},
    },
  ];

  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: { events: [] },
            timeline: { events: ignoredEvents },
          },
        },
      },
    },
    config
  );

  assert.deepEqual(events, []);
});

test('createConfig supports missing env defaults and configurable bridge bot users', () => {
  const defaults = createConfig({});

  assert.equal(defaults.port, 8099);
  assert.equal(defaults.homeserverUrl, '');
  assert.equal(defaults.matrixUserId, '');
  assert.equal(defaults.sourceAccountId, '');
  assert.equal(defaults.userId, '');
  assert.equal(defaults.ownWhatsAppPhoneNumber, '');
  assert.deepEqual(
    [...defaults.bridgeBotUsers],
    ['@whatsappbot:home-dev', '@whatsapp-sync:home-dev']
  );

  const custom = createConfig({
    MATRIX_BRIDGE_BOT_USERS: '@bridgebot:matrix.example, @syncbot:matrix.example',
  });

  assert.deepEqual(
    [...custom.bridgeBotUsers],
    ['@bridgebot:matrix.example', '@syncbot:matrix.example']
  );
  assert.equal(
    isIncomingWhatsAppMatrixEvent(matrixMessage({ sender: '@bridgebot:matrix.example' }), custom),
    false
  );
});

test('runSyncIteration surfaces Matrix sync, ingest API, and corrupted state errors', async () => {
  const runtime = { state: 'starting', counters: {} };
  const baseDeps = {
    readAccessToken: () => 'matrix-token',
    hasNonEmptyFile: () => true,
    readSyncState: async () => ({ nextBatch: 's0' }),
    fetchMatrixRoomState: async () => ({}),
    writeSyncState: async () => {},
  };

  await assert.rejects(
    runSyncIteration(config, runtime, {
      ...baseDeps,
      fetchMatrixSync: async () => {
        throw new Error('matrix_sync_failed_500');
      },
      postEventsInBatches: async () => {},
    }),
    /matrix_sync_failed_500/
  );

  await assert.rejects(
    runSyncIteration(config, runtime, {
      ...baseDeps,
      fetchMatrixSync: async () => ({
        next_batch: 's1',
        rooms: {
          join: {
            '!direct:home-dev': {
              state: { events: [] },
              timeline: { events: [matrixMessage()] },
            },
          },
        },
      }),
      postEventsInBatches: async () => {
        throw new Error('intexuraos_ingest_failed_503');
      },
    }),
    /intexuraos_ingest_failed_503/
  );

  await assert.rejects(
    runSyncIteration(config, runtime, {
      ...baseDeps,
      readSyncState: async () => {
        throw new SyntaxError('Unexpected token b in JSON at position 1');
      },
      fetchMatrixSync: async () => ({}),
      postEventsInBatches: async () => {},
    }),
    /Unexpected token/
  );
});

test('createProcessingPlan skips historical events on first sync but posts later batches', () => {
  const syncResponse = {
    next_batch: 's1',
    rooms: {
      join: {
        '!direct:home-dev': {
          state: { events: [] },
          timeline: {
            events: [
              {
                type: 'm.room.message',
                event_id: '$historical',
                sender: '@whatsapp_48536911713:home-dev',
                origin_server_ts: 1782205200000,
                content: { msgtype: 'm.text', body: 'old message' },
              },
            ],
          },
        },
      },
    },
  };

  assert.deepEqual(createProcessingPlan(syncResponse, config, { hasStoredBatch: false }), {
    nextBatch: 's1',
    events: [],
    shouldPersistNextBatch: true,
  });

  const laterPlan = createProcessingPlan(syncResponse, config, { hasStoredBatch: true });

  assert.equal(laterPlan.nextBatch, 's1');
  assert.equal(laterPlan.shouldPersistNextBatch, true);
  assert.equal(laterPlan.events.length, 1);
  assert.equal(laterPlan.events[0]?.matrixEventId, '$historical');
});

test('buildIngestPayload omits empty legacy user id', () => {
  const payload = buildIngestPayload({ sourceAccountId: 'private-wa-from-settings', userId: '' }, [
    { matrixEventId: '$event-1' },
  ]);

  assert.deepEqual(payload, {
    sourceAccountId: 'private-wa-from-settings',
    deliveryMode: 'live',
    events: [{ matrixEventId: '$event-1' }],
  });
});

test('buildHealthPayload reports credential readiness without exposing secrets', () => {
  assert.equal(
    buildHealthPayload(config, {
      hasMatrixAccessToken: false,
      hasOidcCredentials: true,
      runtimeState: 'starting',
      counters: {},
    }).state,
    'waiting_for_matrix_access_token'
  );

  assert.equal(
    buildHealthPayload(config, {
      hasMatrixAccessToken: true,
      hasOidcCredentials: false,
      runtimeState: 'starting',
      counters: {},
    }).state,
    'waiting_for_intexuraos_oidc_credentials'
  );

  assert.deepEqual(
    buildHealthPayload(config, {
      hasMatrixAccessToken: true,
      hasOidcCredentials: true,
      runtimeState: 'running',
      counters: { postedEvents: 3 },
    }),
    {
      ok: true,
      state: 'running',
      homeserverUrl: 'http://synapse:8008',
      matrixUserId: '@pbuchman:home-dev',
      ingestUrl: 'https://intexuraos.cloud/internal/whatsapp/private/events',
      sourceAccountId: 'pbuchman-private-whatsapp',
      counters: { postedEvents: 3 },
    }
  );
});
