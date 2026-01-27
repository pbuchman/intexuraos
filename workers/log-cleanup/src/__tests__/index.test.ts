import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockCleanupOldLogs = vi.hoisted(() => vi.fn());

vi.mock('../cleanup.js', () => ({
  cleanupOldLogs: mockCleanupOldLogs,
}));

const registeredHandlers = vi.hoisted(() => new Map<string, (event: unknown) => Promise<void>>());

vi.mock('@google-cloud/functions-framework', () => ({
  cloudEvent: (name: string, handler: (event: unknown) => Promise<void>): void => {
    registeredHandlers.set(name, handler);
  },
}));

describe('log-cleanup Cloud Function', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();
    vi.resetModules();
    await import('../index.js');
  });

  it('should register cleanupLogs handler', () => {
    expect(registeredHandlers.has('cleanupLogs')).toBe(true);
  });

  it('should call cleanupOldLogs on Pub/Sub event', async () => {
    mockCleanupOldLogs.mockResolvedValue({
      success: true,
      message: 'Processed 5 tasks',
      tasksProcessed: 5,
      tasksFailed: 0,
      logsDeleted: 100,
      durationMs: 1500,
    });

    const handler = registeredHandlers.get('cleanupLogs');
    if (handler === undefined) {
      throw new Error('Handler not registered');
    }

    const mockEvent = {
      id: 'test-event-123',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      source: '//pubsub.googleapis.com/projects/test/topics/log-cleanup',
      data: {
        message: {
          data: Buffer.from('{}').toString('base64'),
        },
      },
    };

    await handler(mockEvent);

    expect(mockCleanupOldLogs).toHaveBeenCalledOnce();
  });

  it('should throw error if cleanup fails', async () => {
    mockCleanupOldLogs.mockResolvedValue({
      success: false,
      message: 'Database connection failed',
      tasksProcessed: 0,
      tasksFailed: 0,
      logsDeleted: 0,
      durationMs: 100,
    });

    const handler = registeredHandlers.get('cleanupLogs');
    if (handler === undefined) {
      throw new Error('Handler not registered');
    }

    const mockEvent = {
      id: 'test-event-456',
      type: 'google.cloud.pubsub.topic.v1.messagePublished',
      source: '//pubsub.googleapis.com/projects/test/topics/log-cleanup',
      data: {
        message: {},
      },
    };

    await expect(handler(mockEvent)).rejects.toThrow('Database connection failed');
  });
});
