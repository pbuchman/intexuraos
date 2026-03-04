import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TurnMetricsCollector,
  type TurnMetricsCollectorConfig,
} from '../services/turn-metrics-collector.js';
import type { Logger } from '@intexuraos/common-core';
import crypto from 'node:crypto';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  glob: vi.fn(),
}));

import { readFile, glob } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockGlob = vi.mocked(glob);

describe('TurnMetricsCollector', () => {
  const config: TurnMetricsCollectorConfig = {
    codeAgentUrl: 'http://localhost:8128',
    orchestratorSecret: 'test-secret',
    internalAuthToken: 'test-internal-token',
    secretsBasePath: '/tmp/secrets',
  };

  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  let collector: TurnMetricsCollector;

  beforeEach(() => {
    collector = new TurnMetricsCollector(config, mockLogger);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readCpuTimeSec', () => {
    it('parses usage_usec from cpu.stat', async () => {
      mockReadFile.mockResolvedValueOnce(
        'usage_usec 5000000\nuser_usec 3000000\nsystem_usec 2000000\n'
      );

      const result = await collector.readCpuTimeSec('/sys/fs/cgroup/test');

      expect(result).toBe(5);
      expect(mockReadFile).toHaveBeenCalledWith('/sys/fs/cgroup/test/cpu.stat', 'utf-8');
    });

    it('returns 0 when file is missing', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await collector.readCpuTimeSec('/sys/fs/cgroup/missing');

      expect(result).toBe(0);
    });

    it('returns 0 when content is malformed', async () => {
      mockReadFile.mockResolvedValueOnce('some_other_stat 12345\n');

      const result = await collector.readCpuTimeSec('/sys/fs/cgroup/test');

      expect(result).toBe(0);
    });
  });

  describe('readPeakMemoryMB', () => {
    it('parses memory.peak', async () => {
      mockReadFile.mockResolvedValueOnce('1073741824\n'); // 1 GB

      const result = await collector.readPeakMemoryMB('/sys/fs/cgroup/test');

      expect(result).toBe(1024);
      expect(mockReadFile).toHaveBeenCalledWith('/sys/fs/cgroup/test/memory.peak', 'utf-8');
    });

    it('falls back to memory.current when memory.peak missing', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce('536870912\n'); // 512 MB

      const result = await collector.readPeakMemoryMB('/sys/fs/cgroup/test');

      expect(result).toBe(512);
      expect(mockReadFile).toHaveBeenCalledTimes(2);
      expect(mockReadFile).toHaveBeenNthCalledWith(
        2,
        '/sys/fs/cgroup/test/memory.current',
        'utf-8'
      );
    });

    it('returns 0 when both files missing', async () => {
      mockReadFile
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockRejectedValueOnce(new Error('ENOENT'));

      const result = await collector.readPeakMemoryMB('/sys/fs/cgroup/missing');

      expect(result).toBe(0);
    });
  });

  describe('readCpuCores', () => {
    it('parses quota/period from cpu.max to compute cores', async () => {
      mockReadFile.mockResolvedValueOnce('200000 100000\n');

      const result = await collector.readCpuCores('/sys/fs/cgroup/test');

      expect(result).toBe(2);
      expect(mockReadFile).toHaveBeenCalledWith('/sys/fs/cgroup/test/cpu.max', 'utf-8');
    });

    it('returns fractional cores for partial quota', async () => {
      mockReadFile.mockResolvedValueOnce('50000 100000\n');

      const result = await collector.readCpuCores('/sys/fs/cgroup/test');

      expect(result).toBe(0.5);
    });

    it('falls back to os.availableParallelism when cpu.max is "max"', async () => {
      mockReadFile.mockResolvedValueOnce('max 100000\n');

      const result = await collector.readCpuCores('/sys/fs/cgroup/test');

      const os = await import('node:os');
      const expected = os.availableParallelism();
      expect(result).toBe(expected);
    });

    it('falls back to os.availableParallelism when file is missing', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await collector.readCpuCores('/sys/fs/cgroup/missing');

      const os = await import('node:os');
      const expected = os.availableParallelism();
      expect(result).toBe(expected);
    });

    it('falls back to os.availableParallelism when content is malformed', async () => {
      mockReadFile.mockResolvedValueOnce('garbage data\n');

      const result = await collector.readCpuCores('/sys/fs/cgroup/test');

      const os = await import('node:os');
      const expected = os.availableParallelism();
      expect(result).toBe(expected);
    });
  });

  describe('classifyTime', () => {
    const baseTime = new Date('2025-01-01T00:00:00Z').getTime();

    it('classifies user->assistant gaps as API wait', () => {
      const entries = [
        { type: 'user', timestamp: new Date(baseTime).toISOString() },
        { type: 'assistant', timestamp: new Date(baseTime + 5000).toISOString() },
      ];

      const result = collector.classifyTime(entries);

      expect(result.apiWaitSeconds).toBe(5);
      expect(result.toolExecSeconds).toBe(0);
    });

    it('classifies assistant->user gaps as tool exec', () => {
      const entries = [
        { type: 'assistant', timestamp: new Date(baseTime).toISOString() },
        { type: 'user', timestamp: new Date(baseTime + 3000).toISOString() },
      ];

      const result = collector.classifyTime(entries);

      expect(result.toolExecSeconds).toBe(3);
      expect(result.apiWaitSeconds).toBe(0);
    });

    it('classifies progress subtype as background wait', () => {
      const entries = [
        { type: 'system', subtype: 'progress', timestamp: new Date(baseTime).toISOString() },
        { type: 'assistant', timestamp: new Date(baseTime + 10000).toISOString() },
      ];

      const result = collector.classifyTime(entries);

      expect(result.backgroundWaitSeconds).toBe(10);
    });

    it('classifies other gaps as overhead', () => {
      const entries = [
        { type: 'system', timestamp: new Date(baseTime).toISOString() },
        { type: 'system', timestamp: new Date(baseTime + 2000).toISOString() },
      ];

      const result = collector.classifyTime(entries);

      expect(result.overheadSeconds).toBe(2);
    });

    it('returns zeros for fewer than 2 entries', () => {
      const result = collector.classifyTime([
        { type: 'user', timestamp: new Date().toISOString() },
      ]);

      expect(result.wallTimeSeconds).toBe(0);
      expect(result.apiWaitSeconds).toBe(0);
    });

    it('computes wall time from first to last entry', () => {
      const entries = [
        { type: 'user', timestamp: new Date(baseTime).toISOString() },
        { type: 'assistant', timestamp: new Date(baseTime + 5000).toISOString() },
        { type: 'user', timestamp: new Date(baseTime + 8000).toISOString() },
      ];

      const result = collector.classifyTime(entries);

      expect(result.wallTimeSeconds).toBe(8);
    });

    it('skips entries without timestamps', () => {
      const entries = [
        { type: 'user', timestamp: new Date(baseTime).toISOString() },
        { type: 'system' }, // no timestamp
        { type: 'assistant', timestamp: new Date(baseTime + 5000).toISOString() },
      ];

      const result = collector.classifyTime(entries);

      expect(result.apiWaitSeconds).toBe(5);
    });

    it('skips zero-gap entries', () => {
      const ts = new Date(baseTime).toISOString();
      const entries = [
        { type: 'user', timestamp: ts },
        { type: 'assistant', timestamp: ts }, // same timestamp -> gap = 0
        { type: 'user', timestamp: new Date(baseTime + 3000).toISOString() },
      ];

      const result = collector.classifyTime(entries);

      expect(result.apiWaitSeconds).toBe(0);
      expect(result.toolExecSeconds).toBe(3);
      expect(result.wallTimeSeconds).toBe(3);
    });
  });

  describe('aggregateTokens', () => {
    it('sums token usage across entries', () => {
      const entries = [
        {
          type: 'assistant',
          message: {
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 80,
              cache_creation_input_tokens: 20,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            usage: {
              input_tokens: 200,
              output_tokens: 100,
              cache_read_input_tokens: 160,
              cache_creation_input_tokens: 40,
            },
          },
        },
      ];

      const result = collector.aggregateTokens(entries);

      expect(result.totalInputTokens).toBe(300);
      expect(result.totalOutputTokens).toBe(150);
      expect(result.totalCacheReadTokens).toBe(240);
      expect(result.totalCacheCreationTokens).toBe(60);
      expect(result.apiCallCount).toBe(2);
    });

    it('returns zeros when no usage data', () => {
      const entries = [{ type: 'user' }, { type: 'system' }];

      const result = collector.aggregateTokens(entries);

      expect(result.totalInputTokens).toBe(0);
      expect(result.apiCallCount).toBe(0);
    });

    it('handles partial usage fields', () => {
      const entries = [
        {
          type: 'assistant',
          message: {
            usage: {
              input_tokens: 100,
            },
          },
        },
      ];

      const result = collector.aggregateTokens(entries);

      expect(result.totalInputTokens).toBe(100);
      expect(result.totalOutputTokens).toBe(0);
      expect(result.apiCallCount).toBe(1);
    });

    it('handles usage with undefined token fields', () => {
      const entries = [
        {
          type: 'assistant',
          message: {
            usage: {},
          },
        },
      ];

      const result = collector.aggregateTokens(entries);

      expect(result.totalInputTokens).toBe(0);
      expect(result.totalOutputTokens).toBe(0);
      expect(result.totalCacheReadTokens).toBe(0);
      expect(result.totalCacheCreationTokens).toBe(0);
      expect(result.apiCallCount).toBe(1);
    });
  });

  describe('parseSessionJsonl', () => {
    it('parses JSONL files from glob pattern', async () => {
      const jsonlContent = [
        JSON.stringify({ type: 'user', timestamp: '2025-01-01T00:00:00Z' }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2025-01-01T00:00:05Z',
          message: { usage: { input_tokens: 100, output_tokens: 50 } },
        }),
      ].join('\n');

      // Mock glob to yield one file path
      async function* fakeGlob(): AsyncGenerator<string> {
        yield '/tmp/secrets/claude-session-task1/projects/test/session.jsonl';
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);
      mockReadFile.mockResolvedValueOnce(jsonlContent);

      const result = await collector.parseSessionJsonl('task1');

      expect(result.tokens.totalInputTokens).toBe(100);
      expect(result.tokens.totalOutputTokens).toBe(50);
      expect(result.tokens.apiCallCount).toBe(1);
      expect(result.timeClassification.apiWaitSeconds).toBe(5);
    });

    it('returns zero defaults when glob fails', async () => {
      mockGlob.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      const result = await collector.parseSessionJsonl('missing-task');

      expect(result.tokens.apiCallCount).toBe(0);
      expect(result.timeClassification.wallTimeSeconds).toBe(0);
    });

    it('skips empty lines in JSONL content', async () => {
      const jsonlContent = [
        JSON.stringify({ type: 'user', timestamp: '2025-01-01T00:00:00Z' }),
        '',
        '  ',
        JSON.stringify({ type: 'assistant', timestamp: '2025-01-01T00:00:04Z' }),
      ].join('\n');

      async function* fakeGlob(): AsyncGenerator<string> {
        yield '/tmp/file.jsonl';
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);
      mockReadFile.mockResolvedValueOnce(jsonlContent);

      const result = await collector.parseSessionJsonl('task1');

      expect(result.timeClassification.apiWaitSeconds).toBe(4);
    });

    it('skips malformed JSON lines', async () => {
      const jsonlContent = [
        'this is not json',
        JSON.stringify({ type: 'user', timestamp: '2025-01-01T00:00:00Z' }),
        '{ broken',
        JSON.stringify({ type: 'assistant', timestamp: '2025-01-01T00:00:03Z' }),
      ].join('\n');

      async function* fakeGlob(): AsyncGenerator<string> {
        yield '/tmp/file.jsonl';
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);
      mockReadFile.mockResolvedValueOnce(jsonlContent);

      const result = await collector.parseSessionJsonl('task1');

      // Should have parsed the 2 valid entries
      expect(result.timeClassification.apiWaitSeconds).toBe(3);
    });

    it('reads from per-task session path even when sharedCredsPath is configured', async () => {
      const sharedCollector = new TurnMetricsCollector(
        { ...config, sharedCredsPath: '/tmp/shared-creds' },
        mockLogger
      );

      const jsonlContent = [
        JSON.stringify({ type: 'user', timestamp: '2025-06-01T10:00:00Z' }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2025-06-01T10:00:05Z',
          message: { usage: { input_tokens: 200, output_tokens: 75 } },
        }),
      ].join('\n');

      async function* fakeGlob(): AsyncGenerator<string> {
        yield '/tmp/secrets/claude-session-task1/projects/test/session.jsonl';
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);
      mockReadFile.mockResolvedValueOnce(jsonlContent);

      const result = await sharedCollector.parseSessionJsonl('task1');

      expect(mockGlob).toHaveBeenCalledWith(
        '/tmp/secrets/claude-session-task1/projects/**/*.jsonl'
      );
      expect(result.tokens.totalInputTokens).toBe(200);
      expect(result.tokens.totalOutputTokens).toBe(75);
      expect(result.tokens.apiCallCount).toBe(1);
    });

    it('reads all files without time-window filtering from per-task path', async () => {
      const oldFileContent = [
        JSON.stringify({ type: 'user', timestamp: '2024-01-01T00:00:00Z' }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-01T00:00:05Z',
          message: { usage: { input_tokens: 999, output_tokens: 999 } },
        }),
      ].join('\n');

      const recentContent = [
        JSON.stringify({ type: 'user', timestamp: '2025-06-01T10:00:00Z' }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2025-06-01T10:00:05Z',
          message: { usage: { input_tokens: 50, output_tokens: 25 } },
        }),
      ].join('\n');

      async function* fakeGlob(): AsyncGenerator<string> {
        yield '/tmp/secrets/claude-session-task1/projects/test/old.jsonl';
        yield '/tmp/secrets/claude-session-task1/projects/test/current.jsonl';
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);
      mockReadFile.mockResolvedValueOnce(oldFileContent).mockResolvedValueOnce(recentContent);

      const result = await collector.parseSessionJsonl('task1');

      // Both files are included since per-task dirs only contain one task's data
      expect(result.tokens.totalInputTokens).toBe(1049);
      expect(result.tokens.totalOutputTokens).toBe(1024);
      expect(result.tokens.apiCallCount).toBe(2);
    });

    it('handles single-line JSONL file without trailing newline', async () => {
      const singleLine = JSON.stringify({
        type: 'user',
        timestamp: '2025-06-01T10:00:00Z',
      });

      async function* fakeGlob(): AsyncGenerator<string> {
        yield '/tmp/secrets/claude-session-task1/projects/-repo/single.jsonl';
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);
      mockReadFile.mockResolvedValueOnce(singleLine);

      const result = await collector.parseSessionJsonl('task1');

      expect(result.timeClassification.wallTimeSeconds).toBe(0);
    });

    it('parses file with empty first line', async () => {
      async function* fakeGlob(): AsyncGenerator<string> {
        yield '/tmp/secrets/claude-session-task1/projects/-repo/empty.jsonl';
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);
      mockReadFile.mockResolvedValueOnce('\n{"type":"user","timestamp":"2025-06-01T10:00:00Z"}');

      const result = await collector.parseSessionJsonl('task1');

      // Empty lines are skipped, but subsequent valid entries are parsed
      expect(result.timeClassification.wallTimeSeconds).toBe(0);
    });

    it('includes file when first entry has no timestamp field', async () => {
      const content = [
        JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2025-06-01T10:00:05Z',
          message: { usage: { input_tokens: 42 } },
        }),
      ].join('\n');

      async function* fakeGlob(): AsyncGenerator<string> {
        yield '/tmp/secrets/claude-session-task1/projects/-repo/no-ts.jsonl';
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);
      mockReadFile.mockResolvedValueOnce(content);

      const result = await collector.parseSessionJsonl('task1');

      expect(result.tokens.totalInputTokens).toBe(42);
    });

    it('always uses per-task path regardless of sharedCredsPath', async () => {
      const sharedCollector = new TurnMetricsCollector(
        { ...config, sharedCredsPath: '/tmp/shared-creds' },
        mockLogger
      );

      async function* fakeGlob(): AsyncGenerator<string> {
        // yield nothing
      }
      mockGlob.mockReturnValueOnce(fakeGlob() as never);

      await sharedCollector.parseSessionJsonl('task-abc');

      expect(mockGlob).toHaveBeenCalledWith(
        '/tmp/secrets/claude-session-task-abc/projects/**/*.jsonl'
      );
    });
  });

  describe('collectAndPublish', () => {
    const params = {
      taskId: 'task-123',
      containerId: 'abc123def456',
      attempt: 1,
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: '2025-01-01T01:00:00Z', // 1 hour
    };

    it('collects metrics and publishes to code-agent', async () => {
      // Mock cgroup reads
      mockReadFile
        // cpu.stat
        .mockResolvedValueOnce('usage_usec 3600000000\n')
        // memory.peak
        .mockResolvedValueOnce('2147483648\n') // 2 GB
        // cpu.max
        .mockResolvedValueOnce('200000 100000\n'); // 2 cores

      // Mock glob for JSONL (empty)
      async function* emptyGlob(): AsyncGenerator<string> {
        // yield nothing
      }
      mockGlob.mockReturnValueOnce(emptyGlob() as never);

      // Mock fetch
      const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await collector.collectAndPublish(params);

      // Verify fetch was called with correct URL
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, fetchOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8128/internal/turn-metrics');

      // Verify headers
      const headers = fetchOpts.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Internal-Auth']).toBe('test-internal-token');
      expect(headers['X-Request-Timestamp']).toBeDefined();
      expect(headers['X-Request-Signature']).toBeDefined();

      // Verify body
      const body = JSON.parse(fetchOpts.body as string) as Record<string, unknown>;
      expect(body['taskId']).toBe('task-123');
      expect(body['attempt']).toBe(1);
      expect(body['cpuTimeSeconds']).toBe(3600);
      expect(body['peakMemoryMB']).toBe(2048);
      expect(body['wallTimeSeconds']).toBe(3600);

      // Verify HMAC signature
      const timestamp = headers['X-Request-Timestamp'] ?? '';
      const signature = headers['X-Request-Signature'] ?? '';
      const message = `${timestamp}.${fetchOpts.body as string}`;
      const expected = crypto.createHmac('sha256', 'test-secret').update(message).digest('hex');
      expect(signature).toBe(expected);

      // Verify logger.info was called
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123', attempt: 1 }),
        'Turn metrics collected and published'
      );

      mockFetch.mockRestore();
    });

    it('sets utilization and idle to 0 when wall time is 0', async () => {
      mockReadFile
        .mockResolvedValueOnce('usage_usec 1000000\n')
        .mockResolvedValueOnce('1048576\n') // 1 MB
        .mockResolvedValueOnce('200000 100000\n'); // cpu.max

      async function* emptyGlob(): AsyncGenerator<string> {
        // yield nothing
      }
      mockGlob.mockReturnValueOnce(emptyGlob() as never);

      const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const sameTime = '2025-01-01T00:00:00Z';
      await collector.collectAndPublish({
        ...params,
        startedAt: sameTime,
        completedAt: sameTime,
      });

      const body = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
      ) as Record<string, unknown>;
      expect(body['cpuUtilizationPercent']).toBe(0);
      expect(body['idlePercent']).toBe(0);
      expect(body['wallTimeSeconds']).toBe(0);

      mockFetch.mockRestore();
    });

    it('does not throw when fs operations fail', async () => {
      // All reads fail
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockGlob.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      // Should not throw
      await expect(collector.collectAndPublish(params)).resolves.toBeUndefined();

      mockFetch.mockRestore();
    });

    it('logs warning when publish returns non-200', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockGlob.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await collector.collectAndPublish(params);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123', status: 500 }),
        'Turn metrics publish failed (non-fatal)'
      );

      mockFetch.mockRestore();
    });

    it('logs error and does not throw when fetch throws', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockGlob.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      const mockFetch = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('Network error'));

      await expect(collector.collectAndPublish(params)).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123' }),
        'Failed to collect/publish turn metrics (non-fatal)'
      );

      mockFetch.mockRestore();
    });
  });
});
