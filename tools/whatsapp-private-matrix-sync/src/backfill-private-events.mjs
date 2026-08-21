import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  classifyMatrixEventForRecovery,
  collectWhatsAppInviteRoomIds,
  createConfig,
  createPrivateWhatsAppMessageId,
  drainPendingMedia,
  enqueuePendingMedia,
  extractRoomContexts,
  fetchMatrixMedia,
  isWhatsAppMatrixUserId,
  postEvents,
  postPrivateMediaBackfill,
  uploadPrivateMedia,
  validateGoogleCredentialIdentity,
} from './server.mjs';

const MAX_INGEST_BATCH = 100;
const MAX_TRANSIENT_INGEST_ATTEMPTS = 5;
const INITIAL_TRANSIENT_INGEST_DELAY_MS = 1_000;
const RETAINED_PROJECT_ID = 'intexuraos-dev-pbuchman';
const DEFAULT_ANCHOR_BEFORE = Date.parse('2026-08-09T22:00:00.000Z');

export async function discoverRecoverySegment({
  name,
  fromToken,
  syncResponse,
  stateRoomContexts,
  config,
  knownMessageIds,
  fetchRoomMessages,
  joinRoom,
  anchorBefore = DEFAULT_ANCHOR_BEFORE,
}) {
  const toToken =
    typeof syncResponse?.next_batch === 'string' && syncResponse.next_batch !== ''
      ? syncResponse.next_batch
      : undefined;
  if (toToken === undefined) {
    throw new Error('recovery_discover_missing_next_batch');
  }

  const inviteRoomIds = collectWhatsAppInviteRoomIds(syncResponse, config);
  if (inviteRoomIds.length > 0) {
    for (const roomId of inviteRoomIds) {
      await joinRoom(roomId);
    }
    throw new Error('eligible_invite_joined_rediscover');
  }

  const contexts = { ...(stateRoomContexts ?? {}) };
  const relevantRooms = new Map();
  for (const membership of ['join', 'leave']) {
    const rooms = syncResponse?.rooms?.[membership];
    if (!isRecord(rooms)) continue;
    for (const [roomId, room] of Object.entries(rooms)) {
      const known = Object.hasOwn(contexts, roomId);
      const proven = roomProvesWhatsApp(roomId, room, contexts[roomId], config);
      if (known || proven) {
        relevantRooms.set(roomId, room);
      } else if (isRecord(room) && room.timeline?.limited === true) {
        throw new Error('recovery_unresolved_limited_room_eligibility');
      }
    }
  }
  for (const roomId of Object.keys(contexts)) {
    if (!relevantRooms.has(roomId)) {
      relevantRooms.set(roomId, { state: { events: [] }, timeline: { events: [] } });
    }
  }

  const globalEventIds = new Set();
  const mappedEvents = [];
  const skipCounts = {};
  const errors = [];
  for (const [roomId, room] of relevantRooms) {
    const forward = await paginateMatrixRoomMessages({
      initialToken: fromToken,
      direction: 'f',
      toToken,
      fetchPage: ({ fromToken: pageToken, direction, toToken: endToken }) =>
        fetchRoomMessages({ roomId, fromToken: pageToken, direction, toToken: endToken }),
    });
    const backward = await paginateMatrixRoomMessages({
      initialToken: fromToken,
      direction: 'b',
      fetchPage: ({ fromToken: pageToken, direction }) =>
        fetchRoomMessages({ roomId, fromToken: pageToken, direction }),
      shouldStop: (chunk) =>
        chunk.some((event) =>
          isKnownPreSegmentAnchor(event, config, knownMessageIds, anchorBefore)
        ),
    });
    const visible = [
      ...(Array.isArray(room?.state?.events) ? room.state.events : []),
      ...(Array.isArray(room?.timeline?.events) ? room.timeline.events : []),
    ];
    const roomEvents = [...backward, ...forward, ...visible]
      .filter((event) => {
        const eventId = isRecord(event) ? event.event_id : undefined;
        if (typeof eventId !== 'string' || eventId === '') return true;
        if (globalEventIds.has(eventId)) return false;
        globalEventIds.add(eventId);
        return true;
      })
      .sort(compareMatrixEvents);

    for (let position = 0; position < roomEvents.length; position += 1) {
      const event = roomEvents[position];
      const updated = extractRoomContexts(
        { rooms: { join: { [roomId]: { timeline: { events: [event] } } } } },
        contexts
      );
      contexts[roomId] = updated[roomId] ?? contexts[roomId] ?? { memberDisplayNames: {} };
      const classified = classifyMatrixEventForRecovery(roomId, event, contexts[roomId], config);
      if (classified.classification === 'mapped') {
        mappedEvents.push(classified.event);
      } else if (classified.classification === 'policy_skip') {
        skipCounts[classified.reason] = (skipCounts[classified.reason] ?? 0) + 1;
      } else {
        errors.push(sanitizeRecoveryException(event, roomId, position, classified.reason));
      }
    }
  }

  const eventTypeCounts = {};
  for (const event of mappedEvents) {
    const type = event?.message?.type ?? 'unknown';
    eventTypeCounts[type] = (eventTypeCounts[type] ?? 0) + 1;
  }
  const errorCounts = {};
  for (const error of errors) {
    errorCounts[error.errorCode] = (errorCounts[error.errorCode] ?? 0) + 1;
  }
  return {
    name,
    fromToken,
    toToken,
    fromTokenHash: sha256(Buffer.from(fromToken)),
    toTokenHash: sha256(Buffer.from(toToken)),
    events: mappedEvents,
    roomContexts: contexts,
    skipCounts,
    errors,
    summary: {
      roomCount: relevantRooms.size,
      mappedCount: mappedEvents.length,
      policySkipCount: Object.values(skipCounts).reduce((sum, count) => sum + count, 0),
      errorCount: errors.length,
      eventTypeCounts,
      skipCounts,
      errorCounts,
      fromTokenHash: sha256(Buffer.from(fromToken)),
      toTokenHash: sha256(Buffer.from(toToken)),
    },
  };
}

export async function paginateMatrixRoomMessages({
  initialToken,
  direction,
  toToken,
  fetchPage,
  shouldStop,
}) {
  if (typeof initialToken !== 'string' || initialToken === '') {
    throw new Error('matrix_pagination_missing_initial_token');
  }
  const seenTokens = new Set();
  const events = [];
  let fromToken = initialToken;

  for (;;) {
    if (seenTokens.has(fromToken)) {
      throw new Error('matrix_pagination_token_loop');
    }
    seenTokens.add(fromToken);
    const page = await fetchPage({ fromToken, direction, toToken });
    if (!isRecord(page) || !Array.isArray(page.chunk)) {
      throw new Error('matrix_pagination_invalid_response');
    }
    events.push(...page.chunk);
    if (shouldStop?.(page.chunk) === true) {
      break;
    }

    const end = typeof page.end === 'string' && page.end !== '' ? page.end : undefined;
    if (end === undefined) {
      break;
    }
    if (end === fromToken || seenTokens.has(end)) {
      throw new Error('matrix_pagination_token_loop');
    }
    fromToken = end;
  }

  return events;
}

export async function applyRecoverySegment(segment, deps) {
  if (!isRecord(segment) || !Array.isArray(segment.events)) {
    throw new Error('invalid_recovery_segment');
  }
  const summary = {
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    mediaStored: 0,
    mediaPending: 0,
  };

  for (let index = 0; index < segment.events.length; index += MAX_INGEST_BATCH) {
    const batch = segment.events.slice(index, index + MAX_INGEST_BATCH);
    const result = await retryTransientIngest(
      () => deps.postBatch(batch, 'backfill'),
      deps.waitBeforeRetry
    );
    if (
      !isRecord(result) ||
      !Number.isInteger(result.accepted) ||
      !Number.isInteger(result.duplicates) ||
      result.rejected !== 0 ||
      result.accepted + result.duplicates !== batch.length
    ) {
      throw new Error('recovery_apply_invalid_ingest_summary');
    }
    summary.accepted += result.accepted;
    summary.duplicates += result.duplicates;
    await deps.enqueueMedia(batch);
  }

  const media = await deps.drainMedia();
  if (!isRecord(media) || !Number.isInteger(media.stored) || !Number.isInteger(media.pending)) {
    throw new Error('recovery_apply_invalid_media_summary');
  }
  summary.mediaStored = media.stored;
  summary.mediaPending = media.pending;
  return summary;
}

async function retryTransientIngest(operation, waitBeforeRetry = delay) {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_INGEST_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === MAX_TRANSIENT_INGEST_ATTEMPTS || !isTransientIngestError(error)) {
        throw error;
      }
      await waitBeforeRetry(INITIAL_TRANSIENT_INGEST_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw new Error('recovery_apply_transient_retry_exhausted');
}

function isTransientIngestError(error) {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  const match = /^intexuraos_ingest_failed_([0-9]{3})$/u.exec(message);
  if (match === null) return false;
  const status = Number(match[1]);
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function delay(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function verifyRecoveryEvidence(segment, sourceAccountId, expectedUserId, deps) {
  if (!isRecord(segment) || !Array.isArray(segment.events)) {
    throw new Error('invalid_recovery_segment');
  }
  const messageIds = new Map();
  const targetIds = new Set();
  for (const event of segment.events) {
    const messageId = createPrivateWhatsAppMessageId(sourceAccountId, event.matrixEventId);
    messageIds.set(event.matrixEventId, messageId);
    const targetMatrixEventId =
      event?.message?.relation?.targetMatrixEventId ??
      event?.message?.reaction?.targetMatrixEventId;
    if (typeof targetMatrixEventId === 'string' && targetMatrixEventId !== '') {
      targetIds.add(createPrivateWhatsAppMessageId(sourceAccountId, targetMatrixEventId));
    }
  }
  const requestedIds = [...new Set([...messageIds.values(), ...targetIds])];
  const documents = await deps.fetchDocuments(requestedIds);
  const missing = requestedIds.filter((messageId) => !documents.has(messageId));
  if (missing.length > 0) {
    throw new Error(`recovery_verify_missing_documents_${missing.length}`);
  }

  const mediaUnavailable = new Set(segment.mediaUnavailableEventHashes ?? []);
  let storedMediaCount = 0;
  let mediaUnavailableCount = 0;
  let verifiedRelationCount = 0;
  for (const event of segment.events) {
    const document = documents.get(messageIds.get(event.matrixEventId));
    if (
      document?.matrixEventId !== event.matrixEventId ||
      document?.sourceAccountId !== sourceAccountId ||
      document?.userId !== expectedUserId
    ) {
      throw new Error('recovery_verify_deterministic_id_mismatch');
    }
    const targetMatrixEventId =
      event?.message?.relation?.targetMatrixEventId ??
      event?.message?.reaction?.targetMatrixEventId;
    if (typeof targetMatrixEventId === 'string' && targetMatrixEventId !== '') {
      const storedRelation =
        event?.message?.reaction?.targetMatrixEventId === targetMatrixEventId
          ? document.reaction
          : document.relation;
      const expectedTargetMessageId = createPrivateWhatsAppMessageId(
        sourceAccountId,
        targetMatrixEventId
      );
      if (
        storedRelation?.targetMatrixEventId !== targetMatrixEventId ||
        storedRelation?.targetMessageId !== expectedTargetMessageId ||
        (storedRelation?.applicationStatus !== 'applied' &&
          storedRelation?.applicationStatus !== 'superseded')
      ) {
        throw new Error('recovery_verify_relation_not_resolved');
      }
      verifiedRelationCount += 1;
    }
    if (typeof event?.message?.media?.mxcUri !== 'string') {
      continue;
    }
    const eventHash = sha256(Buffer.from(event.matrixEventId));
    if (mediaUnavailable.has(eventHash)) {
      mediaUnavailableCount += 1;
      continue;
    }
    if (document?.media?.storageStatus !== 'stored' || typeof document.media.gcsPath !== 'string') {
      throw new Error('recovery_verify_media_not_stored');
    }
    await deps.verifyObject(document.media.gcsPath);
    if (typeof document.media.thumbnailGcsPath === 'string') {
      await deps.verifyObject(document.media.thumbnailGcsPath);
    }
    storedMediaCount += 1;
  }

  const counters = await deps.readCounters();
  if (
    !isRecord(counters) ||
    !Number.isInteger(counters.accountMessageCount) ||
    !Number.isInteger(counters.totalMessageCount) ||
    counters.accountMessageCount !== counters.totalMessageCount
  ) {
    throw new Error('recovery_verify_counter_mismatch');
  }
  return {
    messageCount: segment.events.length,
    relationTargetCount: targetIds.size,
    verifiedRelationCount,
    storedMediaCount,
    mediaUnavailableCount,
    accountMessageCount: counters.accountMessageCount,
    totalMessageCount: counters.totalMessageCount,
  };
}

export function assertRecoveryVerificationEnvironment(
  env,
  adc,
  targetPrincipal,
  expectedReaderPrincipal,
  projectId
) {
  const rejected =
    nonEmpty(env.GOOGLE_APPLICATION_CREDENTIALS) ||
    nonEmpty(env.FIRESTORE_EMULATOR_HOST) ||
    nonEmpty(env.STORAGE_EMULATOR_HOST) ||
    !isRecord(adc) ||
    adc.type !== 'authorized_user' ||
    targetPrincipal !== expectedReaderPrincipal ||
    projectId !== RETAINED_PROJECT_ID;
  if (rejected) {
    throw new Error('recovery_verification_environment_rejected');
  }
}

export function assertRecoveryApplyIdentity(config, credentialJson) {
  if (
    config.expectedGoogleServiceAccount === '' ||
    config.googleApplicationCredentialsFile === ''
  ) {
    throw new Error('recovery_apply_identity_not_pinned');
  }
  validateGoogleCredentialIdentity(config, credentialJson);
}

export async function finalizeRecoveryState({ manifest, stateFile, pendingMediaFile }) {
  validateFinalizableManifest(manifest);
  const queue = JSON.parse(await fsp.readFile(pendingMediaFile, 'utf8'));
  if (!isRecord(queue) || !Array.isArray(queue.items) || queue.items.length !== 0) {
    throw new Error('recovery_finalize_pending_media');
  }

  const s0Bytes = Buffer.from(manifest.s0StateBytesBase64, 'base64');
  const expectedBytes = buildExpectedFinalStateBytes(manifest, s0Bytes);
  const liveBytes = await fsp.readFile(stateFile);
  const oldStateHash = sha256(s0Bytes);
  const newStateHash = sha256(expectedBytes);

  if (liveBytes.equals(expectedBytes)) {
    return { oldStateHash, newStateHash };
  }
  if (!liveBytes.equals(s0Bytes)) {
    throw new Error('recovery_finalize_unexpected_live_state');
  }

  await writeDurablePrivateFile(stateFile, expectedBytes);
  return { oldStateHash, newStateHash };
}

export function buildExpectedFinalStateBytes(manifest, s0Bytes) {
  const original = JSON.parse(s0Bytes.toString('utf8'));
  const finalSegment = manifest.segments[1];
  const next = {
    ...original,
    nextBatch: finalSegment.toToken,
    roomContexts: finalSegment.roomContexts ?? manifest.segments[0].roomContexts ?? {},
    updatedAt: manifest.finalStateUpdatedAt,
  };
  return Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
}

export async function writePrivateRecoveryJson(filePath, value) {
  await writeDurablePrivateFile(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function writeDurablePrivateFile(filePath, bytes) {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await fsp.open(tempFile, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsp.rename(tempFile, filePath);
    await fsp.chmod(filePath, 0o600);
    const directoryHandle = await fsp.open(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => {});
    }
    await fsp.unlink(tempFile).catch(() => {});
    throw error;
  }
}

function validateFinalizableManifest(manifest) {
  if (
    !isRecord(manifest) ||
    manifest.version !== 1 ||
    typeof manifest.s0StateBytesBase64 !== 'string' ||
    typeof manifest.finalStateUpdatedAt !== 'string' ||
    !Array.isArray(manifest.segments) ||
    manifest.segments.length !== 2 ||
    manifest.segments.some(
      (segment) =>
        !isRecord(segment) || segment.verified !== true || typeof segment.toToken !== 'string'
    ) ||
    manifest.segments[0].toToken !== manifest.segments[1].fromToken
  ) {
    throw new Error('recovery_finalize_manifest_not_verified');
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function roomProvesWhatsApp(roomId, room, existingContext, config) {
  const extracted = extractRoomContexts(
    { rooms: { join: { [roomId]: room } } },
    existingContext === undefined ? {} : { [roomId]: existingContext }
  )[roomId];
  if (typeof extracted?.whatsappMemberCount === 'number' && extracted.whatsappMemberCount > 0) {
    return true;
  }
  const events = [
    ...(Array.isArray(room?.state?.events) ? room.state.events : []),
    ...(Array.isArray(room?.timeline?.events) ? room.timeline.events : []),
  ];
  const bridgeBotUsers = config.bridgeBotUsers ?? new Set();
  return events.some((event) => {
    if (!isRecord(event)) return false;
    const eventType = typeof event.type === 'string' ? event.type : '';
    const sender = typeof event.sender === 'string' ? event.sender : '';
    return (
      eventType === 'm.bridge' ||
      eventType === 'uk.half-shot.bridge' ||
      bridgeBotUsers.has(sender) ||
      isWhatsAppMatrixUserId(sender)
    );
  });
}

function isKnownPreSegmentAnchor(event, config, knownMessageIds, anchorBefore) {
  if (!isRecord(event) || typeof event.event_id !== 'string') return false;
  if (typeof event.origin_server_ts !== 'number' || event.origin_server_ts > anchorBefore) {
    return false;
  }
  const messageId = createPrivateWhatsAppMessageId(config.sourceAccountId, event.event_id);
  return knownMessageIds.has(messageId) || knownMessageIds.has(event.event_id);
}

function compareMatrixEvents(left, right) {
  const leftTimestamp =
    isRecord(left) && typeof left.origin_server_ts === 'number'
      ? left.origin_server_ts
      : Number.MAX_SAFE_INTEGER;
  const rightTimestamp =
    isRecord(right) && typeof right.origin_server_ts === 'number'
      ? right.origin_server_ts
      : Number.MAX_SAFE_INTEGER;
  return leftTimestamp - rightTimestamp;
}

function sanitizeRecoveryException(event, roomId, position, reason) {
  const content = isRecord(event?.content) ? event.content : {};
  const relation = isRecord(content['m.relates_to']) ? content['m.relates_to'] : {};
  const eventId = typeof event?.event_id === 'string' ? event.event_id : `position:${position}`;
  const targetId = typeof relation.event_id === 'string' ? relation.event_id : '';
  return {
    eventType: typeof event?.type === 'string' ? event.type : 'missing',
    messageType: typeof content.msgtype === 'string' ? content.msgtype : 'missing',
    relationCategory: typeof relation.rel_type === 'string' ? relation.rel_type : 'none',
    mediaCategory:
      typeof content.msgtype === 'string' && content.msgtype.startsWith('m.')
        ? content.msgtype.slice(2)
        : 'none',
    roomHash: sha256(Buffer.from(roomId)),
    eventHash: sha256(Buffer.from(eventId)),
    targetHash: targetId === '' ? undefined : sha256(Buffer.from(targetId)),
    errorCode: reason,
    stage: 'discover',
    manifestPosition: position,
    retryCount: 0,
  };
}

function nonEmpty(value) {
  return typeof value === 'string' && value !== '';
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (typeof key !== 'string' || !key.startsWith('--') || value === undefined) {
      throw new Error('invalid_recovery_cli_options');
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`missing_recovery_option_${name}`);
  }
  return value;
}

async function assertPrivateFile(filePath, errorCode) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error(errorCode);
  }
}

async function readPrivateRecoveryJson(filePath) {
  await assertPrivateFile(filePath, 'recovery_private_file_permissions_invalid');
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function readPrivateToken(filePath) {
  await assertPrivateFile(filePath, 'recovery_matrix_token_not_private');
  const token = (await fsp.readFile(filePath, 'utf8')).trim();
  if (token === '') throw new Error('recovery_matrix_token_missing');
  return token;
}

async function readKnownMessageIds(filePath) {
  if (filePath === undefined) return new Set();
  const value = await readPrivateRecoveryJson(filePath);
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('recovery_known_message_ids_invalid');
  }
  return new Set(value);
}

async function fetchMatrixSyncForRecovery(config, accessToken, since) {
  const url = new URL('/_matrix/client/v3/sync', config.homeserverUrl);
  url.searchParams.set('since', since);
  url.searchParams.set('timeout', '0');
  return await fetchMatrixJson(url, accessToken, 'matrix_recovery_sync');
}

async function fetchMatrixRoomMessagesForRecovery(
  config,
  accessToken,
  { roomId, fromToken, direction, toToken }
) {
  const url = new URL(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
    config.homeserverUrl
  );
  url.searchParams.set('from', fromToken);
  url.searchParams.set('dir', direction);
  url.searchParams.set('limit', '1000');
  if (typeof toToken === 'string' && toToken !== '') url.searchParams.set('to', toToken);
  return await fetchMatrixJson(url, accessToken, 'matrix_recovery_messages');
}

async function joinMatrixRoomForRecovery(config, accessToken, roomId) {
  const url = new URL(
    `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
    config.homeserverUrl
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`matrix_recovery_join_failed_${response.status}`);
}

async function fetchMatrixJson(url, accessToken, errorPrefix) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`${errorPrefix}_failed_${response.status}`);
  return await response.json();
}

async function createGcpRecoveryVerifier({ adc, readerPrincipal, projectId, userId, bucket }) {
  const { GoogleAuth, Impersonated } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const sourceClient = auth.fromJSON(adc);
  const impersonated = new Impersonated({
    sourceClient,
    targetPrincipal: readerPrincipal,
    targetScopes: ['https://www.googleapis.com/auth/cloud-platform'],
    lifetime: 900,
  });
  const tokenResponse = await impersonated.getAccessToken();
  const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error('recovery_reader_impersonation_failed');
  }
  const firestoreRoot = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const authorization = `Bearer ${accessToken}`;

  return {
    fetchDocuments: async (messageIds) => {
      const documents = new Map();
      for (let index = 0; index < messageIds.length; index += 100) {
        const batch = messageIds.slice(index, index + 100);
        const response = await fetch(`${firestoreRoot}:batchGet`, {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body: JSON.stringify({
            documents: batch.map(
              (messageId) =>
                `projects/${projectId}/databases/(default)/documents/whatsapp_private_messages/${messageId}`
            ),
          }),
        });
        if (!response.ok) throw new Error(`recovery_firestore_batch_get_failed_${response.status}`);
        for (const item of parseStreamingJson(await response.text())) {
          if (!isRecord(item?.found) || typeof item.found.name !== 'string') continue;
          const messageId = item.found.name.slice(item.found.name.lastIndexOf('/') + 1);
          documents.set(messageId, decodeFirestoreFields(item.found.fields));
        }
      }
      return documents;
    },
    verifyObject: async (gcsPath) => {
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(gcsPath)}`;
      const response = await fetch(url, { headers: { authorization } });
      if (!response.ok) throw new Error(`recovery_gcs_object_missing_${response.status}`);
    },
    readCounters: async () => {
      const accountResponse = await fetch(
        `${firestoreRoot}/whatsapp_private_accounts/${encodeURIComponent(userId)}`,
        { headers: { authorization } }
      );
      if (!accountResponse.ok) {
        throw new Error(`recovery_firestore_account_failed_${accountResponse.status}`);
      }
      const account = decodeFirestoreFields((await accountResponse.json()).fields);
      const aggregateResponse = await fetch(`${firestoreRoot}:runAggregationQuery`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          structuredAggregationQuery: {
            structuredQuery: {
              from: [{ collectionId: 'whatsapp_private_messages' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'userId' },
                  op: 'EQUAL',
                  value: { stringValue: userId },
                },
              },
            },
            aggregations: [{ alias: 'total', count: {} }],
          },
        }),
      });
      if (!aggregateResponse.ok) {
        throw new Error(`recovery_firestore_count_failed_${aggregateResponse.status}`);
      }
      const aggregate = parseStreamingJson(await aggregateResponse.text());
      const totalValue = aggregate[0]?.result?.aggregateFields?.total;
      return {
        accountMessageCount: Number(account.messageCount),
        totalMessageCount: Number(decodeFirestoreValue(totalValue)),
      };
    },
  };
}

function parseStreamingJson(text) {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

function decodeFirestoreFields(fields) {
  if (!isRecord(fields)) return {};
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)])
  );
}

function decodeFirestoreValue(value) {
  if (!isRecord(value)) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if (isRecord(value.mapValue)) return decodeFirestoreFields(value.mapValue.fields);
  if (isRecord(value.arrayValue)) {
    return Array.isArray(value.arrayValue.values)
      ? value.arrayValue.values.map(decodeFirestoreValue)
      : [];
  }
  return undefined;
}

function sanitizedManifestSummary(manifest, stage, result) {
  return {
    ok: true,
    stage,
    sourceAccountHash: sha256(Buffer.from(manifest.sourceAccountId ?? '')),
    s0StateHash: manifest.s0StateHash,
    segmentCount: manifest.segments.length,
    segments: manifest.segments.map((segment) => ({
      name: segment.name,
      fromTokenHash: segment.fromTokenHash,
      toTokenHash: segment.toTokenHash,
      summary: segment.summary,
      applied: segment.applied === true,
      verified: segment.verified === true,
      lastApply: segment.lastApply,
      verification: segment.verification,
    })),
    ...(isRecord(manifest.lastDiscoveryException)
      ? { discoveryException: manifest.lastDiscoveryException }
      : {}),
    result,
  };
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main(process.argv.slice(2), process.env)
    .then((summary) => {
      console.log(JSON.stringify(summary));
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: safeError(error) }));
      process.exitCode = 1;
    });
}

export async function main(argv, env) {
  const [stage, ...optionArgs] = argv;
  if (!['discover', 'apply', 'verify', 'finalize'].includes(stage)) {
    throw new Error('usage_discover_apply_verify_finalize');
  }
  const options = parseOptions(optionArgs);
  const manifestFile = requireOption(options, 'manifest');
  const summaryFile = options.summary ?? `${manifestFile}.summary.json`;
  const config = createConfig(env);
  if (config.sourceAccountId === '') {
    throw new Error('recovery_source_account_missing');
  }
  await assertPrivateFile(config.maintenanceFenceFile, 'recovery_maintenance_fence_missing');

  let result;
  try {
    if (stage === 'discover') {
      result = await runDiscoverStage({ config, manifestFile, options });
    } else if (stage === 'apply') {
      result = await runApplyStage({ config, manifestFile });
    } else if (stage === 'verify') {
      result = await runVerifyStage({ config, manifestFile, env });
    } else {
      const manifest = await readPrivateRecoveryJson(manifestFile);
      result = await finalizeRecoveryState({
        manifest,
        stateFile: config.stateFile,
        pendingMediaFile: config.pendingMediaFile,
      });
    }
  } catch (error) {
    try {
      const manifest = await readPrivateRecoveryJson(manifestFile);
      const summary = {
        ...sanitizedManifestSummary(manifest, stage, undefined),
        ok: false,
        error: safeError(error),
      };
      await writePrivateRecoveryJson(summaryFile, summary);
    } catch {
      // The primary recovery error remains authoritative if no private manifest exists yet.
    }
    throw error;
  }

  const manifest = await readPrivateRecoveryJson(manifestFile);
  const summary = sanitizedManifestSummary(manifest, stage, result);
  await writePrivateRecoveryJson(summaryFile, summary);
  return summary;
}

async function runDiscoverStage({ config, manifestFile, options }) {
  let manifest;
  try {
    manifest = await readPrivateRecoveryJson(manifestFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const stateBackupFile = requireOption(options, 'state-backup');
    await assertPrivateFile(stateBackupFile, 'recovery_state_backup_not_private');
    const s0StateBytes = await fsp.readFile(stateBackupFile);
    const s0State = JSON.parse(s0StateBytes.toString('utf8'));
    if (typeof s0State.nextBatch !== 'string' || s0State.nextBatch === '') {
      throw new Error('recovery_state_backup_missing_cursor');
    }
    manifest = {
      version: 1,
      sourceAccountId: config.sourceAccountId,
      s0StateBytesBase64: s0StateBytes.toString('base64'),
      s0StateHash: sha256(s0StateBytes),
      createdAt: new Date().toISOString(),
      segments: [],
    };
    await writePrivateRecoveryJson(manifestFile, manifest);
  }
  if (manifest.sourceAccountId !== config.sourceAccountId) {
    throw new Error('recovery_manifest_source_account_mismatch');
  }
  if (manifest.segments.length === 2) {
    return { status: 'already_discovered', segmentCount: 2 };
  }
  if (manifest.segments.length === 1 && manifest.segments[0].verified !== true) {
    throw new Error('recovery_first_segment_not_verified');
  }

  const s0State = JSON.parse(Buffer.from(manifest.s0StateBytesBase64, 'base64').toString('utf8'));
  const previous = manifest.segments.at(-1);
  const fromToken = previous?.toToken ?? s0State.nextBatch;
  const stateRoomContexts = previous?.roomContexts ?? s0State.roomContexts ?? {};
  const matrixAccessToken = await readPrivateToken(config.matrixAccessTokenFile);
  const syncResponse = await fetchMatrixSyncForRecovery(config, matrixAccessToken, fromToken);
  const knownMessageIds = await readKnownMessageIds(options['known-message-ids']);
  try {
    const segment = await discoverRecoverySegment({
      name: manifest.segments.length === 0 ? 's0-s1' : 's1-s2',
      fromToken,
      syncResponse,
      stateRoomContexts,
      config,
      knownMessageIds,
      fetchRoomMessages: (page) =>
        fetchMatrixRoomMessagesForRecovery(config, matrixAccessToken, page),
      joinRoom: (roomId) => joinMatrixRoomForRecovery(config, matrixAccessToken, roomId),
    });
    if (segment.errors.length > 0) {
      manifest.lastDiscoveryException = {
        segmentName: segment.name,
        errors: segment.errors,
        summary: segment.summary,
      };
      await writePrivateRecoveryJson(manifestFile, manifest);
      throw new Error(`recovery_discovery_errors_${segment.errors.length}`);
    }
    delete manifest.lastDiscoveryException;
    manifest.segments.push(segment);
    await writePrivateRecoveryJson(manifestFile, manifest);
    return { status: 'discovered', segment: segment.name, ...segment.summary };
  } catch (error) {
    if (safeError(error) === 'eligible_invite_joined_rediscover') {
      return { status: 'invite_joined_rediscover', segmentCount: manifest.segments.length };
    }
    throw error;
  }
}

async function runApplyStage({ config, manifestFile }) {
  const manifest = await readPrivateRecoveryJson(manifestFile);
  if (!Array.isArray(manifest.segments) || manifest.segments.length === 0) {
    throw new Error('recovery_apply_missing_segment');
  }
  const segment = manifest.segments.find((candidate) => candidate.applied !== true);
  if (segment === undefined) {
    return { status: 'already_applied', segmentCount: manifest.segments.length };
  }
  if (segment.errors?.length > 0) {
    throw new Error('recovery_apply_blocked_by_discovery_errors');
  }
  await assertPrivateFile(
    config.googleApplicationCredentialsFile,
    'recovery_apply_identity_file_not_private'
  );
  assertRecoveryApplyIdentity(
    config,
    await fsp.readFile(config.googleApplicationCredentialsFile, 'utf8')
  );
  const matrixAccessToken = await readPrivateToken(config.matrixAccessTokenFile);
  const result = await applyRecoverySegment(segment, {
    postBatch: (events, deliveryMode) => postEvents(config, events, deliveryMode),
    enqueueMedia: (events) =>
      enqueuePendingMedia(
        config.pendingMediaFile,
        config.sourceAccountId,
        events,
        new Date().toISOString()
      ),
    drainMedia: () =>
      drainPendingMedia(config, matrixAccessToken, {
        fetchMatrixMedia,
        uploadPrivateMedia,
        postPrivateMediaBackfill,
        nowISOString: () => new Date().toISOString(),
      }),
  });
  segment.lastApply = result;
  segment.applied = result.mediaPending === 0;
  await writePrivateRecoveryJson(manifestFile, manifest);
  if (!segment.applied) {
    throw new Error(`recovery_apply_media_pending_${result.mediaPending}`);
  }
  return { status: 'applied', segment: segment.name, ...result };
}

async function runVerifyStage({ config, manifestFile, env }) {
  const manifest = await readPrivateRecoveryJson(manifestFile);
  if (!Array.isArray(manifest.segments) || manifest.segments.length === 0) {
    throw new Error('recovery_verify_missing_segment');
  }
  const segment = manifest.segments.find((candidate) => candidate.verified !== true);
  if (segment === undefined) {
    return { status: 'already_verified', segmentCount: manifest.segments.length };
  }
  if (segment.applied !== true) {
    throw new Error('recovery_verify_segment_not_applied');
  }
  const projectId = env.WHATSAPP_RECOVERY_PROJECT_ID ?? '';
  const readerPrincipal = env.WHATSAPP_RECOVERY_READER_SERVICE_ACCOUNT ?? '';
  const expectedReader = `wa-private-recovery-reader-dev@${projectId}.iam.gserviceaccount.com`;
  const adcFile = path.join(
    os.homedir(),
    '.config',
    'gcloud',
    'application_default_credentials.json'
  );
  const adc = JSON.parse(await fsp.readFile(adcFile, 'utf8'));
  assertRecoveryVerificationEnvironment(env, adc, readerPrincipal, expectedReader, projectId);
  if (config.userId === '') {
    throw new Error('recovery_verify_missing_user_id');
  }
  const verifier = await createGcpRecoveryVerifier({
    adc,
    readerPrincipal,
    projectId,
    userId: config.userId,
    bucket: env.WHATSAPP_RECOVERY_MEDIA_BUCKET ?? 'intexuraos-whatsapp-media-dev',
  });
  const result = await verifyRecoveryEvidence(
    segment,
    config.sourceAccountId,
    config.userId,
    verifier
  );
  segment.verification = result;
  segment.verified = true;
  if (manifest.segments.length === 2 && manifest.segments[1] === segment) {
    manifest.finalStateUpdatedAt ??= new Date().toISOString();
  }
  await writePrivateRecoveryJson(manifestFile, manifest);
  return { status: 'verified', segment: segment.name, ...result };
}
