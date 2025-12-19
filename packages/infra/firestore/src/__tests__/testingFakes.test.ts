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

    it('isConnected returns false when no connection exists', async () => {
      const result = await repo.isConnected(userId);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(false);
    });

    it('isConnected returns true when connected', async () => {
      await repo.saveConnection(userId, 'page-1', 'token');
      const result = await repo.isConnected(userId);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);
    });

    it('isConnected returns false when disconnected', async () => {
      await repo.saveConnection(userId, 'page-1', 'token');
      await repo.disconnectConnection(userId);
      const result = await repo.isConnected(userId);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(false);
    });

    it('getToken returns null when no connection exists', async () => {
      const result = await repo.getToken(userId);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it('disconnectConnection handles missing connection gracefully', async () => {
      const disc = await repo.disconnectConnection(userId);
      expect(disc.ok).toBe(true);
      if (disc.ok) {
        expect(disc.value.connected).toBe(false);
        expect(disc.value.promptVaultPageId).toBe('');
      }
    });

    it('getConnection returns all public fields', async () => {
      await repo.saveConnection(userId, 'page-1', 'token');
      const result = await repo.getConnection(userId);
      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.promptVaultPageId).toBe('page-1');
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('clear removes all connections', async () => {
      await repo.saveConnection(userId, 'page-1', 'token');
      await repo.saveConnection('user-2', 'page-2', 'token2');

      repo.clear();

      const result1 = await repo.getConnection(userId);
      const result2 = await repo.getConnection('user-2');

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok) expect(result1.value).toBeNull();
      if (result2.ok) expect(result2.value).toBeNull();
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

    it('clear removes all records', async () => {
      const note = { id: 'n1', url: 'https://notion.so/n1', title: 'T' };
      await ledger.set(userId, 'k1', note);
      await ledger.set('user-2', 'k2', note);

      ledger.clear();

      const result1 = await ledger.get(userId, 'k1');
      const result2 = await ledger.get('user-2', 'k2');

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok) expect(result1.value).toBeNull();
      if (result2.ok) expect(result2.value).toBeNull();
    });
  });
});
