import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FirestoreExecutionRepository } from '../firestore-execution-repository.js';
import { initTestFirestore, cleanupTestFirestore } from './test-helpers.js';

describe('FirestoreExecutionRepository', () => {
  let repo: FirestoreExecutionRepository;

  beforeEach(() => {
    initTestFirestore();
    repo = new FirestoreExecutionRepository();
  });

  afterEach(() => {
    cleanupTestFirestore();
  });

  it('creates an execution and returns it', async () => {
    const result = await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test Schedule',
      userId: 'user-1',
      trigger: 'scheduled',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scheduleId).toBe('schedule-1');
    expect(result.value.scheduleName).toBe('Test Schedule');
    expect(result.value.userId).toBe('user-1');
    expect(result.value.status).toBe('running');
    expect(result.value.trigger).toBe('scheduled');
    expect(result.value.toolCalls).toEqual([]);
    expect(result.value.completedAt).toBeNull();
    expect(result.value.durationMs).toBeNull();
    expect(result.value.agentResponse).toBeNull();
    expect(result.value.tokenUsage).toBeNull();
    expect(result.value.error).toBeNull();
    expect(result.value.id).toBeDefined();
    expect(result.value.startedAt).toBeDefined();
    expect(result.value.createdAt).toBeDefined();
  });

  it('finds an execution by id', async () => {
    const createResult = await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'manual',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const findResult = await repo.findById(createResult.value.id);
    expect(findResult.ok).toBe(true);
    if (!findResult.ok) return;
    expect(findResult.value).not.toBeNull();
    expect(findResult.value?.trigger).toBe('manual');
    expect(findResult.value?.id).toBe(createResult.value.id);
  });

  it('returns null for non-existent execution', async () => {
    const result = await repo.findById('nonexistent');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('finds executions by userId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByUserId('user-1', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
    expect(result.value.executions[0]?.userId).toBe('user-1');
  });

  it('does not return executions for a different user', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByUserId('user-2', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(0);
  });

  it('finds executions by scheduleId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByScheduleId('schedule-1', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
    expect(result.value.executions[0]?.scheduleId).toBe('schedule-1');
  });

  it('does not return executions for a different scheduleId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByScheduleId('schedule-2', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(0);
  });

  it('finds running execution by scheduleId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findRunningByScheduleId('schedule-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value?.status).toBe('running');
  });

  it('returns null when no running execution exists', async () => {
    const result = await repo.findRunningByScheduleId('nonexistent');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('does not find completed execution as running', async () => {
    const createResult = await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await repo.update(createResult.value.id, { status: 'success' });

    const result = await repo.findRunningByScheduleId('schedule-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('updates an execution', async () => {
    const createResult = await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const updateResult = await repo.update(createResult.value.id, {
      status: 'success',
      completedAt: new Date().toISOString(),
      durationMs: 1500,
      agentResponse: 'Done',
    });
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.value.status).toBe('success');
    expect(updateResult.value.agentResponse).toBe('Done');
    expect(updateResult.value.durationMs).toBe(1500);
  });

  it('returns error when updating non-existent execution', async () => {
    const result = await repo.update('nonexistent', { status: 'success' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('filters by status in findByUserId', async () => {
    const createResult = await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await repo.update(createResult.value.id, { status: 'success' });

    const result = await repo.findByUserId('user-1', { limit: 50, status: ['success'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
    expect(result.value.executions[0]?.status).toBe('success');
  });

  it('filters by status excludes non-matching', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByUserId('user-1', { limit: 50, status: ['success'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(0);
  });

  it('filters by scheduleId in findByUserId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    await repo.create({
      scheduleId: 'schedule-2',
      scheduleName: 'Other',
      userId: 'user-1',
      trigger: 'manual',
    });

    const result = await repo.findByUserId('user-1', { limit: 50, scheduleId: 'schedule-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
    expect(result.value.executions[0]?.scheduleId).toBe('schedule-1');
  });

  it('filters by status in findByScheduleId', async () => {
    const createResult = await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await repo.update(createResult.value.id, { status: 'failure' });

    const result = await repo.findByScheduleId('schedule-1', { limit: 50, status: ['failure'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
  });

  it('returns null nextCursor when all results fit in limit', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByUserId('user-1', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextCursor).toBeNull();
  });

  it('returns count matching executions length', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'A',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'B',
      userId: 'user-1',
      trigger: 'manual',
    });

    const result = await repo.findByUserId('user-1', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.count).toBe(result.value.executions.length);
  });

  it('handles pagination with limit in findByScheduleId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'A',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'B',
      userId: 'user-1',
      trigger: 'manual',
    });

    const result = await repo.findByScheduleId('schedule-1', { limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
    expect(result.value.nextCursor).not.toBeNull();
  });

  it('filters by empty status array returns all in findByScheduleId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByScheduleId('schedule-1', { limit: 50, status: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
  });

  it('filters by empty status array returns all in findByUserId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByUserId('user-1', { limit: 50, status: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
  });

  it('returns INTERNAL_ERROR when Firestore throws on create', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
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

  it('returns INTERNAL_ERROR when Firestore throws on findByScheduleId', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.findByScheduleId('schedule-1', { limit: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = savedProjectId ?? '';
    initTestFirestore();
  });

  it('returns INTERNAL_ERROR when Firestore throws on findRunningByScheduleId', async () => {
    cleanupTestFirestore();
    const savedProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    const result = await repo.findRunningByScheduleId('schedule-1');
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
    const result = await repo.update('some-id', { status: 'success' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = savedProjectId ?? '';
    initTestFirestore();
  });

  it('paginates using cursor in findByUserId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'A',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'B',
      userId: 'user-1',
      trigger: 'manual',
    });

    const page1 = await repo.findByUserId('user-1', { limit: 1 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.executions.length).toBe(1);
    expect(page1.value.nextCursor).not.toBeNull();

    const cursor = page1.value.nextCursor ?? '';
    const page2 = await repo.findByUserId('user-1', { limit: 1, cursor });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.executions.length).toBe(1);
  });

  it('handles cursor for non-existent doc in findByUserId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByUserId('user-1', { limit: 50, cursor: 'nonexistent-cursor' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
  });

  it('paginates using cursor in findByScheduleId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'A',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'B',
      userId: 'user-1',
      trigger: 'manual',
    });

    const page1 = await repo.findByScheduleId('schedule-1', { limit: 1 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.executions.length).toBe(1);
    expect(page1.value.nextCursor).not.toBeNull();

    const cursor = page1.value.nextCursor ?? '';
    const page2 = await repo.findByScheduleId('schedule-1', { limit: 1, cursor });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.executions.length).toBe(1);
  });

  it('handles cursor for non-existent doc in findByScheduleId', async () => {
    await repo.create({
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      trigger: 'scheduled',
    });

    const result = await repo.findByScheduleId('schedule-1', { limit: 50, cursor: 'nonexistent-cursor' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executions.length).toBe(1);
  });
});
