import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = 8099;
const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const DEFAULT_INITIAL_SYNC_TIMEOUT_MS = 0;
const MAX_EVENTS_PER_INGEST_REQUEST = 100;
const DEFAULT_BRIDGE_BOT_USERS = ['@whatsappbot:home-dev', '@whatsapp-sync:home-dev'];

const defaultBridgeBotUsers = new Set(DEFAULT_BRIDGE_BOT_USERS);

export function createConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? DEFAULT_PORT),
    homeserverUrl: env.MATRIX_HOMESERVER_URL ?? '',
    matrixUserId: env.MATRIX_USER_ID ?? '',
    matrixAccessTokenFile: env.MATRIX_ACCESS_TOKEN_FILE ?? '',
    ingestUrl: env.INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL ?? '',
    googleApplicationCredentialsFile:
      env.INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE ??
      env.GOOGLE_APPLICATION_CREDENTIALS ??
      '',
    oidcAudience: env.INTEXURAOS_OIDC_AUDIENCE ?? 'https://intexuraos.cloud',
    oidcImpersonateServiceAccount: env.INTEXURAOS_OIDC_IMPERSONATE_SERVICE_ACCOUNT ?? '',
    sourceAccountId: env.INTEXURAOS_SOURCE_ACCOUNT_ID ?? '',
    userId: env.INTEXURAOS_USER_ID ?? '',
    ownWhatsAppPhoneNumber: normalizePhoneNumber(env.SOURCE_WHATSAPP_PHONE_NUMBER ?? ''),
    stateFile: env.WHATSAPP_SYNC_STATE_FILE ?? '/data/state.json',
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
    ok: state !== 'error',
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

export function buildIngestPayload(config, events) {
  const payload = {
    sourceAccountId: config.sourceAccountId,
    // This adapter only streams live events after the initial Matrix checkpoint.
    // Backfill callers should use separate deterministic replay tooling.
    deliveryMode: 'live',
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

  return {
    nextBatch,
    events:
      options.hasStoredBatch === true
        ? collectPrivateWhatsAppEvents(syncResponse, config, options.roomContexts)
        : [],
    shouldPersistNextBatch: nextBatch !== undefined,
  };
}

export function collectPrivateWhatsAppEvents(syncResponse, config, roomContexts = {}) {
  const joinedRooms = syncResponse?.rooms?.join;
  if (!isRecord(joinedRooms)) {
    return [];
  }

  const events = [];
  for (const [roomId, room] of Object.entries(joinedRooms)) {
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
  const joinedRooms = syncResponse?.rooms?.join;
  if (!isRecord(joinedRooms)) {
    return existingRoomContexts;
  }

  const roomContexts = { ...existingRoomContexts };
  for (const [roomId, room] of Object.entries(joinedRooms)) {
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
  const joinedRooms = syncResponse?.rooms?.join;
  if (!isRecord(joinedRooms)) {
    return existingRoomContexts;
  }

  const roomContexts = { ...existingRoomContexts };
  for (const [roomId, room] of Object.entries(joinedRooms)) {
    if (!isRecord(room)) {
      continue;
    }

    let context = roomContexts[roomId] ?? { memberDisplayNames: {} };
    const incomingSenders = incomingWhatsAppSendersFromRoom(room, config);
    if (incomingSenders.length === 0) {
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
  if (type === 'm.reaction' || type === 'm.sticker') {
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
    } catch (error) {
      runtime.state = 'error';
      runtime.counters.errors = (runtime.counters.errors ?? 0) + 1;
      runtime.lastError = sanitizeError(error);
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
  const readAccessTokenFn = deps.readAccessToken ?? readAccessToken;
  const hasNonEmptyFileFn = deps.hasNonEmptyFile ?? hasNonEmptyFile;
  const readSyncStateFn = deps.readSyncState ?? readSyncState;
  const fetchMatrixSyncFn = deps.fetchMatrixSync ?? fetchMatrixSync;
  const fetchMatrixRoomStateFn = deps.fetchMatrixRoomState ?? fetchMatrixRoomState;
  const joinMatrixRoomFn = deps.joinMatrixRoom ?? joinMatrixRoom;
  const postEventsInBatchesFn = deps.postEventsInBatches ?? postEventsInBatches;
  const writeSyncStateFn = deps.writeSyncState ?? writeSyncState;
  const nowISOString = deps.nowISOString ?? (() => new Date().toISOString());

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
  if (hasStoredBatch) {
    roomContexts = await ensureRoomContextsForIncomingEvents(
      syncResponse,
      roomContexts,
      config,
      (roomId, stateType, stateKey) =>
        fetchMatrixRoomStateFn(config, matrixAccessToken, roomId, stateType, stateKey)
    );
  }
  const plan = createProcessingPlan(syncResponse, config, {
    hasStoredBatch,
    roomContexts,
  });
  runtime.counters.syncResponses = (runtime.counters.syncResponses ?? 0) + syncResponseCount;

  if (plan.events.length > 0) {
    await postEventsInBatchesFn(config, plan.events);
    runtime.counters.postedEvents = (runtime.counters.postedEvents ?? 0) + plan.events.length;
  }

  if (plan.shouldPersistNextBatch) {
    await writeSyncStateFn(config.stateFile, {
      nextBatch: plan.nextBatch,
      roomContexts,
      updatedAt: nowISOString(),
    });
  }

  runtime.state = 'running';
  delete runtime.lastError;
}

export function createHealthServer(config, runtime) {
  return http.createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'not_found' }));
      return;
    }

    const payload = buildHealthPayload(config, {
      hasMatrixAccessToken: readAccessToken(config.matrixAccessTokenFile) !== '',
      hasOidcCredentials: hasNonEmptyFile(config.googleApplicationCredentialsFile),
      runtimeState: runtime.state,
      counters: runtime.counters,
      lastError: runtime.lastError,
    });

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
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
    if (!isRecord(event) || typeof event.state_key !== 'string') {
      const type = isRecord(event) ? readString(event, 'type') : undefined;
      if (type === 'm.room.name' && isRecord(event.content)) {
        const name = readString(event.content, 'name');
        if (name !== undefined) {
          context.displayName = name;
        }
      }
      if (type === 'm.room.topic' && isRecord(event.content)) {
        const topic = readString(event.content, 'topic');
        if (topic !== undefined) {
          context.chatType = chatTypeFromTopic(topic);
        }
      }
      if (type === 'm.room.avatar' && isRecord(event.content)) {
        const avatarMxcUri = readString(event.content, 'url');
        if (avatarMxcUri !== undefined) {
          context.avatarMxcUri = avatarMxcUri;
        }
      }
      continue;
    }

    if (event.type === 'm.room.member' && isRecord(event.content)) {
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
  const content = isRecord(event.content) ? event.content : {};

  if (type === 'm.reaction') {
    const relation = isRecord(content['m.relates_to']) ? content['m.relates_to'] : {};
    const reactionText = readString(relation, 'key');
    return withOptionalText({ direction, type: 'reaction' }, reactionText);
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
  const fileName = readString(content, 'filename') ?? readString(content, 'body');
  if (fileName !== undefined) {
    media.fileName = fileName;
  }

  return { ...message, media };
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

function isWhatsAppMatrixUserId(value) {
  return typeof value === 'string' && /^@whatsapp_(?:[0-9]+|lid-[A-Za-z0-9_-]+):/.test(value);
}

function readMatrixTimestamp(event) {
  const value = event.origin_server_ts;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
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

async function postEventsInBatches(config, events) {
  for (let index = 0; index < events.length; index += MAX_EVENTS_PER_INGEST_REQUEST) {
    const batch = events.slice(index, index + MAX_EVENTS_PER_INGEST_REQUEST);
    await postEvents(config, batch);
  }
}

async function postEvents(config, events) {
  const authorization = await createGoogleIdentityAuthorizationHeader(config);
  const response = await fetch(config.ingestUrl, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      'user-agent': 'home-dev-whatsapp-sync/1.0',
    },
    body: JSON.stringify(buildIngestPayload(config, events)),
  });

  if (!response.ok) {
    throw new Error(`intexuraos_ingest_failed_${response.status}`);
  }
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
  await fsp.mkdir(path.dirname(stateFile), { recursive: true });
  const tempFile = `${stateFile}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(tempFile, stateFile);
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
