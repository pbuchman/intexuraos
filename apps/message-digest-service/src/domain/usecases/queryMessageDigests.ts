import { createHash } from 'node:crypto';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { normalizeMessageDigestSearchValue } from './createMessageDigest.js';

export interface QueryMessageDigestsInput {
  userId: string;
  cursor?: string | undefined;
  limit?: number | undefined;
  query?: string | undefined;
  chatType?: 'group' | 'direct' | undefined;
  status?: 'active' | 'paused' | 'needs_attention' | undefined;
  sort?: 'name' | 'updatedAt' | 'nextRunAt' | undefined;
  direction?: 'asc' | 'desc' | undefined;
}

export interface QueryMessageDigestsDependencies {
  store: Pick<MessageDigestStore, 'listOwnedDefinitions'>;
}

export type QueryMessageDigestsResult =
  | { ok: true; items: MessageDigestDefinition[]; nextCursor: string | null }
  | { ok: false; code: 'INVALID_QUERY' | 'INVALID_CURSOR' };

export async function queryMessageDigests(
  input: QueryMessageDigestsInput,
  dependencies: QueryMessageDigestsDependencies
): Promise<QueryMessageDigestsResult> {
  const normalized = normalizeListQuery(input);
  if (normalized === null) return { ok: false, code: 'INVALID_QUERY' };
  const queryFingerprint = fingerprint([
    'message-digest-list-v1',
    normalized.query ?? null,
    normalized.chatType ?? null,
    normalized.status ?? null,
    normalized.sort,
    normalized.direction,
  ]);
  try {
    const result = await dependencies.store.listOwnedDefinitions({
      ...normalized,
      queryFingerprint,
    });
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CURSOR') {
      return { ok: false, code: 'INVALID_CURSOR' };
    }
    throw error;
  }
}

export async function getMessageDigest(
  input: { userId: string; definitionId: string },
  dependencies: { store: Pick<MessageDigestStore, 'getOwnedDefinition'> }
): Promise<{ ok: true; definition: MessageDigestDefinition } | { ok: false; code: 'NOT_FOUND' }> {
  if (input.userId.trim() === '' || input.definitionId.trim() === '') {
    return { ok: false, code: 'NOT_FOUND' };
  }
  const definition = await dependencies.store.getOwnedDefinition(input.userId, input.definitionId);
  return definition === null ? { ok: false, code: 'NOT_FOUND' } : { ok: true, definition };
}

function normalizeListQuery(input: QueryMessageDigestsInput): {
  userId: string;
  cursor?: string | undefined;
  limit: number;
  query?: string | undefined;
  chatType?: 'group' | 'direct' | undefined;
  status?: 'active' | 'paused' | 'needs_attention' | undefined;
  sort: 'name' | 'updatedAt' | 'nextRunAt';
  direction: 'asc' | 'desc';
} | null {
  const userId = input.userId.trim();
  const limit = input.limit ?? 25;
  const query =
    input.query === undefined ? undefined : normalizeMessageDigestSearchValue(input.query);
  if (
    userId === '' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    input.cursor?.trim() === ''
  ) {
    return null;
  }
  const effectiveQuery = query === '' ? undefined : query;
  if (effectiveQuery !== undefined && input.sort !== undefined && input.sort !== 'name') {
    return null;
  }
  const sort = input.sort ?? (effectiveQuery === undefined ? 'updatedAt' : 'name');
  const direction = input.direction ?? (sort === 'name' ? 'asc' : 'desc');
  return {
    userId,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    limit,
    ...(effectiveQuery === undefined ? {} : { query: effectiveQuery }),
    ...(input.chatType === undefined ? {} : { chatType: input.chatType }),
    ...(input.status === undefined ? {} : { status: input.status }),
    sort,
    direction,
  };
}

function fingerprint(values: readonly (string | null)[]): string {
  return createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex');
}
