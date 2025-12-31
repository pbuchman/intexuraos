/**
 * Tests for CleanupWorker.
 * Mocks @google-cloud/pubsub SDK to test message handling without real Pub/Sub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { MediaStoragePort, InboxError, MediaCleanupEvent } from '../../domain/inbox/index.js';

// Create mock subscription with event emitter pattern
type MessageHandler = (message: MockMessage) => void;
type ErrorHandler = (error: Error) => void;

interface MockMessage {
  id: string;
  publishTime: Date;
  data: Buffer;
  ack: () => void;
  nack: () => void;
}

const messageHandlers: MessageHandler[] = [];
const errorHandlers: ErrorHandler[] = [];
const mockClose = vi.fn();
const mockAck = vi.fn();
const mockNack = vi.fn();

interface MockSubscription {
  on: (event: string, handler: MessageHandler | ErrorHandler) => MockSubscription;
  close: () => Promise<void>;
}

const mockSubscription: MockSubscription = {
  on: (event: string, handler: MessageHandler | ErrorHandler): MockSubscription => {
    if (event === 'message') {
      messageHandlers.push(handler as MessageHandler);
    } else if (event === 'error') {
      errorHandlers.push(handler as ErrorHandler);
    }
    return mockSubscription;
  },
  close: (): Promise<void> => mockClose() as Promise<void>,
};

// Mock the module before any imports
vi.mock('@google-cloud/pubsub', () => {
  class MockPubSub {
    subscription(): MockSubscription {
      return mockSubscription;
    }
  }

  return {
    PubSub: MockPubSub,
  };
});

import {
  CleanupWorker,
  createCleanupWorker,
  type CleanupWorkerConfig,
  type CleanupWorkerLogger,
} from '../../workers/cleanupWorker.js';

/**
 * Fake media storage for testing.
 */
class FakeMediaStorageForCleanup implements MediaStoragePort {
  private shouldFailDelete = false;
  private deletedPaths: string[] = [];

  setFailDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  getDeletedPaths(): string[] {
    return [...this.deletedPaths];
  }

  upload(): Promise<Result<{ gcsPath: string }, InboxError>> {
    return Promise.resolve(ok({ gcsPath: 'test/path' }));
  }

  uploadThumbnail(): Promise<Result<{ gcsPath: string }, InboxError>> {
    return Promise.resolve(ok({ gcsPath: 'test/thumb' }));
  }

  delete(gcsPath: string): Promise<Result<void, InboxError>> {
    if (this.shouldFailDelete) {
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Delete failed' }));
    }
    this.deletedPaths.push(gcsPath);
    return Promise.resolve(ok(undefined));
  }

  getSignedUrl(): Promise<Result<string, InboxError>> {
    return Promise.resolve(ok('https://signed.url'));
  }

  clear(): void {
    this.deletedPaths = [];
    this.shouldFailDelete = false;
  }
}

/**
 * Log entry type.
 */
interface LogEntry {
  level: string;
  msg: string;
  data?: Record<string, unknown>;
}

/**
 * Fake logger for testing.
 */
class FakeLogger implements CleanupWorkerLogger {
  logs: LogEntry[] = [];

  info(msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = { level: 'info', msg };
    if (data !== undefined) {
      entry.data = data;
    }
    this.logs.push(entry);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = { level: 'warn', msg };
    if (data !== undefined) {
      entry.data = data;
    }
    this.logs.push(entry);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = { level: 'error', msg };
    if (data !== undefined) {
      entry.data = data;
    }
    this.logs.push(entry);
  }

  clear(): void {
    this.logs = [];
  }

  getLogsByLevel(level: string): LogEntry[] {
    return this.logs.filter((l) => l.level === level);
  }
}

/**
 * Create a mock Pub/Sub message.
 */
function createMockMessage(data: unknown): MockMessage {
  mockAck.mockClear();
  mockNack.mockClear();
  return {
    id: 'test-message-id',
    publishTime: new Date(),
    data: Buffer.from(JSON.stringify(data)),
    ack: mockAck,
    nack: mockNack,
  };
}

/**
 * Create a valid MediaCleanupEvent.
 */
function createCleanupEvent(overrides?: Partial<MediaCleanupEvent>): MediaCleanupEvent {
  return {
    type: 'whatsapp.media.cleanup',
    userId: 'user-123',
    messageId: 'msg-456',
    gcsPaths: ['whatsapp/user-123/msg-456/media.ogg', 'whatsapp/user-123/msg-456/thumb.jpg'],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('CleanupWorker', () => {
  let worker: CleanupWorker;
  let mediaStorage: FakeMediaStorageForCleanup;
  let logger: FakeLogger;
  const config: CleanupWorkerConfig = {
    projectId: 'test-project',
    topicName: 'test-cleanup-topic',
    subscriptionName: 'test-cleanup-subscription',
  };

  beforeEach(() => {
    // Clear handlers from previous tests
    messageHandlers.length = 0;
    errorHandlers.length = 0;
    mockClose.mockReset();
    mockClose.mockResolvedValue(undefined);
    mockAck.mockReset();
    mockNack.mockReset();

    mediaStorage = new FakeMediaStorageForCleanup();
    logger = new FakeLogger();
    worker = new CleanupWorker(config, mediaStorage, logger);
  });

  afterEach(() => {
    mediaStorage.clear();
    logger.clear();
  });

  describe('start()', () => {
    it('starts subscription and logs startup', async () => {
      await worker.start();

      expect(messageHandlers.length).toBe(1);
      expect(errorHandlers.length).toBe(1);

      const infoLogs = logger.getLogsByLevel('info');
      expect(infoLogs.some((l) => l.msg.includes('Starting Pub/Sub subscription'))).toBe(true);
      expect(infoLogs.some((l) => l.msg.includes('Cleanup worker started successfully'))).toBe(
        true
      );
    });

    it('returns early if already running', async () => {
      await worker.start();
      const handlerCountBefore = messageHandlers.length;

      await worker.start(); // Second call should be no-op

      expect(messageHandlers.length).toBe(handlerCountBefore);
    });
  });

  describe('stop()', () => {
    it('closes subscription when running', async () => {
      await worker.start();
      await worker.stop();

      expect(mockClose).toHaveBeenCalled();
      const infoLogs = logger.getLogsByLevel('info');
      expect(infoLogs.some((l) => l.msg === 'Stopped')).toBe(true);
    });

    it('returns early if not running', async () => {
      await worker.stop(); // Never started

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      await worker.start();
    });

    it('processes valid cleanup event and deletes files', async () => {
      const event = createCleanupEvent();
      const message = createMockMessage(event);

      // Trigger the message handler
      const handler = messageHandlers[0];
      if (handler === undefined) {
        throw new Error('Expected message handler to be registered');
      }
      handler(message);

      // Wait for async processing
      await vi.waitFor(() => {
        expect(mockAck).toHaveBeenCalled();
      });

      expect(mediaStorage.getDeletedPaths()).toEqual(event.gcsPaths);

      const infoLogs = logger.getLogsByLevel('info');
      expect(infoLogs.some((l) => l.msg === 'Completed cleanup')).toBe(true);
    });

    it('acks malformed JSON and logs error', async () => {
      const message: MockMessage = {
        id: 'malformed-msg',
        publishTime: new Date(),
        data: Buffer.from('not valid json'),
        ack: mockAck,
        nack: mockNack,
      };

      const handler = messageHandlers[0];
      if (handler === undefined) {
        throw new Error('Expected message handler to be registered');
      }
      handler(message);

      await vi.waitFor(() => {
        expect(mockAck).toHaveBeenCalled();
      });

      expect(mockNack).not.toHaveBeenCalled();

      const errorLogs = logger.getLogsByLevel('error');
      expect(
        errorLogs.some((l) => l.msg.includes('Failed to parse message, acking to prevent'))
      ).toBe(true);
    });

    it('acks unknown event type and logs warning', async () => {
      const event = { type: 'unknown.event.type', data: 'test' };
      const message = createMockMessage(event);

      const handler = messageHandlers[0];
      if (handler === undefined) {
        throw new Error('Expected message handler to be registered');
      }
      handler(message);

      await vi.waitFor(() => {
        expect(mockAck).toHaveBeenCalled();
      });

      expect(mockNack).not.toHaveBeenCalled();

      const warnLogs = logger.getLogsByLevel('warn');
      expect(warnLogs.some((l) => l.msg.includes('Unknown event type'))).toBe(true);
    });

    it('continues and acks even when file deletion fails', async () => {
      mediaStorage.setFailDelete(true);
      const event = createCleanupEvent();
      const message = createMockMessage(event);

      const handler = messageHandlers[0];
      if (handler === undefined) {
        throw new Error('Expected message handler to be registered');
      }
      handler(message);

      await vi.waitFor(() => {
        expect(mockAck).toHaveBeenCalled();
      });

      const warnLogs = logger.getLogsByLevel('warn');
      expect(warnLogs.some((l) => l.msg.includes('Failed to delete file'))).toBe(true);

      // Should still complete successfully (ack, not nack)
      expect(mockNack).not.toHaveBeenCalled();
    });

    it('nacks message on unexpected error during cleanup', async () => {
      // Create a media storage that throws an error
      const throwingStorage: MediaStoragePort = {
        upload: () => Promise.resolve(ok({ gcsPath: 'test' })),
        uploadThumbnail: () => Promise.resolve(ok({ gcsPath: 'test' })),
        delete: () => {
          throw new Error('Unexpected GCS error');
        },
        getSignedUrl: () => Promise.resolve(ok('url')),
      };

      const throwingWorker = new CleanupWorker(config, throwingStorage, logger);
      await throwingWorker.start();

      const event = createCleanupEvent();
      const message = createMockMessage(event);

      const handler = messageHandlers[messageHandlers.length - 1];
      if (handler === undefined) {
        throw new Error('Expected message handler to be registered');
      }
      handler(message);

      await vi.waitFor(() => {
        expect(mockNack).toHaveBeenCalled();
      });

      expect(mockAck).not.toHaveBeenCalled();

      const errorLogs = logger.getLogsByLevel('error');
      expect(errorLogs.some((l) => l.msg.includes('Unexpected error processing cleanup'))).toBe(
        true
      );
    });

    it('logs message metadata on receipt', async () => {
      const event = createCleanupEvent();
      const message = createMockMessage(event);

      const handler = messageHandlers[0];
      if (handler === undefined) {
        throw new Error('Expected message handler to be registered');
      }
      handler(message);

      await vi.waitFor(() => {
        expect(mockAck).toHaveBeenCalled();
      });

      const infoLogs = logger.getLogsByLevel('info');
      expect(infoLogs.some((l) => l.msg === 'Received Pub/Sub message')).toBe(true);
      expect(infoLogs.some((l) => l.msg === 'Processing Pub/Sub message')).toBe(true);
      expect(infoLogs.some((l) => l.msg === 'Processing cleanup')).toBe(true);
    });

    it('logs each deleted file path', async () => {
      const event = createCleanupEvent({
        gcsPaths: ['path/to/file1.ogg', 'path/to/file2.jpg'],
      });
      const message = createMockMessage(event);

      const handler = messageHandlers[0];
      if (handler === undefined) {
        throw new Error('Expected message handler to be registered');
      }
      handler(message);

      await vi.waitFor(() => {
        expect(mockAck).toHaveBeenCalled();
      });

      const infoLogs = logger.getLogsByLevel('info');
      const deletedLogs = infoLogs.filter((l) => l.msg === 'Deleted file');
      expect(deletedLogs.length).toBe(2);
      expect(deletedLogs[0]?.data?.['gcsPath']).toBe('path/to/file1.ogg');
      expect(deletedLogs[1]?.data?.['gcsPath']).toBe('path/to/file2.jpg');
    });
  });

  describe('subscription error handling', () => {
    it('logs subscription errors', async () => {
      await worker.start();

      const testError = new Error('Subscription connection failed');
      testError.stack = 'Error stack trace';

      const errorHandler = errorHandlers[0];
      if (errorHandler === undefined) {
        throw new Error('Expected error handler to be registered');
      }
      errorHandler(testError);

      const errorLogs = logger.getLogsByLevel('error');
      expect(errorLogs.some((l) => l.msg === 'Subscription error')).toBe(true);
      expect(errorLogs.some((l) => l.data?.['error'] === 'Subscription connection failed')).toBe(
        true
      );
    });
  });
});

describe('createCleanupWorker', () => {
  it('creates a CleanupWorker instance', () => {
    const config: CleanupWorkerConfig = {
      projectId: 'test-project',
      topicName: 'test-topic',
      subscriptionName: 'test-subscription',
    };
    const mediaStorage = new FakeMediaStorageForCleanup();
    const logger = new FakeLogger();

    const worker = createCleanupWorker(config, mediaStorage, logger);

    expect(worker).toBeInstanceOf(CleanupWorker);
  });
});
