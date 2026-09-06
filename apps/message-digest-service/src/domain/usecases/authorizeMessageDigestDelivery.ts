import type { MessageDigestStore } from '../ports/messageDigestStore.js';

const AUTHORIZATION_LEASE_MS = 2 * 60 * 1_000;

export interface MessageDigestDeliveryAuthorizationIdentity {
  userId: string;
  definitionId: string;
  runId: string;
  idempotencyKey: string;
  payloadDigest: string;
  ownerDigest: string;
}

export async function acquireMessageDigestDeliveryAuthorization(
  input: MessageDigestDeliveryAuthorizationIdentity,
  dependencies: {
    store: Pick<MessageDigestStore, 'claimDeliveryAuthorization'>;
    now?: (() => string) | undefined;
  }
): Promise<
  | {
      ok: true;
      disposition: 'authorized';
      fence: number;
      expiresAt: string;
    }
  | { ok: true; disposition: 'denied' | 'busy' }
  | { ok: false; code: 'INVALID_REQUEST' }
> {
  const normalized = normalizeIdentity(input);
  const now = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (normalized === null || now === null) return { ok: false, code: 'INVALID_REQUEST' };
  const expiresAt = new Date(Date.parse(now) + AUTHORIZATION_LEASE_MS).toISOString();
  const claimed = await dependencies.store.claimDeliveryAuthorization({
    ...normalized,
    now,
    expiresAt,
  });
  if (!claimed.ok) {
    return {
      ok: true,
      disposition: claimed.code === 'LEASE_BUSY' ? 'busy' : 'denied',
    };
  }
  return {
    ok: true,
    disposition: 'authorized',
    fence: claimed.fence,
    expiresAt: claimed.expiresAt,
  };
}

export async function releaseMessageDigestDeliveryAuthorization(
  input: MessageDigestDeliveryAuthorizationIdentity & { fence: number },
  dependencies: {
    store: Pick<MessageDigestStore, 'releaseDeliveryAuthorization'>;
    now?: (() => string) | undefined;
  }
): Promise<
  | { ok: true; disposition: 'released' | 'ignored' }
  | { ok: false; code: 'INVALID_REQUEST' }
> {
  const normalized = normalizeIdentity(input);
  const now = normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
  if (
    normalized === null ||
    now === null ||
    !Number.isInteger(input.fence) ||
    input.fence <= 0
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const released = await dependencies.store.releaseDeliveryAuthorization({
    userId: normalized.userId,
    definitionId: normalized.definitionId,
    runId: normalized.runId,
    payloadDigest: normalized.payloadDigest,
    ownerDigest: normalized.ownerDigest,
    fence: input.fence,
    now,
  });
  return {
    ok: true,
    disposition: released.ok ? 'released' : 'ignored',
  };
}

function normalizeIdentity(
  input: MessageDigestDeliveryAuthorizationIdentity
): MessageDigestDeliveryAuthorizationIdentity | null {
  const userId = input.userId.trim();
  const definitionId = input.definitionId.trim();
  const runId = input.runId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const payloadDigest = input.payloadDigest.trim();
  const ownerDigest = input.ownerDigest.trim();
  if (
    userId === '' ||
    userId.length > 256 ||
    !/^md_[A-Za-z0-9_-]{3,120}$/u.test(definitionId) ||
    !/^mdr_[A-Za-z0-9_-]{3,160}$/u.test(runId) ||
    idempotencyKey !== `message-digest:${runId}` ||
    !/^[0-9a-f]{64}$/u.test(payloadDigest) ||
    !/^[0-9a-f]{64}$/u.test(ownerDigest)
  ) {
    return null;
  }
  return { userId, definitionId, runId, idempotencyKey, payloadDigest, ownerDigest };
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
