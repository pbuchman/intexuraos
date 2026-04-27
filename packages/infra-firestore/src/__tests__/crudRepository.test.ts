/**
 * Tests for the generic Firestore CRUD repository factory.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore, type FakeFirestore } from '../testing/firestoreFake.js';
import { createFirestoreCrudRepository, type CrudRepository } from '../crudRepository.js';

interface Note {
  id: string;
  title: string;
  body: string;
}

describe('createFirestoreCrudRepository', () => {
  let fake: FakeFirestore;
  let repo: CrudRepository<Note>;

  beforeEach(() => {
    fake = createFakeFirestore();
    repo = createFirestoreCrudRepository<Note>({
      firestore: fake as unknown as Firestore,
      collection: 'notes',
      toFirestore: (n) => ({ title: n.title, body: n.body }),
      fromFirestore: (id, data) => ({
        id,
        title: String(data['title']),
        body: String(data['body']),
      }),
    });
  });

  it('creates a document and reads it back', async () => {
    await repo.create({ id: 'n1', title: 't', body: 'b' });
    const got = await repo.get('n1');
    expect(got).toEqual({ id: 'n1', title: 't', body: 'b' });
  });

  it('returns null for a missing document', async () => {
    expect(await repo.get('missing')).toBeNull();
  });

  it('updates an existing document via merge', async () => {
    await repo.create({ id: 'n2', title: 't', body: 'b' });
    await repo.update('n2', { body: 'b2' });
    const got = await repo.get('n2');
    expect(got).toEqual({ id: 'n2', title: 't', body: 'b2' });
  });

  it('lists all documents in the collection', async () => {
    await repo.create({ id: 'a', title: 't1', body: 'b1' });
    await repo.create({ id: 'b', title: 't2', body: 'b2' });
    const all = await repo.list();
    expect(all).toHaveLength(2);
    const ids = all.map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('returns an empty list when no documents exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('deletes a document', async () => {
    await repo.create({ id: 'n3', title: 't', body: 'b' });
    await repo.delete('n3');
    expect(await repo.get('n3')).toBeNull();
  });

  it('delete is idempotent for missing documents', async () => {
    await expect(repo.delete('never-existed')).resolves.toBeUndefined();
  });

  it('handles snap.data() === undefined by passing {} to fromFirestore', async () => {
    const fakeFirestore = {
      collection: (): {
        doc: () => { get: () => Promise<{ exists: boolean; data: () => undefined }> };
      } => ({
        doc: (): { get: () => Promise<{ exists: boolean; data: () => undefined }> } => ({
          get: async (): Promise<{ exists: boolean; data: () => undefined }> => ({
            exists: true,
            data: (): undefined => undefined,
          }),
        }),
      }),
    };
    const fromFirestoreCalls: { id: string; data: Record<string, unknown> }[] = [];
    const customRepo = createFirestoreCrudRepository<Note>({
      firestore: fakeFirestore as unknown as Firestore,
      collection: 'notes',
      toFirestore: (n) => ({ title: n.title, body: n.body }),
      fromFirestore: (id, data) => {
        fromFirestoreCalls.push({ id, data });
        return { id, title: '', body: '' };
      },
    });
    await customRepo.get('any-id');
    expect(fromFirestoreCalls).toHaveLength(1);
    expect(fromFirestoreCalls[0]?.data).toEqual({});
  });
});
