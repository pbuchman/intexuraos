import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexes, metadata, up } from '../093_llm-usage-events-filtered-asc-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 093 – llm usage events filtered asc indexes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '093',
      name: 'llm-usage-events-filtered-asc-indexes',
    });
    expect(metadata.description).toBeDefined();
    expect(metadata.createdAt).toBe('2026-04-13');
  });

  it('defines the provider + occurredAt asc index', () => {
    expect(indexes).toContainEqual({
      collectionGroup: 'llm_usage_events',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'request.provider', order: 'ASCENDING' },
        { fieldPath: 'occurredAt', order: 'ASCENDING' },
        { fieldPath: '__name__', order: 'ASCENDING' },
      ],
    });
  });

  it('deploys indexes', async () => {
    const context = {
      firestore: {},
      projectId: 'test-project',
      deployIndexes: vi.fn().mockResolvedValue(undefined),
      deployRules: vi.fn().mockResolvedValue(undefined),
    };

    await up(context);

    expect(context.deployIndexes).toHaveBeenCalledOnce();
  });
});
