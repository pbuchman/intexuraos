import { describe, expect, it, vi } from 'vitest';

import {
  indexes,
  metadata,
  up,
} from '../122_whatsapp-conversation-assistant-snapshot-index-redeploy.mjs'; // @allow-missing-js -- .mjs import

describe('migration 122 - whatsapp conversation assistant snapshot index redeploy', () => {
  it('exports the expected metadata and no inline indexes', () => {
    expect(metadata).toEqual({
      id: '122',
      name: 'whatsapp-conversation-assistant-snapshot-index-redeploy',
      description: 'Redeploy Firestore indexes for Conversation Assistant session snapshot reads',
      createdAt: '2026-07-05',
    });
    expect(indexes).toEqual([]);
  });

  it('deploys indexes in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });

  it('propagates deployIndexes failures from up()', async () => {
    const deployIndexes = vi.fn().mockRejectedValue(new Error('deploy failed'));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(up({ deployIndexes })).rejects.toThrow('deploy failed');

    expect(deployIndexes).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
