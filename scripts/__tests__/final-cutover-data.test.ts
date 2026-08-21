import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  RETIRED_WORKER_TYPES,
  buildMatrixMutations,
  commitCutoverMutations,
  decryptAppValue,
  decryptMatrixValue,
  decryptTokenValue,
  encryptAppValue,
  encryptMatrixValue,
  encryptTokenValue,
  matrixRunBinding,
  matrixScenarioBinding,
  matrixConfirmationBinding,
  reencryptMatrixValue,
  transformUserSettings,
  transformWorkerSettings,
} from '../security/final-cutover-data.mjs';
import { createMatrixCorpusContextCrypto } from '../../apps/intex-agent/src/domain/matrixCorpus/contextCrypto.js';

describe('final cutover data migration', () => {
  it('re-encrypts only OpenRouter and permanently removes other provider keys/results', () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const encrypted = (value: string): ReturnType<typeof encryptAppValue> =>
      encryptAppValue(value, oldKey);
    const result = transformUserSettings(
      {
        defaultModel: 'or:google/gemma-4-31b-it',
        llmApiKeys: {
          openrouter: encrypted('retained'),
          openai: encrypted('removed'),
          anthropic: encrypted('removed'),
          perplexity: encrypted('removed'),
        },
        llmTestResults: { openrouter: {}, openai: {}, anthropic: {}, perplexity: {} },
      },
      oldKey,
      newKey
    );

    expect(result.migrated).toBe(1);
    expect(result.intentionallyDeleted).toBe(3);
    expect(Object.keys(result.data.llmApiKeys)).toEqual(['openrouter']);
    expect(Object.keys(result.data.llmTestResults)).toEqual(['openrouter']);
    expect(decryptAppValue(result.data.llmApiKeys.openrouter, newKey)).toBe('retained');
    expect(() => decryptAppValue(result.data.llmApiKeys.openrouter, oldKey)).toThrow();
  });

  it('removes raw-provider defaults so runtime falls back to OpenRouter', () => {
    const key = randomBytes(32);
    const result = transformUserSettings(
      { defaultModel: 'gpt-5.4', fallbackModel: 'gemini-2.5-flash' },
      key,
      key
    );

    expect(result.deleteDefaultModel).toBe(true);
    expect(result.deleteFallbackModel).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('marks removal of a retired test result even when no retired key remains', () => {
    const key = randomBytes(32);
    const result = transformUserSettings(
      { llmApiKeys: {}, llmTestResults: { openai: { status: 'valid' } } },
      key,
      key
    );

    expect(result.changed).toBe(true);
    expect(result.data.llmTestResults).toEqual({});
  });

  it('re-encrypts all worker credentials and identifies retired defaults', () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const token = (value: string): string => encryptTokenValue(value, oldKey);
    const result = transformWorkerSettings(
      {
        defaultReviewWorkerType: 'glm',
        defaultExecutionWorkerType: 'codex',
        workers: [
          {
            name: 'home',
            url: 'https://worker.invalid',
            cfAccessClientId: token('id'),
            cfAccessClientSecret: token('secret'),
            dispatchSigningSecret: token('signing'),
          },
        ],
      },
      oldKey,
      newKey
    );

    expect(result.retiredDefaults).toEqual(['defaultReviewWorkerType']);
    expect(decryptTokenValue(result.workers[0].cfAccessClientId, newKey)).toBe('id');
    expect(() => decryptTokenValue(result.workers[0].cfAccessClientId, oldKey)).toThrow();
  });

  it('freezes the exact retired worker list', () => {
    expect([...RETIRED_WORKER_TYPES]).toEqual(['minimax', 'mimo-pro', 'glm', 'qwen', 'kimi']);
  });

  it('uses the production Matrix AES-GCM envelope and associated data exactly', () => {
    const key = randomBytes(32);
    const binding = matrixRunBinding({ runId: 'run_1', userId: 'user_1', leaseFence: '1' });
    const production = createMatrixCorpusContextCrypto({ key, keyVersion: 'matrix-v1' });

    const fromMigrator = encryptMatrixValue('payload', key, 'matrix-v1', binding);
    expect(production.decrypt(fromMigrator, binding)).toBe('payload');

    const fromProduction = production.encrypt('payload-2', binding);
    expect(decryptMatrixValue(fromProduction, key, 'matrix-v1', binding)).toBe('payload-2');
  });

  it('re-encrypts a Matrix envelope under a new version and rejects both old paths', () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const binding = matrixRunBinding({ runId: 'run_1', userId: 'user_1', leaseFence: '1' });
    const encrypted = encryptMatrixValue('payload', oldKey, 'matrix-v1', binding);

    const replacement = reencryptMatrixValue(
      encrypted,
      binding,
      oldKey,
      'matrix-v1',
      newKey,
      'matrix-v2'
    );

    expect(decryptMatrixValue(replacement, newKey, 'matrix-v2', binding)).toBe('payload');
    expect(() => decryptMatrixValue(replacement, oldKey, 'matrix-v2', binding)).toThrow();
    expect(() => decryptMatrixValue(replacement, newKey, 'matrix-v1', binding)).toThrow(
      'unknown Matrix key version'
    );
  });

  it('plans all three live Matrix domains and preserves their exact bindings', () => {
    const oldMatrix = randomBytes(32);
    const newMatrix = randomBytes(32);
    const now = Date.parse('2026-08-21T00:00:00.000Z');
    const identity = { runId: 'run_1', userId: 'user_1', leaseFence: '1' };
    const scenario = { ...identity, scenarioId: 'scenario_1' };
    const confirmation = {
      confirmationId: 'confirmation_1',
      runId: identity.runId,
      scenarioId: scenario.scenarioId,
      sessionId: 'session_1',
      leaseFence: identity.leaseFence,
      toolName: 'create_code_task',
      selectionTurnIndex: 0,
      selectionOrdinal: 1,
      createdAt: '2026-08-21T00:00:01.000Z',
      expiresAt: '2026-08-21T00:05:00.000Z',
      state: 'pending',
      decision: null,
      resolutionMessageId: null,
      resolvedAt: null,
    };
    const doc = (
      id: string,
      data: Record<string, unknown>
    ): { id: string; ref: { id: string }; data: () => Record<string, unknown> } => ({
      id,
      ref: { id },
      data: (): Record<string, unknown> => data,
    });
    const result = buildMatrixMutations(
      {
        runs: [
          doc(identity.runId, {
            ...identity,
            status: 'active',
            expiresAt: '2026-08-22T00:00:00.000Z',
            encryptedPromptContext: encryptMatrixValue(
              'run payload',
              oldMatrix,
              'matrix-v1',
              matrixRunBinding(identity)
            ),
          }),
        ],
        scenarios: [
          doc('scenario_doc', {
            ...scenario,
            expiresAt: '2026-08-22T00:00:00.000Z',
            encryptedEffectivePromptContext: encryptMatrixValue(
              'scenario payload',
              oldMatrix,
              'matrix-v1',
              matrixScenarioBinding(scenario)
            ),
          }),
        ],
        confirmations: [
          doc(confirmation.confirmationId, {
            ...confirmation,
            userBindingDigest: createHash('sha256').update(identity.userId).digest('hex'),
            encryptedToolArgs: encryptMatrixValue(
              '{"prompt":"safe"}',
              oldMatrix,
              'matrix-v1',
              matrixConfirmationBinding(confirmation, identity.userId)
            ),
          }),
        ],
        testRuns: [],
      },
      {
        oldMatrix,
        newMatrix,
        oldMatrixVersion: 'matrix-v1',
        newMatrixVersion: 'matrix-v2',
      },
      now
    );

    expect(result.report).toMatchObject({
      scanned: 3,
      candidate: 3,
      migrated: 3,
      intentionally_deleted: 0,
      malformed: 0,
    });
    expect(result.mutations).toHaveLength(3);
    expect(
      result.mutations.map(
        (mutation) =>
          (Object.values(mutation.update ?? {})[0] as { keyVersion?: string } | undefined)
            ?.keyVersion
      )
    ).toEqual(['matrix-v2', 'matrix-v2', 'matrix-v2']);
  });

  it('fails the Matrix plan on a live confirmation identity mismatch', () => {
    const oldMatrix = randomBytes(32);
    const newMatrix = randomBytes(32);
    const doc = (
      id: string,
      data: Record<string, unknown>
    ): { id: string; ref: { id: string }; data: () => Record<string, unknown> } => ({
      id,
      ref: { id },
      data: (): Record<string, unknown> => data,
    });
    const identity = { runId: 'run_1', userId: 'user_1', leaseFence: '1' };
    const confirmation = {
      confirmationId: 'confirmation_1',
      runId: identity.runId,
      scenarioId: 'scenario_1',
      sessionId: 'session_1',
      leaseFence: identity.leaseFence,
      toolName: 'create_code_task',
      selectionTurnIndex: 0,
      selectionOrdinal: 1,
      createdAt: '2026-08-21T00:00:01.000Z',
      expiresAt: '2026-08-21T00:05:00.000Z',
      state: 'pending',
      decision: null,
      resolutionMessageId: null,
      resolvedAt: null,
    };
    const result = buildMatrixMutations(
      {
        runs: [doc(identity.runId, { ...identity, status: 'finalized' })],
        scenarios: [],
        confirmations: [
          doc(confirmation.confirmationId, {
            ...confirmation,
            userBindingDigest: '0'.repeat(64),
            encryptedToolArgs: {},
          }),
        ],
        testRuns: [],
      },
      {
        oldMatrix,
        newMatrix,
        oldMatrixVersion: 'matrix-v1',
        newMatrixVersion: 'matrix-v2',
      },
      Date.parse('2026-08-21T00:00:00.000Z')
    );

    expect(result.report.malformed).toBe(1);
    expect(result.mutations).toHaveLength(0);
  });

  it('commits resumable bulk cleanup before one atomic protected-key batch', async () => {
    const commits: string[][] = [];
    const db = {
      batch: (): {
        delete: (ref: { id: string }) => void;
        update: (ref: { id: string }) => void;
        commit: () => Promise<void>;
      } => {
        const ids: string[] = [];
        return {
          delete: (ref): void => ids.push(ref.id),
          update: (ref): void => ids.push(ref.id),
          commit: async (): Promise<void> => {
            commits.push(ids);
          },
        };
      },
    };
    const bulk = Array.from({ length: 805 }, (_, index) => ({
      kind: 'update',
      phase: 'bulk',
      ref: { id: `bulk-${String(index)}` },
      update: {},
    }));
    const protectedMutations = Array.from({ length: 2 }, (_, index) => ({
      kind: 'delete',
      phase: 'protected',
      ref: { id: `protected-${String(index)}` },
    }));

    await commitCutoverMutations(db, [...bulk, ...protectedMutations]);

    expect(commits.map((commit) => commit.length)).toEqual([400, 400, 5, 2]);
    expect(commits.at(-1)).toEqual(['protected-0', 'protected-1']);
  });

  it('rejects an oversized protected-key batch before any write', async () => {
    let batchCalls = 0;
    const db = {
      batch: (): never => {
        batchCalls += 1;
        throw new Error('must not create a batch');
      },
    };
    const mutations = Array.from({ length: 401 }, (_, index) => ({
      kind: 'update',
      phase: 'protected',
      ref: { id: `protected-${String(index)}` },
      update: {},
    }));

    await expect(commitCutoverMutations(db, mutations)).rejects.toThrow(
      'protected migration exceeds one atomic Firestore batch'
    );
    expect(batchCalls).toBe(0);
  });
});
