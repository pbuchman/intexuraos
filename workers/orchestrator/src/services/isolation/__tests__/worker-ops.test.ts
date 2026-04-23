import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type Docker from 'dockerode';
import type { WorkerEntry } from '../worker-entry-types.js';
import { copyOut, statsSnapshot } from '../worker-ops.js';

// Reuse a simple readable-stream style for getArchive — pipeline only needs
// a source stream that emits 'end'.
function createEndingStream(): NodeJS.ReadableStream {
  const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
  // Defer end emission to the next tick so pipeline can attach listeners.
  setImmediate(() => s.emit('end'));
  return s;
}

// Minimal worker stub — only `containerId` is accessed in these paths.
function makeWorker(containerId = 'cid-1'): WorkerEntry {
  return { containerId } as unknown as WorkerEntry;
}

// Mock fs + stream/promises so copyOut can run without touching the real FS.
vi.mock('node:fs', async () => {
  const { EventEmitter: EE } = await import('node:events');
  return {
    createWriteStream: vi.fn((): NodeJS.WritableStream => {
      const stream = new EE() as unknown as NodeJS.WritableStream;
      (stream as unknown as { write: () => boolean }).write = (): boolean => true;
      (stream as unknown as { end: () => void }).end = (): void => undefined;
      return stream;
    }),
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

describe('worker-ops', () => {
  let mockContainer: {
    stats: ReturnType<typeof vi.fn>;
    getArchive: ReturnType<typeof vi.fn>;
  };
  let mockDocker: Docker;

  beforeEach((): void => {
    mockContainer = {
      stats: vi.fn().mockResolvedValue({
        cpu_stats: { cpu_usage: { total_usage: 1234 } },
        memory_stats: { usage: 5678 },
        pids_stats: { current: 3 },
      }),
      getArchive: vi.fn().mockResolvedValue(createEndingStream()),
    };
    mockDocker = {
      getContainer: vi.fn().mockReturnValue(mockContainer),
    } as unknown as Docker;
  });

  afterEach((): void => {
    vi.clearAllMocks();
  });

  describe('copyOut', () => {
    it('throws a descriptive error when the worker is not found', async () => {
      await expect(copyOut('task-missing', undefined, mockDocker, '/src', '/dest')).rejects.toThrow(
        'Worker task-missing not found'
      );
    });

    it('pipes the archive stream for the resolved container when the worker exists', async () => {
      await copyOut('task-1', makeWorker('cid-42'), mockDocker, '/src', '/dest');
      expect(mockDocker.getContainer as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'cid-42'
      );
      expect(mockContainer.getArchive).toHaveBeenCalledWith({ path: '/src' });
    });
  });

  describe('statsSnapshot', () => {
    it('returns null when the worker is not found', async () => {
      const result = await statsSnapshot(undefined, mockDocker);
      expect(result).toBeNull();
    });

    it('returns a snapshot with cpu/memory/pids when the worker exists', async () => {
      const result = await statsSnapshot(makeWorker('cid-7'), mockDocker);
      expect(mockContainer.stats).toHaveBeenCalledWith({ stream: false });
      expect(result).toEqual({
        cpuTotalUsage: 1234,
        memoryUsage: 5678,
        pidsCurrent: 3,
      });
    });
  });
});
