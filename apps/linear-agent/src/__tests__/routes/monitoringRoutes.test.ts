import { err } from '@intexuraos/common-core';
import { getServices } from '../../services.js';
import { describe, expect, it, setupTestContext } from '../testUtils.js';

describe('Linear scheduled job monitoring', () => {
  const context = setupTestContext();
  const headers = { 'x-internal-auth': 'test-internal-token' };

  it('requires internal authentication and returns only aggregate records', async () => {
    expect((await context.app.inject({ method: 'GET', url: '/internal/monitoring/status' })).statusCode).toBe(401);
    const response = await context.app.inject({ method: 'GET', url: '/internal/monitoring/status', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ schemaVersion: 1, jobs: [
      { key: 'linear_sync_hourly', lastOutcome: 'never' },
      { key: 'linear_issues_prune_hourly', lastOutcome: 'never' },
    ] });
    expect(response.json().data.observedAt).toEqual(expect.any(String));
    expect(response.body).not.toMatch(/userId|latestRunId|runId/);
  });

  it.each([
    ['/internal/linear/sync-all', 'linear_sync_hourly'],
    ['/internal/linear/prune-issues', 'linear_issues_prune_hourly'],
  ])('records successful no-work ticks for %s', async (url, key) => {
    expect((await context.app.inject({ method: 'POST', url, headers })).statusCode).toBe(200);
    expect((await getServices().jobHeartbeatStore.list([key]))[0]).toMatchObject({
      key, lastOutcome: 'succeeded', lastSucceededAt: expect.any(String), lastFinishedAt: expect.any(String),
    });
  });

  it.each([
    ['/internal/linear/sync-all', 'linear_sync_hourly'],
    ['/internal/linear/prune-issues', 'linear_issues_prune_hourly'],
  ])('records actual failures for %s without a success timestamp', async (url, key) => {
    context.connectionRepository.getAllConnectedUserIds = async (): ReturnType<typeof context.connectionRepository.getAllConnectedUserIds> => err({ code: 'INTERNAL_ERROR', message: 'storage failure' });
    expect((await context.app.inject({ method: 'POST', url, headers })).statusCode).toBe(500);
    expect((await getServices().jobHeartbeatStore.list([key]))[0]).toMatchObject({ lastOutcome: 'failed', lastSucceededAt: null });
  });

  it('does not start unauthenticated ticks', async () => {
    expect((await context.app.inject({ method: 'POST', url: '/internal/linear/sync-all' })).statusCode).toBe(401);
    expect((await getServices().jobHeartbeatStore.list(['linear_sync_hourly']))[0]?.lastOutcome).toBe('never');
  });
});
