import { createToken, describe, it, expect, setupTestContext } from '../testUtils.js';
import type { StoredPruneCandidate } from '../../domain/models.js';

describe('GET /linear/prune-candidates', () => {
  const ctx = setupTestContext();

  it('returns 200 with empty candidates array when none stored', async () => {
    const token = await createToken({ sub: 'auth0|test-user-id' });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/linear/prune-candidates',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.candidates).toEqual([]);
  });

  it('returns 200 with seeded candidates sorted by score descending', async () => {
    const candidates: StoredPruneCandidate[] = [
      {
        id: 'id-1',
        identifier: 'INT-1',
        title: 'Lower score task',
        score: 70,
        reason: 'Cancelled long ago',
        category: 'cancelled',
        classifiedAt: '2026-03-29T00:00:00.000Z',
      },
      {
        id: 'id-2',
        identifier: 'INT-2',
        title: 'Higher score task',
        score: 95,
        reason: 'Duplicate issue',
        category: 'duplicate',
        classifiedAt: '2026-03-29T01:00:00.000Z',
      },
    ];
    ctx.pruneCandidateRepository.seedCandidates(candidates);

    const token = await createToken({ sub: 'auth0|test-user-id' });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/linear/prune-candidates',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.candidates).toHaveLength(2);
    // FakePruneCandidateRepository sorts by score descending
    expect(body.data.candidates[0].identifier).toBe('INT-2');
    expect(body.data.candidates[0].score).toBe(95);
    expect(body.data.candidates[1].identifier).toBe('INT-1');
    expect(body.data.candidates[1].score).toBe(70);
  });

  it('returns 500 when listAll fails', async () => {
    ctx.pruneCandidateRepository.setListAllFailure(true, {
      code: 'INTERNAL_ERROR',
      message: 'Firestore unavailable',
    });

    const token = await createToken({ sub: 'auth0|test-user-id' });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/linear/prune-candidates',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.success).toBe(false);
  });

  it('returns 401 without auth token', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/linear/prune-candidates',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('DELETE /linear/prune-candidates', () => {
  const ctx = setupTestContext();

  function seedCandidate(): void {
    ctx.pruneCandidateRepository.seedCandidates([
      {
        id: 'id-1',
        identifier: 'INT-1',
        title: 'Task 1',
        score: 90,
        reason: 'Cancelled',
        category: 'cancelled',
        classifiedAt: '2026-03-29T00:00:00.000Z',
      },
    ]);
  }

  function seedConnection(userId: string): void {
    ctx.connectionRepository.seedConnection({
      userId,
      apiKey: 'test-api-key',
      teamId: 'team-1',
      teamName: 'Test Team',
      webhookSecret: null,
      connected: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  it('returns 200 with deletion stats when candidates exist and user is connected', async () => {
    seedCandidate();
    seedConnection('auth0|test-user-id');

    const token = await createToken({ sub: 'auth0|test-user-id' });
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/linear/prune-candidates',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(1);
    expect(body.data.failedDeletions).toEqual([]);
    expect(typeof body.data.durationMs).toBe('number');
  });

  it('returns 200 with zero deletions when no candidates are stored', async () => {
    seedConnection('auth0|test-user-id');

    const token = await createToken({ sub: 'auth0|test-user-id' });
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/linear/prune-candidates',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(0);
    expect(body.data.failedDeletions).toEqual([]);
  });

  it('returns 403 when no users are connected', async () => {
    seedCandidate();
    // No connection seeded — no connected users

    const token = await createToken({ sub: 'auth0|test-user-id' });
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/linear/prune-candidates',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.success).toBe(false);
  });

  it('returns 401 without auth token', async () => {
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/linear/prune-candidates',
    });

    expect(response.statusCode).toBe(401);
  });
});
