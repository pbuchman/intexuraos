import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = 8099;
const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const DEFAULT_INITIAL_SYNC_TIMEOUT_MS = 0;
const MAX_EVENTS_PER_INGEST_REQUEST = 100;
const MAX_PRIVATE_MEDIA_BYTES = 25 * 1024 * 1024;
const DEFAULT_BRIDGE_BOT_USERS = ['@whatsappbot:home-dev', '@whatsapp-sync:home-dev'];

const defaultBridgeBotUsers = new Set(DEFAULT_BRIDGE_BOT_USERS);

export function defaultMediaUploadUrl(ingestUrl) {
  if (typeof ingestUrl !== 'string' || ingestUrl === '') return '';
  return ingestUrl.replace(/\/events$/, '/media');
}

export function defaultMediaBackfillUrl(ingestUrl) {
  if (typeof ingestUrl !== 'string' || ingestUrl === '') return '';
  return ingestUrl.replace(/\/events$/, '/media/backfill');
}

export function defaultPrivateMediaStatusBaseUrl(ingestUrl) {
  if (typeof ingestUrl !== 'string' || ingestUrl === '') return '';
  return ingestUrl.replace(/\/events$/, '/messages');
}

export function createConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? DEFAULT_PORT),
    homeserverUrl: env.MATRIX_HOMESERVER_URL ?? '',
    matrixUserId: env.MATRIX_USER_ID ?? '',
    matrixAccessTokenFile: env.MATRIX_ACCESS_TOKEN_FILE ?? '',
    matrixOutboundAuthTokenFile: env.MATRIX_OUTBOUND_AUTH_TOKEN_FILE ?? '',
    matrixOutboundTargetsFile: env.MATRIX_OUTBOUND_TARGETS_FILE ?? '',
    ingestUrl: env.INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL ?? '',
    mediaUploadUrl:
      env.INTEXURAOS_WHATSAPP_PRIVATE_MEDIA_URL ??
      defaultMediaUploadUrl(env.INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL ?? ''),
    mediaBackfillUrl:
      env.INTEXURAOS_WHATSAPP_PRIVATE_MEDIA_BACKFILL_URL ??
      defaultMediaBackfillUrl(env.INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL ?? ''),
    mediaStatusBaseUrl:
      env.INTEXURAOS_WHATSAPP_PRIVATE_MEDIA_STATUS_BASE_URL ??
      defaultPrivateMediaStatusBaseUrl(env.INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL ?? ''),
    googleApplicationCredentialsFile:
      env.INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE ??
      env.GOOGLE_APPLICATION_CREDENTIALS ??
      '',
    oidcAudience: env.INTEXURAOS_OIDC_AUDIENCE ?? 'https://intexuraos.cloud',
    oidcImpersonateServiceAccount: env.INTEXURAOS_OIDC_IMPERSONATE_SERVICE_ACCOUNT ?? '',
    expectedGoogleServiceAccount: env.INTEXURAOS_EXPECTED_GOOGLE_SERVICE_ACCOUNT ?? '',
    sourceAccountId: env.INTEXURAOS_SOURCE_ACCOUNT_ID ?? '',
    userId: env.INTEXURAOS_USER_ID ?? '',
    ownWhatsAppPhoneNumber: normalizePhoneNumber(env.SOURCE_WHATSAPP_PHONE_NUMBER ?? ''),
    stateFile: env.WHATSAPP_SYNC_STATE_FILE ?? '/data/state.json',
    pendingMediaFile: env.WHATSAPP_SYNC_PENDING_MEDIA_FILE ?? '/data/pending-media.json',
    maintenanceFenceFile: env.WHATSAPP_SYNC_MAINTENANCE_FENCE_FILE ?? '/data/recovery-required',
    pollTimeoutMs: Number(env.WHATSAPP_SYNC_POLL_TIMEOUT_MS ?? DEFAULT_POLL_TIMEOUT_MS),
    initialSyncTimeoutMs: Number(
      env.WHATSAPP_SYNC_INITIAL_TIMEOUT_MS ?? DEFAULT_INITIAL_SYNC_TIMEOUT_MS
    ),
    retryDelayMs: Number(env.WHATSAPP_SYNC_RETRY_DELAY_MS ?? DEFAULT_RETRY_DELAY_MS),
    bridgeBotUsers: parseBridgeBotUsers(env.MATRIX_BRIDGE_BOT_USERS),
  };
}

export function buildHealthPayload(config, readiness) {
  let state = readiness.runtimeState;
  if (!readiness.hasMatrixAccessToken) {
    state = 'waiting_for_matrix_access_token';
  } else if (!readiness.hasOidcCredentials) {
    state = 'waiting_for_intexuraos_oidc_credentials';
  }

  const payload = {
    ok: state !== 'error' && state !== 'recovery_required',
    state,
    homeserverUrl: config.homeserverUrl,
    matrixUserId: config.matrixUserId,
    ingestUrl: config.ingestUrl,
    sourceAccountId: config.sourceAccountId,
    counters: readiness.counters,
  };

  if (readiness.lastError !== undefined) {
    payload.lastError = readiness.lastError;
  }

  return payload;
}

export function buildIngestPayload(config, events, deliveryMode = 'live') {
  const payload = {
    sourceAccountId: config.sourceAccountId,
    // This adapter only streams live events after the initial Matrix checkpoint.
    // Backfill callers should use separate deterministic replay tooling.
    deliveryMode,
    events,
  };
  if (typeof config.userId === 'string' && config.userId !== '') {
    payload.userId = config.userId;
  }
  return payload;
}

export function createProcessingPlan(syncResponse, config, options) {
  const nextBatch =
    typeof syncResponse?.next_batch === 'string' && syncResponse.next_batch.length > 0
      ? syncResponse.next_batch
      : undefined;

  const limitedTimelineCount = syncRoomEntries(syncResponse).filter(
    ([, room]) => isRecord(room) && room.timeline?.limited === true
  ).length;
  const hasLimitedTimeline = limitedTimelineCount > 0;

  return {
    nextBatch,
    events:
      options.hasStoredBatch === true && !hasLimitedTimeline
        ? collectPrivateWhatsAppEvents(syncResponse, config, options.roomContexts)
        : [],
    shouldPersistNextBatch: nextBatch !== undefined && !hasLimitedTimeline,
    hasLimitedTimeline,
    limitedTimelineCount,
  };
}

export function collectPrivateWhatsAppEvents(syncResponse, config, roomContexts = {}) {
  const events = [];
  for (const [roomId, room] of syncRoomEntries(syncResponse)) {
    if (!isRecord(room)) {
      continue;
    }

    const context = mergeRoomContext(roomContexts[roomId], extractRoomContext(room));
    const timelineEvents = Array.isArray(room.timeline?.events) ? room.timeline.events : [];
    for (const event of timelineEvents) {
      const mapped = matrixEventToPrivateWhatsAppEvent(roomId, event, context, config);
      if (mapped !== null) {
        events.push(mapped);
      }
    }
  }

  return events;
}

export function extractRoomContexts(syncResponse, existingRoomContexts = {}) {
  const roomContexts = { ...existingRoomContexts };
  for (const [roomId, room] of syncRoomEntries(syncResponse)) {
    if (!isRecord(room)) {
      continue;
    }
    roomContexts[roomId] = mergeRoomContext(roomContexts[roomId], extractRoomContext(room));
  }

  return roomContexts;
}

export function collectWhatsAppInviteRoomIds(syncResponse, config) {
  const invitedRooms = syncResponse?.rooms?.invite;
  if (!isRecord(invitedRooms)) {
    return [];
  }

  const roomIds = [];
  for (const [roomId, room] of Object.entries(invitedRooms)) {
    if (isWhatsAppInviteRoom(room, config)) {
      roomIds.push(roomId);
    }
  }

  return roomIds;
}

export async function ensureRoomContextsForIncomingEvents(
  syncResponse,
  existingRoomContexts,
  config,
  fetchRoomState
) {
  const roomContexts = { ...existingRoomContexts };
  const leftRooms = new Set(
    isRecord(syncResponse?.rooms?.leave) ? Object.keys(syncResponse.rooms.leave) : []
  );
  for (const [roomId, room] of syncRoomEntries(syncResponse)) {
    if (!isRecord(room)) {
      continue;
    }

    let context = roomContexts[roomId] ?? { memberDisplayNames: {} };
    const incomingSenders = incomingWhatsAppSendersFromRoom(room, config);
    if (incomingSenders.length === 0) {
      continue;
    }
    if (leftRooms.has(roomId)) {
      roomContexts[roomId] = context;
      continue;
    }

    if (context.displayName === undefined) {
      context = mergeRoomContext(
        context,
        roomContextFromStateEvent('m.room.name', await fetchRoomState(roomId, 'm.room.name'))
      );
    }
    if (context.chatType === undefined) {
      context = mergeRoomContext(
        context,
        roomContextFromStateEvent('m.room.topic', await fetchRoomState(roomId, 'm.room.topic'))
      );
    }
    if (context.avatarMxcUri === undefined) {
      context = mergeRoomContext(
        context,
        roomContextFromStateEvent('m.room.avatar', await fetchRoomState(roomId, 'm.room.avatar'))
      );
    }

    for (const sender of incomingSenders) {
      if (context.memberDisplayNames?.[sender] !== undefined) {
        continue;
      }
      context = mergeRoomContext(
        context,
        roomContextFromStateEvent(
          'm.room.member',
          await fetchRoomState(roomId, 'm.room.member', sender),
          sender
        )
      );
    }
    roomContexts[roomId] = context;
  }

  return roomContexts;
}

export function matrixEventToPrivateWhatsAppEvent(roomId, event, roomContext, config) {
  if (!isRecord(event)) {
    return null;
  }

  const direction = getWhatsAppMatrixEventDirection(event, config);
  if (direction === null) {
    return null;
  }

  const eventId = readString(event, 'event_id');
  const sender = readString(event, 'sender');
  const eventTimestamp = readMatrixTimestamp(event);
  if (eventId === undefined || sender === undefined || eventTimestamp === undefined) {
    return null;
  }

  const message = matrixEventToMessage(event, direction);
  if (message === null) {
    return null;
  }

  const senderPhoneNumber = phoneNumberFromWhatsAppMxid(sender);
  const senderDisplayName =
    direction === 'outgoing' ? 'You' : roomContext.memberDisplayNames?.[sender];
  const chat = {
    type: inferChatType(roomContext),
  };

  if (roomContext.displayName !== undefined) {
    chat.displayName = roomContext.displayName;
  }
  if (roomContext.avatarMxcUri !== undefined) {
    chat.avatarMxcUri = roomContext.avatarMxcUri;
  }

  const mapped = {
    matrixRoomId: roomId,
    matrixEventId: eventId,
    matrixSenderId: sender,
    eventTimestamp,
    chat,
    sender: {},
    message,
    rawMatrixEvent: event,
  };

  if (senderDisplayName !== undefined) {
    mapped.sender.displayName = senderDisplayName;
  }
  if (senderPhoneNumber !== undefined) {
    mapped.sender.phoneNumber = senderPhoneNumber;
  }
  if (Object.keys(mapped.sender).length === 0) {
    delete mapped.sender;
  }

  return mapped;
}

export function classifyMatrixEventForRecovery(roomId, event, roomContext, config) {
  if (!isRecord(event)) {
    return { classification: 'error', reason: 'malformed_event' };
  }
  if (typeof event.state_key === 'string') {
    return { classification: 'policy_skip', reason: 'state_context_event' };
  }

  const type = readString(event, 'type');
  if (type === 'm.bridge' || type === 'uk.half-shot.bridge') {
    return { classification: 'policy_skip', reason: 'bridge_control_event' };
  }
  const content = isRecord(event.content) ? event.content : {};
  if (type === 'm.room.message' && readString(content, 'msgtype') === 'm.notice') {
    return { classification: 'policy_skip', reason: 'matrix_notice' };
  }
  if (type === 'm.room.encrypted') {
    return { classification: 'error', reason: 'encrypted_event' };
  }
  if (type === 'm.reaction' && isRedactedMessageTombstone(event, content)) {
    // The separate redaction event retains the removal semantics; this tombstone has no target or emoji.
    return { classification: 'policy_skip', reason: 'redacted_reaction_tombstone' };
  }

  const sender = readString(event, 'sender');
  if (sender === undefined) {
    return { classification: 'error', reason: 'malformed_message_like_event' };
  }
  const bridgeBotUsers = config.bridgeBotUsers ?? defaultBridgeBotUsers;
  const senderPhone = normalizePhoneNumber(phoneNumberFromWhatsAppMxid(sender) ?? '');
  const isOwnSender =
    sender === config.matrixUserId ||
    (config.ownWhatsAppPhoneNumber !== '' && senderPhone === config.ownWhatsAppPhoneNumber);
  if (bridgeBotUsers.has(sender) || (!isOwnSender && !isWhatsAppMatrixUserId(sender))) {
    return { classification: 'policy_skip', reason: 'explicit_non_whatsapp_sender' };
  }

  const mapped = matrixEventToPrivateWhatsAppEvent(roomId, event, roomContext, config);
  if (mapped !== null) {
    return { classification: 'mapped', event: mapped };
  }
  if (
    type === 'm.room.message' ||
    type === 'm.reaction' ||
    type === 'm.sticker' ||
    type === 'm.room.redaction'
  ) {
    return { classification: 'error', reason: 'malformed_message_like_event' };
  }
  return { classification: 'error', reason: 'unsupported_event_type' };
}

export function isIncomingWhatsAppMatrixEvent(event, config) {
  return getWhatsAppMatrixEventDirection(event, config) === 'incoming';
}

function getWhatsAppMatrixEventDirection(event, config) {
  const sender = readString(event, 'sender');
  if (sender === undefined) {
    return null;
  }
  const bridgeBotUsers = config.bridgeBotUsers ?? defaultBridgeBotUsers;
  if (bridgeBotUsers.has(sender)) {
    return null;
  }

  const senderPhone = normalizePhoneNumber(phoneNumberFromWhatsAppMxid(sender) ?? '');
  let direction = 'incoming';
  if (sender === config.matrixUserId) {
    direction = 'outgoing';
  } else if (
    config.ownWhatsAppPhoneNumber !== '' &&
    senderPhone === config.ownWhatsAppPhoneNumber
  ) {
    direction = 'outgoing';
  } else if (!isWhatsAppMatrixUserId(sender)) {
    return null;
  }

  const type = readString(event, 'type');
  if (type === 'm.reaction' || type === 'm.sticker' || type === 'm.room.redaction') {
    return direction;
  }
  if (type !== 'm.room.message') {
    return null;
  }

  const content = isRecord(event.content) ? event.content : {};
  const msgtype = readString(content, 'msgtype');
  return msgtype === 'm.notice' ? null : direction;
}

export function buildImpersonatedIdTokenRequest(config, sourceAccessToken) {
  return {
    url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
      config.oidcImpersonateServiceAccount
    )}:generateIdToken`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sourceAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audience: config.oidcAudience,
        includeEmail: true,
      }),
    },
  };
}

export async function runSyncLoop(config, runtime) {
  for (;;) {
    try {
      await runSyncIteration(config, runtime);
      if (
        runtime.state === 'recovery_required' ||
        runtime.state === 'waiting_for_matrix_access_token' ||
        runtime.state === 'waiting_for_intexuraos_oidc_credentials'
      ) {
        await delay(config.retryDelayMs);
      }
    } catch (error) {
      const safeError = sanitizeError(error);
      runtime.state = safeError === 'matrix_timeline_limited' ? 'recovery_required' : 'error';
      runtime.counters.errors = (runtime.counters.errors ?? 0) + 1;
      runtime.lastError = safeError;
      console.error(
        JSON.stringify({
          event: 'whatsapp_sync_loop_error',
          error: runtime.lastError,
        })
      );
      await delay(config.retryDelayMs);
    }
  }
}

export async function runSyncIteration(config, runtime, deps = {}) {
  const hasMaintenanceFenceFn = deps.hasMaintenanceFence ?? hasMaintenanceFence;
  const readAccessTokenFn = deps.readAccessToken ?? readAccessToken;
  const hasNonEmptyFileFn = deps.hasNonEmptyFile ?? hasNonEmptyFile;
  const readSyncStateFn = deps.readSyncState ?? readSyncState;
  const fetchMatrixSyncFn = deps.fetchMatrixSync ?? fetchMatrixSync;
  const fetchMatrixRoomStateFn = deps.fetchMatrixRoomState ?? fetchMatrixRoomState;
  const fetchMatrixMediaFn = deps.fetchMatrixMedia ?? fetchMatrixMedia;
  const joinMatrixRoomFn = deps.joinMatrixRoom ?? joinMatrixRoom;
  const postEventsInBatchesFn = deps.postEventsInBatches ?? postEventsInBatches;
  const uploadPrivateMediaFn = deps.uploadPrivateMedia ?? uploadPrivateMedia;
  const checkPrivateMediaStoredFn = deps.checkPrivateMediaStored ?? checkPrivateMediaStored;
  const postPrivateMediaBackfillFn = deps.postPrivateMediaBackfill ?? postPrivateMediaBackfill;
  const writeSyncStateFn = deps.writeSyncState ?? writeSyncState;
  const nowISOString = deps.nowISOString ?? (() => new Date().toISOString());

  if (hasMaintenanceFenceFn(config.maintenanceFenceFile)) {
    runtime.state = 'recovery_required';
    return;
  }

  const matrixAccessToken = readAccessTokenFn(config.matrixAccessTokenFile);
  const hasOidcCredentials = hasNonEmptyFileFn(config.googleApplicationCredentialsFile);
  if (matrixAccessToken === '') {
    runtime.state = 'waiting_for_matrix_access_token';
    return;
  }
  if (!hasOidcCredentials) {
    runtime.state = 'waiting_for_intexuraos_oidc_credentials';
    return;
  }
  if (config.expectedGoogleServiceAccount !== '') {
    validateGoogleCredentialIdentity(
      config,
      fs.readFileSync(config.googleApplicationCredentialsFile, 'utf8')
    );
  }

  const state = await readSyncStateFn(config.stateFile);
  const hasStoredBatch = typeof state.nextBatch === 'string' && state.nextBatch.length > 0;
  runtime.state = hasStoredBatch ? 'running' : 'initializing';

  let syncResponse = await fetchMatrixSyncFn(
    config,
    matrixAccessToken,
    state.nextBatch,
    hasStoredBatch ? config.pollTimeoutMs : config.initialSyncTimeoutMs
  );
  let syncResponseCount = 1;

  const inviteRoomIds = collectWhatsAppInviteRoomIds(syncResponse, config);
  if (inviteRoomIds.length > 0) {
    for (const roomId of inviteRoomIds) {
      await joinMatrixRoomFn(config, matrixAccessToken, roomId);
    }
    runtime.counters.joinedRooms = (runtime.counters.joinedRooms ?? 0) + inviteRoomIds.length;

    syncResponse = await fetchMatrixSyncFn(config, matrixAccessToken, state.nextBatch, 0);
    syncResponseCount += 1;
  }

  let roomContexts = extractRoomContexts(syncResponse, state.roomContexts ?? {});
  let plan = createProcessingPlan(syncResponse, config, {
    hasStoredBatch,
    roomContexts,
  });
  runtime.counters.syncResponses = (runtime.counters.syncResponses ?? 0) + syncResponseCount;

  if (plan.hasLimitedTimeline) {
    runtime.counters.limitedTimelines = plan.limitedTimelineCount;
    runtime.state = 'recovery_required';
    throw new Error('matrix_timeline_limited');
  }

  if (hasStoredBatch) {
    roomContexts = await ensureRoomContextsForIncomingEvents(
      syncResponse,
      roomContexts,
      config,
      (roomId, stateType, stateKey) =>
        fetchMatrixRoomStateFn(config, matrixAccessToken, roomId, stateType, stateKey)
    );
    plan = createProcessingPlan(syncResponse, config, {
      hasStoredBatch,
      roomContexts,
    });
  }

  if (plan.events.length > 0) {
    await postEventsInBatchesFn(config, plan.events);
    await enqueuePendingMedia(
      config.pendingMediaFile,
      config.sourceAccountId,
      plan.events,
      nowISOString()
    );
    runtime.counters.postedEvents = (runtime.counters.postedEvents ?? 0) + plan.events.length;
  }

  if (plan.shouldPersistNextBatch) {
    await writeSyncStateFn(config.stateFile, {
      nextBatch: plan.nextBatch,
      roomContexts,
      updatedAt: nowISOString(),
    });
  }

  const mediaResult = await drainPendingMedia(config, matrixAccessToken, {
    fetchMatrixMedia: fetchMatrixMediaFn,
    uploadPrivateMedia: uploadPrivateMediaFn,
    checkPrivateMediaStored: checkPrivateMediaStoredFn,
    postPrivateMediaBackfill: postPrivateMediaBackfillFn,
    nowISOString,
  });
  runtime.counters.mediaPending = mediaResult.pending;
  runtime.counters.mediaStored = (runtime.counters.mediaStored ?? 0) + mediaResult.stored;
  runtime.counters.mediaFailures = (runtime.counters.mediaFailures ?? 0) + mediaResult.failed;
  runtime.state = mediaResult.pending > 0 ? 'media_degraded' : 'running';
  if (mediaResult.pending > 0) {
    runtime.lastError = `pending_private_media_${mediaResult.pending}`;
  } else {
    delete runtime.lastError;
  }
}

export async function prepareEventsForIngest(config, matrixAccessToken, events, deps) {
  const prepared = [];
  for (const event of events) {
    if (
      !isPrivateMediaUploadMessageType(event?.message?.type) ||
      event.message.media?.mxcUri === undefined
    ) {
      prepared.push(event);
      continue;
    }
    if (event.message.media.gcsPath !== undefined) {
      prepared.push(event);
      continue;
    }

    const downloaded = await deps.fetchMatrixMedia(
      config,
      matrixAccessToken,
      event.message.media.mxcUri
    );
    const storedMedia = await deps.uploadPrivateMedia(
      config,
      event,
      event.message.media,
      downloaded
    );
    prepared.push({
      ...event,
      message: {
        ...event.message,
        media: {
          ...event.message.media,
          ...storedMedia,
        },
      },
    });
  }
  return prepared;
}

export async function enqueuePendingMedia(pendingMediaFile, sourceAccountId, events, queuedAt) {
  const queue = await readPendingMediaQueue(pendingMediaFile);
  const knownKeys = new Set(queue.items.map((item) => `${item.messageId}\0${item.mediaKind}`));
  let changed = false;

  for (const event of events) {
    const media = event?.message?.media;
    if (
      !isPrivateMediaUploadMessageType(event?.message?.type) ||
      typeof media?.mxcUri !== 'string' ||
      media.mxcUri === '' ||
      media.gcsPath !== undefined ||
      typeof event.matrixEventId !== 'string'
    ) {
      continue;
    }
    const messageId = createPrivateWhatsAppMessageId(sourceAccountId, event.matrixEventId);
    const key = `${messageId}\0${event.message.type}`;
    if (knownKeys.has(key)) {
      continue;
    }
    queue.items.push({
      messageId,
      mediaKind: event.message.type,
      matrixEventId: event.matrixEventId,
      media,
      queuedAt,
      attempts: 0,
    });
    knownKeys.add(key);
    changed = true;
  }

  if (changed) {
    await writePendingMediaQueue(pendingMediaFile, queue);
  }
  return queue.items.length;
}

export async function drainPendingMedia(config, matrixAccessToken, deps) {
  const queue = await readPendingMediaQueue(config.pendingMediaFile);
  if (queue.items.length === 0) {
    return { stored: 0, failed: 0, pending: 0 };
  }
  const remaining = [];
  let stored = 0;
  let failed = 0;

  for (const item of queue.items) {
    try {
      const checkPrivateMediaStoredFn = deps.checkPrivateMediaStored ?? checkPrivateMediaStored;
      if (await checkPrivateMediaStoredFn(config, item.messageId)) {
        stored += 1;
        continue;
      }
      const downloaded = await deps.fetchMatrixMedia(config, matrixAccessToken, item.media.mxcUri);
      const storedMedia = await deps.uploadPrivateMedia(
        config,
        { matrixEventId: item.matrixEventId },
        item.media,
        downloaded
      );
      await deps.postPrivateMediaBackfill(config, {
        sourceAccountId: config.sourceAccountId,
        messageId: item.messageId,
        media: {
          ...item.media,
          ...storedMedia,
        },
      });
      stored += 1;
    } catch (error) {
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastAttemptAt: deps.nowISOString(),
        lastError: sanitizeError(error),
      });
      failed += 1;
    }
  }

  await writePendingMediaQueue(config.pendingMediaFile, {
    version: 1,
    items: remaining,
  });
  return { stored, failed, pending: remaining.length };
}

export async function checkPrivateMediaStored(config, messageId) {
  if (config.mediaStatusBaseUrl === '') {
    throw new Error('missing_private_media_status_url');
  }
  const authorization = await createGoogleIdentityAuthorizationHeader(config);
  const url = new URL(`${config.mediaStatusBaseUrl}/${encodeURIComponent(messageId)}/media`);
  url.searchParams.set('sourceAccountId', config.sourceAccountId);
  const response = await fetch(url, {
    headers: {
      authorization,
      'user-agent': 'home-dev-whatsapp-sync/1.0',
    },
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`intexuraos_private_media_status_failed_${response.status}`);
  }
  const body = await response.json();
  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    !isRecord(body.data.media) ||
    typeof body.data.media.gcsPath !== 'string'
  ) {
    throw new Error('intexuraos_private_media_status_invalid_response');
  }
  return true;
}

export function createPrivateWhatsAppMessageId(sourceAccountId, matrixEventId) {
  return createHash('sha256').update(`${sourceAccountId}\0${matrixEventId}`).digest('hex');
}

export async function backfillPrivateMedia(config, input, deps = {}) {
  const readAccessTokenFn = deps.readAccessToken ?? readAccessToken;
  const fetchMatrixMediaFn = deps.fetchMatrixMedia ?? fetchMatrixMedia;
  const uploadPrivateMediaFn = deps.uploadPrivateMedia ?? uploadPrivateMedia;
  const postPrivateMediaBackfillFn = deps.postPrivateMediaBackfill ?? postPrivateMediaBackfill;

  const matrixAccessToken = readAccessTokenFn(config.matrixAccessTokenFile);
  if (matrixAccessToken === '') {
    throw new Error('missing_matrix_access_token');
  }
  if (!isRecord(input) || typeof input.messageId !== 'string' || !isRecord(input.media)) {
    throw new Error('invalid_private_media_backfill_input');
  }

  const matrixEventId =
    typeof input.matrixEventId === 'string' && input.matrixEventId !== ''
      ? input.matrixEventId
      : matrixEventIdFromPrivateMessageId(input.messageId, config.sourceAccountId);
  const media = input.media;
  if (typeof media.mxcUri !== 'string' || media.mxcUri === '') {
    throw new Error('missing_private_media_mxc_uri');
  }

  const downloaded = await fetchMatrixMediaFn(config, matrixAccessToken, media.mxcUri);
  const storedMedia = await uploadPrivateMediaFn(config, { matrixEventId }, media, downloaded);
  return await postPrivateMediaBackfillFn(config, {
    sourceAccountId: config.sourceAccountId,
    messageId: input.messageId,
    media: {
      ...media,
      ...storedMedia,
    },
  });
}

function isPrivateMediaUploadMessageType(messageType) {
  return (
    messageType === 'image' ||
    messageType === 'audio' ||
    messageType === 'video' ||
    messageType === 'file' ||
    messageType === 'sticker'
  );
}

export function createHealthServer(config, runtime) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (request.method === 'GET' && url.pathname === '/health') {
        const payload = buildHealthPayload(config, {
          hasMatrixAccessToken: readAccessToken(config.matrixAccessTokenFile) !== '',
          hasOidcCredentials: hasNonEmptyFile(config.googleApplicationCredentialsFile),
          runtimeState: runtime.state,
          counters: runtime.counters,
          lastError: runtime.lastError,
        });

        const status =
          payload.state === 'error' || payload.state === 'recovery_required' ? 503 : 200;
        writeJson(response, status, payload);
        return;
      }

      const readinessMatch = url.pathname.match(
        /^\/internal\/matrix\/outbound\/readiness\/([^/]+)\/([^/]+)$/
      );
      if (request.method === 'GET' && readinessMatch !== null) {
        if (!isAuthorizedRequest(request, config.matrixOutboundAuthTokenFile)) {
          writeJson(response, 401, { ok: false, error: 'unauthorized' });
          return;
        }

        const [, rawSourceAccountId, rawTarget] = readinessMatch;
        const resolved = resolveMatrixOutboundContext(config, {
          sourceAccountId: decodeURIComponent(rawSourceAccountId),
          target: decodeURIComponent(rawTarget),
        });
        if (!resolved.ok) {
          writeJson(response, 200, {
            status: 'setup_required',
            reason: resolved.reason,
          });
          return;
        }

        writeJson(response, 200, { status: 'ready' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/internal/matrix/outbound/messages') {
        if (!isAuthorizedRequest(request, config.matrixOutboundAuthTokenFile)) {
          writeJson(response, 401, { ok: false, error: 'unauthorized' });
          return;
        }

        const body = await readJsonRequestBody(request);
        const result = await sendMatrixOutboundMessage(config, body);
        if (result.status === 'setup_required') {
          writeJson(response, 200, result);
          return;
        }
        if (result.status === 'invalid_request') {
          writeJson(response, 400, result);
          return;
        }

        writeJson(response, 200, result);
        return;
      }

      writeJson(response, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: 'internal_error',
        reason: sanitizeError(error),
      });
    }
  });
}

export function start(config = createConfig()) {
  const runtime = {
    state: 'starting',
    counters: {},
  };
  const server = createHealthServer(config, runtime);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        event: 'whatsapp_sync_started',
        port: config.port,
        homeserverUrl: config.homeserverUrl,
        matrixUserId: config.matrixUserId,
        ingestUrl: config.ingestUrl,
        sourceAccountId: config.sourceAccountId,
      })
    );
  });

  runSyncLoop(config, runtime).catch((error) => {
    runtime.state = 'error';
    runtime.lastError = sanitizeError(error);
    console.error(JSON.stringify({ event: 'whatsapp_sync_fatal', error: runtime.lastError }));
  });

  return { server, runtime };
}

function syncRoomEntries(syncResponse) {
  const rooms = new Map();
  for (const membership of ['join', 'leave']) {
    const section = syncResponse?.rooms?.[membership];
    if (!isRecord(section)) {
      continue;
    }
    for (const [roomId, room] of Object.entries(section)) {
      rooms.set(roomId, room);
    }
  }
  return [...rooms.entries()];
}

function extractRoomContext(room) {
  const context = {
    memberDisplayNames: {},
  };
  const whatsappMemberIds = new Set();

  const stateEvents = [
    ...(Array.isArray(room.state?.events) ? room.state.events : []),
    ...(Array.isArray(room.timeline?.events) ? room.timeline.events : []),
  ];

  for (const event of stateEvents) {
    if (!isRecord(event)) {
      continue;
    }
    const type = readString(event, 'type');
    if (type === 'm.room.name' && isRecord(event.content)) {
      const name = readString(event.content, 'name');
      if (name !== undefined) {
        context.displayName = name;
      }
      continue;
    }
    if (type === 'm.room.topic' && isRecord(event.content)) {
      const topic = readString(event.content, 'topic');
      if (topic !== undefined) {
        context.chatType = chatTypeFromTopic(topic);
      }
      continue;
    }
    if (type === 'm.room.avatar' && isRecord(event.content)) {
      const avatarMxcUri = readString(event.content, 'url');
      if (avatarMxcUri !== undefined) {
        context.avatarMxcUri = avatarMxcUri;
      }
      continue;
    }

    if (
      type === 'm.room.member' &&
      typeof event.state_key === 'string' &&
      isRecord(event.content)
    ) {
      if (isActiveWhatsAppMember(event)) {
        whatsappMemberIds.add(event.state_key);
      }
      const displayName = readString(event.content, 'displayname');
      if (displayName !== undefined) {
        context.memberDisplayNames[event.state_key] = displayName;
      }
    }
  }

  if (whatsappMemberIds.size > 0) {
    context.whatsappMemberCount = whatsappMemberIds.size;
  }

  return context;
}

function roomContextFromStateEvent(type, content, stateKey) {
  if (!isRecord(content)) {
    return { memberDisplayNames: {} };
  }

  if (type === 'm.room.name') {
    const name = readString(content, 'name');
    return name === undefined
      ? { memberDisplayNames: {} }
      : { displayName: name, memberDisplayNames: {} };
  }
  if (type === 'm.room.topic') {
    const topic = readString(content, 'topic');
    return topic === undefined
      ? { memberDisplayNames: {} }
      : { chatType: chatTypeFromTopic(topic), memberDisplayNames: {} };
  }
  if (type === 'm.room.avatar') {
    const avatarMxcUri = readString(content, 'url');
    return avatarMxcUri === undefined
      ? { memberDisplayNames: {} }
      : { avatarMxcUri, memberDisplayNames: {} };
  }
  if (type === 'm.room.member' && stateKey !== undefined) {
    const displayName = readString(content, 'displayname');
    const context =
      displayName === undefined
        ? { memberDisplayNames: {} }
        : { memberDisplayNames: { [stateKey]: displayName } };
    if (isWhatsAppMatrixUserId(stateKey) && readString(content, 'membership') !== 'leave') {
      context.whatsappMemberCount = 1;
    }
    return context;
  }

  return { memberDisplayNames: {} };
}

function incomingWhatsAppSendersFromRoom(room, config) {
  const timelineEvents = Array.isArray(room.timeline?.events) ? room.timeline.events : [];
  const senders = [];
  for (const event of timelineEvents) {
    if (isRecord(event) && isIncomingWhatsAppMatrixEvent(event, config)) {
      const sender = readString(event, 'sender');
      if (sender !== undefined && !senders.includes(sender)) {
        senders.push(sender);
      }
    }
  }
  return senders;
}

function isWhatsAppInviteRoom(room, config) {
  if (!isRecord(room)) {
    return false;
  }

  const inviteStateEvents = Array.isArray(room.invite_state?.events)
    ? room.invite_state.events
    : [];
  const bridgeBotUsers = config.bridgeBotUsers ?? defaultBridgeBotUsers;
  return inviteStateEvents.some((event) => {
    if (!isRecord(event)) {
      return false;
    }
    const sender = readString(event, 'sender');
    if (sender !== undefined && bridgeBotUsers.has(sender)) {
      return true;
    }

    return readString(event, 'type') === 'm.bridge';
  });
}

function mergeRoomContext(existing, next) {
  const merged = {
    ...(existing ?? {}),
    ...next,
    memberDisplayNames: {
      ...((existing ?? {}).memberDisplayNames ?? {}),
      ...(next.memberDisplayNames ?? {}),
    },
  };
  const existingCount = (existing ?? {}).whatsappMemberCount;
  const nextCount = next.whatsappMemberCount;
  if (typeof existingCount === 'number' || typeof nextCount === 'number') {
    merged.whatsappMemberCount = Math.max(existingCount ?? 0, nextCount ?? 0);
  }
  return merged;
}

function matrixEventToMessage(event, direction) {
  const type = readString(event, 'type');
  const eventId = readString(event, 'event_id');
  const content = isRecord(event.content) ? event.content : {};

  if (type === 'm.room.redaction') {
    const targetMatrixEventId = readString(event, 'redacts') ?? readString(content, 'redacts');
    if (targetMatrixEventId === undefined || targetMatrixEventId === eventId) {
      return null;
    }
    return {
      direction,
      type: 'redaction',
      relation: {
        kind: 'redaction',
        targetMatrixEventId,
        applicationStatus: 'pending',
      },
    };
  }

  if (type === 'm.reaction') {
    const relation = isRecord(content['m.relates_to']) ? content['m.relates_to'] : {};
    const reactionText = readString(relation, 'key');
    const targetMatrixEventId = readString(relation, 'event_id');
    if (
      readString(relation, 'rel_type') !== 'm.annotation' ||
      reactionText === undefined ||
      targetMatrixEventId === undefined ||
      targetMatrixEventId === eventId
    ) {
      return null;
    }
    return {
      direction,
      type: 'reaction',
      text: reactionText,
      reaction: { emoji: reactionText, targetMatrixEventId },
    };
  }

  if (type === 'm.sticker') {
    return withMediaFromContent(
      withOptionalText({ direction, type: 'sticker' }, readString(content, 'body')),
      content
    );
  }

  if (type !== 'm.room.message') {
    return null;
  }

  if (isRedactedMessageTombstone(event, content)) {
    return { direction, type: 'unknown' };
  }

  const relatesTo = isRecord(content['m.relates_to']) ? content['m.relates_to'] : {};
  if (readString(relatesTo, 'rel_type') === 'm.replace') {
    const targetMatrixEventId = readString(relatesTo, 'event_id');
    const replacementContent = isRecord(content['m.new_content'])
      ? content['m.new_content']
      : undefined;
    if (
      targetMatrixEventId === undefined ||
      targetMatrixEventId === eventId ||
      replacementContent === undefined
    ) {
      return null;
    }
    const replacementType = messageTypeFromMatrixMsgtype(readString(replacementContent, 'msgtype'));
    if (replacementType === undefined) {
      return null;
    }
    const replacement = withOptionalText(
      {
        direction,
        type: replacementType,
        relation: {
          kind: 'replacement',
          targetMatrixEventId,
          applicationStatus: 'pending',
        },
      },
      readString(replacementContent, 'body')
    );
    return replacementType === 'text'
      ? replacement
      : withMediaFromContent(replacement, replacementContent);
  }

  const msgtype = readString(content, 'msgtype');
  const messageType = messageTypeFromMatrixMsgtype(msgtype);
  if (messageType === undefined) {
    return null;
  }

  const message = withOptionalText({ direction, type: messageType }, readString(content, 'body'));

  if (messageType === 'text') {
    return message;
  }

  return withMediaFromContent(message, content);
}

function isRedactedMessageTombstone(event, content) {
  if (Object.keys(content).length !== 0 || !isRecord(event.unsigned)) {
    return false;
  }
  const redactedBy = readString(event.unsigned, 'redacted_by');
  const redactedBecause = isRecord(event.unsigned.redacted_because)
    ? event.unsigned.redacted_because
    : undefined;
  return (
    redactedBy !== undefined &&
    redactedBecause !== undefined &&
    readString(redactedBecause, 'type') === 'm.room.redaction' &&
    readString(redactedBecause, 'event_id') === redactedBy
  );
}

function withOptionalText(message, text) {
  if (text !== undefined) {
    return { ...message, text };
  }
  return message;
}

function withMediaFromContent(message, content) {
  const mxcUri = readString(content, 'url') ?? readString(content.file, 'url');
  if (mxcUri === undefined) {
    return message;
  }

  const info = isRecord(content.info) ? content.info : {};
  const media = { mxcUri };
  const mimeType = readString(info, 'mimetype');
  if (mimeType !== undefined) {
    media.mimeType = mimeType;
  }
  const sizeBytes = info.size;
  if (typeof sizeBytes === 'number' && Number.isFinite(sizeBytes)) {
    media.sizeBytes = sizeBytes;
  }
  const width = readFinitePositiveNumber(info.w);
  if (width !== undefined) {
    media.width = width;
  }
  const height = readFinitePositiveNumber(info.h);
  if (height !== undefined) {
    media.height = height;
  }
  const fileName = readString(content, 'filename') ?? readString(content, 'body');
  if (fileName !== undefined) {
    media.fileName = fileName;
  }

  return { ...message, media };
}

function readFinitePositiveNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function messageTypeFromMatrixMsgtype(msgtype) {
  switch (msgtype) {
    case 'm.text':
    case 'm.emote':
      return 'text';
    case 'm.image':
      return 'image';
    case 'm.audio':
      return 'audio';
    case 'm.video':
      return 'video';
    case 'm.file':
      return 'file';
    case 'm.location':
      return 'unknown';
    default:
      return undefined;
  }
}

function chatTypeFromTopic(topic) {
  const lower = topic.toLowerCase();
  if (lower.includes('private chat') || lower.includes('direct')) {
    return 'direct';
  }
  if (lower.includes('group')) {
    return 'group';
  }
  return 'unknown';
}

function inferChatType(roomContext) {
  if (roomContext.chatType !== undefined && roomContext.chatType !== 'unknown') {
    return roomContext.chatType;
  }
  const cachedWhatsAppMemberCount =
    typeof roomContext.whatsappMemberCount === 'number' ? roomContext.whatsappMemberCount : 0;
  const whatsappMemberCount = Math.max(
    cachedWhatsAppMemberCount,
    countWhatsAppMembers(roomContext.memberDisplayNames)
  );
  if (whatsappMemberCount > 2) {
    return 'group';
  }
  if (whatsappMemberCount > 0) {
    return 'direct';
  }
  return roomContext.chatType ?? 'unknown';
}

function countWhatsAppMembers(memberDisplayNames) {
  if (!isRecord(memberDisplayNames)) {
    return 0;
  }
  return Object.keys(memberDisplayNames).filter(isWhatsAppMatrixUserId).length;
}

function isActiveWhatsAppMember(event) {
  if (!isRecord(event) || !isRecord(event.content) || typeof event.state_key !== 'string') {
    return false;
  }
  const membership = readString(event.content, 'membership');
  return isWhatsAppMatrixUserId(event.state_key) && membership !== 'leave' && membership !== 'ban';
}

export function isWhatsAppMatrixUserId(value) {
  return typeof value === 'string' && /^@whatsapp_(?:[0-9]+|lid-[A-Za-z0-9_-]+):/.test(value);
}

function readMatrixTimestamp(event) {
  const value = event.origin_server_ts;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
}

export function parseMxcUri(mxcUri) {
  if (typeof mxcUri !== 'string' || !mxcUri.startsWith('mxc://')) {
    throw new Error('invalid_mxc_uri');
  }
  const withoutScheme = mxcUri.slice('mxc://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) {
    throw new Error('invalid_mxc_uri');
  }
  return {
    serverName: withoutScheme.slice(0, slashIndex),
    mediaId: withoutScheme.slice(slashIndex + 1),
  };
}

function mediaIdFromMxcUri(mxcUri) {
  const parsed = parseMxcUri(mxcUri);
  return `${parsed.serverName}-${parsed.mediaId}`;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function isAuthorizedRequest(request, authTokenFile) {
  const expectedToken = readAccessToken(authTokenFile);
  if (expectedToken === '') {
    return false;
  }

  const authorization = request.headers.authorization;
  return typeof authorization === 'string' && authorization === `Bearer ${expectedToken}`;
}

async function readJsonRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function resolveMatrixOutboundContext(config, request) {
  if (typeof request?.sourceAccountId !== 'string' || request.sourceAccountId === '') {
    return { ok: false, reason: 'missing_matrix_outbound_source_account' };
  }
  if (typeof request?.target !== 'string' || request.target === '') {
    return { ok: false, reason: 'missing_matrix_outbound_target' };
  }

  const targets = readMatrixOutboundTargets(config.matrixOutboundTargetsFile);
  if (!targets.ok) {
    return targets;
  }

  const sourceTargets = targets.value[request.sourceAccountId];
  if (!isRecord(sourceTargets)) {
    return { ok: false, reason: 'missing_matrix_outbound_source_account' };
  }

  const roomId = readString(sourceTargets, request.target);
  if (roomId === undefined || roomId === '') {
    return { ok: false, reason: 'missing_matrix_outbound_target' };
  }

  if (config.homeserverUrl === '') {
    return { ok: false, reason: 'missing_matrix_homeserver_url' };
  }

  const accessToken = readAccessToken(config.matrixAccessTokenFile);
  if (accessToken === '') {
    return { ok: false, reason: 'missing_matrix_access_token' };
  }

  return {
    ok: true,
    accessToken,
    roomId,
  };
}

function readMatrixOutboundTargets(filePath) {
  if (typeof filePath !== 'string' || filePath === '') {
    return { ok: false, reason: 'missing_matrix_outbound_targets' };
  }

  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isRecord(value)) {
      return { ok: false, reason: 'invalid_matrix_outbound_targets' };
    }
    return { ok: true, value };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: false, reason: 'missing_matrix_outbound_targets' };
    }
    return { ok: false, reason: 'invalid_matrix_outbound_targets' };
  }
}

async function sendMatrixOutboundMessage(config, request) {
  const resolved = resolveMatrixOutboundContext(config, request);
  if (!resolved.ok) {
    return {
      status: 'setup_required',
      reason: resolved.reason,
    };
  }
  if (typeof request?.text !== 'string' || request.text === '') {
    return {
      status: 'invalid_request',
      reason: 'missing_text',
    };
  }

  const transactionId =
    typeof request.idempotencyKey === 'string' && request.idempotencyKey !== ''
      ? request.idempotencyKey
      : `matrix-outbound-${Date.now()}`;
  const url = new URL(
    `/_matrix/client/v3/rooms/${encodeURIComponent(resolved.roomId)}/send/m.room.message/${encodeURIComponent(transactionId)}`,
    config.homeserverUrl
  );
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${resolved.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      msgtype: 'm.text',
      body: request.text,
    }),
  });

  if (!response.ok) {
    throw new Error(`matrix_outbound_send_failed_${response.status}`);
  }

  const body = await response.json();
  const matrixEventId = isRecord(body) ? readString(body, 'event_id') : undefined;
  if (matrixEventId === undefined || matrixEventId === '') {
    throw new Error('matrix_outbound_send_missing_event_id');
  }

  return {
    status: 'sent',
    matrixEventId,
  };
}

export function buildMatrixMediaDownloadUrl(config, mxcUri) {
  const { serverName, mediaId } = parseMxcUri(mxcUri);
  return new URL(
    `/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
    config.homeserverUrl
  ).toString();
}

async function fetchMatrixSync(config, accessToken, since, timeoutMs) {
  const url = new URL('/_matrix/client/v3/sync', config.homeserverUrl);
  url.searchParams.set('timeout', String(timeoutMs));
  url.searchParams.set('set_presence', 'offline');
  if (since !== undefined) {
    url.searchParams.set('since', since);
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`matrix_sync_failed_${response.status}`);
  }

  return await response.json();
}

async function fetchMatrixRoomState(config, accessToken, roomId, stateType, stateKey) {
  const statePath =
    stateKey === undefined
      ? `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(stateType)}`
      : `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(stateType)}/${encodeURIComponent(stateKey)}`;
  const url = new URL(statePath, config.homeserverUrl);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) {
    return {};
  }
  if (!response.ok) {
    throw new Error(`matrix_room_state_failed_${response.status}`);
  }
  return await response.json();
}

export async function fetchMatrixMedia(config, accessToken, mxcUri) {
  const response = await fetch(buildMatrixMediaDownloadUrl(config, mxcUri), {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'home-dev-whatsapp-sync/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`matrix_media_download_failed_${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_PRIVATE_MEDIA_BYTES) {
    throw new Error('matrix_media_too_large');
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    return {
      buffer: Buffer.alloc(0),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PRIVATE_MEDIA_BYTES) {
        await reader.cancel('matrix_media_too_large');
        throw new Error('matrix_media_too_large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return {
    buffer: Buffer.concat(chunks, totalBytes),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

async function joinMatrixRoom(config, accessToken, roomId) {
  const url = new URL(
    `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
    config.homeserverUrl
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    throw new Error(`matrix_join_failed_${response.status}`);
  }

  return await response.json();
}

export async function postEventsInBatches(config, events, deliveryMode = 'live') {
  const results = [];
  for (let index = 0; index < events.length; index += MAX_EVENTS_PER_INGEST_REQUEST) {
    const batch = events.slice(index, index + MAX_EVENTS_PER_INGEST_REQUEST);
    results.push(await postEvents(config, batch, deliveryMode));
  }
  return results;
}

export async function postEvents(config, events, deliveryMode = 'live') {
  const authorization = await createGoogleIdentityAuthorizationHeader(config);
  const response = await fetch(config.ingestUrl, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      'user-agent': 'home-dev-whatsapp-sync/1.0',
    },
    body: JSON.stringify(buildIngestPayload(config, events, deliveryMode)),
  });

  if (!response.ok) {
    throw new Error(`intexuraos_ingest_failed_${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('intexuraos_ingest_invalid_response');
  }
  validateIngestResponse(body, events);
  return body.data;
}

export function validateIngestResponse(body, events) {
  const data = isRecord(body) && body.success === true && isRecord(body.data) ? body.data : null;
  if (
    data === null ||
    !Number.isInteger(data.accepted) ||
    !Number.isInteger(data.duplicates) ||
    data.rejected !== 0 ||
    !Array.isArray(data.messages) ||
    data.messages.length !== events.length
  ) {
    throw new Error('intexuraos_ingest_invalid_response');
  }

  const expected = events.map((event) => event?.matrixEventId).sort();
  const actual = [];
  let created = 0;
  let duplicates = 0;
  for (const message of data.messages) {
    if (
      !isRecord(message) ||
      typeof message.matrixEventId !== 'string' ||
      (message.outcome !== 'created' && message.outcome !== 'duplicate')
    ) {
      throw new Error('intexuraos_ingest_invalid_response');
    }
    actual.push(message.matrixEventId);
    created += message.outcome === 'created' ? 1 : 0;
    duplicates += message.outcome === 'duplicate' ? 1 : 0;
  }
  actual.sort();
  if (
    created !== data.accepted ||
    duplicates !== data.duplicates ||
    expected.some((eventId, index) => eventId !== actual[index])
  ) {
    throw new Error('intexuraos_ingest_invalid_response');
  }
}

export async function uploadPrivateMedia(config, event, media, downloaded) {
  if (config.mediaUploadUrl === '') {
    throw new Error('missing_private_media_upload_url');
  }
  const authorization = await createGoogleIdentityAuthorizationHeader(config);
  const params = new URLSearchParams({
    sourceAccountId: config.sourceAccountId,
    matrixEventId: event.matrixEventId,
    mxcUri: media.mxcUri,
    mimeType: media.mimeType ?? downloaded.contentType,
    mediaId: mediaIdFromMxcUri(media.mxcUri),
  });
  if (typeof media.fileName === 'string' && media.fileName !== '') {
    params.set('fileName', media.fileName);
  }
  if (typeof media.sha256 === 'string' && media.sha256 !== '') {
    params.set('sha256', media.sha256);
  }

  const response = await fetch(`${config.mediaUploadUrl}?${params.toString()}`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/octet-stream',
      'user-agent': 'home-dev-whatsapp-sync/1.0',
    },
    body: downloaded.buffer,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    throw new Error(
      privateMediaUploadFailureCode(
        response.status,
        body,
        response.headers.get('x-intexuraos-storage-failure') ?? undefined
      )
    );
  }
  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    !isRecord(body.data.media)
  ) {
    throw new Error('intexuraos_private_media_upload_invalid_response');
  }
  return body.data.media;
}

export function privateMediaUploadFailureCode(status, body, storageFailureReason) {
  const reason = body?.error?.details?.reason;
  const safeReasons = new Set([
    'original_gcs_upload_failed',
    'thumbnail_generation_failed',
    'thumbnail_gcs_upload_failed',
  ]);
  const safeStorageReasons = new Set([
    'authentication_failed',
    'permission_denied',
    'not_found',
    'rate_limited',
    'network',
    'precondition_failed',
    'invalid_request',
    'upstream',
    'unknown',
  ]);
  return `intexuraos_private_media_upload_failed_${status}${
    safeReasons.has(reason) ? `_${reason}` : ''
  }${safeStorageReasons.has(storageFailureReason) ? `_${storageFailureReason}` : ''}`;
}

export async function postPrivateMediaBackfill(config, payload) {
  if (config.mediaBackfillUrl === '') {
    throw new Error('missing_private_media_backfill_url');
  }
  const authorization = await createGoogleIdentityAuthorizationHeader(config);
  const response = await fetch(config.mediaBackfillUrl, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      'user-agent': 'home-dev-whatsapp-sync/1.0',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`intexuraos_private_media_backfill_failed_${response.status}`);
  }
  const body = await response.json();
  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
    throw new Error('intexuraos_private_media_backfill_invalid_response');
  }
  return body.data;
}

export function matrixEventIdFromPrivateMessageId(messageId, sourceAccountId) {
  const prefix = `message:${sourceAccountId}:`;
  if (typeof messageId !== 'string' || !messageId.startsWith(prefix)) {
    throw new Error('invalid_private_message_id');
  }
  const matrixEventId = messageId.slice(prefix.length);
  if (matrixEventId === '') {
    throw new Error('invalid_private_message_id');
  }
  return matrixEventId;
}

async function createGoogleIdentityAuthorizationHeader(config) {
  if (config.oidcImpersonateServiceAccount !== '') {
    return await createImpersonatedIdentityAuthorizationHeader(config);
  }

  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ keyFile: config.googleApplicationCredentialsFile });
  const client = await auth.getIdTokenClient(config.oidcAudience);
  const headers = await client.getRequestHeaders(config.ingestUrl);
  const authorization = readHeader(headers, 'authorization');
  if (authorization === undefined || authorization === '') {
    throw new Error('missing_google_identity_authorization_header');
  }
  return authorization;
}

async function createImpersonatedIdentityAuthorizationHeader(config) {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    keyFile: config.googleApplicationCredentialsFile,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const sourceAccessToken = await readSourceAccessToken(client);
  const request = buildImpersonatedIdTokenRequest(config, sourceAccessToken);
  const response = await fetch(request.url, request.init);

  if (!response.ok) {
    throw new Error(`google_generate_id_token_failed_${response.status}`);
  }

  const body = await response.json();
  if (!isRecord(body) || typeof body.token !== 'string' || body.token.length === 0) {
    throw new Error('google_generate_id_token_missing_token');
  }

  return `Bearer ${body.token}`;
}

async function readSourceAccessToken(client) {
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('missing_google_source_access_token');
  }
  return token;
}

function readHeader(headers, name) {
  if (typeof headers?.get === 'function') {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  }
  return headers?.[name] ?? headers?.[name.toLowerCase()];
}

async function readSyncState(stateFile) {
  try {
    return JSON.parse(await fsp.readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeSyncState(stateFile, state) {
  await writeDurablePrivateJson(stateFile, state);
}

async function readPendingMediaQueue(pendingMediaFile) {
  try {
    const parsed = JSON.parse(await fsp.readFile(pendingMediaFile, 'utf8'));
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.items) ||
      parsed.items.some(
        (item) =>
          !isRecord(item) ||
          typeof item.messageId !== 'string' ||
          typeof item.mediaKind !== 'string' ||
          typeof item.matrixEventId !== 'string' ||
          !isRecord(item.media) ||
          typeof item.media.mxcUri !== 'string' ||
          !Number.isInteger(item.attempts)
      )
    ) {
      throw new Error('invalid_pending_media_queue');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { version: 1, items: [] };
    }
    throw error;
  }
}

async function writePendingMediaQueue(pendingMediaFile, queue) {
  await writeDurablePrivateJson(pendingMediaFile, queue);
}

async function writeDurablePrivateJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await fsp.open(tempFile, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

function readAccessToken(filePath) {
  if (filePath === '') {
    return '';
  }
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

export function validateGoogleCredentialIdentity(config, credentialJson) {
  if (config.expectedGoogleServiceAccount === '') {
    return;
  }
  if (config.oidcImpersonateServiceAccount !== config.expectedGoogleServiceAccount) {
    throw new Error('google_credential_impersonation_target_mismatch');
  }
  let credential;
  try {
    credential = JSON.parse(credentialJson);
  } catch {
    throw new Error('google_credential_identity_mismatch');
  }
  if (
    !isRecord(credential) ||
    credential.type !== 'service_account' ||
    credential.client_email !== config.expectedGoogleServiceAccount
  ) {
    throw new Error('google_credential_identity_mismatch');
  }
}

function hasNonEmptyFile(filePath) {
  if (filePath === '') {
    return false;
  }
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function hasMaintenanceFence(filePath) {
  if (filePath === '') {
    return false;
  }
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readString(record, key) {
  if (!isRecord(record)) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function phoneNumberFromWhatsAppMxid(mxid) {
  const match = /^@whatsapp_(\d+):/.exec(mxid);
  if (match === null) {
    return undefined;
  }
  return `+${match[1]}`;
}

function normalizePhoneNumber(phoneNumber) {
  return phoneNumber.replace(/\D/g, '');
}

function parseBridgeBotUsers(value) {
  if (value === undefined || value.trim() === '') {
    return defaultBridgeBotUsers;
  }
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

function sanitizeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  start();
}
