import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { metadata, up } from '../102_backfill-code-worker-settings-enabled.mjs'; // @allow-missing-js -- .mjs import

interface FakeDocSnapshot {
  id: string;
  data: () => Record<string, unknown>;
}

interface FakeDocRef {
  update: (data: Record<string, unknown>) => Promise<void>;
}

function makeFakeFirestore(docs: Record<string, Record<string, unknown>>): {
  firestore: {
    collection: (name: string) => {
      get: () => Promise<{ docs: FakeDocSnapshot[] }>;
      doc: (id: string) => FakeDocRef;
    };
  };
  store: Record<string, Record<string, unknown>>;
  updates: Record<string, unknown>[];
} {
  const store = { ...docs };
  const updates: Record<string, unknown>[] = [];

  return {
    store,
    updates,
    firestore: {
      collection(name: string) {
        if (name !== 'code_worker_settings') {
          throw new Error(`unexpected collection ${name}`);
        }

        return {
          async get() {
            return {
              docs: Object.entries(store).map(([id, data]) => ({
                id,
                data: () => data,
              })),
            };
          },
          doc(id: string) {
            return {
              async update(data: Record<string, unknown>) {
                updates.push({ id, ...data });
                store[id] = {
                  ...store[id],
                  ...data,
                };
              },
            };
          },
        };
      },
    },
  };
}

describe('migration 102 - backfill code worker settings enabled', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '102',
      name: 'backfill-code-worker-settings-enabled',
      description: 'Backfill missing code worker enabled fields to true',
      createdAt: '2026-05-05',
    });
  });

  it('backfills missing worker enabled fields and preserves explicit false', async () => {
    const { firestore, store, updates } = makeFakeFirestore({
      userWithMissing: {
        workers: [{ name: 'home-mac', enabled: false }, { name: 'office-pc' }],
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      userAlreadyBackfilled: {
        workers: [
          { name: 'home-mac', enabled: true },
          { name: 'office-pc', enabled: false },
        ],
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    });

    await up({ firestore });

    expect(updates).toHaveLength(1);
    expect(store['userWithMissing']?.['workers']).toEqual([
      { name: 'home-mac', enabled: false },
      { name: 'office-pc', enabled: true },
    ]);
    expect(store['userAlreadyBackfilled']?.['workers']).toEqual([
      { name: 'home-mac', enabled: true },
      { name: 'office-pc', enabled: false },
    ]);
  });

  it('skips documents without a workers array', async () => {
    const { firestore, updates } = makeFakeFirestore({
      emptySettings: {
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    });

    await up({ firestore });

    expect(updates).toEqual([]);
  });
});
