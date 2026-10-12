import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as recovery from './backfill-private-events.mjs';
import { classifyMatrixEventForRecovery } from './server.mjs';

import {
  applyRecoverySegment,
  assertRecoveryApplyIdentity,
  assertRecoveryVerificationEnvironment,
  discoverRecoverySegment,
  discoverRecoverySegmentWithInviteRefresh,
  finalizeRecoveryState,
  main as runBackfillCli,
  mergeMediaUnavailableEvidence,
  mergeRelationTargetPolicySkipEvidence,
  paginateMatrixRoomMessages,
  parseRecoveryAnchorBefore,
  reviewMissingOperationMetadata,
  reviewPolicySkippedRelationTargets,
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

test('recovery anchor supports an explicit ISO cutoff and rejects malformed values', () => {
  assert.equal(parseRecoveryAnchorBefore('2026-08-22T12:00:00.000Z'), 1787400000000);
  assert.throws(
    () => parseRecoveryAnchorBefore('not-a-timestamp'),
    /recovery_anchor_before_invalid/
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

test('discover can exclude mapped events proven by a verified known-message list', async () => {
  const knownMessageId = createHash('sha256').update('private-source\0$known').digest('hex');
  const segment = await discoverRecoverySegment({
    name: 's0-s1',
    fromToken: 's0',
    syncResponse: {
      next_batch: 's1',
      rooms: {
        join: {
          '!known:home-dev': {
            state: { events: [] },
            timeline: { events: [matrixText('$known'), matrixText('$new')] },
          },
        },
      },
    },
    stateRoomContexts: { '!known:home-dev': { memberDisplayNames: {} } },
    config: recoveryConfig,
    knownMessageIds: new Set([knownMessageId]),
    excludeKnownMessageIds: true,
    fetchRoomMessages: async () => ({ chunk: [] }),
    joinRoom: async () => assert.fail('no invite should be joined'),
  });

  assert.deepEqual(
    segment.events.map((event) => event.matrixEventId),
    ['$new']
  );
  assert.equal(segment.summary.mappedCount, 1);
  assert.equal(segment.summary.excludedKnownMappedCount, 1);
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

test('discover refreshes from the temporary sync token after joining an invite', async () => {
  const joined = [];
  const refreshedFrom = [];
  const pagination = [];
  const segment = await discoverRecoverySegmentWithInviteRefresh({
    name: 's1-s2',
    fromToken: 's1',
    syncResponse: {
      next_batch: 'after-invite',
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
    refreshSync: async (since) => {
      refreshedFrom.push(since);
      return {
        next_batch: 's2',
        rooms: {
          join: {
            '!invite:home-dev': {
              state: { events: [] },
              timeline: { events: [matrixText('$after-join')] },
            },
          },
        },
      };
    },
    stateRoomContexts: {},
    config: recoveryConfig,
    knownMessageIds: new Set(),
    fetchRoomMessages: async ({ fromToken, toToken, direction }) => {
      pagination.push([fromToken, toToken, direction]);
      return { chunk: [] };
    },
    joinRoom: async (roomId) => joined.push(roomId),
  });

  assert.deepEqual(joined, ['!invite:home-dev']);
  assert.deepEqual(refreshedFrom, ['after-invite']);
  assert.deepEqual(pagination, [
    ['s1', 's2', 'f'],
    ['s1', undefined, 'b'],
  ]);
  assert.equal(segment.toToken, 's2');
  assert.deepEqual(
    segment.events.map((event) => event.matrixEventId),
    ['$after-join']
  );
});

test('invite rediscovery fails closed when Matrix repeats the temporary sync token', async () => {
  const stuckSync = {
    next_batch: 'stuck',
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
  };
  let joined = 0;
  let refreshed = 0;

  await assert.rejects(
    discoverRecoverySegmentWithInviteRefresh({
      name: 's1-s2',
      fromToken: 's1',
      syncResponse: stuckSync,
      refreshSync: async () => {
        refreshed += 1;
        return stuckSync;
      },
      stateRoomContexts: {},
      config: recoveryConfig,
      knownMessageIds: new Set(),
      fetchRoomMessages: async () => assert.fail('pagination must wait for rediscovery'),
      joinRoom: async () => {
        joined += 1;
      },
    }),
    /recovery_invite_rediscovery_token_loop/
  );
  assert.equal(joined, 2);
  assert.equal(refreshed, 1);
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

test('operation metadata repair replays only reviewed operations and does not requeue media', async () => {
  const repairEventId = '$legacy-relation';
  const repairEventHash = createHash('sha256').update(repairEventId).digest('hex');
  const posted = [];
  let enqueued = false;
  const result = await applyRecoverySegment(
    {
      events: [
        {
          matrixEventId: '$media',
          message: { type: 'image', media: { mxcUri: 'mxc://home-dev/media' } },
        },
        {
          matrixEventId: repairEventId,
          message: {
            type: 'text',
            relation: { kind: 'replacement', targetMatrixEventId: '$target' },
          },
        },
      ],
      operationMetadataRepairPending: true,
      operationMetadataRepairEventHashes: [repairEventHash],
    },
    {
      postBatch: async (events) => {
        posted.push(...events);
        return { accepted: 0, duplicates: events.length, rejected: 0 };
      },
      enqueueMedia: async () => {
        enqueued = true;
      },
      drainMedia: async () => ({ stored: 0, pending: 0, unavailable: [] }),
    }
  );

  assert.deepEqual(
    posted.map(({ matrixEventId }) => matrixEventId),
    [repairEventId]
  );
  assert.equal(enqueued, false);
  assert.equal(result.duplicates, 1);
  assert.equal(result.mediaPending, 0);
});

test('missing legacy operation metadata review returns only hash evidence and fails closed', async () => {
  const relationEventId = '$legacy-relation';
  const reactionEventId = '$resolved-reaction';
  const relationHash = createHash('sha256').update(relationEventId).digest('hex');
  const sourceAccountId = 'private-source';
  const segment = {
    events: [
      {
        matrixEventId: relationEventId,
        message: {
          type: 'text',
          relation: { kind: 'replacement', targetMatrixEventId: '$relation-target' },
        },
      },
      {
        matrixEventId: reactionEventId,
        message: {
          type: 'reaction',
          reaction: { emoji: 'x', targetMatrixEventId: '$reaction-target' },
        },
      },
    ],
  };
  const relationMessageId = createHashForTest(`${sourceAccountId}\0${relationEventId}`);
  const reactionMessageId = createHashForTest(`${sourceAccountId}\0${reactionEventId}`);
  const documents = new Map([
    [relationMessageId, { matrixEventId: relationEventId, sourceAccountId }],
    [
      reactionMessageId,
      {
        matrixEventId: reactionEventId,
        sourceAccountId,
        reaction: {
          targetMatrixEventId: '$reaction-target',
          targetMessageId: createHashForTest(`${sourceAccountId}\0$reaction-target`),
          applicationStatus: 'applied',
        },
      },
    ],
  ]);

  const review = await reviewMissingOperationMetadata(segment, sourceAccountId, {
    fetchDocuments: async () => documents,
  });
  assert.deepEqual(review, {
    reviewedOperationCount: 2,
    repairedEventCount: 1,
    eventHashes: [relationHash],
  });
  assert.equal(JSON.stringify(review).includes(relationEventId), false);

  documents.get(reactionMessageId).reaction = {
    targetMatrixEventId: '$wrong-target',
    targetMessageId: 'wrong-id',
    applicationStatus: 'applied',
  };
  await assert.rejects(
    reviewMissingOperationMetadata(segment, sourceAccountId, {
      fetchDocuments: async () => documents,
    }),
    /recovery_operation_metadata_review_blocked_1/
  );
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

test('reviewed policy-skipped relation targets are hashed, applied as terminal repairs, and idempotent', async () => {
  const sourceEventId = '$replacement';
  const targetEventId = '$notice';
  const eventHash = createHash('sha256').update(sourceEventId).digest('hex');
  const targetHash = createHash('sha256').update(targetEventId).digest('hex');
  const segment = {
    name: 's0-s1',
    applied: true,
    fromToken: 's0',
    toToken: 's1',
    events: [
      {
        matrixRoomId: '!room:home-dev',
        matrixEventId: sourceEventId,
        message: {
          type: 'text',
          relation: {
            kind: 'replacement',
            targetMatrixEventId: targetEventId,
            applicationStatus: 'pending',
          },
        },
      },
    ],
  };

  const reviewed = await reviewPolicySkippedRelationTargets(segment, 'private-source', {
    fetchDocuments: async (messageIds) =>
      new Map([
        [
          messageIds[0],
          {
            matrixEventId: sourceEventId,
            sourceAccountId: 'private-source',
            userId: 'user-1',
          },
        ],
      ]),
    fetchMatrixEvent: async () => ({ event_id: targetEventId, type: 'm.room.message' }),
    classifyTarget: () => ({ classification: 'policy_skip', reason: 'matrix_notice' }),
  });

  assert.deepEqual(reviewed, {
    reviewedTargetCount: 1,
    repairedEventCount: 1,
  });
  assert.deepEqual(segment.relationTargetPolicySkips, [
    { eventHash, targetHash, reason: 'matrix_notice' },
  ]);
  mergeRelationTargetPolicySkipEvidence(segment, [
    { eventHash, targetHash, reason: 'matrix_notice' },
  ]);
  assert.equal(segment.relationTargetPolicySkips.length, 1);

  let posted;
  await applyRecoverySegment(segment, {
    sourceAccountId: 'private-source',
    postBatch: async (events) => {
      posted = events;
      return { accepted: 0, duplicates: events.length, rejected: 0 };
    },
    enqueueMedia: async () => {},
    drainMedia: async () => ({ stored: 0, pending: 0, unavailable: [] }),
  });
  assert.equal(posted[0].message.relation.targetUnavailableReason, 'matrix_notice');
  assert.equal(segment.events[0].message.relation.targetUnavailableReason, undefined);
});

test('relation target review fails closed for mapped, unavailable, and unapproved skip targets', async () => {
  const segment = {
    applied: true,
    events: [
      {
        matrixRoomId: '!room:home-dev',
        matrixEventId: '$reaction',
        message: {
          type: 'reaction',
          reaction: { emoji: 'x', targetMatrixEventId: '$target' },
        },
      },
    ],
  };
  const base = {
    fetchDocuments: async (messageIds) =>
      new Map([[messageIds[0], { matrixEventId: '$reaction', sourceAccountId: 'private-source' }]]),
    fetchMatrixEvent: async () => ({ event_id: '$target' }),
  };
  for (const classified of [
    { classification: 'mapped', event: {} },
    { classification: 'error', reason: 'encrypted_event' },
    { classification: 'policy_skip', reason: 'explicit_non_whatsapp_sender' },
  ]) {
    await assert.rejects(
      reviewPolicySkippedRelationTargets(segment, 'private-source', {
        ...base,
        classifyTarget: () => classified,
      }),
      /recovery_relation_target_review_blocked_1/
    );
  }
});

function policyRepairFixture() {
  const segment = {
    name: 's0-s1',
    fromToken: 's0',
    toToken: 's1',
    applied: true,
    verified: true,
    verification: { messageCount: 4 },
    lastApply: { accepted: 4, duplicates: 0, mediaStored: 1, mediaPending: 0 },
    mediaUnavailableEvents: [],
    mediaUnavailableEventHashes: [],
    events: [
      { matrixEventId: '$unrelated', message: { type: 'text' } },
      {
        matrixEventId: '$media',
        message: { type: 'image', media: { mxcUri: 'mxc://fixture/media' } },
      },
      {
        matrixRoomId: '!fixture:home-dev',
        matrixEventId: '$replacement',
        message: {
          type: 'text',
          relation: { kind: 'replacement', targetMatrixEventId: '$notice' },
        },
      },
      {
        matrixRoomId: '!fixture:home-dev',
        matrixEventId: '$reaction',
        message: { type: 'reaction', reaction: { emoji: 'x', targetMatrixEventId: '$tombstone' } },
      },
    ],
  };
  const documents = new Map(
    segment.events.map((event) => [
      createHashForTest(`private-source\0${event.matrixEventId}`),
      { matrixEventId: event.matrixEventId, sourceAccountId: 'private-source', userId: 'user-1' },
    ])
  );
  const requested = [];
  const classifiedTargets = [];
  const deps = {
    userId: 'user-1',
    fetchDocuments: async (messageIds) => {
      requested.push(...messageIds);
      return documents;
    },
    fetchMatrixEvent: async (roomId, eventId) => ({
      event_id: eventId,
      room_id: roomId,
      type: eventId === '$notice' ? 'm.room.message' : 'm.reaction',
      content: eventId === '$notice' ? { msgtype: 'm.notice' } : {},
      ...(eventId === '$notice'
        ? {}
        : {
            unsigned: {
              redacted_by: '$fixture-redaction',
              redacted_because: { type: 'm.room.redaction', event_id: '$fixture-redaction' },
            },
          }),
    }),
    classifyTarget: (roomId, event) => {
      classifiedTargets.push([roomId, event.event_id]);
      return classifyMatrixEventForRecovery(
        roomId,
        event,
        { memberDisplayNames: {} },
        recoveryConfig
      );
    },
  };
  return { segment, documents, requested, classifiedTargets, deps };
}

test('policy review stages only new operations after a complete apply and preserves full provenance', async () => {
  const fixture = policyRepairFixture();
  const { segment } = fixture;
  const originalEvents = structuredClone(segment.events);
  const originalApply = structuredClone(segment.lastApply);
  mergeRelationTargetPolicySkipEvidence(segment, [
    {
      eventHash: createHashForTest('$replacement'),
      targetHash: createHashForTest('$notice'),
      reason: 'matrix_notice',
    },
  ]);
  const review = await reviewPolicySkippedRelationTargets(segment, 'private-source', fixture.deps);

  assert.deepEqual(review, { reviewedTargetCount: 2, repairedEventCount: 1 });
  assert.equal(segment.policyRelationRepairPending, true);
  assert.deepEqual(segment.policyRelationRepairProof.eventHashes, [createHashForTest('$reaction')]);
  assert.equal(segment.operationMetadataRepairPending, undefined);
  assert.equal(segment.applied, true);
  assert.equal(segment.verified, undefined);
  assert.equal(segment.verification, undefined);
  assert.deepEqual(segment.lastApply, originalApply);
  assert.deepEqual(segment.events, originalEvents);
  assert.equal(fixture.requested.length, 6);
  assert.equal(fixture.classifiedTargets.length, 2);

  const posted = [];
  const result = await applyRecoverySegment(segment, {
    sourceAccountId: 'private-source',
    postBatch: async (events, deliveryMode) => {
      assert.equal(deliveryMode, 'backfill');
      posted.push(...events);
      return { accepted: 0, duplicates: events.length, rejected: 0 };
    },
    enqueueMedia: async () => assert.fail('policy repair must not enqueue the full media segment'),
    drainMedia: async () => ({ stored: 0, pending: 0, unavailable: [] }),
  });
  assert.deepEqual(
    posted.map(({ matrixEventId }) => matrixEventId),
    ['$reaction']
  );
  assert.equal(posted[0].message.reaction.targetUnavailableReason, 'redacted_reaction_tombstone');
  assert.equal(result.duplicates, 1);
  assert.deepEqual(segment.events, originalEvents);
});

test('policy review refuses incomplete applies, conflicting repairs and missing or misclassified evidence without staging', async () => {
  for (const scenario of [
    'not-applied',
    'metadata-pending',
    'main-missing',
    'identity',
    'wrong-target',
    'classification',
    'fetch-failed',
  ]) {
    const fixture = policyRepairFixture();
    if (scenario === 'not-applied') fixture.segment.applied = false;
    if (scenario === 'metadata-pending') fixture.segment.operationMetadataRepairPending = true;
    if (scenario === 'main-missing')
      fixture.documents.delete(createHashForTest('private-source\0$media'));
    if (scenario === 'identity')
      fixture.documents.get(createHashForTest('private-source\0$media')).userId = 'foreign-user';
    if (scenario === 'wrong-target')
      fixture.deps.fetchMatrixEvent = async () => ({ event_id: '$different' });
    if (scenario === 'classification')
      fixture.deps.classifyTarget = () => ({ classification: 'mapped' });
    if (scenario === 'fetch-failed')
      fixture.deps.fetchMatrixEvent = async () => {
        throw new Error('fixture_matrix_unavailable');
      };
    const before = structuredClone(fixture.segment);
    await assert.rejects(
      reviewPolicySkippedRelationTargets(fixture.segment, 'private-source', fixture.deps)
    );
    assert.deepEqual(fixture.segment, before, scenario);
  }
});

test('policy repair proof rejects stale segment, evidence, foreign, duplicate, malformed and unused hashes before writes', async () => {
  const mutations = [
    (segment) => {
      segment.events[0].message.text = 'changed';
    },
    (segment) => {
      segment.fromToken = 'different';
    },
    (segment) => {
      segment.lastApply.mediaStored = 2;
    },
    (segment) => {
      segment.mediaUnavailableEventHashes.push(createHashForTest('$media'));
    },
    (segment) => {
      segment.relationTargetPolicySkips[0].reason = 'redacted_reaction_tombstone';
    },
    (segment) => {
      segment.policyRelationRepairProof.eventHashes = ['$raw-id'];
    },
    (segment) => {
      segment.policyRelationRepairProof.eventHashes.push(
        segment.policyRelationRepairProof.eventHashes[0]
      );
    },
    (segment) => {
      segment.policyRelationRepairProof.eventHashes = [createHashForTest('$foreign')];
      resignPolicyRepairSelection(segment);
    },
    (segment) => {
      segment.policyRelationRepairProof.eventHashes = [createHashForTest('$media')];
      resignPolicyRepairSelection(segment);
    },
    (segment) => {
      segment.policyRelationRepairProof.proofHash = '0'.repeat(64);
    },
    (segment) => {
      segment.policyRelationRepairProof = undefined;
    },
    (segment) => {
      segment.operationMetadataRepairPending = true;
    },
    (segment) => {
      segment.applied = false;
    },
  ];
  for (const mutate of mutations) {
    const fixture = policyRepairFixture();
    await reviewPolicySkippedRelationTargets(fixture.segment, 'private-source', fixture.deps);
    mutate(fixture.segment);
    let writes = 0;
    await assert.rejects(
      applyRecoverySegment(fixture.segment, {
        sourceAccountId: 'private-source',
        postBatch: async () => {
          writes += 1;
          return {};
        },
        enqueueMedia: async () => {
          writes += 1;
        },
        drainMedia: async () => {
          writes += 1;
          return {};
        },
      })
    );
    assert.equal(writes, 0);
  }
  const fixture = policyRepairFixture();
  await reviewPolicySkippedRelationTargets(fixture.segment, 'private-source', fixture.deps);
  await assert.rejects(
    applyRecoverySegment(fixture.segment, {
      sourceAccountId: 'foreign-source',
      postBatch: async () => assert.fail('foreign source must not post'),
    })
  );
});

function resignPolicyRepairSelection(segment) {
  const { proofHash, ...proof } = segment.policyRelationRepairProof;
  assert.equal(typeof proofHash, 'string');
  segment.policyRelationRepairProof.proofHash = createHashForTest(JSON.stringify(proof));
}

test('policy repair records a separate successful outcome, retains pending on failures and retries deterministically', async () => {
  assert.equal(typeof recovery.recordRecoveryApplyResult, 'function');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'wa-policy-retry-'));
  try {
    const stateFile = path.join(directory, 'state.json');
    const s0Bytes = Buffer.from('{"nextBatch":"s0"}\n');
    await fsp.writeFile(stateFile, s0Bytes, { mode: 0o600 });
    const fixture = policyRepairFixture();
    await reviewPolicySkippedRelationTargets(fixture.segment, 'private-source', fixture.deps);
    const originalApply = structuredClone(fixture.segment.lastApply);
    const originalEvents = structuredClone(fixture.segment.events);
    const posted = [];
    let attempts = 0;
    let pending = 1;
    const deps = {
      sourceAccountId: 'private-source',
      postBatch: async (events, deliveryMode) => {
        assert.equal(deliveryMode, 'backfill');
        posted.push(events.map(({ matrixEventId }) => matrixEventId));
        attempts += 1;
        if (attempts <= 5) throw new Error('intexuraos_ingest_failed_503');
        return { accepted: 0, duplicates: events.length, rejected: 0 };
      },
      waitBeforeRetry: async () => {},
      enqueueMedia: async () => assert.fail('repair must not requeue media'),
      drainMedia: async () => ({ stored: 0, pending, unavailable: [] }),
    };
    await assert.rejects(
      applyRecoverySegment(fixture.segment, deps),
      /intexuraos_ingest_failed_503/
    );
    assert.equal(fixture.segment.policyRelationRepairPending, true);
    assert.equal(fixture.segment.lastPolicyRelationRepair, undefined);

    const pendingResult = await applyRecoverySegment(fixture.segment, deps);
    recovery.recordRecoveryApplyResult(fixture.segment, pendingResult, 'private-source');
    assert.equal(fixture.segment.policyRelationRepairPending, true);
    assert.equal(fixture.segment.applied, true);
    pending = 0;
    const result = await applyRecoverySegment(fixture.segment, deps);
    recovery.recordRecoveryApplyResult(fixture.segment, result, 'private-source');
    assert.equal(fixture.segment.policyRelationRepairPending, false);
    assert.deepEqual(fixture.segment.lastPolicyRelationRepair, result);
    assert.deepEqual(fixture.segment.lastApply, originalApply);
    assert.deepEqual(fixture.segment.events, originalEvents);
    assert.deepEqual(fixture.segment.mediaUnavailableEvents, []);
    assert.deepEqual(await fsp.readFile(stateFile), s0Bytes);
    assert.equal(fixture.segment.verified, undefined);
    assert.ok(
      posted.every((ids) => JSON.stringify(ids) === JSON.stringify(['$replacement', '$reaction']))
    );

    const reviewAgain = await reviewPolicySkippedRelationTargets(
      fixture.segment,
      'private-source',
      fixture.deps
    );
    assert.equal(reviewAgain.repairedEventCount, 0);
    assert.equal(fixture.segment.policyRelationRepairPending, false);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('policy repair refuses stale proof or changed full-media evidence before accepting completion', async () => {
  assert.equal(typeof recovery.recordRecoveryApplyResult, 'function');
  for (const scenario of ['stale-proof', 'new-media-evidence']) {
    const fixture = policyRepairFixture();
    await reviewPolicySkippedRelationTargets(fixture.segment, 'private-source', fixture.deps);
    if (scenario === 'stale-proof') fixture.segment.events[0].message.text = 'changed';
    const result = {
      accepted: 0,
      duplicates: 2,
      rejected: 0,
      mediaStored: 0,
      mediaPending: 0,
      mediaUnavailable:
        scenario === 'new-media-evidence'
          ? [{ eventHash: createHashForTest('$media'), reason: 'matrix_media_too_large' }]
          : [],
    };
    const before = structuredClone(fixture.segment);
    assert.throws(() =>
      recovery.recordRecoveryApplyResult(fixture.segment, result, 'private-source')
    );
    assert.deepEqual(fixture.segment, before);
  }
});

test('completed targeted repair still verifies the entire original segment and all media', async () => {
  assert.equal(typeof recovery.recordRecoveryApplyResult, 'function');
  const fixture = policyRepairFixture();
  await reviewPolicySkippedRelationTargets(fixture.segment, 'private-source', fixture.deps);
  const result = await applyRecoverySegment(fixture.segment, {
    sourceAccountId: 'private-source',
    postBatch: async (events) => ({ accepted: 0, duplicates: events.length, rejected: 0 }),
    enqueueMedia: async () => assert.fail('repair must not enqueue'),
    drainMedia: async () => ({ stored: 0, pending: 0, unavailable: [] }),
  });
  recovery.recordRecoveryApplyResult(fixture.segment, result, 'private-source');
  const mediaId = createHashForTest('private-source\0$media');
  fixture.documents.get(mediaId).media = {
    storageStatus: 'stored',
    gcsPath: 'fixture/media',
    thumbnailGcsPath: 'fixture/thumbnail',
  };
  for (const event of fixture.segment.events.slice(2)) {
    const key = event.message.relation === undefined ? 'reaction' : 'relation';
    const operation = event.message[key];
    fixture.documents.get(createHashForTest(`private-source\0${event.matrixEventId}`))[key] = {
      ...operation,
      targetMessageId: createHashForTest(`private-source\0${operation.targetMatrixEventId}`),
      applicationStatus: 'superseded',
      targetUnavailableReason: key === 'relation' ? 'matrix_notice' : 'redacted_reaction_tombstone',
    };
  }
  const objects = [];
  const deps = {
    fetchDocuments: async (ids) => {
      assert.equal(ids.length, 4);
      return fixture.documents;
    },
    verifyObject: async (objectPath) => objects.push(objectPath),
    readCounters: async () => ({ accountMessageCount: 4, totalMessageCount: 4 }),
  };
  const verification = await verifyRecoveryEvidence(
    fixture.segment,
    'private-source',
    'user-1',
    deps
  );
  assert.equal(verification.messageCount, 4);
  assert.equal(verification.verifiedRelationCount, 2);
  assert.deepEqual(objects, ['fixture/media', 'fixture/thumbnail']);
  fixture.documents.delete(createHashForTest('private-source\0$unrelated'));
  await assert.rejects(
    verifyRecoveryEvidence(fixture.segment, 'private-source', 'user-1', deps),
    /recovery_verify_missing_documents_1/
  );
  assert.equal(fixture.segment.verified, undefined);
});

test('CLI apply selects applied=true pending policy repair and conflicting review modes reject', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'wa-policy-selection-'));
  try {
    const fixture = policyRepairFixture();
    await reviewPolicySkippedRelationTargets(fixture.segment, 'private-source', fixture.deps);
    const manifestFile = path.join(directory, 'manifest.json');
    const fenceFile = path.join(directory, 'recovery-required');
    const credentialFile = path.join(directory, 'fixture-credential.json');
    await fsp.writeFile(
      manifestFile,
      JSON.stringify({ sourceAccountId: 'private-source', segments: [fixture.segment] }),
      { mode: 0o600 }
    );
    await fsp.writeFile(fenceFile, '', { mode: 0o600 });
    await fsp.writeFile(credentialFile, '{}', { mode: 0o644 });
    await fsp.chmod(credentialFile, 0o644);
    const env = {
      INTEXURAOS_SOURCE_ACCOUNT_ID: 'private-source',
      WHATSAPP_SYNC_MAINTENANCE_FENCE_FILE: fenceFile,
      INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE: credentialFile,
    };
    await assert.rejects(
      runBackfillCli(['apply', '--manifest', manifestFile], env),
      /recovery_apply_identity_file_not_private/
    );
    const summary = JSON.parse(await fsp.readFile(`${manifestFile}.summary.json`, 'utf8'));
    assert.equal(summary.segments[0].policyRelationRepairPending, true);
    assert.equal(summary.segments[0].policyRelationRepairEventCount, 2);
    assert.deepEqual(summary.segments[0].lastApply, fixture.segment.lastApply);
    await assert.rejects(
      runBackfillCli(
        [
          'verify',
          '--manifest',
          manifestFile,
          '--review-policy-skipped-relations',
          'true',
          '--review-missing-operation-metadata',
          'true',
        ],
        env
      ),
      /recovery_repair_modes_conflict/
    );
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('policy pending blocks verify, next discovery and finalization even with inconsistent verified=true', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'wa-policy-pending-'));
  try {
    const manifestFile = path.join(directory, 'manifest.json');
    const fenceFile = path.join(directory, 'recovery-required');
    const stateFile = path.join(directory, 'state.json');
    const queueFile = path.join(directory, 'pending-media.json');
    const s0Bytes = Buffer.from('{"nextBatch":"s0"}\n');
    const { segment } = policyRepairFixture();
    segment.policyRelationRepairPending = true;
    const manifest = {
      version: 1,
      sourceAccountId: 'private-source',
      s0StateBytesBase64: s0Bytes.toString('base64'),
      segments: [segment],
    };
    await fsp.writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
    await fsp.writeFile(fenceFile, '', { mode: 0o600 });
    await fsp.writeFile(stateFile, s0Bytes, { mode: 0o600 });
    await fsp.writeFile(queueFile, '{"items":[]}', { mode: 0o600 });
    const env = {
      INTEXURAOS_SOURCE_ACCOUNT_ID: 'private-source',
      WHATSAPP_SYNC_MAINTENANCE_FENCE_FILE: fenceFile,
    };
    await assert.rejects(
      runBackfillCli(['verify', '--manifest', manifestFile], env),
      /recovery_policy_relation_repair_pending/
    );
    await assert.rejects(
      runBackfillCli(['discover', '--manifest', manifestFile], env),
      /recovery_policy_relation_repair_pending/
    );
    manifest.segments.push({ name: 's1-s2', fromToken: 's1', toToken: 's2', verified: true });
    manifest.finalStateUpdatedAt = '2026-10-12T12:00:00.000Z';
    await assert.rejects(
      finalizeRecoveryState({ manifest, stateFile, pendingMediaFile: queueFile }),
      /recovery_policy_relation_repair_pending/
    );
    assert.deepEqual(await fsp.readFile(stateFile), s0Bytes);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
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
    policySkippedRelationTargetCount: 0,
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

test('verify requires reviewed policy-skipped relations to be durably superseded', async () => {
  const event = {
    matrixEventId: '$reaction',
    message: {
      type: 'reaction',
      reaction: { emoji: 'x', targetMatrixEventId: '$notice' },
    },
  };
  const eventId = createHashForTest('private-source\0$reaction');
  const targetId = createHashForTest('private-source\0$notice');
  const evidence = {
    eventHash: createHashForTest('$reaction'),
    targetHash: createHashForTest('$notice'),
    reason: 'matrix_notice',
  };
  const document = {
    matrixEventId: '$reaction',
    sourceAccountId: 'private-source',
    userId: 'user-1',
    reaction: {
      emoji: 'x',
      targetMatrixEventId: '$notice',
      targetMessageId: targetId,
      targetUnavailableReason: 'matrix_notice',
      applicationStatus: 'superseded',
    },
  };
  const segment = { events: [event], relationTargetPolicySkips: [evidence] };
  const deps = {
    fetchDocuments: async () => new Map([[eventId, document]]),
    verifyObject: async () => {},
    readCounters: async () => ({ accountMessageCount: 1, totalMessageCount: 1 }),
  };

  const result = await verifyRecoveryEvidence(segment, 'private-source', 'user-1', deps);
  assert.deepEqual(result, {
    messageCount: 1,
    relationTargetCount: 1,
    verifiedRelationCount: 1,
    policySkippedRelationTargetCount: 1,
    storedMediaCount: 0,
    mediaUnavailableCount: 0,
    accountMessageCount: 1,
    totalMessageCount: 1,
  });

  document.reaction.applicationStatus = 'pending';
  await assert.rejects(
    verifyRecoveryEvidence(segment, 'private-source', 'user-1', deps),
    /recovery_verify_relation_not_resolved/
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
