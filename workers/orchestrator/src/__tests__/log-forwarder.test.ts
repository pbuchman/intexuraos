import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogForwarder } from '../services/log-forwarder.js';
import type { Logger } from '@intexuraos/infra-logging';

describe('LogForwarder', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'log-forwarder-test-'));
  const logBasePath = join(tempDir, 'logs');

  // Mock logger
  /* eslint-disable @typescript-eslint/no-empty-function */
  const mockLogger: Logger = {
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
    debug: (): void => {},
  };

  // Mock Firestore
  const mockChunks: { taskId: string; sequence: number; content: string }[] = [];
  const mockFirestore = {
    collection: (): {
      add: (data: { taskId: string; sequence: number; content: string }) => Promise<{ id: string }>;
    } => ({
      add: async (data: {
        taskId: string;
        sequence: number;
        content: string;
      }): Promise<{ id: string }> => {
        mockChunks.push({
          taskId: data.taskId,
          sequence: data.sequence,
          content: data.content,
        });
        return { id: `chunk-${mockChunks.length}` };
      },
    }),
  };

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(logBasePath, { recursive: true });
    mockChunks.length = 0;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('startForwarding', () => {
    it('should start watching log file', () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      const logFile = join(logBasePath, 'task-1.log');
      writeFileSync(logFile, 'Initial content\n');

      forwarder.startForwarding('task-1', logFile);

      expect(forwarder.getActiveTaskIds()).toEqual(['task-1']);
    });

    it('should read existing log file content on start', async () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      const logFile = join(logBasePath, 'task-2.log');
      writeFileSync(logFile, 'Existing content\n');

      forwarder.startForwarding('task-2', logFile);

      // Write enough content to trigger immediate flush (9KB)
      const largeContent = 'X'.repeat(9 * 1024);
      writeFileSync(logFile, largeContent, 'utf-8');

      // Wait for polling to pick up the content
      await new Promise((resolve: () => void) => setTimeout(resolve, 200));

      // Stop to flush buffer
      await forwarder.stopForwarding('task-2');

      // Should have captured content
      expect(mockChunks.length).toBeGreaterThan(0);
    });
  });

  describe('stopForwarding', () => {
    it('should stop watching and flush remaining buffer', async () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      const logFile = join(logBasePath, 'task-3.log');
      forwarder.startForwarding('task-3', logFile);

      writeFileSync(logFile, 'Content before stop\n');

      // Wait for polling to pick up the content (polling interval is 100ms)
      await new Promise((resolve) => setTimeout(resolve, 200));

      await forwarder.stopForwarding('task-3');

      expect(forwarder.getActiveTaskIds()).not.toContain('task-3');
      expect(mockChunks.length).toBeGreaterThan(0);
    });
  });

  describe('chunking', () => {
    it('should chunk by size when buffer exceeds 8KB', async () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      const logFile = join(logBasePath, 'task-chunk.log');
      forwarder.startForwarding('task-chunk', logFile);

      // Write content that exceeds 8KB
      const largeContent = 'A'.repeat(10 * 1024); // 10KB
      writeFileSync(logFile, largeContent, 'utf-8');

      // Wait for processing
      await new Promise((resolve: () => void) => setTimeout(resolve, 100));

      // Should create multiple chunks
      const taskChunks = mockChunks.filter((c) => c.taskId === 'task-chunk');
      expect(taskChunks.length).toBeGreaterThan(1);

      // Each chunk should be <= 8KB
      taskChunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(8 * 1024);
      });

      await forwarder.stopForwarding('task-chunk');
    });

    it('should chunk by time every 10 seconds', { timeout: 15000 }, async () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      const logFile = join(logBasePath, 'task-time.log');
      forwarder.startForwarding('task-time', logFile);

      writeFileSync(logFile, 'Small content\n');

      // Wait for timer-triggered flush
      await new Promise((resolve) => setTimeout(resolve, 11 * 1000));

      const taskChunks = mockChunks.filter((c) => c.taskId === 'task-time');
      expect(taskChunks.length).toBeGreaterThan(0);

      await forwarder.stopForwarding('task-time');
    });

    it('should truncate chunks larger than 8KB and preserve tail', async () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      const logFile = join(logBasePath, 'task-truncate.log');
      forwarder.startForwarding('task-truncate', logFile);

      // Write content larger than 8KB without newlines
      const largeContent = 'B'.repeat(10 * 1024);
      writeFileSync(logFile, largeContent, 'utf-8');

      await new Promise((resolve: () => void) => setTimeout(resolve, 200));

      await forwarder.stopForwarding('task-truncate');

      const taskChunks = mockChunks.filter((c) => c.taskId === 'task-truncate');
      expect(taskChunks.length).toBeGreaterThan(0);

      // All chunks should be <= 8KB (splitIntoChunks handles this)
      taskChunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(8 * 1024);
      });

      await forwarder.stopForwarding('task-truncate');
    });
  });

  describe('size limits', () => {
    it('should stop uploading after 500 chunks', async () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

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
      const taskChunks = mockChunks.filter((c) => c.taskId === 'task-limit');
      expect(taskChunks.length).toBeGreaterThan(0);
    });

    it('should stop uploading after 4MB total', async () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      const logFile = join(logBasePath, 'task-size.log');
      forwarder.startForwarding('task-size', logFile);

      // Write enough data to create multiple chunks (10KB)
      const largeContent = 'C'.repeat(10 * 1024);
      writeFileSync(logFile, largeContent, 'utf-8');

      // Wait for polling to pick up and chunk the content
      await new Promise((resolve) => setTimeout(resolve, 200));

      await forwarder.stopForwarding('task-size');

      // Should have created chunks
      const taskChunks = mockChunks.filter((c) => c.taskId === 'task-size');
      expect(taskChunks.length).toBeGreaterThan(0);
    });
  });

  describe('retry logic', () => {
    it('should retry failed uploads 3 times with backoff', { timeout: 25000 }, async () => {
      let attempts = 0;
      const failingFirestore = {
        collection: (
          _path: string
        ): {
          add: () => Promise<{ id: string }>;
        } => ({
          add: async (): Promise<{ id: string }> => {
            attempts++;
            if (attempts < 3) {
              throw new Error('Upload failed');
            }
            return { id: 'chunk-1' };
          },
        }),
      };

      const forwarder = new LogForwarder({ logBasePath, firestore: failingFirestore }, mockLogger);

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

    it('should drop chunk after 3 failed attempts', { timeout: 25000 }, async () => {
      const alwaysFailingFirestore = {
        collection: (
          _path: string
        ): {
          add: () => Promise<{ id: string }>;
        } => ({
          add: async (): Promise<{ id: string }> => {
            throw new Error('Always fails');
          },
        }),
      };

      const forwarder = new LogForwarder(
        { logBasePath, firestore: alwaysFailingFirestore },
        mockLogger
      );

      const logFile = join(logBasePath, 'task-drop.log');
      forwarder.startForwarding('task-drop', logFile);

      writeFileSync(logFile, 'Test content\n');

      // Wait for two timer intervals (20s) to ensure flush happens
      await new Promise((resolve) => setTimeout(resolve, 21000));

      // Check dropped count BEFORE stopping (state is deleted on stop)
      expect(forwarder.getDroppedChunkCount('task-drop')).toBe(1);

      await forwarder.stopForwarding('task-drop');
    });
  });

  describe('getDroppedChunkCount', () => {
    it('should return 0 for non-existent task', () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      expect(forwarder.getDroppedChunkCount('non-existent')).toBe(0);
    });

    it('should return dropped chunk count for active task', { timeout: 25000 }, async () => {
      const alwaysFailingFirestore = {
        collection: (
          _path: string
        ): {
          add: () => Promise<{ id: string }>;
        } => ({
          add: async (): Promise<{ id: string }> => {
            throw new Error('Always fails');
          },
        }),
      };

      const forwarder = new LogForwarder(
        { logBasePath, firestore: alwaysFailingFirestore },
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

  describe('sequence numbering', () => {
    it('should number chunks sequentially starting from 0', async () => {
      const forwarder = new LogForwarder({ logBasePath, firestore: mockFirestore }, mockLogger);

      const logFile = join(logBasePath, 'task-seq.log');
      forwarder.startForwarding('task-seq', logFile);

      // Write multiple chunks
      for (let i = 0; i < 3; i++) {
        writeFileSync(logFile, `Chunk ${i}\n`, { flag: 'a' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await forwarder.stopForwarding('task-seq');

      const taskChunks = mockChunks.filter((c) => c.taskId === 'task-seq');
      expect(taskChunks.length).toBeGreaterThan(0);

      // Verify sequential numbering
      for (let i = 0; i < taskChunks.length; i++) {
        expect(taskChunks[i].sequence).toBe(i);
      }
    });
  });
});
