import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreDigestLockRepository } from '../../../infra/firestore/firestoreDigestLockRepository.js';
import { resetFirestoreFake, useFirestoreFake } from './helpers/firestoreFake.js';

describe('FirestoreDigestLockRepository', () => {
  beforeEach(() => {
    useFirestoreFake();
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetFirestoreFake();
    vi.useRealTimers();
  });

  it('first acquire returns acquired=true', async () => {
    const repo = new FirestoreDigestLockRepository();
    const result = await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'cron', currentDate: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acquired).toBe(true);
  });

  it('second acquire while held returns acquired=false with heldBy', async () => {
    const repo = new FirestoreDigestLockRepository();
    await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'cron', currentDate: '2026-04-15' });
    const result = await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'manual', currentDate: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acquired).toBe(false);
    expect(result.value.heldBy).toBe('cron');
  });

  it('acquire after TTL expiry succeeds', async () => {
    vi.setSystemTime(new Date('2026-04-15T00:00:00Z'));
    const repo = new FirestoreDigestLockRepository();
    await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'cron', currentDate: '2026-04-15' });
    vi.setSystemTime(new Date('2026-04-15T00:06:00Z')); // 6 min later, past 5-min TTL
    const result = await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'manual', currentDate: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acquired).toBe(true);
  });
});
