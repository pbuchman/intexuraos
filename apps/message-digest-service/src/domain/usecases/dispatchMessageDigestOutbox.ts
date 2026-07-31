import { createHash } from 'node:crypto';
import type { FrozenMessageDigestPayloadPublisher } from '../ports/messageDigestPublishers.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';

const CLAIM_DURATION_MS = 2 * 60 * 1000;
const CLAIM_HEARTBEAT_MS = 30 * 1000;
const BASE_RETRY_MS = 30 * 1000;
const MAX_RETRY_MS = 15 * 60 * 1000;

export interface DispatchMessageDigestOutboxInput {
  outboxId: string;
  workerId: string;
}

export interface DispatchMessageDigestOutboxDependencies {
  store: Pick<
    MessageDigestStore,
    'claimDispatch' | 'renewDispatchClaim' | 'recordDispatchResult'
  >;
  runRequestPublisher: FrozenMessageDigestPayloadPublisher;
  whatsappPublisher: FrozenMessageDigestPayloadPublisher;
  waitForHeartbeat?:
    | ((delayMs: number, signal: AbortSignal) => Promise<void>)
    | undefined;
  now?: (() => string) | undefined;
}

export type DispatchMessageDigestOutboxResult =
  | {
      ok: true;
      disposition: 'published' | 'retry_scheduled' | 'deferred' | 'terminal';
    }
  | { ok: false; code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'CLAIM_LOST' };

export async function dispatchMessageDigestOutbox(
  input: DispatchMessageDigestOutboxInput,
  dependencies: DispatchMessageDigestOutboxDependencies
): Promise<DispatchMessageDigestOutboxResult> {
  const outboxId = input.outboxId.trim();
  const workerId = input.workerId.trim();
  const claimedAt = currentTime(dependencies);
  if (
    claimedAt === null ||
    !/^mdo_[A-Za-z0-9_-]{3,160}$/u.test(outboxId) ||
    workerId === '' ||
    workerId.length > 256
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const ownerDigest = digest(['message-digest-dispatch-owner-v1', workerId]);
  const claim = await dependencies.store.claimDispatch({
    outboxId,
    ownerDigest,
    now: claimedAt,
    expiresAt: claimExpiry(claimedAt),
  });
  if (!claim.ok) {
    if (claim.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' };
    if (claim.code === 'TERMINAL') return { ok: true, disposition: 'terminal' };
    return { ok: true, disposition: 'deferred' };
  }
  if (claim.disposition === 'existing') return { ok: true, disposition: 'deferred' };

  const publisher =
    claim.dispatch.kind === 'run_request'
      ? dependencies.runRequestPublisher
      : dependencies.whatsappPublisher;
  const publication = await publishWithHeartbeat(
    publisher,
    claim.dispatch.payloadJson,
    {
      outboxId,
      ownerDigest,
      fence: claim.fence,
    },
    dependencies
  );
  if (!publication.ok) return { ok: false, code: 'CLAIM_LOST' };
  const published = publication.value;
  const outcomeAt = currentTime(dependencies);
  if (outcomeAt === null) return { ok: false, code: 'CLAIM_LOST' };
  const outcome = published.ok
    ? ({ status: 'published', publishedAt: outcomeAt } as const)
    : published.code === 'INVALID_PAYLOAD'
      ? ({ status: 'terminal', terminalCode: 'INVALID_PAYLOAD' } as const)
      : ({
          status: 'retry',
          nextAttemptAt: new Date(
            Date.parse(outcomeAt) + retryDelayMs(claim.dispatch.attempts)
          ).toISOString(),
        } as const);
  const recorded = await dependencies.store.recordDispatchResult({
    outboxId,
    ownerDigest,
    fence: claim.fence,
    now: outcomeAt,
    outcome,
  });
  if (!recorded.ok) return { ok: false, code: 'CLAIM_LOST' };
  if (outcome.status === 'published') return { ok: true, disposition: 'published' };
  if (outcome.status === 'terminal') return { ok: true, disposition: 'terminal' };
  return { ok: true, disposition: 'retry_scheduled' };
}

async function publishWithHeartbeat(
  publisher: FrozenMessageDigestPayloadPublisher,
  payloadJson: string,
  claim: { outboxId: string; ownerDigest: string; fence: number },
  dependencies: DispatchMessageDigestOutboxDependencies
): Promise<
  | { ok: true; value: Awaited<ReturnType<FrozenMessageDigestPayloadPublisher['publish']>> }
  | { ok: false }
> {
  const abortController = new AbortController();
  const publication = publisher.publish(payloadJson).then(
    (value) => ({ kind: 'published' as const, value }),
    () => ({
      kind: 'published' as const,
      value: { ok: false as const, code: 'ACK_UNKNOWN' as const },
    })
  );
  void publication.then(() => {
    abortController.abort();
  });
  const waitForHeartbeat = dependencies.waitForHeartbeat ?? waitForAbortableDelay;

  try {
    for (;;) {
      const next = await Promise.race([
        publication,
        waitForHeartbeat(CLAIM_HEARTBEAT_MS, abortController.signal).then(() => ({
          kind: 'heartbeat' as const,
        })),
      ]);
      if (next.kind === 'published') return { ok: true, value: next.value };

      const heartbeatAt = currentTime(dependencies);
      if (heartbeatAt === null) {
        await publication;
        return { ok: false };
      }
      try {
        const renewed = await dependencies.store.renewDispatchClaim({
          ...claim,
          now: heartbeatAt,
          expiresAt: claimExpiry(heartbeatAt),
        });
        if (!renewed.ok) {
          await publication;
          return { ok: false };
        }
      } catch {
        await publication;
        return { ok: false };
      }
    }
  } finally {
    abortController.abort();
  }
}

async function waitForAbortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function currentTime(dependencies: DispatchMessageDigestOutboxDependencies): string | null {
  return normalizeTimestamp(dependencies.now?.() ?? new Date().toISOString());
}

function claimExpiry(now: string): string {
  return new Date(Date.parse(now) + CLAIM_DURATION_MS).toISOString();
}

function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(10, attempts - 1));
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** exponent);
}

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part.length.toString(10)).update(':').update(part);
  return hash.digest('hex');
}

function normalizeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
