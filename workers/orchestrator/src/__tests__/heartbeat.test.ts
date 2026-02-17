import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createHeartbeatManager, type HeartbeatManager } from '../heartbeat.js';
import type { Logger } from 'pino';

// Mock fetch globally (same pattern as webhook-client.test.ts)
const mockFetch = vi.fn();
global.fetch = mockFetch as typeof global.fetch;

describe('HeartbeatManager', () => {
  let manager: HeartbeatManager;
  let logger: Logger;
  let loggerCalls: Record<string, unknown>[] = [];
  let runningTasks: string[] = [];
  const orchestratorSecret = 'test-orchestrator-secret';

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    loggerCalls = [];
    runningTasks = [];

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
        orchestratorSecret,
        intervalMs: 60_000,
        getRunningTasks: () => runningTasks,
      },
      logger
    );
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  it('should not send heartbeats when no tasks running', async () => {
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

  it('should send heartbeats for running tasks with HMAC signature', async () => {
    const expectedBody = { taskIds: ['task-1', 'task-2'] };
    let capturedBody: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;

    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedBody = options?.body as string;
      capturedHeaders = options?.headers as Record<string, string>;
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    runningTasks = ['task-1', 'task-2'];
    manager.start();

    // Trigger interval
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://code-agent.test/internal/code/heartbeat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );

    // Verify body
    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody ?? '{}');
    expect(body).toEqual(expectedBody);

    // Verify HMAC signature
    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.['X-Request-Timestamp']).toBeDefined();
    expect(capturedHeaders?.['X-Request-Signature']).toBeDefined();

    const timestamp = capturedHeaders?.['X-Request-Timestamp'] ?? '0';
    const signature = capturedHeaders?.['X-Request-Signature'] ?? '';
    const message = `${timestamp}.${capturedBody}`;
    const expectedSignature = createHmac('sha256', orchestratorSecret)
      .update(message)
      .digest('hex');
    expect(signature).toBe(expectedSignature);
  });

  it('should include correct headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedHeaders = options?.headers as Record<string, string>;
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    runningTasks = ['task-1'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.['Content-Type']).toBe('application/json');
    expect(capturedHeaders?.['X-Request-Timestamp']).toBeDefined();
    expect(capturedHeaders?.['X-Request-Signature']).toBeDefined();
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    runningTasks = ['task-1'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should not throw, just log error
    const errorCalls = loggerCalls.filter((call) => call['level'] === 'error');
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it('should handle non-ok response gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    runningTasks = ['task-1'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should not throw, just log warning
    const warnCalls = loggerCalls.filter((call) => call['level'] === 'warn');
    expect(warnCalls.length).toBeGreaterThan(0);
  });

  it('should not start multiple intervals when start called twice', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    runningTasks = ['task-1'];
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

    runningTasks = ['task-1'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);
    const callCountAfterFirstStart = mockFetch.mock.calls.length;

    manager.stop();
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should have one more call after restart
    expect(mockFetch.mock.calls.length).toBe(callCountAfterFirstStart + 1);
  });

  it('should handle non-Error objects in sendHeartbeats catch', async () => {
    mockFetch.mockImplementation(() => {
      throw 'string error'; // Non-Error throwable
    });

    runningTasks = ['task-1'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should not throw, just log error
    const errorCalls = loggerCalls.filter((call) => call['level'] === 'error');
    expect(errorCalls.length).toBeGreaterThan(0);
    const stringErrorCall = errorCalls.find(
      (call) => typeof call['data'] === 'object' && call['data'] !== null && 'error' in call['data']
    );
    expect(stringErrorCall).toBeDefined();
  });

  it('should handle AbortError from timeout', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    mockFetch.mockImplementation(() => {
      throw abortError;
    });

    runningTasks = ['task-1'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    // Should not throw, just log error
    const errorCalls = loggerCalls.filter((call) => call['level'] === 'error');
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it('should handle stop called before start (intervalId is null)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    runningTasks = ['task-1'];
    // Call stop before start - intervalId is null, should not throw
    manager.stop();

    // Now start and verify it works
    manager.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('should include correct task IDs in heartbeat request', async () => {
    let capturedBody: string | undefined;

    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedBody = options?.body as string;
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    runningTasks = ['task-1', 'task-2', 'task-3'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody ?? '{}');
    expect(body.taskIds).toEqual(['task-1', 'task-2', 'task-3']);
  });

  it('should update task IDs when running tasks change', async () => {
    let capturedBody: string | undefined;

    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedBody = options?.body as string;
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    runningTasks = ['task-1', 'task-2'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);
    let body = JSON.parse(capturedBody ?? '{}');
    expect(body.taskIds).toEqual(['task-1', 'task-2']);

    // Update running tasks
    runningTasks = ['task-1', 'task-3'];

    await vi.advanceTimersByTimeAsync(60_000);
    body = JSON.parse(capturedBody ?? '{}');
    expect(body.taskIds).toEqual(['task-1', 'task-3']);
  });

  it('should escalate to error level after 3 consecutive failures', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    runningTasks = ['task-1'];
    manager.start();

    // First failure - should log as warn
    await vi.advanceTimersByTimeAsync(60_000);
    let warnCalls = loggerCalls.filter((call) => call['level'] === 'warn');
    let errorCalls = loggerCalls.filter((call) => call['level'] === 'error');
    expect(warnCalls.length).toBe(1);
    expect(errorCalls.length).toBe(0);

    // Second failure - still warn
    loggerCalls = [];
    await vi.advanceTimersByTimeAsync(60_000);
    warnCalls = loggerCalls.filter((call) => call['level'] === 'warn');
    errorCalls = loggerCalls.filter((call) => call['level'] === 'error');
    expect(warnCalls.length).toBe(1);
    expect(errorCalls.length).toBe(0);

    // Third failure - should escalate to error
    loggerCalls = [];
    await vi.advanceTimersByTimeAsync(60_000);
    warnCalls = loggerCalls.filter((call) => call['level'] === 'warn');
    errorCalls = loggerCalls.filter((call) => call['level'] === 'error');
    expect(warnCalls.length).toBe(0);
    expect(errorCalls.length).toBe(1);
  });

  it('should reset consecutive failures after successful heartbeat', async () => {
    runningTasks = ['task-1'];
    manager.start();

    // Two failures
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    // Success - should reset and log recovery
    loggerCalls = [];
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    await vi.advanceTimersByTimeAsync(60_000);

    const infoCalls = loggerCalls.filter((call) => call['level'] === 'info');
    const recoveryLog = infoCalls.find(
      (call) =>
        typeof call['data'] === 'object' &&
        call['data'] !== null &&
        'previousFailures' in call['data']
    );
    expect(recoveryLog).toBeDefined();

    // Next failure should start from 1 again (warn, not error)
    loggerCalls = [];
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await vi.advanceTimersByTimeAsync(60_000);

    const warnCalls = loggerCalls.filter((call) => call['level'] === 'warn');
    const errorCalls = loggerCalls.filter((call) => call['level'] === 'error');
    expect(warnCalls.length).toBe(1);
    expect(errorCalls.length).toBe(0);
  });

  it('should include consecutiveFailures in log context', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    runningTasks = ['task-1'];
    manager.start();

    await vi.advanceTimersByTimeAsync(60_000);

    const warnCalls = loggerCalls.filter((call) => call['level'] === 'warn');
    expect(warnCalls.length).toBe(1);
    const data = warnCalls[0]?.['data'];
    expect(typeof data === 'object' && data !== null && 'consecutiveFailures' in data).toBe(true);
    if (typeof data === 'object' && data !== null && 'consecutiveFailures' in data) {
      expect(data['consecutiveFailures']).toBe(1);
    }
  });

  it('should escalate to error for network failures after 3 consecutive attempts', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    runningTasks = ['task-1'];
    manager.start();

    // First two failures - should still include consecutiveFailures
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    loggerCalls = [];
    // Third failure - should have elevated message
    await vi.advanceTimersByTimeAsync(60_000);

    const errorCalls = loggerCalls.filter((call) => call['level'] === 'error');
    expect(errorCalls.length).toBe(1);
    const data = errorCalls[0]?.['data'];
    expect(typeof data === 'object' && data !== null && 'consecutiveFailures' in data).toBe(true);
    if (typeof data === 'object' && data !== null && 'consecutiveFailures' in data) {
      expect(data['consecutiveFailures']).toBe(3);
    }
  });
});
