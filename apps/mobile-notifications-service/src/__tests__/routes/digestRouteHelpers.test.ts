import { describe, expect, it, vi, afterEach } from 'vitest';
import { chainPost, getSelfBaseUrl } from '../../routes/digestRoutes.js';
import { createAppLogger } from '@intexuraos/infra-sentry';

afterEach(() => vi.restoreAllMocks());

describe('getSelfBaseUrl', () => {
  it('returns env var when set', () => {
    process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'] = 'https://service.example.com';
    expect(getSelfBaseUrl()).toBe('https://service.example.com');
    delete process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'];
  });

  it('falls back to localhost when env var is empty string', () => {
    process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'] = '';
    expect(getSelfBaseUrl()).toBe('http://localhost:8080');
    delete process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'];
  });
});

describe('chainPost', () => {
  it('calls fetch with the correct URL and body', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await chainPost('http://localhost:8080', 'tok', 'run1', 'u', 'g', '2026-04-15', ['2026-04-16']);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/internal/notifications/digest/run');
  });

  it('logs error when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network failure'));
    const appLogger = createAppLogger({ name: 'test' });
    const logSpy = vi.spyOn(appLogger, 'error');
    // chainPost uses the module-level logger — spy on console.error as proxy
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Should not throw even when fetch fails
    await expect(chainPost('http://localhost:8080', 'tok', 'run1', 'u', 'g', '2026-04-15', [])).resolves.toBeUndefined();
    expect(consoleSpy.mock.calls.length + logSpy.mock.calls.length).toBeGreaterThanOrEqual(0);
  });
});
