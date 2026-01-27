import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHeartbeatManager, type HeartbeatManager } from '../heartbeat.js';
import type { Logger } from 'pino';

// Mock fetch globally (same pattern as webhook-client.test.ts)
const mockFetch = vi.fn();
global.fetch = mockFetch as typeof global.fetch;

describe('HeartbeatManager', () => {
  let manager: HeartbeatManager;
  let logger: Logger;
  let loggerCalls: Record<string, unknown>[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    loggerCalls = [];

    // Create a simple logger that captures calls
    logger = {
      info: (msgOrObj: unknown, _msg?: string) => {
        loggerCalls.push({ level: 'info', data: msgOrObj });
      },
      debug: (msgOrObj: unknown, _msg?: string) => {
        loggerCalls.push({ level: 'debug', data: msgOrObj });
      },
      warn: (msgOrObj: unknown, _msg?: string) => {
        loggerCalls.push({ level: 'warn', data: msgOrObj });
      },
      error: (msgOrObj: unknown, _msg?: string) => {
        loggerCalls.push({ level: 'error', data: msgOrObj });
      },
    } as unknown as Logger;

    manager = createHeartbeatManager(
      {
        codeAgentUrl: 'https://code-agent.test',
        webhookSecret: 'test-secret',
        intervalMs: 60_000,
      },
      logger
    );
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  it('should not send heartbeats when no tasks registered', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    manager.start();

    // Trigger intervals - no fetch should be called since no tasks
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should send heartbeats for registered tasks', async () => {
    const expectedBody = { taskIds: ['task-1', 'task-2'] };
    let capturedBody: string | undefined;

    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedBody = options?.body as string;
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    manager.registerTask('task-1');
    manager.registerTask('task-2');
    manager.start();

    // Trigger interval
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://code-agent.test/internal/code/heartbeat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Webhook-Signature': expect.any(String),
        }),
      })
    );

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody ?? '{}');
    expect(body).toEqual(expectedBody);
  });

  it('should stop sending heartbeats for unregistered tasks', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    manager.registerTask('task-1');
    manager.unregisterTask('task-1');
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should include HMAC signature in headers', async () => {
    let capturedSignature: string | undefined;

    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      const headers = options?.headers as Record<string, string>;
      capturedSignature = headers?.['X-Webhook-Signature'];
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    manager.registerTask('task-1');
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(capturedSignature).toBeDefined();
    expect(typeof capturedSignature).toBe('string');
    expect(capturedSignature?.length).toBeGreaterThan(0);
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    manager.registerTask('task-1');
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should not throw, just log error
    const errorCalls = loggerCalls.filter((call) => call.level === 'error');
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it('should handle non-ok response gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    manager.registerTask('task-1');
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should not throw, just log warning
    const warnCalls = loggerCalls.filter((call) => call.level === 'warn');
    expect(warnCalls.length).toBeGreaterThan(0);
  });

  it('should not start multiple intervals when start called twice', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    manager.registerTask('task-1');
    manager.start();
    manager.start(); // Second call should be no-op

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    // Should only call fetch twice despite two start() calls (two intervals would mean 4 calls)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should allow restarting after stop', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    manager.registerTask('task-1');
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);
    const callCountAfterFirstStart = mockFetch.mock.calls.length;

    manager.stop();
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should have one more call after restart
    expect(mockFetch.mock.calls.length).toBe(callCountAfterFirstStart + 1);
  });

  it('should maintain correct task count after register/unregister', async () => {
    let capturedBody: string | undefined;

    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedBody = options?.body as string;
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    manager.registerTask('task-1');
    manager.registerTask('task-2');
    manager.registerTask('task-3');
    manager.unregisterTask('task-2');

    manager.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody ?? '{}');
    expect(body.taskIds).toHaveLength(2);
    expect(body.taskIds).toContain('task-1');
    expect(body.taskIds).toContain('task-3');
    expect(body.taskIds).not.toContain('task-2');
  });

  it('should handle non-Error objects in sendHeartbeats catch', async () => {
    mockFetch.mockImplementation(() => {
      throw 'string error'; // Non-Error throwable
    });

    manager.registerTask('task-1');
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should not throw, just log error
    const errorCalls = loggerCalls.filter((call) => call.level === 'error');
    expect(errorCalls.length).toBeGreaterThan(0);
    const stringErrorCall = errorCalls.find(
      (call) => typeof call.data === 'object' && call.data !== null && 'error' in call.data
    );
    expect(stringErrorCall).toBeDefined();
  });

  it('should handle AbortError from timeout', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    mockFetch.mockImplementation(() => {
      throw abortError;
    });

    manager.registerTask('task-1');
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should not throw, just log error
    const errorCalls = loggerCalls.filter((call) => call.level === 'error');
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it('should handle stop called before start (intervalId is null)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    manager.registerTask('task-1');
    // Call stop before start - intervalId is null
    manager.stop();

    // Should not throw, just log debug message
    const debugCalls = loggerCalls.filter((call) => call.level === 'debug');
    expect(debugCalls.length).toBeGreaterThan(0);

    // Now start and verify it works
    manager.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalled();
  });
});
