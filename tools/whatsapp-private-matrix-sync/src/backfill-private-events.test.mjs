import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyRecoverySegment,
  assertRecoveryApplyIdentity,
  assertRecoveryVerificationEnvironment,
  discoverRecoverySegment,
  finalizeRecoveryState,
  main as runBackfillCli,
  mergeMediaUnavailableEvidence,
  paginateMatrixRoomMessages,
  verifyRecoveryEvidence,
} from './backfill-private-events.mjs';

const recoveryConfig = {
  matrixUserId: '@owner:home-dev',
  ownWhatsAppPhoneNumber: '48111222333',
  sourceAccountId: 'private-source',
  bridgeBotUsers: new Set(['@whatsappbot:home-dev']),
};

function matrixText(eventId, timestamp = 1782205200123) {
  return {
    type: 'm.room.message',
    event_id: eventId,
    sender: '@whatsapp_48536911713:home-dev',
    origin_server_ts: timestamp,
    content: { msgtype: 'm.text', body: 'private text' },
  };
}

test('Matrix pagination follows end tokens after empty chunks and rejects token loops', async () => {
  const calls = [];
  const pages = new Map([
    ['start', { chunk: [], end: 'after-empty' }],
    ['after-empty', { chunk: [{ event_id: '$one' }], end: 'done' }],
    ['done', { chunk: [{ event_id: '$two' }] }],
  ]);

  const events = await paginateMatrixRoomMessages({
    initialToken: 'start',
    direction: 'f',
    toToken: 'segment-end',
    fetchPage: async ({ fromToken }) => {
      calls.push(fromToken);
      return pages.get(fromToken);
    },
  });

  assert.deepEqual(calls, ['start', 'after-empty', 'done']);
  assert.deepEqual(
    events.map((event) => event.event_id),
    ['$one', '$two']
  );

  await assert.rejects(
    paginateMatrixRoomMessages({
      initialToken: 'loop',
      direction: 'b',
      fetchPage: async () => ({ chunk: [], end: 'loop' }),
    }),
    /matrix_pagination_token_loop/
  );
});

test('discover replays known limited room history, context, skips, and mapped events', async () => {
  const calls = [];
  const segment = await discoverRecoverySegment({
    name: 's0-s1',
    fromToken: 's0',
    syncResponse: {
      next_batch: 's1',
      rooms: {
        join: {
          '!known:home-dev': {
            state: {
              events: [
                {
                  type: 'm.room.topic',
                  state_key: '',
                  event_id: '$current-topic',
                  sender: '@owner:home-dev',
                  origin_server_ts: 25,
                  content: { topic: 'Private chat recovered from current sync state' },
                },
              ],
            },
            timeline: { limited: true, events: [matrixText('$visible', 30)] },
          },
        },
      },
    },
    stateRoomContexts: { '!known:home-dev': { memberDisplayNames: {} } },
    config: recoveryConfig,
    knownMessageIds: new Set(),
    fetchRoomMessages: async ({ roomId, fromToken, direction }) => {
      calls.push([roomId, fromToken, direction]);
      if (direction === 'f') {
        return { chunk: [matrixText('$forward', 20)] };
      }
      return {
        chunk: [
          {
            type: 'm.room.name',
            state_key: '',
            event_id: '$name',
            sender: '@owner:home-dev',
            origin_server_ts: 10,
            content: { name: 'Recovered room' },
          },
        ],
      };
    },
    joinRoom: async () => assert.fail('no invite should be joined'),
  });

  assert.deepEqual(calls, [
    ['!known:home-dev', 's0', 'f'],
    ['!known:home-dev', 's0', 'b'],
  ]);
  assert.deepEqual(
    segment.events.map((event) => event.matrixEventId),
    ['$forward', '$visible']
  );
  assert.equal(segment.roomContexts['!known:home-dev'].displayName, 'Recovered room');
  assert.equal(segment.roomContexts['!known:home-dev'].chatType, 'direct');
  assert.deepEqual(segment.skipCounts, { state_context_event: 2 });
  assert.deepEqual(segment.errors, []);
});

test('discover joins eligible WhatsApp invites and requires rediscovery from unchanged token', async () => {
  const joined = [];
  await assert.rejects(
    discoverRecoverySegment({
      name: 's0-s1',
      fromToken: 's0',
      syncResponse: {
        next_batch: 'discard-me',
        rooms: {
          invite: {
            '!invite:home-dev': {
              invite_state: {
                events: [
                  {
                    type: 'm.room.member',
                    sender: '@whatsappbot:home-dev',
                    state_key: '@owner:home-dev',
                    content: { membership: 'invite' },
                  },
                ],
              },
            },
          },
        },
      },
      stateRoomContexts: {},
      config: recoveryConfig,
      knownMessageIds: new Set(),
      fetchRoomMessages: async () => assert.fail('pagination must wait for rediscovery'),
      joinRoom: async (roomId) => joined.push(roomId),
    }),
    /eligible_invite_joined_rediscover/
  );
  assert.deepEqual(joined, ['!invite:home-dev']);
});

test('discover does not treat an owner-authored tail as WhatsApp room proof', async () => {
  await assert.rejects(
    discoverRecoverySegment({
      name: 's0-s1',
      fromToken: 's0',
      syncResponse: {
        next_batch: 's1',
        rooms: {
          join: {
            '!unproved:home-dev': {
              state: { events: [] },
              timeline: {
                limited: true,
                events: [{ ...matrixText('$owner-message', 10), sender: '@owner:home-dev' }],
              },
            },
          },
        },
      },
      stateRoomContexts: {},
      config: recoveryConfig,
      knownMessageIds: new Set(),
      fetchRoomMessages: async () => assert.fail('unproved limited room must stop'),
      joinRoom: async () => {},
    }),
    /recovery_unresolved_limited_room_eligibility/
  );
});

test('discover groups sanitized classifier errors by exact reason', async () => {
  const malformed = await discoverRecoverySegment({
    name: 's0-s1',
    fromToken: 's0',
    syncResponse: {
      next_batch: 's1',
      rooms: {
        join: {
          '!known:home-dev': {
            state: { events: [] },
            timeline: {
              limited: false,
              events: [{ ...matrixText('$malformed', 10), content: {} }],
            },
          },
        },
      },
    },
    stateRoomContexts: { '!known:home-dev': { memberDisplayNames: {} } },
    config: recoveryConfig,
    knownMessageIds: new Set(),
    fetchRoomMessages: async () => ({ chunk: [] }),
    joinRoom: async () => {},
  });
  assert.deepEqual(malformed.summary.errorCounts, { malformed_message_like_event: 1 });
  assert.equal(malformed.errors[0].eventHash, createHashForTest('$malformed'));
  assert.equal(JSON.stringify(malformed.errors).includes('$malformed'), false);
});

test('CLI discovers exactly S0 to S1 and then verified S1 to S2', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'wa-recovery-discover-'));
  const stateBackupFile = path.join(directory, 'state-s0.json');
  const manifestFile = path.join(directory, 'manifest.json');
  const tokenFile = path.join(directory, 'matrix-token');
  const fenceFile = path.join(directory, 'recovery-required');
  const knownRoom = '!known:home-dev';
  await fsp.writeFile(
    stateBackupFile,
    `${JSON.stringify({
      nextBatch: 's0',
      roomContexts: { [knownRoom]: { memberDisplayNames: {}, whatsappMemberCount: 1 } },
    })}\n`,
    { mode: 0o600 }
  );
  await fsp.writeFile(tokenFile, 'private-matrix-token\n', { mode: 0o600 });
  await fsp.writeFile(fenceFile, '', { mode: 0o600 });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/sync')) {
      const since = url.searchParams.get('since');
      const toToken = since === 's0' ? 's1' : since === 's1' ? 's2' : undefined;
      assert.notEqual(toToken, undefined);
      return new Response(
        JSON.stringify({
          next_batch: toToken,
          rooms: {
            join: {
              [knownRoom]: {
                state: { events: [] },
                timeline: {
                  limited: false,
                  events: [matrixText(`$${since}-${toToken}`, since === 's0' ? 10 : 20)],
                },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.pathname.includes('/messages')) {
      return new Response(JSON.stringify({ chunk: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  };

  const env = {
    MATRIX_HOMESERVER_URL: 'https://matrix.test',
    MATRIX_USER_ID: '@owner:home-dev',
    MATRIX_ACCESS_TOKEN_FILE: tokenFile,
    MATRIX_BRIDGE_BOT_USERS: '@whatsappbot:home-dev',
    INTEXURAOS_SOURCE_ACCOUNT_ID: 'private-source',
    WHATSAPP_SYNC_MAINTENANCE_FENCE_FILE: fenceFile,
  };
  try {
    await runBackfillCli(
      ['discover', '--manifest', manifestFile, '--state-backup', stateBackupFile],
      env
    );
    await assert.rejects(
      runBackfillCli(['discover', '--manifest', manifestFile], env),
      /recovery_first_segment_not_verified/
    );
    const failedSummary = JSON.parse(await fsp.readFile(`${manifestFile}.summary.json`, 'utf8'));
    assert.equal(failedSummary.ok, false);
    assert.equal(failedSummary.error, 'recovery_first_segment_not_verified');

    const afterFirst = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
    afterFirst.segments[0].applied = true;
    afterFirst.segments[0].verified = true;
    await fsp.writeFile(manifestFile, `${JSON.stringify(afterFirst)}\n`);

    await runBackfillCli(['discover', '--manifest', manifestFile], env);
    const afterSecond = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
    assert.deepEqual(
      afterSecond.segments.map((segment) => [segment.fromToken, segment.toToken]),
      [
        ['s0', 's1'],
        ['s1', 's2'],
      ]
    );
    assert.deepEqual(
      afterSecond.segments.map((segment) => segment.events[0].matrixEventId),
      ['$s0-s1', '$s1-s2']
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apply is idempotent, uses backfill batches, and drains media only after metadata', async () => {
  const trace = [];
  const unavailableEvidence = {
    eventHash: createHash('sha256').update('$two').digest('hex'),
    reason: 'unsupported_application_pdf',
  };
  const segment = {
    name: 's0-s1',
    events: [
      { matrixEventId: '$one', message: { type: 'text' } },
      {
        matrixEventId: '$two',
        message: { type: 'image', media: { mxcUri: 'mxc://home-dev/media' } },
      },
    ],
  };

  const first = await applyRecoverySegment(segment, {
    postBatch: async (events, deliveryMode) => {
      trace.push(['post', deliveryMode, events.length]);
      return { accepted: events.length, duplicates: 0, rejected: 0 };
    },
    enqueueMedia: async (events) => trace.push(['enqueue', events.length]),
    drainMedia: async () => {
      trace.push(['drain']);
      return { stored: 1, failed: 0, pending: 0, unavailable: [unavailableEvidence] };
    },
  });
  const retry = await applyRecoverySegment(segment, {
    postBatch: async (events, deliveryMode) => {
      trace.push(['post-retry', deliveryMode, events.length]);
      return { accepted: 0, duplicates: events.length, rejected: 0 };
    },
    enqueueMedia: async (events) => trace.push(['enqueue-retry', events.length]),
    drainMedia: async () => ({ stored: 0, failed: 0, pending: 0, unavailable: [] }),
  });

  assert.deepEqual(first, {
    accepted: 2,
    duplicates: 0,
    rejected: 0,
    mediaStored: 1,
    mediaPending: 0,
    mediaUnavailable: [unavailableEvidence],
  });
  assert.equal(retry.accepted, 0);
  assert.equal(retry.duplicates, 2);
  assert.deepEqual(trace.slice(0, 3), [['post', 'backfill', 2], ['enqueue', 2], ['drain']]);
});

test('media unavailable evidence is allowlisted and merged idempotently by event hash', () => {
  const pdfHash = createHash('sha256').update('$pdf').digest('hex');
  const oversizedHash = createHash('sha256').update('$oversized').digest('hex');
  const segment = {};

  mergeMediaUnavailableEvidence(segment, [
    { eventHash: pdfHash, reason: 'unsupported_application_pdf' },
  ]);
  mergeMediaUnavailableEvidence(segment, [
    { eventHash: pdfHash, reason: 'unsupported_application_pdf' },
    { eventHash: oversizedHash, reason: 'matrix_media_too_large' },
  ]);

  assert.deepEqual(
    segment.mediaUnavailableEvents,
    [
      { eventHash: pdfHash, reason: 'unsupported_application_pdf' },
      { eventHash: oversizedHash, reason: 'matrix_media_too_large' },
    ].sort((left, right) => left.eventHash.localeCompare(right.eventHash))
  );
  assert.deepEqual(
    segment.mediaUnavailableEventHashes,
    segment.mediaUnavailableEvents.map(({ eventHash }) => eventHash)
  );
  assert.throws(
    () =>
      mergeMediaUnavailableEvidence(segment, [
        { eventHash: '$raw-event-id', reason: 'unsupported_application_pdf' },
      ]),
    /recovery_media_unavailable_evidence_invalid/
  );
  assert.throws(
    () =>
      mergeMediaUnavailableEvidence(segment, [
        { eventHash: pdfHash, reason: 'intexuraos_private_media_upload_failed_400' },
      ]),
    /recovery_media_unavailable_evidence_invalid/
  );
});

test('apply retries transient ingest failures with bounded backoff and stops on non-retryable failures', async () => {
  const segment = {
    name: 's0-s1',
    events: [{ matrixEventId: '$one', message: { type: 'text' } }],
  };
  const delays = [];
  let attempts = 0;
  const result = await applyRecoverySegment(segment, {
    postBatch: async (events) => {
      attempts += 1;
      if (attempts === 1) throw new Error('intexuraos_ingest_failed_502');
      if (attempts === 2) throw new TypeError('fetch failed');
      return { accepted: events.length, duplicates: 0, rejected: 0 };
    },
    enqueueMedia: async () => {},
    drainMedia: async () => ({ stored: 0, failed: 0, pending: 0, unavailable: [] }),
    waitBeforeRetry: async (delayMs) => delays.push(delayMs),
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
  assert.equal(result.accepted, 1);

  let nonRetryableAttempts = 0;
  await assert.rejects(
    applyRecoverySegment(segment, {
      postBatch: async () => {
        nonRetryableAttempts += 1;
        throw new Error('intexuraos_ingest_failed_400');
      },
      enqueueMedia: async () => {},
      drainMedia: async () => ({ stored: 0, failed: 0, pending: 0, unavailable: [] }),
      waitBeforeRetry: async () => assert.fail('non-retryable failures must not wait'),
    }),
    /intexuraos_ingest_failed_400/
  );
  assert.equal(nonRetryableAttempts, 1);

  const exhaustedDelays = [];
  let exhaustedAttempts = 0;
  await assert.rejects(
    applyRecoverySegment(segment, {
      postBatch: async () => {
        exhaustedAttempts += 1;
        throw new Error('intexuraos_ingest_failed_503');
      },
      enqueueMedia: async () => {},
      drainMedia: async () => ({ stored: 0, failed: 0, pending: 0, unavailable: [] }),
      waitBeforeRetry: async (delayMs) => exhaustedDelays.push(delayMs),
    }),
    /intexuraos_ingest_failed_503/
  );
  assert.equal(exhaustedAttempts, 5);
  assert.deepEqual(exhaustedDelays, [1_000, 2_000, 4_000, 8_000]);
});

test('verification rejects file-backed, service-account, emulator, and wrong reader credentials', () => {
  const expected = 'wa-private-recovery-reader-dev@example.iam.gserviceaccount.com';
  const validAdc = { type: 'authorized_user' };
  assert.doesNotThrow(() =>
    assertRecoveryVerificationEnvironment(
      {},
      validAdc,
      expected,
      expected,
      'intexuraos-dev-pbuchman'
    )
  );

  for (const [env, adc, target, project] of [
    [
      { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' },
      validAdc,
      expected,
      'intexuraos-dev-pbuchman',
    ],
    [{ FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, validAdc, expected, 'intexuraos-dev-pbuchman'],
    [{ STORAGE_EMULATOR_HOST: 'localhost:9090' }, validAdc, expected, 'intexuraos-dev-pbuchman'],
    [{}, { type: 'service_account' }, expected, 'intexuraos-dev-pbuchman'],
    [{}, validAdc, 'admin@example.iam.gserviceaccount.com', 'intexuraos-dev-pbuchman'],
    [{}, validAdc, expected, 'other-project'],
  ]) {
    assert.throws(
      () => assertRecoveryVerificationEnvironment(env, adc, target, expected, project),
      /recovery_verification_environment_rejected/
    );
  }
});

test('apply requires the pinned private-sync credential and its exact self-scoped OIDC target', () => {
  const expected = 'intexuraos-wa-private-sync-dev@example.iam.gserviceaccount.com';
  const selfScopedConfig = {
    expectedGoogleServiceAccount: expected,
    googleApplicationCredentialsFile: '/run/secrets/private-sync-service-account.json',
    oidcImpersonateServiceAccount: expected,
  };
  assert.doesNotThrow(() =>
    assertRecoveryApplyIdentity(
      selfScopedConfig,
      JSON.stringify({ type: 'service_account', client_email: expected })
    )
  );
  assert.throws(
    () =>
      assertRecoveryApplyIdentity(
        selfScopedConfig,
        JSON.stringify({ type: 'service_account', client_email: 'wrong@example.com' })
      ),
    /google_credential_identity_mismatch/
  );
  assert.throws(
    () =>
      assertRecoveryApplyIdentity({ ...selfScopedConfig, expectedGoogleServiceAccount: '' }, '{}'),
    /recovery_apply_identity_not_pinned/
  );
  assert.throws(
    () =>
      assertRecoveryApplyIdentity(
        { ...selfScopedConfig, oidcImpersonateServiceAccount: '' },
        JSON.stringify({ type: 'service_account', client_email: expected })
      ),
    /google_credential_impersonation_target_mismatch/
  );
});

test('verify requires every deterministic message, relation target, stored media object, and counter', async () => {
  const textEvent = {
    matrixEventId: '$target',
    message: { type: 'text' },
  };
  const mediaEvent = {
    matrixEventId: '$media',
    message: {
      type: 'image',
      media: { mxcUri: 'mxc://home-dev/media' },
      relation: { targetMatrixEventId: '$target' },
    },
  };
  const ids = new Map(
    [textEvent, mediaEvent].map((event) => [
      event.matrixEventId,
      createHashForTest(`private-source\0${event.matrixEventId}`),
    ])
  );
  const documents = new Map([
    [
      ids.get('$target'),
      { matrixEventId: '$target', sourceAccountId: 'private-source', userId: 'user-1' },
    ],
    [
      ids.get('$media'),
      {
        matrixEventId: '$media',
        sourceAccountId: 'private-source',
        userId: 'user-1',
        relation: {
          targetMatrixEventId: '$target',
          targetMessageId: ids.get('$target'),
          applicationStatus: 'applied',
        },
        media: { storageStatus: 'stored', gcsPath: 'whatsapp/private/user/media.jpg' },
      },
    ],
  ]);
  const objectPaths = [];

  const result = await verifyRecoveryEvidence(
    { events: [textEvent, mediaEvent], mediaUnavailableEventHashes: [] },
    'private-source',
    'user-1',
    {
      fetchDocuments: async () => documents,
      verifyObject: async (gcsPath) => objectPaths.push(gcsPath),
      readCounters: async () => ({ accountMessageCount: 2, totalMessageCount: 2 }),
    }
  );

  assert.deepEqual(result, {
    messageCount: 2,
    relationTargetCount: 1,
    verifiedRelationCount: 1,
    storedMediaCount: 1,
    mediaUnavailableCount: 0,
    accountMessageCount: 2,
    totalMessageCount: 2,
  });
  assert.deepEqual(objectPaths, ['whatsapp/private/user/media.jpg']);

  await assert.rejects(
    verifyRecoveryEvidence({ events: [textEvent] }, 'private-source', 'user-1', {
      fetchDocuments: async () => new Map(),
      verifyObject: async () => {},
      readCounters: async () => ({ accountMessageCount: 0, totalMessageCount: 0 }),
    }),
    /recovery_verify_missing_documents/
  );
});

test('finalize atomically accepts exact S0 once and exact expected S2 on retry', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'wa-recovery-finalize-'));
  const stateFile = path.join(directory, 'state.json');
  const pendingMediaFile = path.join(directory, 'pending-media.json');
  const s0Bytes = Buffer.from(
    `${JSON.stringify({ nextBatch: 's0', roomContexts: { old: { displayName: 'old' } } }, null, 2)}\n`
  );
  await fsp.writeFile(stateFile, s0Bytes, { mode: 0o600 });
  await fsp.writeFile(pendingMediaFile, `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`, {
    mode: 0o600,
  });
  const manifest = {
    version: 1,
    s0StateBytesBase64: s0Bytes.toString('base64'),
    finalStateUpdatedAt: '2026-08-21T12:00:00.000Z',
    segments: [
      { name: 's0-s1', fromToken: 's0', toToken: 's1', verified: true },
      {
        name: 's1-s2',
        fromToken: 's1',
        toToken: 's2',
        verified: true,
        roomContexts: { final: { displayName: 'final' } },
      },
    ],
  };

  const first = await finalizeRecoveryState({ manifest, stateFile, pendingMediaFile });
  const retry = await finalizeRecoveryState({ manifest, stateFile, pendingMediaFile });
  assert.deepEqual(retry, first);
  assert.notEqual(first.oldStateHash, first.newStateHash);
  assert.equal((await fsp.stat(stateFile)).mode & 0o777, 0o600);

  await fsp.writeFile(stateFile, '{"nextBatch":"unexpected"}\n', { mode: 0o600 });
  await assert.rejects(
    finalizeRecoveryState({ manifest, stateFile, pendingMediaFile }),
    /recovery_finalize_unexpected_live_state/
  );
});

function createHashForTest(value) {
  return createHash('sha256').update(value).digest('hex');
}
