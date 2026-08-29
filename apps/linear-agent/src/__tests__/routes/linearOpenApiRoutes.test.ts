import { describe, expect, it, setupTestContext } from '../testUtils.js';

describe('linear-agent OpenAPI routes', () => {
  const ctx = setupTestContext();

  it('documents canonical plural Linear webhook route only', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { paths: Record<string, unknown> };
    expect(body.paths['/webhooks']).toMatchObject({ post: expect.any(Object) });
    expect(body.paths).not.toHaveProperty('/webhook');
  });

  it('uses canonical public API servers', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { servers: { url: string }[] };
    const serverUrls = body.servers.map((server) => server.url);
    expect(serverUrls).toEqual(['https://intexuraos.cloud/api/linear']);
    expect(serverUrls).not.toContain('https://dev.intexuraos.cloud/api/linear');
    expect(serverUrls).not.toContain('https://intexuraos-linear-agent-cj44trunra-lm.a.run.app');
  });
});
