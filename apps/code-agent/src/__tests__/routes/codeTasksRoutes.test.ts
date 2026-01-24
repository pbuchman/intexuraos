/**
 * Tests for code tasks routes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { resetServices, setServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import type { Logger } from 'pino';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';

describe('codeTasksRoutes', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    // Setup services with fake repository
    const codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
  });

  const createTaskBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    userId: 'user-123',
    prompt: 'Fix login bug',
    sanitizedPrompt: 'fix login bug',
    systemPromptHash: 'abc123',
    workerType: 'opus' as const,
    workerLocation: 'vm' as const,
    repository: 'test/repo',
    baseBranch: 'main',
    traceId: 'trace-123',
    ...overrides,
  });

  describe('POST /internal/code-tasks', () => {
    it('creates task and returns 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: createTaskBody(),
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.task).toBeDefined();
      expect(body.data.task.id).toBeDefined();
      expect(body.data.task.userId).toBe('user-123');
      expect(body.data.task.prompt).toBe('Fix login bug');
      expect(body.data.task.status).toBe('dispatched');
    });

    it('rejects without internal auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        payload: createTaskBody(),
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 409 for duplicate prompt', async () => {
      const body = createTaskBody();

      // First request
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: body,
      });

      expect(firstResponse.statusCode).toBe(201);

      // Second request with same prompt (should hit dedup)
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: body,
      });

      expect(secondResponse.statusCode).toBe(409);

      const secondBody = JSON.parse(secondResponse.body);
      expect(secondBody.success).toBe(false);
      expect(secondBody.error.code).toBe('DUPLICATE_PROMPT');
      expect(secondBody.error.existingTaskId).toBeDefined();
    });

    it('returns 409 for duplicate actionId', async () => {
      const body = createTaskBody({ actionId: 'action-123' });

      // First request
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: body,
      });

      expect(firstResponse.statusCode).toBe(201);

      // Second request with same actionId
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: body,
      });

      expect(secondResponse.statusCode).toBe(409);

      const secondBody = JSON.parse(secondResponse.body);
      expect(secondBody.success).toBe(false);
      expect(secondBody.error.code).toBe('DUPLICATE_ACTION');
      expect(secondBody.error.existingTaskId).toBeDefined();
    });

    it('creates task with optional Linear fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: createTaskBody({
          linearIssueId: 'LIN-123',
          linearIssueTitle: 'Fix bug',
          linearFallback: true,
        }),
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.task.linearIssueId).toBe('LIN-123');
      expect(body.data.task.linearIssueTitle).toBe('Fix bug');
      expect(body.data.task.linearFallback).toBe(true);
    });

    it('validates required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: createTaskBody({ prompt: undefined }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns task with timestamps in ISO format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: createTaskBody(),
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.data.task.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(body.data.task.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('GET /internal/code-tasks/:taskId', () => {
    it('returns task when user owns it', async () => {
      // First create a task
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: createTaskBody({ userId: 'user-123' }),
      });

      expect(createResponse.statusCode).toBe(201);
      const createdBody = JSON.parse(createResponse.body);
      const taskId = createdBody.data.task.id;

      // Now fetch it
      const response = await app.inject({
        method: 'GET',
        url: `/internal/code-tasks/${taskId}?userId=user-123`,
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.task.id).toBe(taskId);
      expect(body.data.task.userId).toBe('user-123');
    });

    it('returns 404 when task does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/code-tasks/non-existent?userId=user-123',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when user does not own task', async () => {
      // First create a task for user-123
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/code-tasks',
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
        payload: createTaskBody({ userId: 'user-123' }),
      });

      expect(createResponse.statusCode).toBe(201);
      const createdBody = JSON.parse(createResponse.body);
      const taskId = createdBody.data.task.id;

      // Try to fetch as different user
      const response = await app.inject({
        method: 'GET',
        url: `/internal/code-tasks/${taskId}?userId=user-456`,
        headers: {
          'X-Internal-Auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? 'test-token',
        },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('rejects without internal auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/code-tasks/some-task?userId=user-123',
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
