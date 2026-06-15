import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metadata, up } from '../109_mimo-v25-pro-model-migration.mjs'; // @allow-missing-js -- .mjs import

const OLD_RAW_MODEL = 'xiaomi/mimo-' + 'v2-pro';
const OLD_OPENROUTER_MODEL = `or:${OLD_RAW_MODEL}`;
const NEW_RAW_MODEL = 'xiaomi/mimo-v2.5-pro';
const NEW_OPENROUTER_MODEL = `or:${NEW_RAW_MODEL}`;

interface FakeDocData {
  [key: string]: unknown;
}

interface FakeDocRecord {
  data: FakeDocData;
  exists: boolean;
}

class FakeDocRef {
  constructor(
    private readonly collectionName: string,
    private readonly id: string,
    private readonly store: Map<string, Map<string, FakeDocRecord>>
  ) {}

  async get(): Promise<{ exists: boolean; data: () => FakeDocData | undefined }> {
    const record = this.store.get(this.collectionName)?.get(this.id);
    return {
      exists: record?.exists === true,
      data: () => record?.data,
    };
  }

  async set(data: FakeDocData): Promise<void> {
    let collection = this.store.get(this.collectionName);
    if (collection === undefined) {
      collection = new Map();
      this.store.set(this.collectionName, collection);
    }
    collection.set(this.id, { data, exists: true });
  }

  path(): string {
    return `${this.collectionName}/${this.id}`;
  }
}

class FakeBatch {
  private readonly writes: Array<() => void> = [];

  constructor(private readonly store: Map<string, Map<string, FakeDocRecord>>) {}

  update(ref: FakeDocRef, updates: FakeDocData): void {
    this.writes.push(() => {
      const [collectionName, id] = ref.path().split('/');
      const record = this.store.get(collectionName ?? '')?.get(id ?? '');
      if (record === undefined) return;
      for (const [path, value] of Object.entries(updates)) {
        setNestedValue(record.data, path, value);
      }
    });
  }

  async commit(): Promise<void> {
    for (const write of this.writes) write();
  }
}

class FakeFirestore {
  private readonly store = new Map<string, Map<string, FakeDocRecord>>();

  collection(name: string): {
    doc: (id: string) => FakeDocRef;
    get: () => Promise<{ size: number; docs: Array<{ ref: FakeDocRef; data: () => FakeDocData }> }>;
  } {
    return {
      doc: (id: string) => new FakeDocRef(name, id, this.store),
      get: async () => {
        const collection = this.store.get(name) ?? new Map<string, FakeDocRecord>();
        const docs = Array.from(collection.entries()).map(([id, record]) => ({
          ref: new FakeDocRef(name, id, this.store),
          data: () => record.data,
        }));
        return { size: docs.length, docs };
      },
    };
  }

  batch(): FakeBatch {
    return new FakeBatch(this.store);
  }
}

function setNestedValue(target: FakeDocData, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: FakeDocData = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as FakeDocData;
  }
  const leaf = parts.at(-1);
  if (leaf !== undefined) current[leaf] = value;
}

describe('migration 109 - mimo v2.5 pro model migration', () => {
  let firestore: FakeFirestore;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    firestore = new FakeFirestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '109',
      name: 'mimo-v25-pro-model-migration',
    });
  });

  it('migrates OpenRouter MiMo user default and fallback preferences', async () => {
    await firestore
      .collection('user_settings')
      .doc('user-1')
      .set({
        llmPreferences: {
          defaultModel: OLD_OPENROUTER_MODEL,
          fallbackModel: OLD_OPENROUTER_MODEL,
        },
      });

    await up({ firestore });

    const data = (await firestore.collection('user_settings').doc('user-1').get()).data();
    expect(data?.['llmPreferences']).toEqual({
      defaultModel: NEW_OPENROUTER_MODEL,
      fallbackModel: NEW_OPENROUTER_MODEL,
    });
  });

  it('migrates raw and prefixed MiMo references in researches', async () => {
    await firestore
      .collection('researches')
      .doc('research-1')
      .set({
        selectedModels: [OLD_OPENROUTER_MODEL, OLD_RAW_MODEL, 'gemini-2.5-flash'],
        synthesisModel: OLD_OPENROUTER_MODEL,
        llmResults: [
          { provider: 'openrouter', model: OLD_OPENROUTER_MODEL, status: 'completed' },
          { provider: 'openrouter', model: OLD_RAW_MODEL, status: 'failed' },
          { provider: 'google', model: 'gemini-2.5-flash', status: 'completed' },
        ],
      });

    await up({ firestore });

    const data = (await firestore.collection('researches').doc('research-1').get()).data();
    expect(data?.['selectedModels']).toEqual([
      NEW_OPENROUTER_MODEL,
      NEW_RAW_MODEL,
      'gemini-2.5-flash',
    ]);
    expect(data?.['synthesisModel']).toBe(NEW_OPENROUTER_MODEL);
    expect(data?.['llmResults']).toEqual([
      { provider: 'openrouter', model: NEW_OPENROUTER_MODEL, status: 'completed' },
      { provider: 'openrouter', model: NEW_RAW_MODEL, status: 'failed' },
      { provider: 'google', model: 'gemini-2.5-flash', status: 'completed' },
    ]);
  });
});
