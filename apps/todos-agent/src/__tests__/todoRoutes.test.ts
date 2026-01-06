import { describe, it, expect } from './testUtils.js';
import { setupTestContext, createToken } from './testUtils.js';

describe('Todo Routes', () => {
  const ctx = setupTestContext();

  describe('GET /todos', () => {
    it('returns empty list initially', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/todos',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns user todos', async () => {
      await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test Todo',
        tags: ['test'],
        source: 'web',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/todos',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Test Todo');
    });

    it('filters by status', async () => {
      await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Pending',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/todos?status=completed',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(0);
    });

    it('returns 401 without auth', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/todos',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /todos', () => {
    it('creates a todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'New Todo',
          tags: ['important'],
          source: 'web',
          sourceId: 'src-123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('New Todo');
      expect(body.data.status).toBe('pending');
      expect(body.data.priority).toBe('medium');
    });

    it('creates a todo with items', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Todo with Items',
          tags: [],
          source: 'web',
          sourceId: 'src-123',
          items: [{ title: 'Item 1' }, { title: 'Item 2' }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.items).toHaveLength(2);
    });

    it('returns 400 for missing required fields', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Missing fields' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /todos/:id', () => {
    it('returns todo for owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/todos/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBe(createResult.value.id);
    });

    it('returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/todos/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/todos/non-existent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /todos/:id', () => {
    it('updates todo', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Original',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/todos/${createResult.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.title).toBe('Updated');
    });
  });

  describe('DELETE /todos/:id', () => {
    it('deletes todo', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/todos/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(ctx.todoRepository.getAll()).toHaveLength(0);
    });
  });

  describe('POST /todos/:id/items', () => {
    it('adds item to todo', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/items`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'New Item' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].title).toBe('New Item');
    });
  });

  describe('PATCH /todos/:id/items/:itemId', () => {
    it('updates item status', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const itemId = createResult.value.items[0]?.id;
      expect(itemId).toBeDefined();
      if (itemId === undefined) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/todos/${createResult.value.id}/items/${itemId}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { status: 'completed' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.items[0].status).toBe('completed');
    });
  });

  describe('DELETE /todos/:id/items/:itemId', () => {
    it('deletes item from todo', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }, { title: 'Item 2' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const itemId = createResult.value.items[0]?.id;
      expect(itemId).toBeDefined();
      if (itemId === undefined) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/todos/${createResult.value.id}/items/${itemId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.items).toHaveLength(1);
    });
  });

  describe('POST /todos/:id/items/reorder', () => {
    it('reorders items', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }, { title: 'Item 2' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const items = createResult.value.items;
      const item1Id = items[0]?.id;
      const item2Id = items[1]?.id;
      expect(item1Id).toBeDefined();
      expect(item2Id).toBeDefined();
      if (item1Id === undefined || item2Id === undefined) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/items/reorder`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { itemIds: [item2Id, item1Id] },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.items[0].title).toBe('Item 2');
      expect(body.data.items[1].title).toBe('Item 1');
    });
  });

  describe('POST /todos/:id/archive', () => {
    it('archives completed todo', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const todo = createResult.value;
      todo.status = 'completed';
      await ctx.todoRepository.update(todo.id, todo);

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${todo.id}/archive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.archived).toBe(true);
    });

    it('returns 400 for pending todo', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/archive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /todos/:id/unarchive', () => {
    it('unarchives todo', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const todo = createResult.value;
      todo.status = 'completed';
      todo.archived = true;
      await ctx.todoRepository.update(todo.id, todo);

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${todo.id}/unarchive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.archived).toBe(false);
    });

    it('returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos/non-existent/unarchive',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/unarchive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Additional coverage for filters', () => {
    it('filters by archived', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Archived Todo',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const todo = createResult.value;
      todo.status = 'completed';
      todo.archived = true;
      await ctx.todoRepository.update(todo.id, todo);

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/todos?archived=true',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].archived).toBe(true);
    });

    it('filters by priority', async () => {
      await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'High Priority',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        priority: 'high',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/todos?priority=high',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].priority).toBe('high');
    });

    it('filters by tags', async () => {
      await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Tagged Todo',
        tags: ['work', 'urgent'],
        source: 'web',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/todos?tags=work',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
    });
  });

  describe('Additional error cases', () => {
    it('PATCH /todos/:id returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/todos/non-existent',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('PATCH /todos/:id returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/todos/${createResult.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Hacked' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('DELETE /todos/:id returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/todos/non-existent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('DELETE /todos/:id returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/todos/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('POST /todos/:id/items returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos/non-existent/items',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'New Item' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('POST /todos/:id/items returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/items`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'New Item' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('PATCH /todos/:id/items/:itemId returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/todos/non-existent/items/item-id',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { status: 'completed' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('PATCH /todos/:id/items/:itemId returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const itemId = createResult.value.items[0]?.id;
      expect(itemId).toBeDefined();
      if (itemId === undefined) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/todos/${createResult.value.id}/items/${itemId}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { status: 'completed' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('PATCH /todos/:id/items/:itemId returns 404 for non-existent item', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/todos/${createResult.value.id}/items/non-existent`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { status: 'completed' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('DELETE /todos/:id/items/:itemId returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/todos/non-existent/items/item-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('DELETE /todos/:id/items/:itemId returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const itemId = createResult.value.items[0]?.id;
      expect(itemId).toBeDefined();
      if (itemId === undefined) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/todos/${createResult.value.id}/items/${itemId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('POST /todos/:id/items/reorder returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos/non-existent/items/reorder',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { itemIds: [] },
      });

      expect(response.statusCode).toBe(404);
    });

    it('POST /todos/:id/items/reorder returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/items/reorder`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { itemIds: [] },
      });

      expect(response.statusCode).toBe(403);
    });

    it('POST /todos/:id/items/reorder returns 400 for invalid item IDs', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/items/reorder`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { itemIds: ['invalid-id'] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('POST /todos/:id/archive returns 404 for non-existent todo', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos/non-existent/archive',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('POST /todos/:id/archive returns 403 for non-owner', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const todo = createResult.value;
      todo.status = 'completed';
      await ctx.todoRepository.update(todo.id, todo);

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${todo.id}/archive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('POST /todos/:id/archive returns 500 on storage error', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const todo = createResult.value;
      todo.status = 'completed';
      await ctx.todoRepository.update(todo.id, todo);

      ctx.todoRepository.simulateMethodError('update', { code: 'STORAGE_ERROR', message: 'DB error' });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${todo.id}/archive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });

    it('POST /todos/:id/unarchive returns 500 on storage error', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const todo = createResult.value;
      todo.status = 'completed';
      todo.archived = true;
      await ctx.todoRepository.update(todo.id, todo);

      ctx.todoRepository.simulateMethodError('update', { code: 'STORAGE_ERROR', message: 'DB error' });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${todo.id}/unarchive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });

    it('POST /todos/:id/items/reorder returns 400 for count mismatch', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }, { title: 'Item 2' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/items/reorder`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { itemIds: [createResult.value.items[0]?.id] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('POST /todos/:id/items/reorder returns 500 on storage error', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        items: [{ title: 'Item 1' }, { title: 'Item 2' }],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const itemIds = createResult.value.items.map((item) => item.id);
      ctx.todoRepository.simulateMethodError('update', { code: 'STORAGE_ERROR', message: 'DB error' });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/items/reorder`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { itemIds },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Todo creation with optional fields', () => {
    it('creates todo with priority and dueDate', async () => {
      const token = await createToken({ sub: 'user-1' });
      const dueDate = new Date('2025-12-31').toISOString();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Important Task',
          tags: [],
          source: 'web',
          sourceId: 'src-123',
          priority: 'urgent',
          dueDate,
          description: 'This is a description',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.priority).toBe('urgent');
      expect(body.data.description).toBe('This is a description');
    });

    it('creates todo with items including priority and dueDate', async () => {
      const token = await createToken({ sub: 'user-1' });
      const dueDate = new Date('2025-12-31').toISOString();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/todos',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Todo with detailed items',
          tags: [],
          source: 'web',
          sourceId: 'src-123',
          items: [
            { title: 'Item with priority', priority: 'high' },
            { title: 'Item with dueDate', dueDate },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.items[0].priority).toBe('high');
    });
  });

  describe('Update todo with all fields', () => {
    it('updates todo description and priority', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Original',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/todos/${createResult.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          description: 'New description',
          priority: 'high',
          tags: ['updated', 'tags'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.description).toBe('New description');
      expect(body.data.priority).toBe('high');
      expect(body.data.tags).toEqual(['updated', 'tags']);
    });
  });

  describe('Add item with all fields', () => {
    it('adds item with priority and dueDate', async () => {
      const createResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const dueDate = new Date('2025-12-31').toISOString();
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/todos/${createResult.value.id}/items`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'New Item', priority: 'urgent', dueDate },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.items[0].priority).toBe('urgent');
    });
  });
});
