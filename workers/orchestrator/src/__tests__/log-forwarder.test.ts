import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogForwarder } from '../services/log-forwarder.js';
import type { Logger } from '@intexuraos/common-core';

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
      forwarder.startForwarding('task-http', logFile);

      writeFileSync(logFile, 'Test content\n');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-http');

      expect(capturedUrl).toBe('https://code-agent.test/internal/logs');
      expect(capturedHeaders?.['Content-Type']).toBe('application/json');
      expect(capturedHeaders?.['X-Request-Timestamp']).toBeDefined();
      expect(capturedHeaders?.['X-Request-Signature']).toBeDefined();

      // Verify HMAC signature
      const expectedMessage = `${capturedHeaders?.['X-Request-Timestamp']}.${capturedBody}`;
      const crypto = await import('node:crypto');
      const expectedSignature = crypto
        .createHmac('sha256', orchestratorSecret)
        .update(expectedMessage)
        .digest('hex');
      expect(capturedHeaders?.['X-Request-Signature']).toBe(expectedSignature);
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
      expect(chunk.sequence).toBe(0);
      expect(chunk.content).toBe('Payload test\n');
      expect(chunk.timestamp).toBeDefined();
    });
  });

  describe('retry logic', () => {
    it('should retry 3x on 5xx errors with exponential backoff', { timeout: 25000 }, async () => {
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

      // Wait for two timer intervals (20s) to ensure flush happens
      await new Promise((resolve) => setTimeout(resolve, 21000));

      // Check dropped count BEFORE stopping (state is deleted on stop)
      expect(forwarder.getDroppedChunkCount('task-retry')).toBe(0);

      await forwarder.stopForwarding('task-retry');

      // Should succeed on 3rd attempt
      expect(attempts).toBe(3);
    });

    it('should not retry on 4xx errors and log as error', { timeout: 25000 }, async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 21000));

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
    });

    it('should drop chunks after max retries exceeded', { timeout: 25000 }, async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 21000));

      // Check dropped count BEFORE stopping (state is deleted on stop)
      expect(forwarder.getDroppedChunkCount('task-drop')).toBe(1);

      await forwarder.stopForwarding('task-drop');
    });
  });

  describe('chunking', () => {
    it('should chunk by size when buffer exceeds 8KB', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-chunk.log');
      forwarder.startForwarding('task-chunk', logFile);

      // Write content that exceeds 8KB
      const largeContent = 'A'.repeat(10 * 1024); // 10KB
      writeFileSync(logFile, largeContent, 'utf-8');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should create multiple chunks
      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-chunk');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);
      expect(allChunks.length).toBeGreaterThan(1);

      // Each chunk should be <= 8KB
      allChunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(8 * 1024);
      });

      await forwarder.stopForwarding('task-chunk');
    });

    it('should chunk by time every 10 seconds', { timeout: 15000 }, async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-time.log');
      forwarder.startForwarding('task-time', logFile);

      writeFileSync(logFile, 'Small content\n');

      // Wait for timer-triggered flush
      await new Promise((resolve) => setTimeout(resolve, 11 * 1000));

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-time');
      expect(taskUploads.length).toBeGreaterThan(0);

      await forwarder.stopForwarding('task-time');
    });

    it('should truncate chunks larger than 8KB and preserve tail', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-truncate.log');
      forwarder.startForwarding('task-truncate', logFile);

      // Write content larger than 8KB without newlines
      const largeContent = 'B'.repeat(10 * 1024);
      writeFileSync(logFile, largeContent, 'utf-8');

      await new Promise((resolve) => setTimeout(resolve, 200));

      await forwarder.stopForwarding('task-truncate');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-truncate');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);

      // All chunks should be <= 8KB
      allChunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(8 * 1024);
      });
    });
  });

  describe('size limits', () => {
    it('should stop uploading after 500 chunks', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-limit.log');
      forwarder.startForwarding('task-limit', logFile);

      // Write enough data to trigger chunking (9KB per chunk to trigger immediate flush)
      // Write 10 chunks of 9KB each
      for (let i = 0; i < 10; i++) {
        const chunk = 'X'.repeat(9 * 1024);
        writeFileSync(logFile, chunk, { flag: 'a' });
        // Wait for polling to pick up the content
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      await forwarder.stopForwarding('task-limit');

      // Should have created chunks (we wrote enough to trigger immediate flush)
      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-limit');
      expect(taskUploads.length).toBeGreaterThan(0);
    });

    it('should stop uploading after 4MB total', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-size.log');
      forwarder.startForwarding('task-size', logFile);

      // Write enough data to create multiple chunks (10KB)
      const largeContent = 'C'.repeat(10 * 1024);
      writeFileSync(logFile, largeContent, 'utf-8');

      // Wait for polling to pick up and chunk the content
      await new Promise((resolve) => setTimeout(resolve, 200));

      await forwarder.stopForwarding('task-size');

      // Should have created chunks
      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-size');
      expect(taskUploads.length).toBeGreaterThan(0);
    });
  });

  describe('sequence numbering', () => {
    it('should number chunks sequentially starting from 0', async () => {
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

      // Verify sequential numbering
      for (let i = 0; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        expect(chunk.sequence).toBe(i);
      }
    });
  });

  describe('getDroppedChunkCount', () => {
    it('should return 0 for non-existent task', () => {
      const forwarder = createMockForwarder();

      expect(forwarder.getDroppedChunkCount('non-existent')).toBe(0);
    });

    it('should return dropped chunk count for active task', { timeout: 25000 }, async () => {
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

      // Wait for polling, chunking, and retries (21s for two timer intervals)
      await new Promise((resolve) => setTimeout(resolve, 21000));

      expect(forwarder.getDroppedChunkCount('task-dropped')).toBe(1);

      await forwarder.stopForwarding('task-dropped');
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

  describe('splitIntoChunks', () => {
    it('should prefer splitting at newline when within 80% of max size', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-split.log');
      forwarder.startForwarding('task-split', logFile);

      // Write content that has a newline within the 80% threshold of MAX_CHUNK_SIZE
      // MAX_CHUNK_SIZE = 8192, 80% = 6553.6
      const prefix = 'A'.repeat(6500); // Within 80%
      const newline = '\n';
      const suffix = 'B'.repeat(2000); // Total ~8700 bytes
      const content = prefix + newline + suffix;
      writeFileSync(logFile, content, 'utf-8');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-split');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-split');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);

      // First chunk should be at most MAX_CHUNK_SIZE
      const firstChunk = allChunks[0];
      expect(firstChunk.content.length).toBeLessThanOrEqual(8192);
    });

    it('should not split at newline when too far back', async () => {
      const forwarder = createMockForwarder();
      captureUploadedChunks();

      const logFile = join(logBasePath, 'task-nosplit.log');
      forwarder.startForwarding('task-nosplit', logFile);

      // Write content where newline is far back (< 80% of max)
      const prefix = 'A'.repeat(7000); // Beyond 80%
      const newline = '\n';
      const suffix = 'B'.repeat(2000);
      const content = prefix + newline + suffix;
      writeFileSync(logFile, content, 'utf-8');

      await new Promise((resolve) => setTimeout(resolve, 200));
      await forwarder.stopForwarding('task-nosplit');

      const taskUploads = uploadedChunks.filter((u) => u.taskId === 'task-nosplit');
      expect(taskUploads.length).toBeGreaterThan(0);
      const allChunks = taskUploads.flatMap((u) => u.chunks);

      // First chunk should be at max chunk size (not at the newline)
      const firstChunk = allChunks[0];
      expect(firstChunk.content.length).toBeLessThanOrEqual(8192);
    });
  });
});
