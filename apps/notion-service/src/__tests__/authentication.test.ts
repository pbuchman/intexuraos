/**
 * Tests for JWT authentication across all endpoints.
 */
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('Authentication', () => {
  const ctx = setupTestContext();

  it('returns 401 UNAUTHORIZED when Authorization header is missing', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/notion/status',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED when Authorization header is invalid format', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/notion/status',
      headers: {
        authorization: 'InvalidFormat',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED for invalid JWT', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/notion/status',
      headers: {
        authorization: 'Bearer invalid-jwt-token',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED for expired JWT', async () => {
    const token = await createToken({ sub: 'user-123' }, { expiresIn: '-1s' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/notion/status',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('expired');
  });

  it('returns 401 UNAUTHORIZED for JWT missing sub claim', async () => {
    const token = await createToken({});

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/notion/status',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('sub');
  });

  it('accepts valid JWT and extracts userId from sub', async () => {
    const token = await createToken({ sub: 'auth0|user-abc123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/notion/status',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { configured: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.configured).toBe(false);
  });
});
