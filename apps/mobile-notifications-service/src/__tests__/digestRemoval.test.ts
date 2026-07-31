import { describe, expect, it, setupTestContext } from './testUtils.js';

const retiredEndpoints = [
  ['POST', '/internal/notifications/digest/run'],
  ['POST', '/internal/notifications/digest/run-yesterday'],
  ['GET', '/digests'],
  ['GET', '/digests/synthetic-group/2026-07-27'],
  ['GET', '/digests/synthetic-group/2026-07-27/state'],
  ['POST', '/digests/run'],
  ['POST', '/digests/backfill'],
  ['GET', '/digests/backfill/synthetic-run'],
  ['POST', '/internal/notifications/digest-subscriptions/list'],
  ['POST', '/internal/notifications/digests/query'],
  ['POST', '/internal/notifications/digests/get'],
  ['POST', '/internal/notifications/digest-state/get'],
  ['POST', '/internal/notifications/group-messages/query'],
] as const;

describe('Mobile Notifications digest removal', () => {
  const ctx = setupTestContext();

  it.each(retiredEndpoints)('%s %s is no longer registered', async (method, url) => {
    const response = await ctx.app.inject({
      method,
      url,
      ...(method === 'POST' ? { payload: {} } : {}),
    });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ['POST', '/internal/mobile-notifications/query'],
    ['GET', '/'],
    ['GET', '/filters'],
    ['POST', '/connect'],
    ['GET', '/status'],
    ['POST', '/webhooks'],
  ] as const)('keeps ordinary route %s %s registered', async (method, url) => {
    const response = await ctx.app.inject({
      method,
      url,
      ...(method === 'POST' ? { payload: {} } : {}),
    });

    expect(response.statusCode).not.toBe(404);
  });
});
