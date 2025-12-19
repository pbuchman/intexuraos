import { describe, it, expect, beforeEach } from 'vitest';
import { FakeNotionConnectionRepository, FakeIdempotencyLedger } from '../testing/index.js';

describe('infra-firestore testing fakes', () => {
  const userId = 'user-1';

  describe('FakeNotionConnectionRepository', () => {
    let repo: FakeNotionConnectionRepository;

    beforeEach(() => {
      repo = new FakeNotionConnectionRepository();
    });

    it('returns null when no connection exists', async () => {
      const r = await repo.getConnection(userId);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBeNull();
    });

    it('saveConnection stores connected config but never exposes token', async () => {
      const save = await repo.saveConnection(userId, 'page-1', 'secret-token');
      expect(save.ok).toBe(true);
      if (!save.ok) return;

      expect(save.value.connected).toBe(true);
      expect(save.value.promptVaultPageId).toBe('page-1');

      const token = await repo.getToken(userId);
      expect(token.ok).toBe(true);
      if (token.ok) expect(token.value).toBe('secret-token');
    });

    it('disconnectConnection marks disconnected and getToken returns null', async () => {
      await repo.saveConnection(userId, 'page-1', 'secret-token');

      const disc = await repo.disconnectConnection(userId);
      expect(disc.ok).toBe(true);
      if (disc.ok) expect(disc.value.connected).toBe(false);

      const token = await repo.getToken(userId);
      expect(token.ok).toBe(true);
      if (token.ok) expect(token.value).toBeNull();
    });
  });

  describe('FakeIdempotencyLedger', () => {
    let ledger: FakeIdempotencyLedger;

    beforeEach(() => {
      ledger = new FakeIdempotencyLedger();
    });

    it('returns null when there is no record', async () => {
      const r = await ledger.get(userId, 'k1');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBeNull();
    });

    it('set then get returns stored CreatedNote', async () => {
      const note = { id: 'n1', url: 'https://notion.so/n1', title: 'T' };
      const set = await ledger.set(userId, 'k1', note);
      expect(set.ok).toBe(true);

      const got = await ledger.get(userId, 'k1');
      expect(got.ok).toBe(true);
      if (got.ok) expect(got.value).toEqual(note);
    });
  });
});
