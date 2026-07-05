import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  backfillPrivateMedia,
  buildHealthPayload,
  buildImpersonatedIdTokenRequest,
  buildIngestPayload,
  collectWhatsAppInviteRoomIds,
  collectPrivateWhatsAppEvents,
  createConfig,
  createHealthServer,
  createProcessingPlan,
  ensureRoomContextsForIncomingEvents,
  extractRoomContexts,
  fetchMatrixMedia,
  isIncomingWhatsAppMatrixEvent,
  prepareEventsForIngest,
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

test('collectPrivateWhatsAppEvents maps finite positive Matrix image dimensions only', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: { events: [] },
            timeline: {
              events: [
                matrixMessage({
                  event_id: '$image-dimensions',
                  content: {
                    msgtype: 'm.image',
                    body: 'photo.jpg',
                    url: 'mxc://home-dev/image-dimensions',
                    info: { w: 640, h: 480 },
                  },
                }),
                matrixMessage({
                  event_id: '$image-invalid-dimensions',
                  content: {
                    msgtype: 'm.image',
                    body: 'broken.jpg',
                    url: 'mxc://home-dev/image-invalid-dimensions',
                    info: { w: Number.POSITIVE_INFINITY, h: 0 },
                  },
                }),
              ],
            },
          },
        },
      },
    },
    config
  );

  assert.deepEqual(events[0]?.message.media, {
    mxcUri: 'mxc://home-dev/image-dimensions',
    fileName: 'photo.jpg',
    width: 640,
    height: 480,
  });
  assert.deepEqual(events[1]?.message.media, {
    mxcUri: 'mxc://home-dev/image-invalid-dimensions',
    fileName: 'broken.jpg',
  });
});

test('fetchMatrixMedia rejects oversized responses before reading the body when content-length exceeds the adapter limit', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('image-bytes', {
      status: 200,
      headers: {
        'content-length': String(25 * 1024 * 1024 + 1),
        'content-type': 'image/jpeg',
      },
    });

  try {
    await assert.rejects(
      fetchMatrixMedia(config, 'matrix-token', 'mxc://home-dev/image-too-large'),
      /matrix_media_too_large/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchMatrixMedia rejects oversized responses while streaming when content-length is absent', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(25 * 1024 * 1024));
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
        },
      }
    );

  try {
    await assert.rejects(
      fetchMatrixMedia(config, 'matrix-token', 'mxc://home-dev/image-stream-too-large'),
      /matrix_media_too_large/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('collectPrivateWhatsAppEvents maps messages authored by the Matrix user as outgoing', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: {
              events: [
                { type: 'm.room.name', content: { name: 'Tomek (WA)' } },
                { type: 'm.room.topic', content: { topic: 'WhatsApp private chat' } },
              ],
            },
            timeline: {
              events: [
                {
                  type: 'm.room.message',
                  event_id: '$outgoing-from-matrix-user',
                  sender: '@pbuchman:home-dev',
                  origin_server_ts: 1782205300000,
                  content: { msgtype: 'm.text', body: 'sent from Element' },
                },
              ],
            },
          },
        },
      },
    },
    config
  );

  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.message, {
    direction: 'outgoing',
    type: 'text',
    text: 'sent from Element',
  });
  assert.equal(events[0]?.sender?.displayName, 'You');
});

test('collectPrivateWhatsAppEvents maps own WhatsApp number echoes as outgoing', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: {
              events: [
                { type: 'm.room.name', content: { name: 'Tomek (WA)' } },
                { type: 'm.room.topic', content: { topic: 'WhatsApp private chat' } },
              ],
            },
            timeline: {
              events: [
                matrixMessage({
                  event_id: '$outgoing-from-own-phone',
                  sender: '@whatsapp_48111222333:home-dev',
                  content: { msgtype: 'm.text', body: 'sent from mobile' },
                }),
              ],
            },
          },
        },
      },
    },
    config
  );

  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.message, {
    direction: 'outgoing',
    type: 'text',
    text: 'sent from mobile',
  });
  assert.equal(events[0]?.sender?.phoneNumber, '+48111222333');
});

test('collectPrivateWhatsAppEvents maps group rooms as one conversation with participant senders', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!group:home-dev': {
            state: {
              events: [
                { type: 'm.room.name', content: { name: 'Fishing Crew (WA)' } },
                { type: 'm.room.topic', content: { topic: 'WhatsApp group' } },
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_48536911713:home-dev',
                  content: { displayname: 'Piotrek (WA)' },
                },
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_48517277952:home-dev',
                  content: { displayname: 'Monika (WA)' },
                },
                {
                  type: 'm.room.member',
                  state_key: '@pbuchman:home-dev',
                  content: { displayname: 'Piotr' },
                },
              ],
            },
            timeline: {
              events: [
                matrixMessage({
                  event_id: '$group-piotrek',
                  sender: '@whatsapp_48536911713:home-dev',
                  content: { msgtype: 'm.text', body: 'Kto jedzie?' },
                }),
                matrixMessage({
                  event_id: '$group-monika',
                  sender: '@whatsapp_48517277952:home-dev',
                  content: { msgtype: 'm.text', body: 'Ja moge.' },
                }),
                {
                  type: 'm.room.message',
                  event_id: '$group-me',
                  sender: '@pbuchman:home-dev',
                  origin_server_ts: 1782205305000,
                  content: { msgtype: 'm.text', body: 'Tez bede.' },
                },
              ],
            },
          },
        },
      },
    },
    config
  );

  assert.deepEqual(
    events.map((event) => ({
      roomId: event.matrixRoomId,
      chat: event.chat,
      sender: event.sender,
      direction: event.message.direction,
      text: event.message.text,
    })),
    [
      {
        roomId: '!group:home-dev',
        chat: { type: 'group', displayName: 'Fishing Crew (WA)' },
        sender: { displayName: 'Piotrek (WA)', phoneNumber: '+48536911713' },
        direction: 'incoming',
        text: 'Kto jedzie?',
      },
      {
        roomId: '!group:home-dev',
        chat: { type: 'group', displayName: 'Fishing Crew (WA)' },
        sender: { displayName: 'Monika (WA)', phoneNumber: '+48517277952' },
        direction: 'incoming',
        text: 'Ja moge.',
      },
      {
        roomId: '!group:home-dev',
        chat: { type: 'group', displayName: 'Fishing Crew (WA)' },
        sender: { displayName: 'You' },
        direction: 'outgoing',
        text: 'Tez bede.',
      },
    ]
  );
});

test('collectPrivateWhatsAppEvents infers group rooms from WhatsApp member state when topic is missing', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!group-without-topic:home-dev': {
            state: {
              events: [
                { type: 'm.room.name', content: { name: 'Weekend Crew (WA)' } },
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_48111111111:home-dev',
                  content: { membership: 'join', displayname: 'One (WA)' },
                },
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_48222222222:home-dev',
                  content: { membership: 'join', displayname: 'Two (WA)' },
                },
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_48333333333:home-dev',
                  content: { membership: 'join', displayname: 'Three (WA)' },
                },
                {
                  type: 'm.room.member',
                  state_key: '@pbuchman:home-dev',
                  content: { membership: 'join', displayname: 'Piotr' },
                },
              ],
            },
            timeline: {
              events: [
                matrixMessage({
                  event_id: '$group-without-topic-message',
                  sender: '@whatsapp_48111111111:home-dev',
                  content: { msgtype: 'm.text', body: 'topic metadata is absent' },
                }),
              ],
            },
          },
        },
      },
    },
    config
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.chat.type, 'group');
  assert.equal(events[0]?.sender?.displayName, 'One (WA)');
});

test('collectPrivateWhatsAppEvents maps WhatsApp LID group sender events', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!lid-group:home-dev': {
            state: {
              events: [
                { type: 'm.room.name', content: { name: 'LID Crew (WA)' } },
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_lid-111111111111111:home-dev',
                  content: { membership: 'join', displayname: 'LID One (WA)' },
                },
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_lid-222222222222222:home-dev',
                  content: { membership: 'join', displayname: 'LID Two (WA)' },
                },
                {
                  type: 'm.room.member',
                  state_key: '@whatsapp_lid-333333333333333:home-dev',
                  content: { membership: 'join', displayname: 'LID Three (WA)' },
                },
              ],
            },
            timeline: {
              events: [
                matrixMessage({
                  event_id: '$lid-group-message',
                  sender: '@whatsapp_lid-111111111111111:home-dev',
                  content: { msgtype: 'm.text', body: 'lid sender message' },
                }),
              ],
            },
          },
        },
      },
    },
    config
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.chat.type, 'group');
  assert.equal(events[0]?.sender?.displayName, 'LID One (WA)');
  assert.equal(events[0]?.sender?.phoneNumber, undefined);
  assert.deepEqual(events[0]?.message, {
    direction: 'incoming',
    type: 'text',
    text: 'lid sender message',
  });
});

test('collectPrivateWhatsAppEvents keeps stale cached LID member counts from downgrading groups', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!stale-lid-group:home-dev': {
            timeline: {
              events: [
                {
                  type: 'm.reaction',
                  event_id: '$stale-lid-group-reaction',
                  sender: '@whatsapp_lid-111111111111111:home-dev',
                  origin_server_ts: 1782205200123,
                  content: {
                    'm.relates_to': {
                      rel_type: 'm.annotation',
                      event_id: '$message-being-reacted-to',
                      key: 'ok',
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    config,
    {
      '!stale-lid-group:home-dev': {
        chatType: 'unknown',
        whatsappMemberCount: 1,
        memberDisplayNames: {
          '@whatsapp_lid-111111111111111:home-dev': 'LID One (WA)',
          '@whatsapp_lid-222222222222222:home-dev': 'LID Two (WA)',
          '@whatsapp_lid-333333333333333:home-dev': 'LID Three (WA)',
        },
      },
    }
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.chat.type, 'group');
  assert.equal(events[0]?.sender?.displayName, 'LID One (WA)');
  assert.deepEqual(events[0]?.message, {
    direction: 'incoming',
    type: 'reaction',
    text: 'ok',
  });
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
      whatsappMemberCount: 1,
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

test('collectPrivateWhatsAppEvents ignores bridge bot and non-message events', () => {
  const ignoredEvents = [
    {
      type: 'm.room.message',
      event_id: '$from-bot',
      sender: '@whatsappbot:home-dev',
      origin_server_ts: 1782205200000,
      content: { msgtype: 'm.notice', body: 'bridge status' },
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

test('collectWhatsAppInviteRoomIds returns only WhatsApp bridge invites', () => {
  assert.deepEqual(
    collectWhatsAppInviteRoomIds(
      {
        rooms: {
          invite: {
            '!whatsapp:home-dev': {
              invite_state: {
                events: [
                  {
                    type: 'm.room.member',
                    sender: '@whatsappbot:home-dev',
                    state_key: '@pbuchman:home-dev',
                    content: { membership: 'invite' },
                  },
                ],
              },
            },
            '!bridge-event:home-dev': {
              invite_state: {
                events: [{ type: 'm.bridge', sender: '@someone:home-dev', content: {} }],
              },
            },
            '!ordinary:home-dev': {
              invite_state: {
                events: [
                  {
                    type: 'm.room.member',
                    sender: '@friend:home-dev',
                    state_key: '@pbuchman:home-dev',
                    content: { membership: 'invite' },
                  },
                ],
              },
            },
          },
        },
      },
      config
    ),
    ['!whatsapp:home-dev', '!bridge-event:home-dev']
  );
});

test('runSyncIteration joins WhatsApp invite rooms before processing joined timelines', async () => {
  const runtime = { state: 'starting', counters: {} };
  const joinedRoomIds = [];
  const postedBatches = [];
  const writtenStates = [];
  const syncResponses = [
    {
      next_batch: 's-invite',
      rooms: {
        invite: {
          '!business:home-dev': {
            invite_state: {
              events: [
                {
                  type: 'm.room.member',
                  sender: '@whatsappbot:home-dev',
                  state_key: '@pbuchman:home-dev',
                  content: { membership: 'invite' },
                },
              ],
            },
          },
          '!ordinary:home-dev': {
            invite_state: {
              events: [{ type: 'm.room.member', sender: '@friend:home-dev' }],
            },
          },
        },
      },
    },
    {
      next_batch: 's-joined',
      rooms: {
        join: {
          '!business:home-dev': {
            state: {
              events: [
                { type: 'm.room.name', content: { name: 'Test Number (WA)' } },
                { type: 'm.room.topic', content: { topic: 'WhatsApp private chat' } },
              ],
            },
            timeline: {
              events: [
                matrixMessage({
                  event_id: '$business-message',
                  sender: '@whatsapp_15551381846:home-dev',
                  content: { msgtype: 'm.text', body: 'prod marker' },
                }),
              ],
            },
          },
        },
      },
    },
  ];

  await runSyncIteration(config, runtime, {
    readAccessToken: () => 'matrix-token',
    hasNonEmptyFile: () => true,
    readSyncState: async () => ({ nextBatch: 's0' }),
    fetchMatrixSync: async () => syncResponses.shift(),
    fetchMatrixRoomState: async () => ({}),
    joinMatrixRoom: async (_config, _accessToken, roomId) => {
      joinedRoomIds.push(roomId);
      return { room_id: roomId };
    },
    postEventsInBatches: async (_config, events) => {
      postedBatches.push(events);
    },
    writeSyncState: async (_stateFile, state) => {
      writtenStates.push(state);
    },
    nowISOString: () => '2026-06-24T07:20:00.000Z',
  });

  assert.deepEqual(joinedRoomIds, ['!business:home-dev']);
  assert.equal(postedBatches.length, 1);
  assert.equal(postedBatches[0]?.length, 1);
  assert.equal(postedBatches[0]?.[0]?.matrixEventId, '$business-message');
  assert.equal(postedBatches[0]?.[0]?.chat.displayName, 'Test Number (WA)');
  assert.equal(writtenStates[0]?.nextBatch, 's-joined');
  assert.equal(runtime.counters.joinedRooms, 1);
  assert.equal(runtime.counters.syncResponses, 2);
  assert.equal(runtime.counters.postedEvents, 1);
});

test('runSyncIteration uploads new Matrix images before posting ingest events', async () => {
  const stateFile = await createTempStateFile({
    nextBatch: 'batch-1',
    roomContexts: {},
  });
  const postedBatches = [];
  const uploadedMedia = [];
  const runtime = { state: 'starting', counters: {} };

  await runSyncIteration(
    {
      ...config,
      stateFile,
      mediaUploadUrl: 'https://intexuraos.cloud/internal/whatsapp/private/media',
    },
    runtime,
    {
      readAccessToken: () => 'matrix-token',
      hasNonEmptyFile: () => true,
      fetchMatrixSync: async () => ({
        next_batch: 'batch-2',
        rooms: {
          join: {
            '!room:home-dev': {
              state: { events: [] },
              timeline: {
                events: [
                  matrixMessage({
                    event_id: '$image',
                    content: {
                      msgtype: 'm.image',
                      body: 'image.jpg',
                      url: 'mxc://home-dev/image',
                      info: { mimetype: 'image/jpeg', size: 11 },
                    },
                  }),
                ],
              },
            },
          },
        },
      }),
      fetchMatrixRoomState: async () => ({}),
      fetchMatrixMedia: async (_config, accessToken, mxcUri) => {
        assert.equal(accessToken, 'matrix-token');
        assert.equal(mxcUri, 'mxc://home-dev/image');
        return {
          buffer: Buffer.from('image-bytes'),
          contentType: 'image/jpeg',
        };
      },
      uploadPrivateMedia: async (_config, event, media, downloaded) => {
        uploadedMedia.push({ event, media, downloaded });
        return {
          mxcUri: media.mxcUri,
          mimeType: 'image/jpeg',
          fileName: 'image.jpg',
          sizeBytes: downloaded.buffer.length,
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user/message/image.jpg',
          thumbnailGcsPath: 'whatsapp/private/user/message/image_thumb.jpg',
          storedMimeType: 'image/jpeg',
          storedSizeBytes: downloaded.buffer.length,
          storedAt: '2026-06-26T10:00:00.000Z',
        };
      },
      postEventsInBatches: async (_config, events) => {
        postedBatches.push(events);
      },
    }
  );

  assert.equal(uploadedMedia.length, 1);
  assert.deepEqual(postedBatches[0]?.[0]?.message.media, {
    mxcUri: 'mxc://home-dev/image',
    mimeType: 'image/jpeg',
    fileName: 'image.jpg',
    sizeBytes: 'image-bytes'.length,
    storageStatus: 'stored',
    gcsPath: 'whatsapp/private/user/message/image.jpg',
    thumbnailGcsPath: 'whatsapp/private/user/message/image_thumb.jpg',
    storedMimeType: 'image/jpeg',
    storedSizeBytes: 'image-bytes'.length,
    storedAt: '2026-06-26T10:00:00.000Z',
  });
});

test('prepareEventsForIngest uploads new Matrix audio before posting ingest events', async () => {
  const prepared = await prepareEventsForIngest(
    config,
    'matrix-token',
    [
      {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$audio',
        matrixSenderId: '@whatsapp_48536911713:home-dev',
        eventTimestamp: '2026-06-26T10:00:00.000Z',
        chat: { type: 'direct' },
        message: {
          direction: 'incoming',
          type: 'audio',
          text: 'voice.ogg',
          media: {
            mxcUri: 'mxc://home-dev/audio',
            mimeType: 'audio/ogg',
            fileName: 'voice.ogg',
          },
        },
        rawMatrixEvent: {},
      },
    ],
    {
      fetchMatrixMedia: async (_config, accessToken, mxcUri) => {
        assert.equal(accessToken, 'matrix-token');
        assert.equal(mxcUri, 'mxc://home-dev/audio');
        return {
          buffer: Buffer.from('audio-bytes'),
          contentType: 'audio/ogg',
        };
      },
      uploadPrivateMedia: async (_config, event, media, downloaded) => {
        assert.equal(event.matrixEventId, '$audio');
        assert.equal(media.mxcUri, 'mxc://home-dev/audio');
        assert.equal(downloaded.contentType, 'audio/ogg');
        return {
          mxcUri: media.mxcUri,
          mimeType: 'audio/ogg',
          fileName: 'voice.ogg',
          sizeBytes: downloaded.buffer.length,
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user/message/audio.ogg',
          storedMimeType: 'audio/ogg',
          storedSizeBytes: downloaded.buffer.length,
          storedAt: '2026-06-26T10:00:00.000Z',
        };
      },
    }
  );

  assert.deepEqual(prepared[0]?.message.media, {
    mxcUri: 'mxc://home-dev/audio',
    mimeType: 'audio/ogg',
    fileName: 'voice.ogg',
    sizeBytes: 'audio-bytes'.length,
    storageStatus: 'stored',
    gcsPath: 'whatsapp/private/user/message/audio.ogg',
    storedMimeType: 'audio/ogg',
    storedSizeBytes: 'audio-bytes'.length,
    storedAt: '2026-06-26T10:00:00.000Z',
  });
});

test('prepareEventsForIngest uploads new Matrix video before posting ingest events', async () => {
  const prepared = await prepareEventsForIngest(
    config,
    'matrix-token',
    [
      {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$video',
        matrixSenderId: '@whatsapp_48536911713:home-dev',
        eventTimestamp: '2026-06-30T12:54:45.000Z',
        chat: { type: 'group' },
        message: {
          direction: 'incoming',
          type: 'video',
          text: 'video.mp4',
          media: {
            mxcUri: 'mxc://home-dev/video',
            mimeType: 'video/mp4',
            fileName: 'video.mp4',
          },
        },
        rawMatrixEvent: {},
      },
    ],
    {
      fetchMatrixMedia: async (_config, accessToken, mxcUri) => {
        assert.equal(accessToken, 'matrix-token');
        assert.equal(mxcUri, 'mxc://home-dev/video');
        return {
          buffer: Buffer.from('video-bytes'),
          contentType: 'video/mp4',
        };
      },
      uploadPrivateMedia: async (_config, event, media, downloaded) => {
        assert.equal(event.matrixEventId, '$video');
        assert.equal(media.mxcUri, 'mxc://home-dev/video');
        assert.equal(downloaded.contentType, 'video/mp4');
        return {
          mxcUri: media.mxcUri,
          mimeType: 'video/mp4',
          fileName: 'video.mp4',
          sizeBytes: downloaded.buffer.length,
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user/message/video.mp4',
          storedMimeType: 'video/mp4',
          storedSizeBytes: downloaded.buffer.length,
          storedAt: '2026-06-30T12:55:00.000Z',
        };
      },
    }
  );

  assert.deepEqual(prepared[0]?.message.media, {
    mxcUri: 'mxc://home-dev/video',
    mimeType: 'video/mp4',
    fileName: 'video.mp4',
    sizeBytes: 'video-bytes'.length,
    storageStatus: 'stored',
    gcsPath: 'whatsapp/private/user/message/video.mp4',
    storedMimeType: 'video/mp4',
    storedSizeBytes: 'video-bytes'.length,
    storedAt: '2026-06-30T12:55:00.000Z',
  });
});

test('backfillPrivateMedia uploads Matrix media and posts stored metadata to IntexuraOS', async () => {
  const calls = [];

  const result = await backfillPrivateMedia(
    {
      ...config,
      mediaBackfillUrl: 'https://intexuraos.cloud/internal/whatsapp/private/media/backfill',
    },
    {
      messageId: 'message:pbuchman-private-whatsapp:$event-private-audio-placeholder',
      media: {
        mxcUri: 'mxc://home-dev/private-audio-placeholder',
        mimeType: 'audio/ogg',
        fileName: 'Voice message.ogg',
      },
    },
    {
      readAccessToken: () => 'matrix-token',
      fetchMatrixMedia: async (_config, accessToken, mxcUri) => {
        calls.push({ step: 'fetch', accessToken, mxcUri });
        return {
          buffer: Buffer.from('audio-bytes'),
          contentType: 'audio/ogg',
        };
      },
      uploadPrivateMedia: async (_config, event, media, downloaded) => {
        calls.push({
          step: 'upload',
          matrixEventId: event.matrixEventId,
          media,
          bytes: downloaded.buffer.length,
        });
        return {
          mxcUri: media.mxcUri,
          mimeType: media.mimeType,
          fileName: media.fileName,
          sizeBytes: downloaded.buffer.length,
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/private-audio-placeholder/audio.ogg',
          storedMimeType: 'audio/ogg',
          storedSizeBytes: downloaded.buffer.length,
          storedAt: '2026-06-30T22:02:00.000Z',
        };
      },
      postPrivateMediaBackfill: async (_config, payload) => {
        calls.push({ step: 'backfill', payload });
        return {
          status: 'updated',
          transcriptionPublished: true,
        };
      },
    }
  );

  assert.deepEqual(result, {
    status: 'updated',
    transcriptionPublished: true,
  });
  assert.deepEqual(calls, [
    {
      step: 'fetch',
      accessToken: 'matrix-token',
      mxcUri: 'mxc://home-dev/private-audio-placeholder',
    },
    {
      step: 'upload',
      matrixEventId: '$event-private-audio-placeholder',
      media: {
        mxcUri: 'mxc://home-dev/private-audio-placeholder',
        mimeType: 'audio/ogg',
        fileName: 'Voice message.ogg',
      },
      bytes: 'audio-bytes'.length,
    },
    {
      step: 'backfill',
      payload: {
        sourceAccountId: 'pbuchman-private-whatsapp',
        messageId: 'message:pbuchman-private-whatsapp:$event-private-audio-placeholder',
        media: {
          mxcUri: 'mxc://home-dev/private-audio-placeholder',
          mimeType: 'audio/ogg',
          fileName: 'Voice message.ogg',
          sizeBytes: 'audio-bytes'.length,
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user-123/private-audio-placeholder/audio.ogg',
          storedMimeType: 'audio/ogg',
          storedSizeBytes: 'audio-bytes'.length,
          storedAt: '2026-06-30T22:02:00.000Z',
        },
      },
    },
  ]);
});

test('runSyncIteration does not persist Matrix state when image upload fails', async () => {
  const stateFile = await createTempStateFile({
    nextBatch: 'batch-1',
    roomContexts: {},
  });
  const runtime = { state: 'starting', counters: {} };

  await assert.rejects(
    runSyncIteration(
      {
        ...config,
        stateFile,
        mediaUploadUrl: 'https://intexuraos.cloud/internal/whatsapp/private/media',
      },
      runtime,
      {
        readAccessToken: () => 'matrix-token',
        hasNonEmptyFile: () => true,
        fetchMatrixSync: async () => ({
          next_batch: 'batch-2',
          rooms: {
            join: {
              '!room:home-dev': {
                state: { events: [] },
                timeline: {
                  events: [
                    matrixMessage({
                      event_id: '$image',
                      content: {
                        msgtype: 'm.image',
                        body: 'image.jpg',
                        url: 'mxc://home-dev/image',
                        info: { mimetype: 'image/jpeg' },
                      },
                    }),
                  ],
                },
              },
            },
          },
        }),
        fetchMatrixRoomState: async () => ({}),
        fetchMatrixMedia: async () => {
          throw new Error('matrix_media_download_failed_404');
        },
      }
    ),
    /matrix_media_download_failed_404/
  );

  const state = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
  assert.equal(state.nextBatch, 'batch-1');
});

test('runSyncIteration does not persist Matrix state when Matrix media exceeds the adapter byte limit', async () => {
  const stateFile = await createTempStateFile({
    nextBatch: 'batch-1',
    roomContexts: {},
  });
  const runtime = { state: 'starting', counters: {} };
  let postedEvents = false;
  let uploadedMedia = false;

  await assert.rejects(
    runSyncIteration(
      {
        ...config,
        stateFile,
        mediaUploadUrl: 'https://intexuraos.cloud/internal/whatsapp/private/media',
      },
      runtime,
      {
        readAccessToken: () => 'matrix-token',
        hasNonEmptyFile: () => true,
        fetchMatrixSync: async () => ({
          next_batch: 'batch-2',
          rooms: {
            join: {
              '!room:home-dev': {
                state: { events: [] },
                timeline: {
                  events: [
                    matrixMessage({
                      event_id: '$image-too-large',
                      content: {
                        msgtype: 'm.image',
                        body: 'image.jpg',
                        url: 'mxc://home-dev/image-too-large',
                        info: { mimetype: 'image/jpeg', size: 25 * 1024 * 1024 + 1 },
                      },
                    }),
                  ],
                },
              },
            },
          },
        }),
        fetchMatrixRoomState: async () => ({}),
        fetchMatrixMedia: async () => {
          throw new Error('matrix_media_too_large');
        },
        uploadPrivateMedia: async () => {
          uploadedMedia = true;
          throw new Error('should_not_upload_media');
        },
        postEventsInBatches: async () => {
          postedEvents = true;
        },
      }
    ),
    /matrix_media_too_large/
  );

  const state = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
  assert.equal(state.nextBatch, 'batch-1');
  assert.equal(uploadedMedia, false);
  assert.equal(postedEvents, false);
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

async function createTempStateFile(state) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'whatsapp-private-matrix-sync-'));
  const stateFile = path.join(tempDir, 'state.json');
  await fsp.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return stateFile;
}

async function createTempFile(name, contents) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'whatsapp-private-matrix-sync-'));
  const filePath = path.join(tempDir, name);
  await fsp.writeFile(filePath, contents, 'utf8');
  return filePath;
}

async function createServerHarness(configOverrides = {}) {
  const runtime = { state: 'starting', counters: {} };
  const config = {
    ...createConfig({
      PORT: '0',
      MATRIX_HOMESERVER_URL: 'http://synapse:8008',
      MATRIX_USER_ID: '@pbuchman:home-dev',
      MATRIX_ACCESS_TOKEN_FILE: '',
      INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL:
        'https://intexuraos.cloud/internal/whatsapp/private/events',
      INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE: '',
      INTEXURAOS_OIDC_AUDIENCE: 'https://intexuraos.cloud',
      INTEXURAOS_OIDC_IMPERSONATE_SERVICE_ACCOUNT:
        'intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
      INTEXURAOS_SOURCE_ACCOUNT_ID: 'pbuchman-private-whatsapp',
      WHATSAPP_SYNC_STATE_FILE: '/tmp/state.json',
    }),
    ...configOverrides,
  };
  const server = createHealthServer(config, runtime);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin =
    typeof address === 'object' && address !== null
      ? `http://127.0.0.1:${String(address.port)}`
      : null;
  assert.notEqual(origin, null);

  return {
    config,
    runtime,
    async request(pathname, init = {}) {
      const body =
        typeof init.body === 'string'
          ? init.body
          : init.body === undefined
            ? undefined
            : String(init.body);
      const response = await new Promise((resolve, reject) => {
        const request = http.request(
          `${origin}${pathname}`,
          {
            method: init.method ?? 'GET',
            headers: init.headers,
          },
          (result) => {
            const chunks = [];
            result.on('data', (chunk) => chunks.push(chunk));
            result.on('end', () =>
              resolve({
                status: result.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              })
            );
          }
        );
        request.on('error', reject);
        if (body !== undefined) {
          request.write(body);
        }
        request.end();
      });
      return {
        status: response.status,
        body: JSON.parse(response.body),
      };
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}

test('matrix outbound readiness requires adapter auth', async () => {
  const harness = await createServerHarness();

  try {
    const response = await harness.request(
      '/internal/matrix/outbound/readiness/pbuchman-private-whatsapp/intex_agent'
    );

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      ok: false,
      error: 'unauthorized',
    });
  } finally {
    await harness.close();
  }
});

test('matrix outbound readiness returns setup_required when targets config is missing', async () => {
  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const harness = await createServerHarness({
    matrixOutboundAuthTokenFile: authTokenFile,
    matrixOutboundTargetsFile: '/tmp/does-not-exist.json',
  });

  try {
    const response = await harness.request(
      '/internal/matrix/outbound/readiness/pbuchman-private-whatsapp/intex_agent',
      {
        headers: {
          authorization: 'Bearer adapter-secret',
        },
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: 'setup_required',
      reason: 'missing_matrix_outbound_targets',
    });
  } finally {
    await harness.close();
  }
});

test('matrix outbound readiness returns setup_required when source account mapping is missing', async () => {
  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const targetsFile = await createTempFile(
    'matrix-outbound-targets.json',
    `${JSON.stringify(
      {
        'someone-else-private-whatsapp': {
          intex_agent: '!agent:home-dev',
        },
      },
      null,
      2
    )}\n`
  );
  const harness = await createServerHarness({
    matrixOutboundAuthTokenFile: authTokenFile,
    matrixOutboundTargetsFile: targetsFile,
  });

  try {
    const response = await harness.request(
      '/internal/matrix/outbound/readiness/pbuchman-private-whatsapp/intex_agent',
      {
        headers: {
          authorization: 'Bearer adapter-secret',
        },
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: 'setup_required',
      reason: 'missing_matrix_outbound_source_account',
    });
  } finally {
    await harness.close();
  }
});

test('matrix outbound readiness returns ready without sending a Matrix event when mapping resolves', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    throw new Error(`unexpected_fetch:${JSON.stringify(args[0])}`);
  };

  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const accessTokenFile = await createTempFile('matrix-access-token.txt', 'matrix-user-token\n');
  const targetsFile = await createTempFile(
    'matrix-outbound-targets.json',
    `${JSON.stringify(
      {
        'pbuchman-private-whatsapp': {
          intex_agent: '!agent:home-dev',
        },
      },
      null,
      2
    )}\n`
  );
  const harness = await createServerHarness({
    matrixAccessTokenFile: accessTokenFile,
    matrixOutboundAuthTokenFile: authTokenFile,
    matrixOutboundTargetsFile: targetsFile,
  });

  try {
    const response = await harness.request(
      '/internal/matrix/outbound/readiness/pbuchman-private-whatsapp/intex_agent',
      {
        headers: {
          authorization: 'Bearer adapter-secret',
        },
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: 'ready',
    });
  } finally {
    globalThis.fetch = originalFetch;
    await harness.close();
  }
});

test('matrix outbound send returns setup_required when target mapping is missing', async () => {
  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const targetsFile = await createTempFile(
    'matrix-outbound-targets.json',
    `${JSON.stringify(
      {
        'pbuchman-private-whatsapp': {},
      },
      null,
      2
    )}\n`
  );
  const harness = await createServerHarness({
    matrixOutboundAuthTokenFile: authTokenFile,
    matrixOutboundTargetsFile: targetsFile,
  });

  try {
    const response = await harness.request('/internal/matrix/outbound/messages', {
      method: 'POST',
      headers: {
        authorization: 'Bearer adapter-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sourceAccountId: 'pbuchman-private-whatsapp',
        target: 'intex_agent',
        text: 'hello',
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: 'setup_required',
      reason: 'missing_matrix_outbound_target',
    });
  } finally {
    await harness.close();
  }
});

test('matrix outbound send posts Matrix text messages with the resolved room id and txn id', async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ event_id: '$matrix-event-1' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  };

  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const accessTokenFile = await createTempFile('matrix-access-token.txt', 'matrix-user-token\n');
  const targetsFile = await createTempFile(
    'matrix-outbound-targets.json',
    `${JSON.stringify(
      {
        'pbuchman-private-whatsapp': {
          intex_agent: '!agent:home-dev',
        },
      },
      null,
      2
    )}\n`
  );
  const harness = await createServerHarness({
    homeserverUrl: 'http://synapse:8008',
    matrixAccessTokenFile: accessTokenFile,
    matrixOutboundAuthTokenFile: authTokenFile,
    matrixOutboundTargetsFile: targetsFile,
  });

  try {
    const response = await harness.request('/internal/matrix/outbound/messages', {
      method: 'POST',
      headers: {
        authorization: 'Bearer adapter-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sourceAccountId: 'pbuchman-private-whatsapp',
        target: 'intex_agent',
        text: 'new session: Send me events that they have in the calendar in the next 24 hours.',
        idempotencyKey: 'calendar-daily-lookahead-2026-07-04',
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: 'sent',
      matrixEventId: '$matrix-event-1',
    });
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(fetchCalls[0], {
      url: 'http://synapse:8008/_matrix/client/v3/rooms/!agent%3Ahome-dev/send/m.room.message/calendar-daily-lookahead-2026-07-04',
      init: {
        method: 'PUT',
        headers: {
          authorization: 'Bearer matrix-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: 'new session: Send me events that they have in the calendar in the next 24 hours.',
        }),
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    await harness.close();
  }
});
