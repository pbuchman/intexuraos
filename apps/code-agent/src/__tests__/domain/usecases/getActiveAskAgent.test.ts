/**
 * Tests for getActiveAskAgent use case.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Logger } from '@intexuraos/common-core';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import { getActiveAskAgent } from '../../../domain/usecases/getActiveAskAgent.js';

// Required env vars
process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';
process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';

describe('getActiveAskAgent', () => {
  let logger: Logger;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let codeTaskRepo: CodeTaskRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });
  });

  afterEach(() => {
    resetFirestore();
  });

  it('returns null when no ask-agent tasks exist', async () => {
    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toBeNull();
  });

  it('returns the most recent non-archived ask-agent task', async () => {
    const createResult = await codeTaskRepo.create({
      id: 'task_ask_1',
      userId: 'test-user-id',
      prompt: 'What is this codebase?',
      sanitizedPrompt: 'What is this codebase?',
      systemPromptHash: 'ask-agent',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
      agentType: 'ask_agent',
    });
    expect(createResult.ok).toBe(true);

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.task === null) {
      throw new Error('Expected task to not be null');
    }
    expect(result.value.task.id).toBe('task_ask_1');
  });

  it('does not return archived ask-agent tasks', async () => {
    await codeTaskRepo.create({
      id: 'task_ask_archived',
      userId: 'test-user-id',
      prompt: 'Old conversation',
      sanitizedPrompt: 'Old conversation',
      systemPromptHash: 'ask-agent',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
      agentType: 'ask_agent',
    });
    await codeTaskRepo.update('task_ask_archived', { status: 'implemented' });
    await codeTaskRepo.update('task_ask_archived', { status: 'archived' });

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toBeNull();
  });

  it('does not return tasks belonging to other users', async () => {
    await codeTaskRepo.create({
      id: 'task_ask_other',
      userId: 'other-user-id',
      prompt: 'Other user conversation',
      sanitizedPrompt: 'Other user conversation',
      systemPromptHash: 'ask-agent',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
      agentType: 'ask_agent',
    });

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toBeNull();
  });

  it('does not return non-ask-agent tasks', async () => {
    await codeTaskRepo.create({
      id: 'task_regular',
      userId: 'test-user-id',
      prompt: 'Regular code task',
      sanitizedPrompt: 'Regular code task',
      systemPromptHash: 'some-hash',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
    });

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toBeNull();
  });

  it('returns internal_error when repository fails', async () => {
    // Create a mock repository that returns an error
    const failingRepo = {
      findLatestAskAgentTask: async () => ({
        ok: false,
        error: new Error('Database connection failed'),
      }),
    } as unknown as CodeTaskRepository;

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo: failingRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal_error');
    expect(result.error.message).toBe('Database connection failed');
  });
});
