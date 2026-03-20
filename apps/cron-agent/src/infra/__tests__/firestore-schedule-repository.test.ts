import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FirestoreScheduleRepository } from '../firestore-schedule-repository.js';
import { initTestFirestore, cleanupTestFirestore } from './test-helpers.js';

describe('FirestoreScheduleRepository', () => {
  let repo: FirestoreScheduleRepository;

  beforeEach(() => {
    initTestFirestore();
    repo = new FirestoreScheduleRepository();
  });

  afterEach(() => {
    cleanupTestFirestore();
  });

  it('creates a schedule and returns it', async () => {
    const result = await repo.create('user-1', {
      name: 'Test Schedule',
      description: 'Every minute',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'do something', preferredTools: [] },
      nextExecutionAt: '2026-01-01T00:01:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('Test Schedule');
    expect(result.value.userId).toBe('user-1');
    expect(result.value.status).toBe('active');
    expect(result.value.executionCount).toBe(0);
    expect(result.value.failureCount).toBe(0);
    expect(result.value.lastExecutedAt).toBeNull();
    expect(result.value.cronExpression).toBe('* * * * *');
    expect(result.value.timezone).toBe('UTC');
    expect(result.value.nextExecutionAt).toBe('2026-01-01T00:01:00.000Z');
    expect(result.value.id).toBeDefined();
    expect(result.value.createdAt).toBeDefined();
    expect(result.value.updatedAt).toBeDefined();
  });

  it('finds a schedule by id', async () => {
    const createResult = await repo.create('user-1', {
      name: 'Test',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const findResult = await repo.findById(createResult.value.id);
    expect(findResult.ok).toBe(true);
    if (!findResult.ok) return;
    expect(findResult.value).not.toBeNull();
    expect(findResult.value?.name).toBe('Test');
    expect(findResult.value?.id).toBe(createResult.value.id);
  });

  it('returns null for non-existent schedule', async () => {
    const result = await repo.findById('nonexistent');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('finds schedules by userId with status filter', async () => {
    await repo.create('user-1', {
      name: 'Active',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const result = await repo.findByUserId('user-1', { limit: 50, status: ['active'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schedules.length).toBe(1);
    expect(result.value.schedules[0]?.status).toBe('active');
  });

  it('finds due schedules', async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    await repo.create('user-1', {
      name: 'Due',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: past,
    });

    const result = await repo.findDueSchedules(new Date());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]?.name).toBe('Due');
  });

  it('does not return future schedules as due', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    await repo.create('user-1', {
      name: 'Future',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: future,
    });

    const result = await repo.findDueSchedules(new Date());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(0);
  });

  it('updates a schedule', async () => {
    const createResult = await repo.create('user-1', {
      name: 'Original',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const updateResult = await repo.update(createResult.value.id, { name: 'Updated' });
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.value.name).toBe('Updated');
  });

  it('returns error when updating non-existent schedule', async () => {
    const result = await repo.update('nonexistent', { name: 'Updated' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('finds by userId without status filter', async () => {
    await repo.create('user-1', {
      name: 'Test',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const result = await repo.findByUserId('user-1', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schedules.length).toBe(1);
  });

  it('does not return schedules for a different user', async () => {
    await repo.create('user-1', {
      name: 'User1 Schedule',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const result = await repo.findByUserId('user-2', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schedules.length).toBe(0);
  });

  it('handles pagination with limit', async () => {
    await repo.create('user-1', {
      name: 'First',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    await repo.create('user-1', {
      name: 'Second',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const page1 = await repo.findByUserId('user-1', { limit: 1 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.schedules.length).toBe(1);
    expect(page1.value.nextCursor).not.toBeNull();
  });

  it('only finds active schedules as due', async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const createResult = await repo.create('user-1', {
      name: 'Paused',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: past,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await repo.update(createResult.value.id, { status: 'paused' });

    const result = await repo.findDueSchedules(new Date());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(0);
  });

  it('sets updatedAt on update', async () => {
    const createResult = await repo.create('user-1', {
      name: 'Test',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const updateResult = await repo.update(createResult.value.id, { name: 'Updated' });
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(typeof updateResult.value.updatedAt).toBe('string');
    expect(updateResult.value.updatedAt.length).toBeGreaterThan(0);
  });

  it('filters by empty status array returns all', async () => {
    await repo.create('user-1', {
      name: 'Test',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const result = await repo.findByUserId('user-1', { limit: 50, status: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schedules.length).toBe(1);
  });

  it('returns count matching schedules length', async () => {
    await repo.create('user-1', {
      name: 'A',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    await repo.create('user-1', {
      name: 'B',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const result = await repo.findByUserId('user-1', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.count).toBe(result.value.schedules.length);
  });

  it('returns null nextCursor when all results fit in limit', async () => {
    await repo.create('user-1', {
      name: 'Only',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const result = await repo.findByUserId('user-1', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextCursor).toBeNull();
  });

  it('paginates using cursor in findByUserId', async () => {
    const first = await repo.create('user-1', {
      name: 'First',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await repo.create('user-1', {
      name: 'Second',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const page1 = await repo.findByUserId('user-1', { limit: 1 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.schedules.length).toBe(1);
    expect(page1.value.nextCursor).not.toBeNull();

    const cursor = page1.value.nextCursor ?? '';
    const page2 = await repo.findByUserId('user-1', { limit: 1, cursor });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.schedules.length).toBe(1);
  });

  it('returns INTERNAL_ERROR when Firestore throws on create', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.create('user-1', {
      name: 'Test',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = savedProjectId ?? '';
    initTestFirestore();
  });

  it('returns INTERNAL_ERROR when Firestore throws on findById', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.findById('some-id');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = savedProjectId ?? '';
    initTestFirestore();
  });

  it('returns INTERNAL_ERROR when Firestore throws on findByUserId', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.findByUserId('user-1', { limit: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = savedProjectId ?? '';
    initTestFirestore();
  });

  it('returns INTERNAL_ERROR when Firestore throws on findDueSchedules', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.findDueSchedules(new Date());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = savedProjectId ?? '';
    initTestFirestore();
  });

  it('returns INTERNAL_ERROR when Firestore throws on update', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.update('some-id', { name: 'Updated' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = savedProjectId ?? '';
    initTestFirestore();
  });

  it('incrementCounters with both counters', async () => {
    const createResult = await repo.create('user-1', {
      name: 'Test',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await repo.incrementCounters(
      createResult.value.id,
      { executionCount: true, failureCount: true },
      { lastExecutedAt: '2026-01-01T00:00:00Z', nextExecutionAt: '2026-01-01T00:01:00Z' },
    );
    expect(result.ok).toBe(true);
  });

  it('incrementCounters with only executionCount', async () => {
    const createResult = await repo.create('user-1', {
      name: 'Test',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await repo.incrementCounters(
      createResult.value.id,
      { executionCount: true },
      { lastExecutedAt: '2026-01-01T00:00:00Z', nextExecutionAt: null },
    );
    expect(result.ok).toBe(true);
  });

  it('incrementCounters returns error when Firestore throws', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.incrementCounters(
      'some-id',
      { executionCount: true },
      { lastExecutedAt: '2026-01-01T00:00:00Z', nextExecutionAt: null },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = savedProjectId ?? '';
    initTestFirestore();
  });

  it('handles cursor for non-existent doc in findByUserId', async () => {
    await repo.create('user-1', {
      name: 'Test',
      description: 'test',
      cronExpression: '* * * * *',
      timezone: 'UTC',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      nextExecutionAt: null,
    });

    const result = await repo.findByUserId('user-1', { limit: 50, cursor: 'nonexistent-cursor' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should still return results since cursor doc doesn't exist
    expect(result.value.schedules.length).toBe(1);
  });
});
