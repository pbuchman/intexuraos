/**
 * Tests for the Intex agent status client.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntexAgentClient, type IntexAgentClient } from '../../../infra/clients/intexAgentClient.js';
import { fetchWithAuth } from '@intexuraos/internal-clients';
import pino from 'pino';
import type { Logger } from 'pino';
import { ok } from '@intexuraos/common-core';

// Mock fetchWithAuth
vi.mock('@intexuraos/internal-clients', async () => ({
  fetchWithAuth: vi.fn(),
}));

describe('IntexAgentClient', () => {
  let client: IntexAgentClient;
  let logger: Logger;
  let mockFetchWithAuth: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;
    mockFetchWithAuth = fetchWithAuth as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  beforeEach(() => {
    client = createIntexAgentClient({
      baseUrl: 'http://intex-agent',
      internalAuthToken: 'test-token',
      logger,
    });
  });

  it('sends correct status to the intex-agent status endpoint', async () => {
    mockFetchWithAuth.mockResolvedValue(ok(undefined));

    const result = await client.updateActionStatus('action-123', 'completed', {
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
    }, 'test-trace-id-123');

    expect(result.ok).toBe(true);
    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://intex-agent',
        internalAuthToken: 'test-token',
        logger,
      }),
      '/internal/intex-agent/actions/action-123/status',
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resource_status: 'completed',
          resource_result: {
            prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
          },
        }),
        traceId: 'test-trace-id-123',
      })
    );
  });

  it('includes X-Internal-Auth header via fetchWithAuth', async () => {
    mockFetchWithAuth.mockResolvedValue(ok(undefined));

    const result = await client.updateActionStatus('action-456', 'failed', {
      error: 'Task failed',
    });

    expect(result.ok).toBe(true);
    // fetchWithAuth adds the X-Internal-Auth header
    expect(mockFetchWithAuth).toHaveBeenCalled();
  });

  it('handles network errors gracefully', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Connection refused',
      },
    });

    const result = await client.updateActionStatus('action-789', 'completed');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.message).toContain('Connection refused');
    }
  });

  it('handles API errors gracefully', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 404',
      },
    });

    const result = await client.updateActionStatus('action-999', 'failed');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('API_ERROR');
    }
  });

  it('returns error result on network error', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Connection refused',
      },
    });

    const result = await client.updateActionStatus('action-111', 'completed');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
    }
  });

  it('sends failed status with error message', async () => {
    mockFetchWithAuth.mockResolvedValue(ok(undefined));

    const result = await client.updateActionStatus('action-222', 'failed', {
      error: 'Compilation failed',
    });

    expect(result.ok).toBe(true);
    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      expect.any(Object),
      '/internal/intex-agent/actions/action-222/status',
      expect.objectContaining({
        body: JSON.stringify({
          resource_status: 'failed',
          resource_result: {
            error: 'Compilation failed',
          },
        }),
      })
    );
  });

  it('sends cancelled status', async () => {
    mockFetchWithAuth.mockResolvedValue(ok(undefined));

    const result = await client.updateActionStatus('action-333', 'cancelled');

    expect(result.ok).toBe(true);
    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      expect.any(Object),
      '/internal/intex-agent/actions/action-333/status',
      expect.objectContaining({
        body: JSON.stringify({
          resource_status: 'cancelled',
        }),
      })
    );
  });

  it('sends status without result parameter', async () => {
    mockFetchWithAuth.mockResolvedValue(ok(undefined));

    const result = await client.updateActionStatus('action-444', 'completed');

    expect(result.ok).toBe(true);
    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      expect.any(Object),
      '/internal/intex-agent/actions/action-444/status',
      expect.objectContaining({
        body: JSON.stringify({
          resource_status: 'completed',
        }),
      })
    );
  });
});
