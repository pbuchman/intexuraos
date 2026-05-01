import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metadata, up } from '../100_claude-sonnet-4-7-pricing.mjs'; // @allow-missing-js -- .mjs import

interface FakeDoc {
  data: Record<string, unknown> | undefined;
  exists: boolean;
}

function makeFakeFirestore(initial: Record<string, FakeDoc>): {
  firestore: { doc: (path: string) => unknown };
  store: Record<string, FakeDoc>;
} {
  const store = { ...initial };
  const firestore = {
    doc(path: string): unknown {
      return {
        async get() {
          const entry = store[path] ?? { data: undefined, exists: false };
          return {
            exists: entry.exists,
            data: () => entry.data,
          };
        },
        async set(data: Record<string, unknown>) {
          store[path] = { data, exists: true };
        },
      };
    },
  };
  return { firestore, store };
}

describe('migration 100 – claude-sonnet-4-7 pricing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '100',
      name: 'claude-sonnet-4-7-pricing',
    });
    expect(metadata.description).toBeDefined();
    expect(metadata.createdAt).toBe('2026-05-01');
  });

  it('adds claude-sonnet-4-7 to llm_pricing/anthropic preserving existing models', async () => {
    const { firestore, store } = makeFakeFirestore({
      'llm_pricing/anthropic': {
        exists: true,
        data: {
          provider: 'anthropic',
          models: {
            'claude-sonnet-4-6': {
              inputPricePerMillion: 3.0,
              outputPricePerMillion: 15.0,
              cacheReadMultiplier: 0.1,
              cacheWriteMultiplier: 1.25,
              webSearchCostPerCall: 0.01,
            },
          },
          updatedAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    await up({ firestore });

    const written = store['llm_pricing/anthropic']?.data as
      | {
          models: Record<string, Record<string, number>>;
          updatedAt: string;
          provider: string;
        }
      | undefined;
    expect(written).toBeDefined();
    expect(written?.provider).toBe('anthropic');
    expect(written?.models['claude-sonnet-4-6']).toBeDefined();
    expect(written?.models['claude-sonnet-4-7']).toEqual({
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      webSearchCostPerCall: 0.01,
    });
    // updatedAt should have been bumped
    expect(written?.updatedAt).not.toBe('2026-04-13T00:00:00.000Z');
  });

  it('throws when llm_pricing/anthropic is missing', async () => {
    const { firestore } = makeFakeFirestore({});
    await expect(up({ firestore })).rejects.toThrow(/llm_pricing\/anthropic document missing/i);
  });
});
