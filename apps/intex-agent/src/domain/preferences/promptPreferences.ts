import { randomUUID } from 'node:crypto';

export const PROMPT_PREFERENCES_SCHEMA_VERSION = 1;
export const MAX_PROMPT_PREFERENCE_ITEMS = 50;
export const MAX_PROMPT_PREFERENCE_ITEM_LENGTH = 500;
export const MAX_RENDERED_PROMPT_PREFERENCES_LENGTH = 10_000;

export type PreferenceUpdatedBy =
  | { actor: 'web_ui'; userId: string }
  | { actor: 'agent_tool'; userId: string; sessionId: string; messageId?: string };

export interface IntexAgentPromptPreferenceItem {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntexAgentPromptPreferences {
  userId: string;
  schemaVersion: typeof PROMPT_PREFERENCES_SCHEMA_VERSION;
  currentVersion: number;
  items: IntexAgentPromptPreferenceItem[];
  renderedPromptBlock: string;
  createdAt: string | null;
  updatedAt: string | null;
  updatedBy: PreferenceUpdatedBy | null;
}

export type PromptPreferenceChangeType = 'add' | 'update' | 'delete';

export interface IntexAgentPromptPreferenceVersion {
  id: string;
  userId: string;
  version: number;
  items: IntexAgentPromptPreferenceItem[];
  renderedPromptBlock: string;
  changeType: PromptPreferenceChangeType;
  changedItemId?: string;
  previousText?: string;
  nextText?: string;
  itemCount: number;
  createdAt: string;
  createdBy: PreferenceUpdatedBy;
}

export type IntexAgentPromptPreferenceVersionSummary = Omit<
  IntexAgentPromptPreferenceVersion,
  'id' | 'userId' | 'items' | 'renderedPromptBlock'
>;

export type PromptPreferencesErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT';

export class PromptPreferencesError extends Error {
  readonly code: PromptPreferencesErrorCode;
  readonly current?: IntexAgentPromptPreferences;

  constructor(
    code: PromptPreferencesErrorCode,
    message: string,
    options?: { current?: IntexAgentPromptPreferences }
  ) {
    super(message);
    this.name = 'PromptPreferencesError';
    this.code = code;
    if (options?.current !== undefined) {
      this.current = options.current;
    }
  }
}

export interface AddPromptPreferenceItemInput {
  id?: string;
  text: string;
  now: string;
  updatedBy: PreferenceUpdatedBy;
}

export interface UpdatePromptPreferenceItemInput {
  itemId: string;
  text: string;
  now: string;
  updatedBy: PreferenceUpdatedBy;
}

export interface DeletePromptPreferenceItemInput {
  itemId: string;
  now: string;
  updatedBy: PreferenceUpdatedBy;
}

export interface PromptPreferenceMutationResult {
  current: IntexAgentPromptPreferences;
  version: IntexAgentPromptPreferenceVersion;
}

export function emptyPromptPreferences(userId: string): IntexAgentPromptPreferences {
  return {
    userId,
    schemaVersion: PROMPT_PREFERENCES_SCHEMA_VERSION,
    currentVersion: 0,
    items: [],
    renderedPromptBlock: '',
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

export function createPromptPreferenceItemId(): string {
  return `pref_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function normalizePromptPreferenceText(text: string): string {
  if (containsControlCharacter(text)) {
    throw new PromptPreferencesError(
      'INVALID_REQUEST',
      'Preference text cannot contain newlines or control characters'
    );
  }

  const normalized = text.trim().replace(/\s+/gu, ' ');
  if (normalized === '') {
    throw new PromptPreferencesError('INVALID_REQUEST', 'Preference text cannot be empty');
  }
  if (normalized.length > MAX_PROMPT_PREFERENCE_ITEM_LENGTH) {
    throw new PromptPreferencesError(
      'INVALID_REQUEST',
      `Preference text must be at most ${String(MAX_PROMPT_PREFERENCE_ITEM_LENGTH)} characters`
    );
  }
  return normalized;
}

export function renderPromptPreferenceBlock(
  version: number,
  items: readonly IntexAgentPromptPreferenceItem[]
): string {
  if (items.length === 0) {
    return '';
  }

  const lines = [
    `User Preferences v${String(version)}:`,
    ...items.map(
      (item, index) => `${String(index + 1)}. (id: ${item.id}) ${JSON.stringify(item.text)}`
    ),
  ];
  const block = lines.join('\n');
  assertRenderedBlockLength(block);
  return block;
}

export function addPromptPreferenceItem(
  current: IntexAgentPromptPreferences,
  input: AddPromptPreferenceItemInput
): PromptPreferenceMutationResult {
  if (current.items.length >= MAX_PROMPT_PREFERENCE_ITEMS) {
    throw new PromptPreferencesError(
      'INVALID_REQUEST',
      `A maximum of ${String(MAX_PROMPT_PREFERENCE_ITEMS)} preferences is allowed`
    );
  }

  const normalizedText = normalizePromptPreferenceText(input.text);
  const item: IntexAgentPromptPreferenceItem = {
    id: input.id ?? createPromptPreferenceItemId(),
    text: normalizedText,
    createdAt: input.now,
    updatedAt: input.now,
  };

  return buildMutationResult(current, {
    items: [...clonePreferenceItems(current.items), item],
    changeType: 'add',
    changedItemId: item.id,
    nextText: normalizedText,
    now: input.now,
    updatedBy: input.updatedBy,
  });
}

export function updatePromptPreferenceItem(
  current: IntexAgentPromptPreferences,
  input: UpdatePromptPreferenceItemInput
): PromptPreferenceMutationResult {
  const itemIndex = current.items.findIndex((item) => item.id === input.itemId);
  if (itemIndex === -1) {
    throw new PromptPreferencesError('NOT_FOUND', 'Preference item not found');
  }

  const normalizedText = normalizePromptPreferenceText(input.text);
  const existing = current.items[itemIndex];
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires fallback despite prior findIndex match @preserve */
  if (existing === undefined) {
    throw new PromptPreferencesError('NOT_FOUND', 'Preference item not found');
  }
  /* v8 ignore stop @preserve */

  const items = clonePreferenceItems(current.items);
  items[itemIndex] = {
    ...existing,
    text: normalizedText,
    updatedAt: input.now,
  };

  return buildMutationResult(current, {
    items,
    changeType: 'update',
    changedItemId: input.itemId,
    previousText: existing.text,
    nextText: normalizedText,
    now: input.now,
    updatedBy: input.updatedBy,
  });
}

export function deletePromptPreferenceItem(
  current: IntexAgentPromptPreferences,
  input: DeletePromptPreferenceItemInput
): PromptPreferenceMutationResult {
  const existing = current.items.find((item) => item.id === input.itemId);
  if (existing === undefined) {
    throw new PromptPreferencesError('NOT_FOUND', 'Preference item not found');
  }

  return buildMutationResult(current, {
    items: current.items.filter((item) => item.id !== input.itemId),
    changeType: 'delete',
    changedItemId: input.itemId,
    previousText: existing.text,
    now: input.now,
    updatedBy: input.updatedBy,
  });
}

function buildMutationResult(
  current: IntexAgentPromptPreferences,
  input: {
    items: IntexAgentPromptPreferenceItem[];
    changeType: PromptPreferenceChangeType;
    changedItemId: string;
    previousText?: string;
    nextText?: string;
    now: string;
    updatedBy: PreferenceUpdatedBy;
  }
): PromptPreferenceMutationResult {
  const nextVersion = current.currentVersion + 1;
  const renderedPromptBlock = renderPromptPreferenceBlock(nextVersion, input.items);
  const currentPreferences: IntexAgentPromptPreferences = {
    userId: current.userId,
    schemaVersion: PROMPT_PREFERENCES_SCHEMA_VERSION,
    currentVersion: nextVersion,
    items: clonePreferenceItems(input.items),
    renderedPromptBlock,
    createdAt: current.createdAt ?? input.now,
    updatedAt: input.now,
    updatedBy: input.updatedBy,
  };

  const version: IntexAgentPromptPreferenceVersion = {
    id: promptPreferenceVersionId(current.userId, nextVersion),
    userId: current.userId,
    version: nextVersion,
    items: clonePreferenceItems(input.items),
    renderedPromptBlock,
    changeType: input.changeType,
    changedItemId: input.changedItemId,
    ...(input.previousText !== undefined ? { previousText: input.previousText } : {}),
    ...(input.nextText !== undefined ? { nextText: input.nextText } : {}),
    itemCount: input.items.length,
    createdAt: input.now,
    createdBy: input.updatedBy,
  };

  return {
    current: currentPreferences,
    version,
  };
}

export function assertExpectedPromptPreferenceVersion(
  current: IntexAgentPromptPreferences,
  expectedVersion: number
): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new PromptPreferencesError('INVALID_REQUEST', 'expectedVersion must be a non-negative integer');
  }
  if (expectedVersion !== current.currentVersion) {
    throw new PromptPreferencesError(
      'VERSION_CONFLICT',
      `Expected preference version ${String(expectedVersion)}, but current version is ${String(current.currentVersion)}`,
      { current }
    );
  }
}

export function promptPreferenceVersionId(userId: string, version: number): string {
  return `${userId}_${String(version)}`;
}

function clonePreferenceItems(
  items: readonly IntexAgentPromptPreferenceItem[]
): IntexAgentPromptPreferenceItem[] {
  return items.map((item) => ({ ...item }));
}

function assertRenderedBlockLength(block: string): void {
  if (block.length > MAX_RENDERED_PROMPT_PREFERENCES_LENGTH) {
    throw new PromptPreferencesError(
      'INVALID_REQUEST',
      `Rendered preference prompt block must be at most ${String(MAX_RENDERED_PROMPT_PREFERENCES_LENGTH)} characters`
    );
  }
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode <= 31 || charCode === 127) {
      return true;
    }
  }
  return false;
}
