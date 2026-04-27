import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanupOldLogs, loadConfig, type CleanupConfig } from '../cleanup.js';
import type { Logger } from '../logger.js';

const mockLogger: Logger = {
  level: 'info',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw when INTEXURAOS_CODE_AGENT_URL is missing', () => {
    delete process.env['INTEXURAOS_CODE_AGENT_URL'];
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'token';

    expect(() => loadConfig()).toThrow('INTEXURAOS_CODE_AGENT_URL is required');
  });

  it('should throw when INTEXURAOS_CODE_AGENT_URL is empty', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = '';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'token';

    expect(() => loadConfig()).toThrow('INTEXURAOS_CODE_AGENT_URL is required');
  });

  it('should throw when INTEXURAOS_INTERNAL_AUTH_TOKEN is missing', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'http://code-agent';
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

    expect(() => loadConfig()).toThrow('INTEXURAOS_INTERNAL_AUTH_TOKEN is required');
  });

  it('should throw when INTEXURAOS_INTERNAL_AUTH_TOKEN is empty', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'http://code-agent';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = '';

    expect(() => loadConfig()).toThrow('INTEXURAOS_INTERNAL_AUTH_TOKEN is required');
  });

  it('should load required config values', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'http://code-agent';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';

    const config = loadConfig();

    expect(config.codeAgentUrl).toBe('http://code-agent');
    expect(config.internalAuthToken).toBe('test-token');
    expect(config.retentionDays).toBeUndefined();
    expect(config.batchSize).toBeUndefined();
    expect(config.tasksPerRun).toBeUndefined();
  });

  it('should load optional config values when present', () => {
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'http://code-agent';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
    process.env['INTEXURAOS_LOG_RETENTION_DAYS'] = '30';
    process.env['INTEXURAOS_LOG_BATCH_SIZE'] = '250';
    process.env['INTEXURAOS_LOG_TASKS_PER_RUN'] = '50';

    const config = loadConfig();

    expect(config.retentionDays).toBe(30);
    expect(config.batchSize).toBe(250);
    expect(config.tasksPerRun).toBe(50);
  });
});

describe('cleanupOldLogs', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  const createConfig = (overrides: Partial<CleanupConfig> = {}): CleanupConfig => ({
    codeAgentUrl: 'http://code-agent',
    internalAuthToken: 'test-token',
    ...overrides,
  });

  it('should call API with correct headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { tasksProcessed: 5, tasksFailed: 0, logsDeleted: 100, durationMs: 1000 },
        }),
    });

    await cleanupOldLogs(mockLogger, createConfig());

    expect(mockFetch).toHaveBeenCalledWith(
      'http://code-agent/internal/tasks/cleanup-logs',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'test-token',
        },
      })
    );
  });

  it('should pass custom parameters in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { tasksProcessed: 5, tasksFailed: 0, logsDeleted: 100, durationMs: 1000 },
        }),
    });

    await cleanupOldLogs(
      mockLogger,
      createConfig({
        retentionDays: 30,
        batchSize: 250,
        tasksPerRun: 50,
      })
    );

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;

    expect(body).toEqual({
      retentionDays: 30,
      batchSize: 250,
      tasksPerRun: 50,
    });
  });

  it('should return success from API response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { tasksProcessed: 10, tasksFailed: 1, logsDeleted: 500, durationMs: 2000 },
        }),
    });

    const result = await cleanupOldLogs(mockLogger, createConfig());

    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(10);
    expect(result.tasksFailed).toBe(1);
    expect(result.logsDeleted).toBe(500);
    expect(result.durationMs).toBe(2000);
  });

  it('should return error when API returns non-200', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const result = await cleanupOldLogs(mockLogger, createConfig());

    expect(result.success).toBe(false);
    expect(result.message).toContain('API returned 500');
    expect(result.tasksProcessed).toBe(0);
  });

  it('should return error when API returns success=false', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Database connection failed' },
        }),
    });

    const result = await cleanupOldLogs(mockLogger, createConfig());

    expect(result.success).toBe(false);
    expect(result.message).toBe('Database connection failed');
  });

  it('should return error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await cleanupOldLogs(mockLogger, createConfig());

    expect(result.success).toBe(false);
    expect(result.message).toBe('Network error');
  });

  it('should handle non-Error exceptions', async () => {
    mockFetch.mockRejectedValue('String error');

    const result = await cleanupOldLogs(mockLogger, createConfig());

    expect(result.success).toBe(false);
    expect(result.message).toBe('String error');
  });

  it('should return error when API returns success but no data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const result = await cleanupOldLogs(mockLogger, createConfig());

    expect(result.success).toBe(false);
    expect(result.message).toBe('API returned success but no data');
  });

  it('should use default error message when API error has no message', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: 'UNKNOWN' },
        }),
    });

    const result = await cleanupOldLogs(mockLogger, createConfig());

    expect(result.success).toBe(false);
    expect(result.message).toBe('Unknown API error');
  });

  it('should not include undefined parameters in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { tasksProcessed: 0, tasksFailed: 0, logsDeleted: 0, durationMs: 100 },
        }),
    });

    await cleanupOldLogs(mockLogger, createConfig());

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;

    expect(body).toEqual({});
  });
});
