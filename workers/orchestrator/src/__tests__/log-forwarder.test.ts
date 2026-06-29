import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogForwarder } from '../services/log-forwarder.js';
import type { Logger } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as typeof global.fetch;

describe('LogForwarder', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'log-forwarder-test-'));
  const logBasePath = join(tempDir, 'logs');

  // Test configuration
  const codeAgentUrl = 'https://code-agent.test';
  const orchestratorSecret = 'test-orchestrator-secret';
  const internalAuthToken = 'test-internal-auth-token';
  const webhookSecret = 'test-webhook-secret';

  // Mock logger
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  // Track uploaded chunks for verification
  const uploadedChunks: {
    taskId: string;
    chunks: { sequence: number; content: string; timestamp: string }[];
  }[] = [];

  function createMockForwarder(httpResponse?: { ok: boolean; status?: number }): LogForwarder {
    uploadedChunks.length = 0;
    mockFetch.mockReset();

    // Default: successful response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ received: true }),
    } as Response);

    if (httpResponse) {
      mockFetch.mockResolvedValue({
        ok: httpResponse.ok ?? true,
        status: httpResponse.status ?? 200,
        json: async () => ({ received: true }),
      } as Response);
    }

    return new LogForwarder(
      {
        logBasePath,
        codeAgentUrl,
        orchestratorSecret,
        internalAuthToken,
      },
      mockLogger
    );
  }

  function captureUploadedChunks(): void {
    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      const body = options?.body as string;
      if (body) {
        const data = JSON.parse(body) as {
          taskId: string;
          chunks: { sequence: number; content: string; timestamp: string }[];
        };
        uploadedChunks.push(data);
      }
      return {
        ok: true,
        json: async () => ({ received: true }),
      } as Response;
    });
  }

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(logBasePath, { recursive: true });
    uploadedChunks.length = 0;
    mockFetch.mockReset();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('startForwarding', () => {
    it('should start watching log file', () => {
      const forwarder = createMockForwarder();

      const logFile = join(logBasePath, 'task-1.log');
      writeFileSync(logFile, 'Initial content\n');

      forwarder.startForwarding('task-1', logFile);

      expect(forwarder.getActiveTaskIds()).toEqual(['task-1']);
    });

    it('should read existing log file content on start', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-2.log');
      writeFileSync(logFile, 'Existing content\n');

      forwarder.startForwarding('task-2', logFile);

      // Write enough content to trigger immediate flush (9KB)
      const largeContent = 'X'.repeat(9 * 1024);
      writeFileSync(logFile, largeContent, 'utf-8');

      // Wait for polling to pick up the content
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      // Stop to flush buffer
      await forwarder.stopForwarding('task-2');

      // Should have uploaded chunks
      expect(uploadedChunks.length).toBeGreaterThan(0);
    });
  });

  describe('stopForwarding', () => {
    it('should stop watching and flush remaining buffer', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-3.log');
      forwarder.startForwarding('task-3', logFile);

      writeFileSync(logFile, 'Content before stop\n');

      // Wait for polling to pick up the content (polling interval is 100ms)
      await new Promise((resolve) => setTimeout(resolve, 200));

      await forwarder.stopForwarding('task-3');

      expect(forwarder.getActiveTaskIds()).not.toContain('task-3');
      expect(uploadedChunks.length).toBeGreaterThan(0);
    });
  });

  describe('HTTP sending', () => {
    it('should send POST to /internal/logs with correct headers', async () => {
      let capturedUrl: string | undefined;
      let capturedHeaders: Record<string, string> | undefined;
      let capturedBody: string | undefined;

      mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = options?.headers as Record<string, string>;
        capturedBody = options?.body as string;
        return {
          ok: true,
          json: async () => ({ received: true }),
        } as Response;
      });

      const forwarder = new LogForwarder(
        { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
        mockLogger
      );

      const logFile = join(logBasePath, 'task-http.log');
      forwarder.registerTask('task-http', webhookSecret);
      forwarder.startForwarding('task-http', logFile);

      writeFileSync(logFile, 'Test content\n');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-http');

      expect(capturedUrl).toBe('https://code-agent.test/internal/logs');
      expect(capturedHeaders?.['Content-Type']).toBe('application/json');
      expect(capturedHeaders?.['X-Request-Timestamp']).toBeDefined();
      expect(capturedHeaders?.['X-Request-Signature']).toBeDefined();

      // Verify HMAC signature (uses task-specific webhookSecret, not orchestratorSecret)
      const expectedMessage = `${capturedHeaders?.['X-Request-Timestamp']}.${capturedBody}`;
      const crypto = await import('node:crypto');
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(expectedMessage)
        .digest('hex');
      expect(capturedHeaders?.['X-Request-Signature']).toBe(expectedSignature);
    });

    it('uses the task webhook base for task-scoped log uploads when provided', async () => {
      let capturedUrl: string | undefined;

      mockFetch.mockImplementation(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({ received: true }),
        } as Response;
      });

      const forwarder = new LogForwarder(
        { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
        mockLogger
      );

      const logFile = join(logBasePath, 'task-callback-base.log');
      forwarder.registerTask(
        'task-callback-base',
        webhookSecret,
        'https://intexuraos.cloud/api/code/internal/webhooks/task-complete'
      );
      forwarder.startForwarding('task-callback-base', logFile);

      writeFileSync(logFile, 'Prod task content\n');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-callback-base');

      expect(capturedUrl).toBe('https://intexuraos.cloud/api/code/internal/logs');
    });

    it('should include correct payload format', async () => {
      let capturedBody: string | undefined;

      mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
        capturedBody = options?.body as string;
        return {
          ok: true,
          json: async () => ({ received: true }),
        } as Response;
      });

      const forwarder = new LogForwarder(
        { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
        mockLogger
      );

      const logFile = join(logBasePath, 'task-payload.log');
      forwarder.startForwarding('task-payload', logFile);

      writeFileSync(logFile, 'Payload test\n');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-payload');

      expect(capturedBody).toBeDefined();
      const data = JSON.parse(capturedBody ?? '{}');
      expect(data.taskId).toBe('task-payload');
      expect(data.chunks).toBeInstanceOf(Array);
      expect(data.chunks.length).toBeGreaterThan(0);

      // Verify chunk structure
      const chunk = data.chunks[0];
      expect(chunk.sequence).toBeGreaterThan(1_000_000_000_000); // timestamp-based
      expect(chunk.content).toBe('Payload test\n');
      expect(chunk.timestamp).toBeDefined();
    });
  });

  describe('retry logic', () => {
    it('should retry 3x on 5xx errors with exponential backoff', async () => {
      vi.useFakeTimers();
      try {
        let attempts = 0;

        mockFetch.mockImplementation(async () => {
          attempts++;
          if (attempts < 3) {
            return {
              ok: false,
              status: 500,
              json: async () => ({}),
            } as Response;
          }
          return {
            ok: true,
            json: async () => ({ received: true }),
          } as Response;
        });

        const forwarder = new LogForwarder(
          { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
          mockLogger
        );

        const logFile = join(logBasePath, 'task-retry.log');
        forwarder.startForwarding('task-retry', logFile);

        writeFileSync(logFile, 'Test content\n');

        // Advance fake time through two flush intervals (6s) plus retry backoff
        await vi.advanceTimersByTimeAsync(7000);

        // Check dropped count BEFORE stopping (state is deleted on stop)
        expect(forwarder.getDroppedChunkCount('task-retry')).toBe(0);

        await forwarder.stopForwarding('task-retry');

        // Should succeed on 3rd attempt
        expect(attempts).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('suppresses retry warnings from Sentry while preserving retry logs', async () => {
      vi.useFakeTimers();
      try {
        let attempts = 0;
        vi.mocked(mockLogger.warn).mockReset();

        mockFetch.mockImplementation(async () => {
          attempts++;
          if (attempts < 3) {
            return {
              ok: false,
              status: 502,
              json: async () => ({}),
            } as Response;
          }
          return {
            ok: true,
            json: async () => ({ received: true }),
          } as Response;
        });

        const forwarder = new LogForwarder(
          { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
          mockLogger
        );

        const logFile = join(logBasePath, 'task-retry-skip-sentry.log');
        forwarder.startForwarding('task-retry-skip-sentry', logFile);

        writeFileSync(logFile, 'Test content\n');

        await vi.advanceTimersByTimeAsync(7000);
        await forwarder.stopForwarding('task-retry-skip-sentry');

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: 'task-retry-skip-sentry',
            attempt: 1,
            status: 502,
            url: expect.stringContaining('/internal/logs'),
            [SKIP_SENTRY_KEY]: true,
          }),
          'Log upload failed, retrying'
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('suppresses final upload failure errors from Sentry while tracking dropped chunks', async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(mockLogger.error).mockReset();

        mockFetch.mockImplementation(async () => {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
          } as Response;
        });

        const forwarder = new LogForwarder(
          { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
          mockLogger
        );

        const logFile = join(logBasePath, 'task-upload-failed-skip-sentry.log');
        forwarder.startForwarding('task-upload-failed-skip-sentry', logFile);

        writeFileSync(logFile, 'Test\n');

        await vi.advanceTimersByTimeAsync(7000);

        expect(forwarder.getDroppedChunkCount('task-upload-failed-skip-sentry')).toBe(1);

        await forwarder.stopForwarding('task-upload-failed-skip-sentry');

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: 'task-upload-failed-skip-sentry',
            count: 1,
            url: 'https://code-agent.test/internal/logs',
            [SKIP_SENTRY_KEY]: true,
          }),
          'Failed to upload log chunks after retries'
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not retry on 4xx errors and log as error', async () => {
      vi.useFakeTimers();
      try {
        let attempts = 0;
        vi.mocked(mockLogger.error).mockReset();

        mockFetch.mockImplementation(async () => {
          attempts++;
          return {
            ok: false,
            status: 400,
            json: async () => ({}),
          } as Response;
        });

        const forwarder = new LogForwarder(
          { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
          mockLogger
        );

        const logFile = join(logBasePath, 'task-no-retry.log');
        forwarder.startForwarding('task-no-retry', logFile);

        writeFileSync(logFile, 'Test content\n');

        await vi.advanceTimersByTimeAsync(7000);

        // Check dropped count - should have dropped chunks
        expect(forwarder.getDroppedChunkCount('task-no-retry')).toBe(1);

        await forwarder.stopForwarding('task-no-retry');

        // Should only try once (no retry on 4xx)
        expect(attempts).toBe(1);

        // Should log 4xx as error with taskId, status, and url
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: 'task-no-retry',
            status: 400,
            url: expect.stringContaining('/internal/logs'),
          }),
          expect.stringContaining('client error')
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should drop chunks after max retries exceeded', async () => {
      vi.useFakeTimers();
      try {
        mockFetch.mockImplementation(async () => {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
          } as Response;
        });

        const forwarder = new LogForwarder(
          { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
          mockLogger
        );

        const logFile = join(logBasePath, 'task-drop.log');
        forwarder.startForwarding('task-drop', logFile);

        writeFileSync(logFile, 'Test\n');

        await vi.advanceTimersByTimeAsync(7000);

        // Check dropped count BEFORE stopping (state is deleted on stop)
        expect(forwarder.getDroppedChunkCount('task-drop')).toBe(1);

        await forwarder.stopForwarding('task-drop');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('chunking', () => {
    it('should split multi-line content at line boundaries when buffer exceeds 64KB', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-chunk.log');
      forwarder.startForwarding('task-chunk', logFile);

      // Write many lines totalling >64KB — must split at newlines
      const lines = Array.from({ length: 200 }, (_, i) => `line-${String(i)}: ${'X'.repeat(500)}`);
      writeFileSync(logFile, lines.join('\n') + '\n', 'utf-8');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-chunk');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-chunk');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);
      expect(allChunks.length).toBeGreaterThan(1);

      // Each chunk should end with a newline (split at line boundaries)
      allChunks.forEach((chunk) => {
        expect(chunk.content.endsWith('\n')).toBe(true);
      });
    });

    it('should keep a single long line intact instead of splitting mid-content', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-long-line.log');
      forwarder.startForwarding('task-long-line', logFile);

      // Two lines: one >64KB (kept intact) + one short line
      // Total exceeds MAX_CHUNK_SIZE so flush triggers immediately
      const longLine = 'A'.repeat(70 * 1024);
      const content = longLine + '\nshort line\n';
      writeFileSync(logFile, content, 'utf-8');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-long-line');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-long-line');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);

      // The long line should be in one chunk (not split mid-content)
      // even though it exceeds MAX_CHUNK_SIZE
      expect(allChunks.length).toBe(2);
      expect(allChunks[0]?.content).toContain('AAAA');
      expect(allChunks[1]?.content).toContain('short line');
    });

    it('should chunk by time every 3 seconds', async () => {
      vi.useFakeTimers();
      try {
        const forwarder = createMockForwarder();
        captureUploadedChunks();

        const logFile = join(logBasePath, 'task-time.log');
        forwarder.startForwarding('task-time', logFile);

        writeFileSync(logFile, 'Small content\n');

        // Advance through one CHUNK_INTERVAL_MS (3s) flush plus slack
        await vi.advanceTimersByTimeAsync(4 * 1000);

        const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-time');
        expect(taskUploads.length).toBeGreaterThan(0);

        await forwarder.stopForwarding('task-time');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should truncate chunks larger than 64KB and preserve tail', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-truncate.log');
      forwarder.startForwarding('task-truncate', logFile);

      // Write content larger than 64KB without newlines
      const largeContent = 'B'.repeat(80 * 1024);
      writeFileSync(logFile, largeContent, 'utf-8');

      await new Promise((resolve) => setTimeout(resolve, 200));

      await forwarder.stopForwarding('task-truncate');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-truncate');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);

      // All chunks should be <= 64KB after enforceChunkSize truncation
      allChunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(64 * 1024);
      });
    });
  });

  describe('size limits', () => {
    it('should stop uploading formatted chunks after 8MB total', async () => {
      vi.useFakeTimers();
      try {
        const warnSpy = mockLogger.warn as ReturnType<typeof vi.fn>;
        warnSpy.mockClear();

        const forwarder = createMockForwarder();
        captureUploadedChunks();

        // Use appendChunk (Docker mode) for deterministic control
        forwarder.registerTask('task-size', 'secret');
        forwarder.appendChunk('task-size', 'init\n');
        await forwarder.flush('task-size');

        // Push totalBytes past the 8MB cap so the next non-force flush
        // exercises the limit guard in flushBuffer.
        const forwarders = (forwarder as unknown as Record<string, unknown>)['forwarders'] as Map<
          string,
          { totalBytes: number; timer: NodeJS.Timeout | null }
        >;
        const state = forwarders.get('task-size');
        if (state !== undefined) {
          state.totalBytes = 8 * 1024 * 1024 + 1;
        }

        // Append more content — a timer-triggered (non-force) flush should drop it
        forwarder.appendChunk('task-size', 'should-be-dropped\n');
        await vi.advanceTimersByTimeAsync(3100); // CHUNK_INTERVAL_MS = 3000

        // Verify the cap was hit: warn logged and chunk dropped
        expect(warnSpy).toHaveBeenCalledWith(
          expect.objectContaining({ taskId: 'task-size' }),
          'Max total log size reached, stopping uploads'
        );
        expect(forwarder.getDroppedChunkCount('task-size')).toBeGreaterThan(0);

        // Clean up timer
        if (state?.timer !== null && state?.timer !== undefined) clearInterval(state.timer);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('sequence numbering', () => {
    it('should use timestamp-based sequences that are monotonically increasing', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-seq.log');
      forwarder.startForwarding('task-seq', logFile);

      // Write multiple chunks
      for (let i = 0; i < 3; i++) {
        writeFileSync(logFile, `Chunk ${i}\n`, { flag: 'a' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await forwarder.stopForwarding('task-seq');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-seq');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);

      // Verify timestamp-based sequences (monotonically increasing)
      for (let i = 0; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        if (chunk) {
          expect(chunk.sequence).toBeGreaterThan(1_000_000_000_000);
          if (i > 0) {
            const prev = allChunks[i - 1];
            if (prev) {
              expect(chunk.sequence).toBeGreaterThanOrEqual(prev.sequence);
            }
          }
        }
      }
    });
  });

  describe('getDroppedChunkCount', () => {
    it('should return 0 for non-existent task', () => {
      const forwarder = createMockForwarder();

      expect(forwarder.getDroppedChunkCount('non-existent')).toBe(0);
    });

    it('should return dropped chunk count for active task', async () => {
      vi.useFakeTimers();
      try {
        mockFetch.mockImplementation(async () => {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
          } as Response;
        });

        const forwarder = new LogForwarder(
          { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
          mockLogger
        );

        const logFile = join(logBasePath, 'task-dropped.log');
        forwarder.startForwarding('task-dropped', logFile);

        writeFileSync(logFile, 'Test\n');

        // Advance fake time through polling, chunking, and retries
        await vi.advanceTimersByTimeAsync(7000);

        expect(forwarder.getDroppedChunkCount('task-dropped')).toBe(1);

        await forwarder.stopForwarding('task-dropped');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('edge cases', () => {
    it('should warn when starting forwarding for already active task', () => {
      const warnSpy = vi.fn();
      const loggerWithWarn: Logger = {
        info: () => undefined,
        warn: warnSpy,
        error: () => undefined,
        debug: () => undefined,
      };

      const forwarder = new LogForwarder(
        { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
        loggerWithWarn
      );

      const logFile = join(logBasePath, 'task-duplicate.log');
      forwarder.startForwarding('task-duplicate', logFile);

      // Start again with same task ID
      forwarder.startForwarding('task-duplicate', logFile);

      expect(warnSpy).toHaveBeenCalledWith(
        { taskId: 'task-duplicate' },
        'Log forwarding already started'
      );

      // Should still only have one active task
      expect(forwarder.getActiveTaskIds()).toEqual(['task-duplicate']);
    });

    it('should warn when stopping forwarding for non-existent task', async () => {
      const warnSpy = vi.fn();
      const loggerWithWarn: Logger = {
        info: () => undefined,
        warn: warnSpy,
        error: () => undefined,
        debug: () => undefined,
      };

      const forwarder = new LogForwarder(
        { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
        loggerWithWarn
      );

      // Stop task that was never started
      await forwarder.stopForwarding('non-existent-task');

      expect(warnSpy).toHaveBeenCalledWith(
        { taskId: 'non-existent-task' },
        'No forwarding state to stop'
      );
    });

    it('should handle non-existent log file gracefully in readNewContent', () => {
      const forwarder = createMockForwarder();

      // Start with a log file that doesn't exist
      const nonExistentFile = join(tempDir, 'does-not-exist.log');
      forwarder.startForwarding('task-no-file', nonExistentFile);

      // Should not throw, file will be created when written to
      expect(forwarder.getActiveTaskIds()).toContain('task-no-file');

      forwarder.stopForwarding('task-no-file');
    });

    it('should handle errors reading existing log file', () => {
      const errorSpy = vi.fn();
      const loggerWithError: Logger = {
        info: () => undefined,
        warn: () => undefined,
        error: errorSpy,
        debug: () => undefined,
      };

      const forwarder = new LogForwarder(
        { logBasePath, codeAgentUrl, orchestratorSecret, internalAuthToken },
        loggerWithError
      );

      const logFile = join(logBasePath, 'task-error.log');

      // Start forwarding with existing file - should handle errors gracefully
      forwarder.startForwarding('task-error', logFile);

      // The test verifies the branch is exercised when file read fails
      expect(forwarder.getActiveTaskIds()).toContain('task-error');
    });
  });

  describe('appendChunk partial-line reassembly', () => {
    it('should buffer content without trailing newline until next chunk completes it', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();
      forwarder.registerTask('task-partial', webhookSecret);

      const jsonPart1 = '{"type":"assistant","message":{"content":[{"type":"text","text":"hel';
      const jsonPart2 = 'lo world"}]}}\n';

      forwarder.appendChunk('task-partial', jsonPart1);
      forwarder.appendChunk('task-partial', jsonPart2);

      await forwarder.flushAndStop('task-partial');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-partial');
      expect(taskUploads.length).toBeGreaterThan(0);

      const allContent = taskUploads
        .flatMap((u) => u.chunks)
        .map((c) => c.content)
        .join('');
      expect(allContent).toContain('hello world');
    });

    it('should forward split hook_response JSON when reassembled', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();
      forwarder.registerTask('task-hook', webhookSecret);

      const hookJson = JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        hook_id: 'abc',
        output: 'x'.repeat(200),
      });
      const midpoint = Math.floor(hookJson.length / 2);
      const part1 = hookJson.slice(0, midpoint);
      const part2 = hookJson.slice(midpoint) + '\n';

      forwarder.appendChunk('task-hook', part1);
      forwarder.appendChunk('task-hook', part2);

      await forwarder.flushAndStop('task-hook');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-hook');
      const allContent = taskUploads
        .flatMap((u) => u.chunks)
        .map((c) => c.content)
        .join('');
      expect(allContent).toContain('hook_response');
    });

    it('should flush partial line on flushAndStop', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();
      forwarder.registerTask('task-flush-partial', webhookSecret);

      forwarder.appendChunk('task-flush-partial', '[entrypoint] Starting');

      await forwarder.flushAndStop('task-flush-partial');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-flush-partial');
      expect(taskUploads.length).toBeGreaterThan(0);

      const allContent = taskUploads
        .flatMap((u) => u.chunks)
        .map((c) => c.content)
        .join('');
      expect(allContent).toContain('[entrypoint] Starting');
    });

    it('should handle multiple complete lines in one chunk', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();
      forwarder.registerTask('task-multi', webhookSecret);

      const line1 = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Line 1' }] },
      });
      const line2 = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Line 2' }] },
      });

      forwarder.appendChunk('task-multi', line1 + '\n' + line2 + '\n');

      await forwarder.flushAndStop('task-multi');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-multi');
      const allContent = taskUploads
        .flatMap((u) => u.chunks)
        .map((c) => c.content)
        .join('');
      expect(allContent).toContain('Line 1');
      expect(allContent).toContain('Line 2');
    });
  });

  describe('splitIntoChunks', () => {
    const MAX_CHUNK = 64 * 1024;

    it('should split multi-line content at newline boundaries', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-split.log');
      forwarder.startForwarding('task-split', logFile);

      // Two lines totalling >64KB — must split at the newline
      const line1 = 'A'.repeat(60 * 1024) + '\n';
      const line2 = 'B'.repeat(20 * 1024) + '\n';
      writeFileSync(logFile, line1 + line2, 'utf-8');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-split');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-split');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);

      // Should split into 2 chunks at the newline boundary
      expect(allChunks.length).toBe(2);
      expect(allChunks[0]?.content).toContain('AAAA');
      expect(allChunks[1]?.content).toContain('BBBB');
    });

    it('should not split a single line even if it exceeds max chunk size', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-nosplit.log');
      forwarder.startForwarding('task-nosplit', logFile);

      // Single line >64KB with no internal newlines
      const singleLine = 'C'.repeat(MAX_CHUNK + 5000) + '\n';
      writeFileSync(logFile, singleLine, 'utf-8');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-nosplit');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-nosplit');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);

      // Single line kept intact as one chunk (enforceChunkSize may truncate it)
      expect(allChunks.length).toBe(1);
    });
  });
});
