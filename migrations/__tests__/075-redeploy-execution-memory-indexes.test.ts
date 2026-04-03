import { describe, expect, it, vi } from 'vitest';
import { metadata, up } from '../075_redeploy-execution-memory-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 075 – redeploy execution memory indexes', () => {
  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '075',
      name: 'redeploy-execution-memory-indexes',
    });
    expect(metadata.description).toBeDefined();
    expect(metadata.createdAt).toBe('2026-04-03');
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
