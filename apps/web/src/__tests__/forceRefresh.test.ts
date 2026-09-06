import { describe, expect, it, vi } from 'vitest';
import { clearOfflineStateAndReload } from '../utils/forceRefresh.js';

describe('clearOfflineStateAndReload', () => {
  it('waits for every cache deletion and service-worker unregister before reload', async () => {
    let releaseCache!: () => void;
    let releaseWorker!: () => void;
    const cacheDeleted = new Promise<void>((resolve) => {
      releaseCache = resolve;
    });
    const workerUnregistered = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    const reload = vi.fn();

    const refresh = clearOfflineStateAndReload({
      cacheStorage: {
        keys: vi.fn().mockResolvedValue(['old-cache']),
        delete: vi.fn().mockReturnValue(cacheDeleted),
      },
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue([
          { unregister: vi.fn().mockReturnValue(workerUnregistered) },
        ]),
      },
      reload,
    });

    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    releaseCache();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    releaseWorker();
    await refresh;
    expect(reload).toHaveBeenCalledOnce();
  });
});
