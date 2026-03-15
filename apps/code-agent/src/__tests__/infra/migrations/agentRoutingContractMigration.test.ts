import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Logger } from 'pino';
import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  runAgentRoutingContractMigration,
  assertNoLegacyAgentRoutingContractValues,
} from '../../../infra/migrations/agentRoutingContractMigration.js';

describe('agentRoutingContractMigration', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let firestore: Firestore;
  let logger: Logger;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    firestore = fakeFirestore as unknown as Firestore;
    setFirestore(firestore);
    logger = pino({ level: 'silent' }) as unknown as Logger;
  });

  afterEach(() => {
    resetFirestore();
  });

  it('migrates legacy executionPhase, designed status, and follow-up reason without Linear calls', async () => {
    const tasks = firestore.collection('code_tasks');

    await tasks.doc('legacy-design').set({
      status: 'designed',
      executionPhase: 'design',
      callbackReceived: true,
    });

    await tasks.doc('legacy-execution').set({
      status: 'implemented',
      executionPhase: 'execution',
      followUpReason: 'phase2_implement',
      callbackReceived: true,
    });

    await tasks.doc('already-new').set({
      status: 'planned',
      agentType: 'planning',
      callbackReceived: true,
    });

    await runAgentRoutingContractMigration({ firestore, logger });
    await assertNoLegacyAgentRoutingContractValues({ firestore, logger });

    const designDoc = await tasks.doc('legacy-design').get();
    expect(designDoc.data()?.['status']).toBe('planned');
    expect(designDoc.data()?.['agentType']).toBe('planning');
    expect(designDoc.data()?.['executionPhase']).toBeUndefined();

    const executionDoc = await tasks.doc('legacy-execution').get();
    expect(executionDoc.data()?.['status']).toBe('implemented');
    expect(executionDoc.data()?.['agentType']).toBe('execution');
    expect(executionDoc.data()?.['executionPhase']).toBeUndefined();
    expect(executionDoc.data()?.['followUpReason']).toBe('execution_implement');

    const newDoc = await tasks.doc('already-new').get();
    expect(newDoc.data()?.['status']).toBe('planned');
    expect(newDoc.data()?.['agentType']).toBe('planning');
  });

  it('fails fast when legacy values remain after migration validation', async () => {
    const tasks = firestore.collection('code_tasks');
    await tasks.doc('legacy-still-there').set({
      status: 'planned',
      followUpReason: 'phase2_implement',
    });

    await expect(assertNoLegacyAgentRoutingContractValues({ firestore, logger })).rejects.toThrow(
      'Legacy agent-routing values remain'
    );
  });

  it('truncates offenders at 10 when asserting no legacy values', async () => {
    const tasks = firestore.collection('code_tasks');

    for (let i = 0; i < 11; i++) {
      await tasks.doc(`legacy-offender-${String(i)}`).set({
        status: 'designed',
      });
    }

    const error: Error = await assertNoLegacyAgentRoutingContractValues({
      firestore,
      logger,
    }).then(
      () => new Error('Expected rejection but resolved'),
      (e: unknown) => e as Error
    );

    expect(error.message).toMatch(/Legacy agent-routing values remain/);

    // Verify the error message contains exactly 10 IDs (truncated, not all 11)
    const ids = error.message
      .replace(/^.*\(sample task IDs: /, '')
      .replace(/\)$/, '')
      .split(', ');
    expect(ids).toHaveLength(10);
  });

  it('fails on conflicting legacy executionPhase and agentType values', async () => {
    const tasks = firestore.collection('code_tasks');
    await tasks.doc('conflict').set({
      status: 'designed',
      executionPhase: 'design',
      agentType: 'execution',
    });

    await expect(runAgentRoutingContractMigration({ firestore, logger })).rejects.toThrow(
      'Legacy migration conflict'
    );
  });
});
