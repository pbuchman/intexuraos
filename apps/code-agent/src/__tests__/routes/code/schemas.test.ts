/**
 * Structural sanity tests for the schemas extracted from codeRoutes.ts
 * into routes/code/schemas.ts (INT-1430).
 *
 * The main behavioural coverage for every inline route schema still lives in
 * codeRoutes.test.ts / codeRoutes.branches.test.ts via `app.inject()`. These
 * tests just guarantee the extracted shared schemas remain valid JSON-Schema,
 * keep their external shape, and reject obviously invalid payloads — so we can
 * catch silent drift if somebody touches the schemas file.
 */

import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';

import {
  linearIssueForDisplaySchema,
  workerTypeSchema,
  executionMemoryContextSchema,
  executionMemoryPostRunSchema,
  codeTaskSchema,
} from '../../../routes/code/schemas.js';

// `logger: false` silences Ajv's "unknown format ..." stderr warnings for the
// `date-time` formats referenced by the extracted schemas; the production
// Fastify pipeline provides those formats via `ajv-formats`, but these unit
// tests only assert structural shape so the warnings are noise and violate
// the repo's no-unexpected-stdout rule in CI.
const ajv = new Ajv.default({
  strict: false,
  allowUnionTypes: true,
  logger: false,
});

describe('routes/code/schemas', () => {
  it('compiles every exported schema as valid JSON Schema', () => {
    expect(() => ajv.compile(linearIssueForDisplaySchema)).not.toThrow();
    expect(() => ajv.compile(workerTypeSchema)).not.toThrow();
    expect(() => ajv.compile(executionMemoryContextSchema)).not.toThrow();
    expect(() => ajv.compile(executionMemoryPostRunSchema)).not.toThrow();
    expect(() => ajv.compile(codeTaskSchema)).not.toThrow();
  });

  it('workerTypeSchema rejects unknown worker types', () => {
    const validate = ajv.compile(workerTypeSchema);
    expect(validate('auto')).toBe(true);
    expect(validate('not-a-real-worker')).toBe(false);
  });

  it('linearIssueForDisplaySchema rejects payloads missing required fields', () => {
    const validate = ajv.compile(linearIssueForDisplaySchema);
    // Minimal valid payload — required keys present
    const valid = {
      identifier: 'INT-1',
      parentIdentifier: null,
      title: 't',
      state: { name: 'Backlog', type: 'backlog' },
      priority: 0,
      assignee: null,
      labels: [],
      url: 'https://linear.app/x',
      commentCount: 0,
      lastCommentAt: null,
    };
    expect(validate(valid)).toBe(true);
    // Missing required `title`
    const invalid = { ...valid } as Record<string, unknown>;
    delete invalid['title'];
    expect(validate(invalid)).toBe(false);
  });

  it('codeTaskSchema rejects payloads missing required id/userId/status', () => {
    const validate = ajv.compile(codeTaskSchema);
    expect(validate({})).toBe(false);
    // A payload with every required field
    const task = {
      id: 'task_1',
      userId: 'u_1',
      prompt: 'p',
      sanitizedPrompt: 'p',
      systemPromptHash: 'h',
      workerType: 'auto',
      workerLocation: 'pending',
      repository: 'org/repo',
      baseBranch: 'development',
      traceId: 't',
      status: 'dispatched',
      dedupKey: 'd',
      callbackReceived: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    expect(validate(task)).toBe(true);
  });

  it('executionMemoryContextSchema restricts status to the enum', () => {
    const validate = ajv.compile(executionMemoryContextSchema);
    expect(validate({ status: 'matched' })).toBe(true);
    expect(validate({ status: 'not-a-status' })).toBe(false);
  });

  it('executionMemoryPostRunSchema restricts skipReason to the enum', () => {
    const validate = ajv.compile(executionMemoryPostRunSchema);
    expect(
      validate({ status: 'completed', attempts: 0, generatedMemoryIds: [], skipReason: 'infra_only' }),
    ).toBe(true);
    expect(
      validate({ status: 'completed', attempts: 0, generatedMemoryIds: [], skipReason: 'bogus' }),
    ).toBe(false);
  });
});
