const DRAFT_STORAGE_PREFIX = 'intexuraos:conversation-assistant:draft:v1';
const DRAFT_TTL_MS = 30 * 60 * 1000;
const ATTACHMENT_EXPIRY_GRACE_MS = 5 * 60 * 1000;

const DRAFT_RECORD_KEYS = new Set([
  'version',
  'question',
  'preparationRequestId',
  'replacesAttachmentId',
  'attachmentId',
  'startedTurnRequestId',
  'warningAcknowledged',
  'savedAt',
  'expiresAt',
]);

export interface ConversationAssistantDraftIdentity {
  origin: string;
  userId: string;
  sessionId: string;
}

export interface ConversationAssistantDraftInput {
  question: string;
  preparationRequestId?: string;
  replacesAttachmentId?: string;
  attachmentId?: string;
  startedTurnRequestId?: string;
  warningAcknowledged: boolean;
}

export interface ConversationAssistantDraftRecord extends ConversationAssistantDraftInput {
  version: 1;
  savedAt: string;
  expiresAt: string;
}

export interface ConversationAssistantDraftClockOptions {
  nowMs?: number;
  attachmentExpiresAt?: string;
  lastEditedAt?: string;
}

export interface ConversationAssistantDraftOwnershipInput {
  runtimeOwnerNonce: string;
  announcedOwnerNonce?: string;
  startedTurnRequestId?: string;
}

export type ConversationAssistantDraftOwnershipDecision =
  | 'reuse_current_request_ids'
  | 'regenerate_unstarted_request_ids'
  | 'recover_started_turn_request';

export function getConversationAssistantDraftStorageKey(
  identity: ConversationAssistantDraftIdentity
): string {
  return [
    DRAFT_STORAGE_PREFIX,
    encodeURIComponent(identity.origin),
    encodeURIComponent(identity.userId),
    encodeURIComponent(identity.sessionId),
  ].join(':');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalId(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function parseIsoDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function formatIsoDate(milliseconds: number): string | null {
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeDraftRecord(value: unknown): ConversationAssistantDraftRecord | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !DRAFT_RECORD_KEYS.has(key))) return null;
  if (value['version'] !== 1) return null;
  if (typeof value['question'] !== 'string') return null;
  if (typeof value['warningAcknowledged'] !== 'boolean') return null;
  if (!isOptionalId(value['preparationRequestId'])) return null;
  if (!isOptionalId(value['replacesAttachmentId'])) return null;
  if (!isOptionalId(value['attachmentId'])) return null;
  if (!isOptionalId(value['startedTurnRequestId'])) return null;

  const savedAtMs = parseIsoDate(value['savedAt']);
  const expiresAtMs = parseIsoDate(value['expiresAt']);
  if (savedAtMs === null || expiresAtMs === null || expiresAtMs <= savedAtMs) return null;

  return {
    version: 1,
    question: value['question'],
    ...(value['preparationRequestId'] === undefined
      ? {}
      : { preparationRequestId: value['preparationRequestId'] }),
    ...(value['replacesAttachmentId'] === undefined
      ? {}
      : { replacesAttachmentId: value['replacesAttachmentId'] }),
    ...(value['attachmentId'] === undefined
      ? {}
      : { attachmentId: value['attachmentId'] }),
    ...(value['startedTurnRequestId'] === undefined
      ? {}
      : { startedTurnRequestId: value['startedTurnRequestId'] }),
    warningAcknowledged: value['warningAcknowledged'],
    savedAt: value['savedAt'] as string,
    expiresAt: value['expiresAt'] as string,
  };
}

function removeStoredDraft(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Draft recovery is best-effort when browser storage is unavailable.
  }
}

export function saveConversationAssistantDraft(
  storage: Storage,
  identity: ConversationAssistantDraftIdentity,
  draft: ConversationAssistantDraftInput,
  options: ConversationAssistantDraftClockOptions = {}
): ConversationAssistantDraftRecord | null {
  const key = getConversationAssistantDraftStorageKey(identity);
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    removeStoredDraft(storage, key);
    return null;
  }

  const attachmentExpiresAtMs =
    options.attachmentExpiresAt === undefined
      ? null
      : parseIsoDate(options.attachmentExpiresAt);
  if (options.attachmentExpiresAt !== undefined && attachmentExpiresAtMs === null) {
    removeStoredDraft(storage, key);
    return null;
  }
  const lastEditedAtMs =
    options.lastEditedAt === undefined ? nowMs : parseIsoDate(options.lastEditedAt);
  if (lastEditedAtMs === null) {
    removeStoredDraft(storage, key);
    return null;
  }
  const expiresAtMs = Math.max(
    lastEditedAtMs + DRAFT_TTL_MS,
    attachmentExpiresAtMs === null
      ? Number.NEGATIVE_INFINITY
      : attachmentExpiresAtMs + ATTACHMENT_EXPIRY_GRACE_MS
  );
  if (expiresAtMs <= nowMs) {
    removeStoredDraft(storage, key);
    return null;
  }
  const savedAt = formatIsoDate(lastEditedAtMs);
  const expiresAt = formatIsoDate(expiresAtMs);
  if (savedAt === null || expiresAt === null) {
    removeStoredDraft(storage, key);
    return null;
  }

  const candidate = decodeDraftRecord({
    version: 1,
    question: draft.question,
    ...(draft.preparationRequestId === undefined
      ? {}
      : { preparationRequestId: draft.preparationRequestId }),
    ...(draft.replacesAttachmentId === undefined
      ? {}
      : { replacesAttachmentId: draft.replacesAttachmentId }),
    ...(draft.attachmentId === undefined ? {} : { attachmentId: draft.attachmentId }),
    ...(draft.startedTurnRequestId === undefined
      ? {}
      : { startedTurnRequestId: draft.startedTurnRequestId }),
    warningAcknowledged: draft.warningAcknowledged,
    savedAt,
    expiresAt,
  });
  if (candidate === null) {
    removeStoredDraft(storage, key);
    return null;
  }

  try {
    storage.setItem(key, JSON.stringify(candidate));
    return candidate;
  } catch {
    return null;
  }
}

export function loadConversationAssistantDraft(
  storage: Storage,
  identity: ConversationAssistantDraftIdentity,
  options: ConversationAssistantDraftClockOptions = {}
): ConversationAssistantDraftRecord | null {
  const key = getConversationAssistantDraftStorageKey(identity);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    removeStoredDraft(storage, key);
    return null;
  }

  const draft = decodeDraftRecord(parsed);
  const nowMs = options.nowMs ?? Date.now();
  const expiresAtMs = draft === null ? null : Date.parse(draft.expiresAt);
  if (
    draft === null ||
    formatIsoDate(nowMs) === null ||
    expiresAtMs === null ||
    expiresAtMs <= nowMs
  ) {
    removeStoredDraft(storage, key);
    return null;
  }

  return draft;
}

export function clearConversationAssistantDraft(
  storage: Storage,
  identity: ConversationAssistantDraftIdentity
): void {
  removeStoredDraft(storage, getConversationAssistantDraftStorageKey(identity));
}

export function decideConversationAssistantDraftOwnership(
  input: ConversationAssistantDraftOwnershipInput
): ConversationAssistantDraftOwnershipDecision {
  if (
    input.announcedOwnerNonce === undefined ||
    input.announcedOwnerNonce === input.runtimeOwnerNonce
  ) {
    return 'reuse_current_request_ids';
  }

  return input.startedTurnRequestId === undefined
    ? 'regenerate_unstarted_request_ids'
    : 'recover_started_turn_request';
}
