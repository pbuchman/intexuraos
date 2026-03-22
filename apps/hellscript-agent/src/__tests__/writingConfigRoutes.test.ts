import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('writingConfigRoutes', () => {
  const ctx = setupTestContext();

  describe('GET /hellscript/writing-config', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns null when no config exists', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeNull();
    });

    it('returns config when it exists', async () => {
      await ctx.writingConfigRepository.upsertStyleInstructions(
        'test-user-123', 'threads', 'Be casual'
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.threads).toBe('Be casual');
    });

    it('returns 500 when repository fails', async () => {
      ctx.writingConfigRepository.simulateMethodError(
        'getStyleConfig', new Error('DB error')
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('PUT /hellscript/writing-config/:category/style', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/hellscript/writing-config/threads/style',
        headers: { 'content-type': 'application/json' },
        payload: { text: 'test' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('updates style instructions for valid category', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/hellscript/writing-config/linkedin/style',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { text: 'Write professionally' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
    });

    it('returns 400 for invalid category', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/hellscript/writing-config/twitter/style',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { text: 'Write casually' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('escapes XML tags in text input', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      await ctx.app.inject({
        method: 'PUT',
        url: '/hellscript/writing-config/threads/style',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { text: '<script>alert("xss")</script>' },
      });

      const config = await ctx.writingConfigRepository.getStyleConfig('test-user-123');
      expect(config.ok).toBe(true);
      if (config.ok && config.value !== null) {
        expect(config.value.threads).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
      }
    });

    it('returns 500 when repository fails', async () => {
      ctx.writingConfigRepository.simulateMethodError(
        'upsertStyleInstructions', new Error('DB error')
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/hellscript/writing-config/general/style',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { text: 'test' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('DELETE /hellscript/writing-config/:category/style', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/hellscript/writing-config/threads/style',
      });
      expect(response.statusCode).toBe(401);
    });

    it('clears style instructions', async () => {
      await ctx.writingConfigRepository.upsertStyleInstructions(
        'test-user-123', 'linkedin', 'Old instructions'
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/hellscript/writing-config/linkedin/style',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);

      const config = await ctx.writingConfigRepository.getStyleConfig('test-user-123');
      if (config.ok && config.value !== null) {
        expect(config.value.linkedin).toBeNull();
      }
    });

    it('returns 400 for invalid category', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/hellscript/writing-config/invalid/style',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when repository fails', async () => {
      ctx.writingConfigRepository.simulateMethodError(
        'deleteStyleInstructions', new Error('DB error')
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/hellscript/writing-config/threads/style',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /hellscript/writing-config/:category/samples', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config/threads/samples',
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns empty array when no samples exist', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config/threads/samples',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toEqual([]);
    });

    it('returns 400 for invalid category', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config/twitter/samples',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when repository fails', async () => {
      ctx.writingConfigRepository.simulateMethodError(
        'listSamples', new Error('DB error')
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config/threads/samples',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns samples for the category', async () => {
      await ctx.writingConfigRepository.createSample('test-user-123', {
        category: 'threads',
        title: 'Thread sample',
        text: 'Sample text',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/hellscript/writing-config/threads/samples',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Thread sample');
    });
  });

  describe('POST /hellscript/writing-config/:category/samples', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/writing-config/threads/samples',
        headers: { 'content-type': 'application/json' },
        payload: { title: 'Test', text: 'Test' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('creates a new sample', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/writing-config/linkedin/samples',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'My sample', text: 'Sample content here' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBeDefined();
      expect(body.data.category).toBe('linkedin');
    });

    it('returns 409 when 5 samples already exist', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.writingConfigRepository.createSample('test-user-123', {
          category: 'general',
          title: `Sample ${String(i)}`,
          text: `Text ${String(i)}`,
        });
      }

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/writing-config/general/samples',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Sixth sample', text: 'Too many' },
      });

      expect(response.statusCode).toBe(409);
    });

    it('escapes XML tags in sample text', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/writing-config/threads/samples',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Test', text: '<script>bad</script>' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.text).toBe('&lt;script&gt;bad&lt;/script&gt;');
    });

    it('returns 500 when repository fails', async () => {
      ctx.writingConfigRepository.simulateMethodError(
        'createSample', new Error('DB error')
      );

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/writing-config/threads/samples',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Test', text: 'Test content' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 400 for invalid category', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/hellscript/writing-config/twitter/samples',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Test', text: 'Test' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /hellscript/writing-config/:category/samples/:sampleId', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/hellscript/writing-config/threads/samples/some-id',
        headers: { 'content-type': 'application/json' },
        payload: { title: 'Test', text: 'Test' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('updates an existing sample', async () => {
      const created = await ctx.writingConfigRepository.createSample('test-user-123', {
        category: 'threads',
        title: 'Original',
        text: 'Original text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/hellscript/writing-config/threads/samples/${created.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated', text: 'Updated text' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 404 for wrong category', async () => {
      const created = await ctx.writingConfigRepository.createSample('test-user-123', {
        category: 'threads',
        title: 'Thread sample',
        text: 'Text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/hellscript/writing-config/linkedin/samples/${created.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated', text: 'Updated text' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for non-existent sample', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/hellscript/writing-config/threads/samples/nonexistent',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated', text: 'Updated text' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for invalid category', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/hellscript/writing-config/twitter/samples/some-id',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated', text: 'Updated text' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when repository fails', async () => {
      ctx.writingConfigRepository.simulateMethodError(
        'updateSample', new Error('DB error')
      );

      const created = await ctx.writingConfigRepository.createSample('test-user-123', {
        category: 'threads',
        title: 'Original',
        text: 'Original text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/hellscript/writing-config/threads/samples/${created.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated', text: 'Updated text' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('DELETE /hellscript/writing-config/:category/samples/:sampleId', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/hellscript/writing-config/general/samples/some-id',
      });
      expect(response.statusCode).toBe(401);
    });

    it('deletes an existing sample', async () => {
      const created = await ctx.writingConfigRepository.createSample('test-user-123', {
        category: 'general',
        title: 'To delete',
        text: 'Delete me',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/hellscript/writing-config/general/samples/${created.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 404 for wrong category', async () => {
      const created = await ctx.writingConfigRepository.createSample('test-user-123', {
        category: 'general',
        title: 'Sample',
        text: 'Text',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/hellscript/writing-config/threads/samples/${created.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for non-existent sample', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/hellscript/writing-config/general/samples/nonexistent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for invalid category', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/hellscript/writing-config/twitter/samples/some-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when repository fails', async () => {
      ctx.writingConfigRepository.simulateMethodError(
        'deleteSample', new Error('DB error')
      );

      const created = await ctx.writingConfigRepository.createSample('test-user-123', {
        category: 'general',
        title: 'To delete',
        text: 'Delete me',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/hellscript/writing-config/general/samples/${created.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
