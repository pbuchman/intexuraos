import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('hellscriptRoutes', () => {
  const ctx = setupTestContext();

  describe('POST /hellscript/impose', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/impose',
        headers: { 'content-type': 'application/json' },
        payload: { utterance: 'Hello world' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates a new buffer and appends thought', async () => {
      ctx.intentInterpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'My thought' },
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/impose',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { utterance: 'My thought' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.bufferId).toBeDefined();
      expect(body.data.action).toBe('append_thought');
    });

    it('uses existing buffer when bufferId provided', async () => {
      const createResult = await ctx.hellscriptRepository.createBuffer(
        'test-user-123',
        'Test buffer'
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.intentInterpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'New thought' },
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/impose',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          bufferId: createResult.value.id,
          utterance: 'New thought',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.bufferId).toBe(createResult.value.id);
    });

    it('returns 404 when buffer not found', async () => {
      ctx.intentInterpreter.setNextIntent({
        kind: 'append_thought',
        payload: { text: 'thought' },
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/impose',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          bufferId: 'nonexistent',
          utterance: 'thought',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when repository fails', async () => {
      ctx.hellscriptRepository.simulateMethodError(
        'createBuffer',
        new Error('DB error')
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/impose',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { utterance: 'thought' },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /hellscript/buffers', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/buffers',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns empty array when no buffers exist', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/buffers',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns buffers for the authenticated user only', async () => {
      await ctx.hellscriptRepository.createBuffer('test-user-123', 'My buffer');
      await ctx.hellscriptRepository.createBuffer('other-user', 'Other buffer');

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/buffers',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('My buffer');
    });

    it('returns 500 when repository fails', async () => {
      ctx.hellscriptRepository.simulateMethodError(
        'listBuffers',
        new Error('DB error')
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/buffers',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /hellscript/buffers/:id', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/buffers/some-id',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns buffer workspace', async () => {
      const created = await ctx.hellscriptRepository.createBuffer(
        'test-user-123',
        'My buffer'
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/hellscript/buffers/${created.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.buffer.title).toBe('My buffer');
      expect(body.data.events).toEqual([]);
      expect(body.data.draftVersions).toEqual([]);
    });

    it('returns 404 for non-existent buffer', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/buffers/nonexistent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 404 for buffer owned by another user', async () => {
      const created = await ctx.hellscriptRepository.createBuffer(
        'other-user',
        'Other buffer'
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/hellscript/buffers/${created.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 500 when repository fails', async () => {
      ctx.hellscriptRepository.simulateMethodError(
        'getBuffer',
        new Error('DB error')
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/buffers/some-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });
  });
});
