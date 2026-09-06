import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  backfillPrivateMedia,
  buildHealthPayload,
  buildImpersonatedIdTokenRequest,
  buildIngestPayload,
  classifyMatrixEventForRecovery,
  collectWhatsAppInviteRoomIds,
  collectPrivateWhatsAppEvents,
  createConfig,
  createHealthServer,
  createProcessingPlan,
  drainPendingMedia,
  enqueuePendingMedia,
  ensureRoomContextsForIncomingEvents,
  extractRoomContexts,
  fetchMatrixMedia,
  isIncomingWhatsAppMatrixEvent,
  prepareEventsForIngest,
  privateMediaUploadFailureCode,
  runSyncIteration,
  validateGoogleCredentialIdentity,
  validateIngestResponse,
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

test('OIDC minting requires the private-sync credential to target its exact self binding', () => {
  const expected = 'intexuraos-wa-private-sync-dev@example.iam.gserviceaccount.com';
  assert.doesNotThrow(() =>
    validateGoogleCredentialIdentity(
      {
        expectedGoogleServiceAccount: expected,
        oidcImpersonateServiceAccount: expected,
      },
      JSON.stringify({ type: 'service_account', client_email: expected })
    )
  );
  assert.throws(
    () =>
      validateGoogleCredentialIdentity(
        {
          expectedGoogleServiceAccount: expected,
          oidcImpersonateServiceAccount: expected,
        },
        JSON.stringify({
          type: 'service_account',
          client_email: 'admin@example.iam.gserviceaccount.com',
        })
      ),
    /google_credential_identity_mismatch/
  );
  for (const target of ['', 'other@example.iam.gserviceaccount.com']) {
    assert.throws(
      () =>
        validateGoogleCredentialIdentity(
          {
            expectedGoogleServiceAccount: expected,
            oidcImpersonateServiceAccount: target,
          },
          JSON.stringify({ type: 'service_account', client_email: expected })
        ),
      /google_credential_impersonation_target_mismatch/
    );
  }
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
          content: {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: '$reaction-target',
              key: '👍',
            },
          },
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
      {
        direction: 'incoming',
        type: 'reaction',
        text: '👍',
        reaction: { emoji: '👍', targetMatrixEventId: '$reaction-target' },
      },
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

test('collectPrivateWhatsAppEvents normalizes Matrix replacements to the target message', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: { events: [] },
            timeline: {
              events: [
                matrixMessage({
                  event_id: '$replacement',
                  content: {
                    msgtype: 'm.text',
                    body: '* corrected text',
                    'm.new_content': { msgtype: 'm.text', body: 'corrected text' },
                    'm.relates_to': {
                      rel_type: 'm.replace',
                      event_id: '$original',
                    },
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

  assert.deepEqual(events[0]?.message, {
    direction: 'incoming',
    type: 'text',
    text: 'corrected text',
    relation: {
      kind: 'replacement',
      targetMatrixEventId: '$original',
      applicationStatus: 'pending',
    },
  });
});

test('collectPrivateWhatsAppEvents normalizes Matrix redactions to the target message', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: { events: [] },
            timeline: {
              events: [
                matrixMessage({
                  type: 'm.room.redaction',
                  event_id: '$redaction',
                  redacts: '$original',
                  content: { reason: 'Message deleted for everyone on WhatsApp' },
                }),
              ],
            },
          },
        },
      },
    },
    config
  );

  assert.deepEqual(events[0]?.message, {
    direction: 'incoming',
    type: 'redaction',
    relation: {
      kind: 'redaction',
      targetMatrixEventId: '$original',
      applicationStatus: 'pending',
    },
  });
  assert.equal(events[0]?.message.type, 'redaction');
});

test('collectPrivateWhatsAppEvents normalizes Matrix reaction target metadata', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: { events: [] },
            timeline: {
              events: [
                matrixMessage({
                  type: 'm.reaction',
                  event_id: '$reaction',
                  content: {
                    'm.relates_to': {
                      rel_type: 'm.annotation',
                      event_id: '$original',
                      key: '👍',
                    },
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

  assert.deepEqual(events[0]?.message, {
    direction: 'incoming',
    type: 'reaction',
    text: '👍',
    reaction: {
      emoji: '👍',
      targetMatrixEventId: '$original',
    },
  });
});

test('collectPrivateWhatsAppEvents rejects incomplete and self-targeting context relations', () => {
  const events = collectPrivateWhatsAppEvents(
    {
      rooms: {
        join: {
          '!direct:home-dev': {
            state: { events: [] },
            timeline: {
              events: [
                matrixMessage({
                  event_id: '$self-replacement',
                  content: {
                    msgtype: 'm.text',
                    body: '* invalid',
                    'm.new_content': { msgtype: 'm.text', body: 'invalid' },
                    'm.relates_to': {
                      rel_type: 'm.replace',
                      event_id: '$self-replacement',
                    },
                  },
                }),
                matrixMessage({
                  event_id: '$missing-new-content',
                  content: {
                    msgtype: 'm.text',
                    body: '* invalid',
                    'm.relates_to': {
                      rel_type: 'm.replace',
                      event_id: '$original',
                    },
                  },
                }),
                matrixMessage({
                  type: 'm.room.redaction',
                  event_id: '$self-redaction',
                  redacts: '$self-redaction',
                  content: {},
                }),
                matrixMessage({
                  type: 'm.reaction',
                  event_id: '$incomplete-reaction',
                  content: {
                    'm.relates_to': {
                      rel_type: 'm.annotation',
                      key: '👍',
                    },
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

  assert.deepEqual(events, []);
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
    reaction: {
      emoji: 'ok',
      targetMatrixEventId: '$message-being-reacted-to',
    },
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

test('collectPrivateWhatsAppEvents maps WhatsApp events from joined and left rooms', () => {
  const syncResponse = {
    rooms: {
      join: {
        '!joined:home-dev': {
          state: { events: [] },
          timeline: { events: [matrixMessage({ event_id: '$joined' })] },
        },
      },
      leave: {
        '!left:home-dev': {
          state: { events: [] },
          timeline: { events: [matrixMessage({ event_id: '$left' })] },
        },
      },
    },
  };

  assert.deepEqual(
    collectPrivateWhatsAppEvents(syncResponse, config).map((event) => event.matrixEventId),
    ['$joined', '$left']
  );
});

test('createProcessingPlan refuses to advance across a limited joined or left timeline', () => {
  for (const membership of ['join', 'leave']) {
    const plan = createProcessingPlan(
      {
        next_batch: `s-${membership}`,
        rooms: {
          [membership]: {
            '!limited:home-dev': {
              state: { events: [] },
              timeline: {
                limited: true,
                prev_batch: 'older-events-exist',
                events: [matrixMessage({ event_id: `$${membership}` })],
              },
            },
          },
        },
      },
      config,
      { hasStoredBatch: true, roomContexts: {} }
    );

    assert.equal(plan.hasLimitedTimeline, true);
    assert.equal(plan.limitedTimelineCount, 1);
    assert.equal(plan.shouldPersistNextBatch, false);
    assert.deepEqual(plan.events, []);
  }
});

test('validateIngestResponse requires one successful result for every requested event', () => {
  const events = [{ matrixEventId: '$one' }, { matrixEventId: '$two' }];

  assert.doesNotThrow(() =>
    validateIngestResponse(
      {
        success: true,
        data: {
          accepted: 1,
          duplicates: 1,
          rejected: 0,
          messages: [
            { matrixEventId: '$one', outcome: 'created' },
            { matrixEventId: '$two', outcome: 'duplicate' },
          ],
        },
      },
      events
    )
  );

  for (const body of [
    {
      success: true,
      data: {
        accepted: 1,
        duplicates: 0,
        rejected: 1,
        messages: [
          { matrixEventId: '$one', outcome: 'created' },
          { matrixEventId: '$two', outcome: 'rejected' },
        ],
      },
    },
    {
      success: true,
      data: {
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        messages: [{ matrixEventId: '$one', outcome: 'created' }],
      },
    },
    {
      success: true,
      data: {
        accepted: 2,
        duplicates: 0,
        rejected: 0,
        messages: [
          { matrixEventId: '$one', outcome: 'created' },
          { matrixEventId: '$unexpected', outcome: 'created' },
        ],
      },
    },
  ]) {
    assert.throws(() => validateIngestResponse(body, events), /intexuraos_ingest_invalid_response/);
  }
});

test('private media upload failures retain only the safe typed API stage', () => {
  assert.equal(
    privateMediaUploadFailureCode(502, {
      success: false,
      error: { details: { reason: 'thumbnail_gcs_upload_failed' } },
    }),
    'intexuraos_private_media_upload_failed_502_thumbnail_gcs_upload_failed'
  );
  assert.equal(
    privateMediaUploadFailureCode(502, {
      success: false,
      error: { details: { reason: 'raw-private-id-must-not-pass' } },
    }),
    'intexuraos_private_media_upload_failed_502'
  );
  assert.equal(
    privateMediaUploadFailureCode(
      502,
      { success: false, error: { details: { reason: 'original_gcs_upload_failed' } } },
      'permission_denied'
    ),
    'intexuraos_private_media_upload_failed_502_original_gcs_upload_failed_permission_denied'
  );
  assert.equal(
    privateMediaUploadFailureCode(502, undefined, 'raw-private-id-must-not-pass'),
    'intexuraos_private_media_upload_failed_502'
  );
});

test('recovery classifier uses closed skip predicates and fails on malformed message-like events', () => {
  const roomContext = { memberDisplayNames: {} };
  assert.deepEqual(
    classifyMatrixEventForRecovery(
      '!room:home-dev',
      { type: 'm.room.name', state_key: '', content: { name: 'Private chat' } },
      roomContext,
      config
    ),
    { classification: 'policy_skip', reason: 'state_context_event' }
  );
  assert.deepEqual(
    classifyMatrixEventForRecovery(
      '!room:home-dev',
      { type: 'm.bridge', sender: '@whatsappbot:home-dev', content: {} },
      roomContext,
      config
    ),
    { classification: 'policy_skip', reason: 'bridge_control_event' }
  );
  assert.deepEqual(
    classifyMatrixEventForRecovery(
      '!room:home-dev',
      matrixMessage({ content: { msgtype: 'm.notice', body: 'bridge control' } }),
      roomContext,
      config
    ),
    { classification: 'policy_skip', reason: 'matrix_notice' }
  );
  assert.deepEqual(
    classifyMatrixEventForRecovery(
      '!room:home-dev',
      matrixMessage({
        type: 'm.reaction',
        event_id: '$redacted-reaction',
        content: {},
        unsigned: {
          redacted_by: '$reaction-redaction',
          redacted_because: {
            type: 'm.room.redaction',
            event_id: '$reaction-redaction',
          },
        },
      }),
      roomContext,
      config
    ),
    { classification: 'policy_skip', reason: 'redacted_reaction_tombstone' }
  );
  assert.deepEqual(
    classifyMatrixEventForRecovery(
      '!room:home-dev',
      matrixMessage({ sender: '@ordinary:home-dev' }),
      roomContext,
      config
    ),
    { classification: 'policy_skip', reason: 'explicit_non_whatsapp_sender' }
  );
  assert.deepEqual(
    classifyMatrixEventForRecovery(
      '!room:home-dev',
      matrixMessage({ type: 'm.room.encrypted' }),
      roomContext,
      config
    ),
    { classification: 'error', reason: 'encrypted_event' }
  );
  assert.deepEqual(
    classifyMatrixEventForRecovery(
      '!room:home-dev',
      matrixMessage({ content: { body: 'missing msgtype' } }),
      roomContext,
      config
    ),
    { classification: 'error', reason: 'malformed_message_like_event' }
  );
  const mapped = classifyMatrixEventForRecovery(
    '!room:home-dev',
    matrixMessage({ event_id: '$mapped' }),
    roomContext,
    config
  );
  assert.equal(mapped.classification, 'mapped');
  assert.equal(mapped.event.matrixEventId, '$mapped');

  const location = classifyMatrixEventForRecovery(
    '!room:home-dev',
    matrixMessage({
      event_id: '$location',
      content: { msgtype: 'm.location', body: 'Shared location', geo_uri: 'geo:0,0' },
    }),
    roomContext,
    config
  );
  assert.equal(location.classification, 'mapped');
  assert.equal(location.event.message.type, 'unknown');
  assert.equal(location.event.message.text, 'Shared location');

  const redactedTombstone = classifyMatrixEventForRecovery(
    '!room:home-dev',
    matrixMessage({
      event_id: '$redacted-original',
      content: {},
      unsigned: {
        redacted_by: '$redaction',
        redacted_because: { type: 'm.room.redaction', event_id: '$redaction' },
      },
    }),
    roomContext,
    config
  );
  assert.equal(redactedTombstone.classification, 'mapped');
  assert.equal(redactedTombstone.event.message.type, 'unknown');
  assert.equal(redactedTombstone.event.message.text, undefined);
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

test('runSyncIteration processes a room joined and left between syncs without post-leave state reads', async () => {
  const runtime = { state: 'starting', counters: {} };
  const posted = [];
  const writtenStates = [];

  await runSyncIteration(config, runtime, {
    readAccessToken: () => 'matrix-token',
    hasNonEmptyFile: () => true,
    readSyncState: async () => ({ nextBatch: 's0', roomContexts: {} }),
    fetchMatrixSync: async () => ({
      next_batch: 's1',
      rooms: {
        leave: {
          '!joined-and-left:home-dev': {
            state: {
              events: [
                { type: 'm.room.name', content: { name: 'Recovered leave room' } },
                { type: 'm.room.topic', content: { topic: 'WhatsApp private chat' } },
              ],
            },
            timeline: {
              limited: false,
              events: [matrixMessage({ event_id: '$final-before-leave' })],
            },
          },
        },
      },
    }),
    fetchMatrixRoomState: async () =>
      assert.fail('state must not be fetched after the Matrix user left the room'),
    postEventsInBatches: async (_config, events) => posted.push(...events),
    writeSyncState: async (_stateFile, state) => writtenStates.push(state),
    nowISOString: () => '2026-08-21T17:00:00.000Z',
  });

  assert.deepEqual(
    posted.map((event) => event.matrixEventId),
    ['$final-before-leave']
  );
  assert.equal(posted[0]?.chat.displayName, 'Recovered leave room');
  assert.equal(writtenStates.length, 1);
  assert.equal(writtenStates[0]?.nextBatch, 's1');
});

test('runSyncIteration persists metadata and cursor while retaining failed media for retry', async () => {
  const stateFile = await createTempStateFile({
    nextBatch: 'batch-1',
    roomContexts: {},
  });
  const pendingMediaFile = path.join(path.dirname(stateFile), 'pending-media.json');
  const postedBatches = [];
  const writtenStates = [];
  const runtime = { state: 'starting', counters: {} };

  await runSyncIteration(
    {
      ...config,
      stateFile,
      pendingMediaFile,
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
      postEventsInBatches: async (_config, events) => {
        postedBatches.push(events);
      },
      fetchMatrixMedia: async () => {
        throw new Error('matrix_media_download_failed_404');
      },
      checkPrivateMediaStored: async () => false,
      writeSyncState: async (_stateFile, state) => {
        writtenStates.push(state);
      },
    }
  );

  assert.equal(postedBatches.length, 1);
  assert.equal(postedBatches[0]?.[0]?.matrixEventId, '$image');
  assert.equal(postedBatches[0]?.[0]?.message.media.storageStatus, undefined);
  assert.equal(writtenStates[0]?.nextBatch, 'batch-2');
  const pending = JSON.parse(await fsp.readFile(pendingMediaFile, 'utf8'));
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0]?.matrixEventId, '$image');
  assert.equal(pending.items[0]?.attempts, 1);
  assert.equal(pending.items[0]?.lastError, 'matrix_media_download_failed_404');
  assert.equal(runtime.state, 'media_degraded');
});

test('pending media retry skips deterministic messages whose media is already stored', async () => {
  const stateFile = await createTempStateFile({ nextBatch: 's0' });
  const pendingMediaFile = path.join(path.dirname(stateFile), 'pending-media.json');
  const event = {
    matrixEventId: '$stored-media',
    message: {
      type: 'image',
      media: { mxcUri: 'mxc://home-dev/stored-media', mimeType: 'image/jpeg' },
    },
  };
  await enqueuePendingMedia(
    pendingMediaFile,
    config.sourceAccountId,
    [event],
    '2026-08-21T00:00:00.000Z'
  );

  const result = await drainPendingMedia({ ...config, pendingMediaFile }, 'matrix-token', {
    checkPrivateMediaStored: async (_config, messageId) => {
      assert.equal(messageId.length, 64);
      return true;
    },
    fetchMatrixMedia: async () => assert.fail('stored media must not be downloaded'),
    uploadPrivateMedia: async () => assert.fail('stored media must not be uploaded'),
    postPrivateMediaBackfill: async () => assert.fail('stored media must not be patched'),
    nowISOString: () => '2026-08-21T00:00:01.000Z',
  });

  assert.deepEqual(result, { stored: 1, failed: 0, pending: 0, unavailable: [] });
  assert.deepEqual(JSON.parse(await fsp.readFile(pendingMediaFile, 'utf8')).items, []);
});

test('pending media retry safely skips only unsupported PDFs and oversized Matrix media', async () => {
  const stateFile = await createTempStateFile({ nextBatch: 's0' });
  const pendingMediaFile = path.join(path.dirname(stateFile), 'pending-media.json');
  const events = [
    {
      matrixEventId: '$pdf',
      message: {
        type: 'file',
        media: { mxcUri: 'mxc://home-dev/pdf', mimeType: 'application/pdf' },
      },
    },
    {
      matrixEventId: '$oversized',
      message: {
        type: 'video',
        media: { mxcUri: 'mxc://home-dev/oversized', mimeType: 'video/mp4' },
      },
    },
    {
      matrixEventId: '$generic-400',
      message: {
        type: 'image',
        media: { mxcUri: 'mxc://home-dev/generic-400', mimeType: 'image/jpeg' },
      },
    },
  ];
  await enqueuePendingMedia(
    pendingMediaFile,
    config.sourceAccountId,
    events,
    '2026-08-21T00:00:00.000Z'
  );

  const recordedUnavailable = [];
  const result = await drainPendingMedia({ ...config, pendingMediaFile }, 'matrix-token', {
    checkPrivateMediaStored: async () => false,
    fetchMatrixMedia: async (_config, _token, mxcUri) => {
      if (mxcUri.endsWith('/pdf')) {
        assert.fail('known unsupported PDFs must not be downloaded');
      }
      if (mxcUri.endsWith('/oversized')) {
        throw new Error('matrix_media_too_large');
      }
      return { buffer: Buffer.from('image'), contentType: 'image/jpeg' };
    },
    uploadPrivateMedia: async () => {
      throw new Error('intexuraos_private_media_upload_failed_400');
    },
    postPrivateMediaBackfill: async () => assert.fail('failed media must not be patched'),
    recordMediaUnavailable: async (evidence) => recordedUnavailable.push(evidence),
    nowISOString: () => '2026-08-21T00:00:01.000Z',
  });

  const hash = (eventId) => createHash('sha256').update(eventId).digest('hex');
  assert.deepEqual(result, {
    stored: 0,
    failed: 1,
    pending: 1,
    unavailable: [
      { eventHash: hash('$pdf'), reason: 'unsupported_application_pdf' },
      { eventHash: hash('$oversized'), reason: 'matrix_media_too_large' },
    ],
  });
  assert.deepEqual(recordedUnavailable, result.unavailable);
  const pending = JSON.parse(await fsp.readFile(pendingMediaFile, 'utf8'));
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0]?.matrixEventId, '$generic-400');
  assert.equal(pending.items[0]?.lastError, 'intexuraos_private_media_upload_failed_400');
});

test('pending media retry keeps unavailable media queued until its evidence is durable', async () => {
  const stateFile = await createTempStateFile({ nextBatch: 's0' });
  const pendingMediaFile = path.join(path.dirname(stateFile), 'pending-media.json');
  await enqueuePendingMedia(
    pendingMediaFile,
    config.sourceAccountId,
    [
      {
        matrixEventId: '$pdf-evidence-write-fails',
        message: {
          type: 'file',
          media: { mxcUri: 'mxc://home-dev/pdf', mimeType: 'application/pdf' },
        },
      },
    ],
    '2026-08-21T00:00:00.000Z'
  );

  const result = await drainPendingMedia({ ...config, pendingMediaFile }, 'matrix-token', {
    checkPrivateMediaStored: async () => false,
    fetchMatrixMedia: async () => assert.fail('known unsupported PDFs must not be downloaded'),
    uploadPrivateMedia: async () => assert.fail('known unsupported PDFs must not be uploaded'),
    postPrivateMediaBackfill: async () => assert.fail('known unsupported PDFs must not be patched'),
    recordMediaUnavailable: async () => {
      throw new Error('recovery_manifest_write_failed');
    },
    nowISOString: () => '2026-08-21T00:00:01.000Z',
  });

  assert.deepEqual(result, { stored: 0, failed: 1, pending: 1, unavailable: [] });
  const pending = JSON.parse(await fsp.readFile(pendingMediaFile, 'utf8'));
  assert.equal(pending.items[0]?.lastError, 'recovery_manifest_write_failed');
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

test('runSyncIteration does not call Matrix or IntexuraOS while the recovery fence exists', async () => {
  const stateFile = await createTempStateFile({
    nextBatch: 'batch-1',
    roomContexts: {},
  });
  const runtime = { state: 'starting', counters: {} };

  let externalCall = false;
  await runSyncIteration(
    { ...config, stateFile, maintenanceFenceFile: '/data/recovery-required' },
    runtime,
    {
      hasMaintenanceFence: () => true,
      readAccessToken: () => {
        externalCall = true;
        return 'matrix-token';
      },
      fetchMatrixSync: async () => {
        externalCall = true;
        return {};
      },
    }
  );

  assert.equal(externalCall, false);
  assert.equal(runtime.state, 'recovery_required');
});

test('runSyncIteration fails closed before external work when Matrix credentials reuse a path or value', async () => {
  for (const testCase of [
    {
      matrixAccessTokenFile: '/run/secrets/shared-matrix-token',
      matrixOutboundAuthTokenFile: '/run/secrets/shared-matrix-token',
      tokens: { '/run/secrets/shared-matrix-token': 'shared-secret' },
    },
    {
      matrixAccessTokenFile: '/run/secrets/matrix-access-token',
      matrixOutboundAuthTokenFile: '/run/secrets/matrix-outbound-token',
      tokens: {
        '/run/secrets/matrix-access-token': 'shared-secret',
        '/run/secrets/matrix-outbound-token': 'shared-secret',
      },
    },
  ]) {
    const runtime = { state: 'starting', counters: {} };
    const guardedConfig = {
      ...config,
      matrixAccessTokenFile: testCase.matrixAccessTokenFile,
      matrixOutboundAuthTokenFile: testCase.matrixOutboundAuthTokenFile,
    };

    await assert.rejects(
      runSyncIteration(guardedConfig, runtime, {
        hasMaintenanceFence: () => false,
        readAccessToken: (filePath) => testCase.tokens[filePath] ?? '',
        hasNonEmptyFile: () => true,
        readSyncState: async () => {
          throw new Error('unexpected_external_call');
        },
      }),
      /matrix_credentials_not_distinct/
    );
    assert.equal(runtime.state, 'starting');
  }
});

test('a fenced adapter yields to its health server while making no external calls', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'whatsapp-sync-fence-'));
  const accessTokenFile = path.join(directory, 'matrix-access-token');
  const outboundAuthTokenFile = path.join(directory, 'matrix-outbound-auth-token');
  const credentialFile = path.join(directory, 'private-sync.json');
  const stateFile = path.join(directory, 'state.json');
  const pendingMediaFile = path.join(directory, 'pending-media.json');
  const maintenanceFenceFile = path.join(directory, 'recovery-required');
  await Promise.all([
    fsp.writeFile(accessTokenFile, 'matrix-token\n', { mode: 0o600 }),
    fsp.writeFile(outboundAuthTokenFile, 'adapter-secret\n', { mode: 0o600 }),
    fsp.writeFile(credentialFile, '{}\n', { mode: 0o600 }),
    fsp.writeFile(stateFile, '{"nextBatch":"s0","roomContexts":{}}\n', { mode: 0o600 }),
    fsp.writeFile(maintenanceFenceFile, '', { mode: 0o600 }),
  ]);

  const listener = http.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  const port = address.port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error === undefined ? resolve() : reject(error)))
  );

  let stderr = '';
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: {
      ...process.env,
      PORT: String(port),
      MATRIX_HOMESERVER_URL: 'http://127.0.0.1:1',
      MATRIX_USER_ID: '@pbuchman:home-dev',
      MATRIX_ACCESS_TOKEN_FILE: accessTokenFile,
      MATRIX_OUTBOUND_AUTH_TOKEN_FILE: outboundAuthTokenFile,
      INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL: 'http://127.0.0.1:1/private/events',
      INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE: credentialFile,
      INTEXURAOS_SOURCE_ACCOUNT_ID: 'private-account',
      SOURCE_WHATSAPP_PHONE_NUMBER: '48111222333',
      WHATSAPP_SYNC_STATE_FILE: stateFile,
      WHATSAPP_SYNC_PENDING_MEDIA_FILE: pendingMediaFile,
      WHATSAPP_SYNC_MAINTENANCE_FENCE_FILE: maintenanceFenceFile,
      WHATSAPP_SYNC_RETRY_DELAY_MS: '25',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  try {
    const deadline = Date.now() + 2_000;
    let response;
    while (Date.now() < deadline) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { authorization: 'Bearer adapter-secret' },
          signal: AbortSignal.timeout(150),
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    assert.notEqual(response, undefined, stderr || 'health server was starved by the sync loop');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      state: 'recovery_required',
      homeserverUrl: 'http://127.0.0.1:1',
      matrixUserId: '@pbuchman:home-dev',
      ingestUrl: 'http://127.0.0.1:1/private/events',
      sourceAccountId: 'private-account',
      counters: {},
    });
    await assert.rejects(fsp.access(pendingMediaFile));
    assert.equal(await fsp.readFile(stateFile, 'utf8'), '{"nextBatch":"s0","roomContexts":{}}\n');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
});

test('runSyncIteration never posts or advances a limited timeline', async () => {
  const stateFile = await createTempStateFile({
    nextBatch: 'batch-1',
    roomContexts: {},
  });
  const runtime = { state: 'starting', counters: {} };
  let postedEvents = false;
  let wroteState = false;

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
            leave: {
              '!room:home-dev': {
                state: { events: [] },
                timeline: {
                  events: [matrixMessage({ event_id: '$limited' })],
                  limited: true,
                  prev_batch: 'older-events-exist',
                },
              },
            },
          },
        }),
        fetchMatrixRoomState: async () =>
          assert.fail('limited timelines must stop before Matrix room-state reads'),
        postEventsInBatches: async () => {
          postedEvents = true;
        },
        writeSyncState: async () => {
          wroteState = true;
        },
      }
    ),
    /matrix_timeline_limited/
  );

  assert.equal(postedEvents, false);
  assert.equal(wroteState, false);
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
    hasLimitedTimeline: false,
    limitedTimelineCount: 0,
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

test('health rejects a missing Authorization header', async () => {
  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const harness = await createServerHarness({ matrixOutboundAuthTokenFile: authTokenFile });

  try {
    const response = await harness.request('/health');

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { ok: false, error: 'unauthorized' });
  } finally {
    await harness.close();
  }
});

test('health rejects Matrix homeserver credential reuse by path or token value', async () => {
  const sharedTokenFile = await createTempFile('shared-matrix-token.txt', 'shared-secret\n');
  const separateAccessTokenFile = await createTempFile(
    'separate-matrix-access-token.txt',
    'shared-secret\n'
  );
  const separateOutboundTokenFile = await createTempFile(
    'separate-matrix-outbound-token.txt',
    'shared-secret\n'
  );

  for (const configOverrides of [
    {
      matrixAccessTokenFile: sharedTokenFile,
      matrixOutboundAuthTokenFile: sharedTokenFile,
    },
    {
      matrixAccessTokenFile: separateAccessTokenFile,
      matrixOutboundAuthTokenFile: separateOutboundTokenFile,
    },
  ]) {
    const harness = await createServerHarness(configOverrides);
    try {
      const response = await harness.request('/health', {
        headers: { authorization: 'Bearer shared-secret' },
      });

      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { ok: false, error: 'unauthorized' });
    } finally {
      await harness.close();
    }
  }
});

test('health rejects missing, empty, unreadable, and whitespace-only auth token files', async () => {
  const missingTokenFile = path.join(
    await fsp.mkdtemp(path.join(os.tmpdir(), 'whatsapp-private-matrix-sync-')),
    'missing-token'
  );
  const emptyTokenFile = await createTempFile('empty-matrix-outbound-token.txt', '');
  const whitespaceTokenFile = await createTempFile(
    'whitespace-matrix-outbound-token.txt',
    ' \n\t '
  );
  const unreadableTokenFile = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'whatsapp-private-matrix-sync-unreadable-')
  );

  for (const authTokenFile of [
    missingTokenFile,
    emptyTokenFile,
    unreadableTokenFile,
    whitespaceTokenFile,
  ]) {
    const harness = await createServerHarness({ matrixOutboundAuthTokenFile: authTokenFile });
    try {
      const response = await harness.request('/health', {
        headers: { authorization: 'Bearer adapter-secret' },
      });

      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { ok: false, error: 'unauthorized' });
    } finally {
      await harness.close();
    }
  }
});

test('health bearer matching rejects whitespace and case changes', async () => {
  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const harness = await createServerHarness({ matrixOutboundAuthTokenFile: authTokenFile });

  try {
    for (const authorization of [
      'Bearer  adapter-secret',
      'Bearer\tadapter-secret',
      'bearer adapter-secret',
      'Bearer Adapter-secret',
    ]) {
      const response = await harness.request('/health', { headers: { authorization } });
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { ok: false, error: 'unauthorized' });
    }
  } finally {
    await harness.close();
  }
});

test('health returns its exact 200 schema with the authorized bearer', async () => {
  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const accessTokenFile = await createTempFile('matrix-access-token.txt', 'token\n');
  const credentialFile = await createTempFile('private-sync.json', '{}\n');
  const harness = await createServerHarness({
    matrixOutboundAuthTokenFile: authTokenFile,
    matrixAccessTokenFile: accessTokenFile,
    googleApplicationCredentialsFile: credentialFile,
  });
  harness.runtime.state = 'running';
  harness.runtime.counters = { postedEvents: 3 };

  try {
    const response = await harness.request('/health', {
      headers: { authorization: 'Bearer adapter-secret' },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      ok: true,
      state: 'running',
      homeserverUrl: 'http://synapse:8008',
      matrixUserId: '@pbuchman:home-dev',
      ingestUrl: 'https://intexuraos.cloud/internal/whatsapp/private/events',
      sourceAccountId: 'pbuchman-private-whatsapp',
      counters: { postedEvents: 3 },
    });
  } finally {
    await harness.close();
  }
});

test('health returns its exact 503 schema with the authorized bearer', async () => {
  const authTokenFile = await createTempFile('matrix-outbound-token.txt', 'adapter-secret\n');
  const accessTokenFile = await createTempFile('matrix-access-token.txt', 'token\n');
  const credentialFile = await createTempFile('private-sync.json', '{}\n');
  const harness = await createServerHarness({
    matrixOutboundAuthTokenFile: authTokenFile,
    matrixAccessTokenFile: accessTokenFile,
    googleApplicationCredentialsFile: credentialFile,
  });
  harness.runtime.state = 'recovery_required';
  harness.runtime.counters = { limitedTimelines: 2 };

  try {
    const response = await harness.request('/health', {
      headers: { authorization: 'Bearer adapter-secret' },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      ok: false,
      state: 'recovery_required',
      homeserverUrl: 'http://synapse:8008',
      matrixUserId: '@pbuchman:home-dev',
      ingestUrl: 'https://intexuraos.cloud/internal/whatsapp/private/events',
      sourceAccountId: 'pbuchman-private-whatsapp',
      counters: { limitedTimelines: 2 },
    });
  } finally {
    await harness.close();
  }
});

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
