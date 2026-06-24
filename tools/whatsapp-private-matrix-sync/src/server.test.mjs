import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHealthPayload,
  buildImpersonatedIdTokenRequest,
  buildIngestPayload,
  collectWhatsAppInviteRoomIds,
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
