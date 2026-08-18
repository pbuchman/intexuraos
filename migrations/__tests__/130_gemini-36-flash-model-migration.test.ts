import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metadata, up } from '../130_gemini-36-flash-model-migration.mjs'; // @allow-missing-js -- .mjs import

const OLD_RAW_MODEL = 'google/gemini-3-flash-preview';
const OLD_OPENROUTER_MODEL = `or:${OLD_RAW_MODEL}`;
const NEW_RAW_MODEL = 'google/gemini-3.6-flash';
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

describe('migration 130 - Gemini 3.6 Flash model migration', () => {
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
      id: '130',
      name: 'gemini-36-flash-model-migration',
    });
  });

  it('is the reserved migration and tracks its immutable checksum', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
    ) as {
      lastReservedId: string;
      entries: { id: string; name: string; checksum: string }[];
    };
    const source = readFileSync(
      new URL('../130_gemini-36-flash-model-migration.mjs', import.meta.url)
    );

    expect(manifest.lastReservedId).toBe('130');
    expect(manifest.entries.find((entry) => entry.id === '130')).toEqual({
      id: '130',
      name: 'gemini-36-flash-model-migration',
      checksum: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    });
  });

  it('migrates every persisted user preference without changing its selector revision', async () => {
    await firestore
      .collection('user_settings')
      .doc('user-1')
      .set({
        llmPreferences: {
          defaultModel: OLD_OPENROUTER_MODEL,
          fallbackModel: OLD_OPENROUTER_MODEL,
          intexAgentModel: OLD_OPENROUTER_MODEL,
          intexAgentModelRevision: 7,
        },
      });

    const result = await up({ firestore });

    const data = (await firestore.collection('user_settings').doc('user-1').get()).data();
    expect(data?.['llmPreferences']).toEqual({
      defaultModel: NEW_OPENROUTER_MODEL,
      fallbackModel: NEW_OPENROUTER_MODEL,
      intexAgentModel: NEW_OPENROUTER_MODEL,
      intexAgentModelRevision: 7,
    });
    expect(result.userSettings.userSettingsModified).toBe(1);
  });

  it('migrates raw and prefixed Gemini references in researches', async () => {
    await firestore
      .collection('researches')
      .doc('research-1')
      .set({
        selectedModels: [OLD_OPENROUTER_MODEL, OLD_RAW_MODEL, 'openai/gpt-5.4'],
        synthesisModel: OLD_OPENROUTER_MODEL,
        llmResults: [
          { provider: 'openrouter', model: OLD_OPENROUTER_MODEL, status: 'completed' },
          { provider: 'openrouter', model: OLD_RAW_MODEL, status: 'failed' },
          { provider: 'openrouter', model: 'openai/gpt-5.4', status: 'completed' },
        ],
        partialFailure: {
          failedModels: [OLD_OPENROUTER_MODEL, OLD_RAW_MODEL],
          detectedAt: '2026-08-18T10:00:00.000Z',
          retryCount: 1,
        },
      });

    const result = await up({ firestore });

    const data = (await firestore.collection('researches').doc('research-1').get()).data();
    expect(data?.['selectedModels']).toEqual([
      NEW_OPENROUTER_MODEL,
      NEW_RAW_MODEL,
      'openai/gpt-5.4',
    ]);
    expect(data?.['synthesisModel']).toBe(NEW_OPENROUTER_MODEL);
    expect(data?.['llmResults']).toEqual([
      { provider: 'openrouter', model: NEW_OPENROUTER_MODEL, status: 'completed' },
      { provider: 'openrouter', model: NEW_RAW_MODEL, status: 'failed' },
      { provider: 'openrouter', model: 'openai/gpt-5.4', status: 'completed' },
    ]);
    expect(data?.['partialFailure']).toEqual({
      failedModels: [NEW_OPENROUTER_MODEL, NEW_RAW_MODEL],
      detectedAt: '2026-08-18T10:00:00.000Z',
      retryCount: 1,
    });
    expect(result.researches.researchesModified).toBe(1);
  });

  it('is idempotent and does not rewrite unrelated values', async () => {
    await firestore
      .collection('user_settings')
      .doc('user-1')
      .set({
        llmPreferences: {
          defaultModel: NEW_OPENROUTER_MODEL,
          fallbackModel: 'or:minimax/minimax-m3',
        },
      });

    await expect(up({ firestore })).resolves.toEqual({
      userSettings: { userSettingsModified: 0 },
      researches: { researchesModified: 0 },
    });
    await expect(up({ firestore })).resolves.toEqual({
      userSettings: { userSettingsModified: 0 },
      researches: { researchesModified: 0 },
    });
  });
});
