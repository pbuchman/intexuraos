/**
 * Unit tests for the extracted JSON schemas (INT-1433).
 *
 * Each test spins up a minimal Fastify app with a dedicated route using the
 * extracted schema, then injects an invalid payload and expects Fastify's Ajv
 * to reject the request with 400. This mirrors Fastify's production schema
 * validation pipeline.
 */

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import {
  ARCHIVE_STALE_GROUPS_SCHEMA,
  AUTO_ARCHIVE_MERGED_TASKS_SCHEMA,
  PROCESS_EXECUTION_MEMORY_BACKLOG_SCHEMA,
  PRUNE_STALE_EXECUTION_MEMORY_SCHEMA,
} from '../../../routes/internal/schemas.js';

describe('internal route schemas', () => {
  it('PROCESS_EXECUTION_MEMORY_BACKLOG_SCHEMA rejects limit out of range', async () => {
    const app = Fastify();
    app.post('/t', { schema: { body: PROCESS_EXECUTION_MEMORY_BACKLOG_SCHEMA.body } }, async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/t',
      payload: { limit: 0 }, // minimum is 1
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('PROCESS_EXECUTION_MEMORY_BACKLOG_SCHEMA rejects non-numeric limit', async () => {
    const app = Fastify();
    app.post('/t', { schema: { body: PROCESS_EXECUTION_MEMORY_BACKLOG_SCHEMA.body } }, async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/t',
      payload: { limit: 'nope' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('PRUNE_STALE_EXECUTION_MEMORY_SCHEMA rejects maxAgeDays below minimum', async () => {
    const app = Fastify();
    app.post('/t', { schema: { body: PRUNE_STALE_EXECUTION_MEMORY_SCHEMA.body } }, async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/t',
      payload: { maxAgeDays: 0 },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('PRUNE_STALE_EXECUTION_MEMORY_SCHEMA rejects non-boolean dryRun', async () => {
    const app = Fastify();
    app.post('/t', { schema: { body: PRUNE_STALE_EXECUTION_MEMORY_SCHEMA.body } }, async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/t',
      payload: { dryRun: 'yes' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('ARCHIVE_STALE_GROUPS_SCHEMA rejects non-numeric staleDays', async () => {
    const app = Fastify();
    app.post('/t', { schema: { body: ARCHIVE_STALE_GROUPS_SCHEMA.body } }, async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/t',
      payload: { staleDays: 'seven' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('ARCHIVE_STALE_GROUPS_SCHEMA documents lifecycle status activity as the retention clock', () => {
    expect(ARCHIVE_STALE_GROUPS_SCHEMA.description).toContain('lifecycle status activity');
    expect(ARCHIVE_STALE_GROUPS_SCHEMA.description).not.toContain('updatedAt');
  });

  it('AUTO_ARCHIVE_MERGED_TASKS_SCHEMA rejects non-numeric mergeDays', async () => {
    const app = Fastify();
    app.post('/t', { schema: { body: AUTO_ARCHIVE_MERGED_TASKS_SCHEMA.body } }, async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/t',
      payload: { mergeDays: 'seven' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
