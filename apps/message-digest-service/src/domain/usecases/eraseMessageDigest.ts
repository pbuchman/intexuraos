import { createHash } from 'node:crypto';
import type { MessageDigestErasureRequest } from '../models/messageDigestErasure.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';

export interface EraseMessageDigestInput {
  userId: string;
  definitionId: string;
  requestId: string;
  limit?: number | undefined;
}

export interface MessageDigestErasureView {
  erasureRequestId: string;
  definitionId: string;
  status: 'in_progress' | 'completed';
  stage: MessageDigestErasureRequest['stage'];
  deletedCounts: MessageDigestErasureRequest['deletedCounts'];
  updatedAt: string;
  completedAt: string | null;
  nextAction: 'resume_delete' | null;
}

export async function eraseMessageDigest(
  input: EraseMessageDigestInput,
  dependencies: {
    store: Pick<MessageDigestStore, 'startOrResumeDefinitionErasure'>;
    now?: (() => string) | undefined;
  }
): Promise<
  | ({ ok: true; deletedThisCall: number } & MessageDigestErasureView)
  | { ok: false; code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'ERASURE_CONFLICT' }
> {
  const now = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  const limit = input.limit ?? 50;
  if (
    now === null ||
    input.userId.trim() === '' ||
    input.definitionId.trim() === '' ||
    input.requestId.trim().length < 8 ||
    input.requestId.length > 256 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const identity = [input.userId, input.definitionId, input.requestId.trim()] as const;
  const erasureRequestId = `mde_${digest(['message-digest-erasure-id-v1', ...identity]).slice(0, 40)}`;
  const requestIdDigest = digest(['message-digest-erasure-request-v1', ...identity]);
  const result = await dependencies.store.startOrResumeDefinitionErasure({
    userId: input.userId,
    definitionId: input.definitionId,
    erasureRequestId,
    requestIdDigest,
    now,
    limit,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    deletedThisCall: result.deletedThisCall,
    ...toView(result.request),
  };
}

export async function getMessageDigestErasure(
  input: { userId: string; erasureRequestId: string },
  dependencies: { store: Pick<MessageDigestStore, 'getOwnedErasureRequest'> }
): Promise<({ ok: true } & MessageDigestErasureView) | { ok: false; code: 'NOT_FOUND' }> {
  if (input.userId.trim() === '' || input.erasureRequestId.trim() === '') {
    return { ok: false, code: 'NOT_FOUND' };
  }
  const request = await dependencies.store.getOwnedErasureRequest(
    input.userId,
    input.erasureRequestId
  );
  return request === null ? { ok: false, code: 'NOT_FOUND' } : { ok: true, ...toView(request) };
}

export async function resumeMessageDigestErasure(
  input: { userId: string; erasureRequestId: string; limit?: number | undefined },
  dependencies: {
    store: Pick<
      MessageDigestStore,
      'getOwnedErasureRequest' | 'startOrResumeDefinitionErasure'
    >;
    now?: (() => string) | undefined;
  }
): Promise<
  | ({ ok: true; deletedThisCall: number } & MessageDigestErasureView)
  | { ok: false; code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'ERASURE_CONFLICT' }
> {
  if (input.userId.trim() === '' || input.erasureRequestId.trim() === '') {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const now = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  const limit = input.limit ?? 50;
  if (now === null || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const request = await dependencies.store.getOwnedErasureRequest(
    input.userId,
    input.erasureRequestId
  );
  if (request === null) return { ok: false, code: 'NOT_FOUND' };

  const result = await dependencies.store.startOrResumeDefinitionErasure({
    userId: input.userId,
    definitionId: request.definitionId,
    erasureRequestId: request.erasureRequestId,
    requestIdDigest: request.requestIdDigest,
    now,
    limit,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    deletedThisCall: result.deletedThisCall,
    ...toView(result.request),
  };
}

function toView(request: MessageDigestErasureRequest): MessageDigestErasureView {
  const completed = request.stage === 'completed';
  return {
    erasureRequestId: request.erasureRequestId,
    definitionId: request.definitionId,
    status: completed ? 'completed' : 'in_progress',
    stage: request.stage,
    deletedCounts: request.deletedCounts,
    updatedAt: request.updatedAt,
    completedAt: request.completedAt,
    nextAction: completed ? null : 'resume_delete',
  };
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part.length.toString(10)).update(':').update(part);
  return hash.digest('hex');
}
