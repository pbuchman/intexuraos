import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canTransitionMessageDigestDefinitionStatus,
  createMessageDigestCursorCodec,
  MESSAGE_DIGEST_DEFINITIONS_COLLECTION,
  MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION,
  MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION,
  MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION,
  MESSAGE_DIGEST_RUNS_COLLECTION,
  MESSAGE_DIGEST_STATES_COLLECTION,
  MessageDigestDefinitionDocumentSchema,
  MessageDigestDispatchOutboxDocumentSchema,
  MessageDigestErasureRequestDocumentSchema,
  MessageDigestMigrationActivationDocumentSchema,
  MessageDigestRunDocumentSchema,
  MessageDigestStateDocumentSchema,
  type MessageDigestDefinitionDocument,
  type MessageDigestDispatchOutboxDocument,
  type MessageDigestErasureRequestDocument,
  type MessageDigestMigrationActivationDocument,
  type MessageDigestRunDocument,
  type MessageDigestStateDocument,
} from './messageDigestDocuments.js';

describe('Message Digest Firestore document codecs', () => {
  it('registers six explicit collection names and accepts their exact valid shapes', () => {
    expect([
      MESSAGE_DIGEST_DEFINITIONS_COLLECTION,
      MESSAGE_DIGEST_RUNS_COLLECTION,
      MESSAGE_DIGEST_STATES_COLLECTION,
      MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION,
      MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION,
      MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION,
    ]).toEqual([
      'message_digest_definitions',
      'message_digest_runs',
      'message_digest_states',
      'message_digest_dispatch_outbox',
      'message_digest_erasure_requests',
      'message_digest_migration_activations',
    ]);

    expect(MessageDigestDefinitionDocumentSchema.safeParse(definition()).success).toBe(true);
    expect(MessageDigestStateDocumentSchema.safeParse(state()).success).toBe(true);
    expect(MessageDigestRunDocumentSchema.safeParse(run()).success).toBe(true);
    expect(MessageDigestDispatchOutboxDocumentSchema.safeParse(outbox()).success).toBe(true);
    expect(MessageDigestErasureRequestDocumentSchema.safeParse(erasure()).success).toBe(true);
    expect(
      MessageDigestMigrationActivationDocumentSchema.safeParse(migrationActivation()).success
    ).toBe(true);
  });

  it('keeps daily records compatible and accepts exact weekdays and weekly schedule unions', () => {
    const schedules = [
      { kind: 'daily', localTime: '03:00', timeZone: 'Europe/Warsaw' },
      { kind: 'weekdays', localTime: '08:15', timeZone: 'Europe/Warsaw' },
      {
        kind: 'weekly',
        weekday: 'saturday',
        localTime: '10:45',
        timeZone: 'Europe/Warsaw',
      },
    ] as const;

    for (const schedule of schedules) {
      const parsedDefinition = MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        schedule,
      });
      const parsedRun = MessageDigestRunDocumentSchema.safeParse({
        ...run(),
        scheduleSnapshot: schedule,
      });
      expect(parsedDefinition.success).toBe(true);
      expect(parsedRun.success).toBe(true);
      if (!parsedDefinition.success || !parsedRun.success) continue;
      expect(parsedDefinition.data.schedule).toEqual(schedule);
      expect(parsedRun.data.scheduleSnapshot).toEqual(schedule);
    }
  });

  it('defaults legacy runs to no delivery authorization and validates the private lease shape', () => {
    const legacy = MessageDigestRunDocumentSchema.parse(run());
    expect(legacy.deliveryAuthorization).toBeNull();

    const authorized = MessageDigestRunDocumentSchema.safeParse({
      ...run(),
      deliveryAuthorization: {
        ownerDigest: 'd'.repeat(64),
        fence: 2,
        expiresAt: '2026-07-27T01:03:00.000Z',
        renewedAt: '2026-07-27T01:01:00.000Z',
        releasedAt: null,
      },
    });
    expect(authorized.success).toBe(true);

    for (const deliveryAuthorization of [
      { ownerDigest: 'private-owner', fence: 1, expiresAt: 'invalid', renewedAt: 'invalid', releasedAt: null },
      {
        ownerDigest: 'd'.repeat(64),
        fence: 0,
        expiresAt: '2026-07-27T01:03:00.000Z',
        renewedAt: '2026-07-27T01:01:00.000Z',
        releasedAt: null,
      },
      {
        ownerDigest: 'd'.repeat(64),
        fence: 1,
        expiresAt: '2026-07-27T01:03:00.000Z',
        renewedAt: '2026-07-27T01:04:00.000Z',
        releasedAt: null,
      },
      {
        ownerDigest: 'd'.repeat(64),
        fence: 1,
        expiresAt: '2026-07-27T01:03:00.000Z',
        renewedAt: '2026-07-27T01:01:00.000Z',
        releasedAt: '2026-07-27T01:04:00.000Z',
      },
    ]) {
      expect(
        MessageDigestRunDocumentSchema.safeParse({ ...run(), deliveryAuthorization }).success
      ).toBe(false);
    }
  });

  it('defaults native run provenance while accepting a fully fenced silent replay run', () => {
    const native = MessageDigestRunDocumentSchema.parse(run());
    expect(native).toMatchObject({
      migrationDate: null,
      provenance: 'native',
      deliveryMode: 'whatsapp',
      predecessorRunHash: null,
      runHash: null,
      sourceWatermarkHash: null,
      sourceCandidateHash: null,
      candidateHash: null,
    });

    const replayInput = {
      ...run(),
      runId: 'mdr_migration_replay_001',
      visibilityMigrationId: 'mdm_fishing_001',
      migrationDate: '2026-07-04',
      provenance: 'private_whatsapp_replay',
      deliveryMode: 'silent',
      predecessorRunHash: '1'.repeat(64),
      runHash: '2'.repeat(64),
      sourceWatermarkHash: '3'.repeat(64),
      sourceCandidateHash: '4'.repeat(64),
      candidateHash: '5'.repeat(64),
      generationStatus: 'completed',
      processingStage: 'completed',
      headline: 'Synthetic migration result',
      summaryMarkdown: 'Synthetic migration summary',
      continuityMemoryMarkdown: 'Synthetic migration continuity',
      effectiveMessageCount: 2,
      promptVersion: 'message-digest-aggregate@2.1.0',
      model: 'synthetic-model',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0 },
      completedAt: '2026-07-27T01:00:00.000Z',
    };
    const replay = MessageDigestRunDocumentSchema.safeParse(replayInput);
    expect(replay.success).toBe(true);
    expect(
      MessageDigestRunDocumentSchema.safeParse({
        ...replayInput,
        provenance: 'legacy_mobile_notification',
        sourceCandidateHash: null,
      }).success
    ).toBe(false);
    expect(
      MessageDigestRunDocumentSchema.safeParse({
        ...replayInput,
        provenance: 'legacy_mobile_notification',
        sourceWatermarkHash: null,
      }).success
    ).toBe(false);
    expect(
      MessageDigestRunDocumentSchema.safeParse({ ...replayInput, provenance: 'native' }).success
    ).toBe(false);
  });

  it('rejects migration runs without silent delivery and complete provenance proofs', () => {
    const base = {
      ...run(),
      runId: 'mdr_migration_replay_001',
      visibilityMigrationId: 'mdm_fishing_001',
      migrationDate: '2026-07-04',
      provenance: 'private_whatsapp_replay',
      deliveryMode: 'silent',
      predecessorRunHash: null,
      runHash: '2'.repeat(64),
      sourceWatermarkHash: '3'.repeat(64),
      sourceCandidateHash: '4'.repeat(64),
      candidateHash: '5'.repeat(64),
    };
    for (const patch of [
      { deliveryMode: 'whatsapp' },
      { migrationDate: null },
      { runHash: null },
      { candidateHash: null },
      { sourceWatermarkHash: null },
      { sourceCandidateHash: null },
      { delivery: { ...run().delivery, status: 'pending', nextCheckAt: '2026-07-27T01:01:00.000Z' } },
    ]) {
      expect(MessageDigestRunDocumentSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
  });

  it('persists safe migration activation alias and verification hashes', () => {
    const parsed = MessageDigestMigrationActivationDocumentSchema.parse({
      ...migrationActivation(),
      status: 'active',
      legacyGroupKey: 'grupa-wedkarska-skool',
      baselineHash: 'a'.repeat(64),
      replayHash: 'b'.repeat(64),
      verificationHash: 'c'.repeat(64),
    });
    expect(parsed).toMatchObject({
      legacyGroupKey: 'grupa-wedkarska-skool',
      verificationHash: 'c'.repeat(64),
    });

    expect(
      MessageDigestMigrationActivationDocumentSchema.safeParse({
        ...migrationActivation(),
        status: 'active',
        legacyGroupKey: 'grupa-wedkarska-skool',
        baselineHash: 'a'.repeat(64),
        replayHash: null,
        verificationHash: 'c'.repeat(64),
      }).success
    ).toBe(false);
  });

  it('rejects missing, invalid, or extraneous weekly schedule fields', () => {
    for (const schedule of [
      { kind: 'weekly', localTime: '09:00', timeZone: 'UTC' },
      { kind: 'weekly', weekday: 'funday', localTime: '09:00', timeZone: 'UTC' },
      { kind: 'daily', weekday: 'monday', localTime: '09:00', timeZone: 'UTC' },
      { kind: 'weekdays', weekday: 'monday', localTime: '09:00', timeZone: 'UTC' },
    ]) {
      expect(
        MessageDigestDefinitionDocumentSchema.safeParse({ ...definition(), schedule }).success
      ).toBe(false);
    }
  });

  it.each([
    [
      'definition',
      MessageDigestDefinitionDocumentSchema,
      (): Record<string, unknown> => ({ ...definition(), extra: true }),
    ],
    [
      'state',
      MessageDigestStateDocumentSchema,
      (): Record<string, unknown> => ({ ...state(), rawMessages: [] }),
    ],
    [
      'run',
      MessageDigestRunDocumentSchema,
      (): Record<string, unknown> => ({ ...run(), sourceMessages: ['private'] }),
    ],
    [
      'outbox',
      MessageDigestDispatchOutboxDocumentSchema,
      (): Record<string, unknown> => ({ ...outbox(), recipientPhoneNumber: 'not-allowed' }),
    ],
    [
      'erasure',
      MessageDigestErasureRequestDocumentSchema,
      (): Record<string, unknown> => ({ ...erasure(), prompt: 'raw' }),
    ],
  ] as const)(
    'rejects unknown or privacy-unsafe fields in %s records',
    (_name, schema, fixture) => {
      expect(schema.safeParse(fixture()).success).toBe(false);
    }
  );

  it('rejects invalid identifiers, timestamps, instruction bounds, and recipient delivery shape', () => {
    expect(
      MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        definitionId: 'predictable id',
      }).success
    ).toBe(false);
    expect(
      MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        updatedAt: 'yesterday',
      }).success
    ).toBe(false);
    expect(
      MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        instructions: { ...definition().instructions, text: 'too short' },
      }).success
    ).toBe(false);
    expect(
      MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        delivery: { type: 'whatsapp_primary', recipient: 'not-allowed' },
      }).success
    ).toBe(false);
  });

  it('accepts an 80-character definition name, rejects 81, and defaults legacy source metadata', () => {
    const accepted = MessageDigestDefinitionDocumentSchema.safeParse({
      ...definition(),
      name: 'n'.repeat(80),
    });
    expect(accepted.success).toBe(true);
    expect(
      MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        name: 'n'.repeat(81),
      }).success
    ).toBe(false);

    const legacy = definition();
    const source = { ...legacy.source } as Record<string, unknown>;
    delete source['messageCount'];
    delete source['participantCount'];
    delete source['lastActivityAt'];
    const parsedLegacy = MessageDigestDefinitionDocumentSchema.safeParse({ ...legacy, source });
    expect(parsedLegacy.success).toBe(true);
  });

  it('defaults an older definition latest-run projection and validates the safe exact shape', () => {
    const legacy = { ...definition() } as Record<string, unknown>;
    delete legacy['latestRun'];
    const parsedLegacy = MessageDigestDefinitionDocumentSchema.safeParse(legacy);
    expect(parsedLegacy.success).toBe(true);
    if (!parsedLegacy.success) throw new Error('Expected a backward-compatible definition');
    expect((parsedLegacy.data as Record<string, unknown>)['latestRun']).toBeNull();

    const latestRun = {
      runId: 'mdr_run_001',
      startedAt: '2026-07-27T01:00:00.000Z',
      generationStatus: 'processing',
      processingStage: 'aggregating',
      deliveryStatus: 'not_sent',
    };
    expect(
      MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        hasRuns: true,
        latestRun,
      }).success
    ).toBe(true);
    expect(
      MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        hasRuns: true,
        latestRun: { ...latestRun, requestIdDigest: 'a'.repeat(64) },
      }).success
    ).toBe(false);
    expect(
      MessageDigestDefinitionDocumentSchema.safeParse({
        ...definition(),
        hasRuns: true,
        latestRun: { ...latestRun, processingStage: 'completed' },
      }).success
    ).toBe(false);
  });

  it('rejects oversized continuity and a pending window that does not advance the checkpoint', () => {
    expect(
      MessageDigestStateDocumentSchema.safeParse({
        ...state(),
        continuityMemoryMarkdown: 'x'.repeat(8_001),
      }).success
    ).toBe(false);
    expect(
      MessageDigestStateDocumentSchema.safeParse({
        ...state(),
        pendingWindow: {
          ...pendingWindow(),
          windowEnd: '2026-07-27T00:00:00.000Z',
        },
      }).success
    ).toBe(false);
  });

  it('rejects a payload whose stored SHA-256 does not match the exact JSON bytes', () => {
    expect(
      MessageDigestDispatchOutboxDocumentSchema.safeParse({
        ...outbox(),
        payloadDigest: 'f'.repeat(64),
      }).success
    ).toBe(false);
  });

  it('defines only legal lifecycle transitions', () => {
    expect(canTransitionMessageDigestDefinitionStatus('active', 'paused')).toBe(true);
    expect(canTransitionMessageDigestDefinitionStatus('paused', 'active')).toBe(true);
    expect(canTransitionMessageDigestDefinitionStatus('active', 'deleting')).toBe(true);
    expect(canTransitionMessageDigestDefinitionStatus('deleting', 'active')).toBe(false);
    expect(canTransitionMessageDigestDefinitionStatus('migrating', 'active')).toBe(true);
    expect(canTransitionMessageDigestDefinitionStatus('active', 'migrating')).toBe(false);
  });

  it('rejects every contradictory definition projection and timestamp relation', () => {
    for (const value of [
      { ...definition(), updatedAt: '2026-07-26T23:59:59.000Z' },
      { ...definition(), status: 'active' as const, listStatus: 'paused' as const },
      { ...definition(), status: 'paused' as const, listStatus: 'active' as const },
      { ...definition(), listStatus: 'needs_attention' as const, attentionCode: null },
      { ...definition(), listStatus: 'active' as const, attentionCode: 'UNEXPECTED' },
      { ...definition(), status: 'deleting' as const, activeErasureRequestId: null },
      {
        ...definition(),
        status: 'active' as const,
        activeErasureRequestId: erasure().erasureRequestId,
      },
    ]) {
      expect(MessageDigestDefinitionDocumentSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects a pending window that starts away from the state checkpoint', () => {
    expect(
      MessageDigestStateDocumentSchema.safeParse({
        ...state(),
        pendingWindow: {
          ...pendingWindow(),
          windowStart: '2026-07-26T23:00:00.000Z',
        },
      }).success
    ).toBe(false);
  });

  it('accepts every coherent run lifecycle and rejects empty, mismatched, and unsafe failures', () => {
    const coherent = [
      { generationStatus: 'processing', processingStage: 'reading_messages' },
      { generationStatus: 'processing', processingStage: 'aggregating' },
      { generationStatus: 'processing', processingStage: 'repairing' },
      { generationStatus: 'completed', processingStage: 'completed' },
      { generationStatus: 'failed', processingStage: 'failed', safeFailureCode: 'LLM_UNAVAILABLE' },
      {
        generationStatus: 'skipped_no_activity',
        processingStage: 'skipped_no_activity',
      },
    ] as const;
    for (const overrides of coherent) {
      expect(MessageDigestRunDocumentSchema.safeParse({ ...run(), ...overrides }).success).toBe(
        true
      );
    }

    for (const value of [
      { ...run(), windowEnd: run().windowStart },
      { ...run(), generationStatus: 'completed', processingStage: 'queued' },
      { ...run(), generationStatus: 'failed', processingStage: 'failed', safeFailureCode: null },
      { ...run(), delivery: { ...run().delivery, status: 'pending', nextCheckAt: null } },
      {
        ...run(),
        delivery: {
          ...run().delivery,
          status: 'sent',
          missingSince: '2026-07-27T01:01:00.000Z',
        },
      },
    ]) {
      expect(MessageDigestRunDocumentSchema.safeParse(value).success).toBe(false);
    }
  });

  it('requires terminal dispatch metadata and a complete erasure tombstone', () => {
    expect(
      MessageDigestDispatchOutboxDocumentSchema.safeParse({
        ...outbox(),
        status: 'published',
        publishedAt: null,
      }).success
    ).toBe(false);
    expect(
      MessageDigestDispatchOutboxDocumentSchema.safeParse({
        ...outbox(),
        status: 'terminal',
        terminalCode: null,
      }).success
    ).toBe(false);
    expect(
      MessageDigestDispatchOutboxDocumentSchema.safeParse({
        ...outbox(),
        status: 'published',
        publishedAt: '2026-07-27T01:01:00.000Z',
      }).success
    ).toBe(true);
    expect(
      MessageDigestDispatchOutboxDocumentSchema.safeParse({
        ...outbox(),
        status: 'terminal',
        terminalCode: 'INVALID_PAYLOAD',
      }).success
    ).toBe(true);

    const completed = {
      ...erasure(),
      stage: 'completed' as const,
      completedAt: '2026-07-27T01:02:00.000Z',
      expiresAt: 1_775_000_100,
      cursor: null,
    };
    expect(MessageDigestErasureRequestDocumentSchema.safeParse(completed).success).toBe(true);
    for (const value of [
      { ...completed, completedAt: null },
      { ...completed, expiresAt: null },
      { ...completed, cursor: 'unexpected' },
    ]) {
      expect(MessageDigestErasureRequestDocumentSchema.safeParse(value).success).toBe(false);
    }
  });

  it('covers idempotent, migration, deletion, and rejected lifecycle edges', () => {
    expect(canTransitionMessageDigestDefinitionStatus('active', 'active')).toBe(true);
    expect(canTransitionMessageDigestDefinitionStatus('migrating', 'deleting')).toBe(true);
    expect(canTransitionMessageDigestDefinitionStatus('migrating', 'paused')).toBe(false);
    expect(canTransitionMessageDigestDefinitionStatus('paused', 'deleting')).toBe(true);
    expect(canTransitionMessageDigestDefinitionStatus('paused', 'migrating')).toBe(false);
  });
});

describe('Message Digest cursor codec', () => {
  it('issues an opaque authenticated cursor bound to query fingerprint and expiry', () => {
    let now = Date.parse('2026-07-27T12:00:00.000Z');
    const codec = createMessageDigestCursorCodec({
      secret: 'synthetic-cursor-secret',
      now: () => now,
      ttlMs: 60_000,
    });
    const issued = codec.issue({
      kind: 'definitions',
      queryFingerprint: 'fingerprint-v1',
      values: ['2026-07-27T10:00:00.000Z', 'md_definition_001'],
    });

    expect(issued).toMatch(/^mdc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(issued).not.toContain('md_definition_001');
    expect(codec.read(issued, { kind: 'definitions', queryFingerprint: 'fingerprint-v1' })).toEqual(
      {
        ok: true,
        value: ['2026-07-27T10:00:00.000Z', 'md_definition_001'],
      }
    );
    expect(codec.read(issued, { kind: 'definitions', queryFingerprint: 'different' })).toEqual({
      ok: false,
      error: { code: 'INVALID_CURSOR', message: 'Invalid Message Digest cursor' },
    });

    now += 60_001;
    expect(codec.read(issued, { kind: 'definitions', queryFingerprint: 'fingerprint-v1' })).toEqual(
      {
        ok: false,
        error: { code: 'INVALID_CURSOR', message: 'Invalid Message Digest cursor' },
      }
    );
  });

  it('rejects malformed and tampered cursor bytes without throwing', () => {
    const codec = createMessageDigestCursorCodec({
      secret: 'synthetic-cursor-secret',
      now: () => Date.parse('2026-07-27T12:00:00.000Z'),
    });
    const issued = codec.issue({
      kind: 'runs',
      queryFingerprint: 'runs-v1',
      values: ['2026-07-27T00:00:00.000Z', 'mdr_run_001'],
    });

    expect(codec.read(`${issued}x`, { kind: 'runs', queryFingerprint: 'runs-v1' }).ok).toBe(false);
    expect(codec.read('not-a-cursor', { kind: 'runs', queryFingerprint: 'runs-v1' }).ok).toBe(
      false
    );
    expect(codec.read('mdc2.payload.signature', { kind: 'runs', queryFingerprint: 'runs-v1' }).ok).toBe(
      false
    );
    const [prefix, payload, signature] = issued.split('.');
    if (prefix === undefined || payload === undefined || signature === undefined) {
      throw new Error('Expected cursor parts');
    }
    const replacement = signature.startsWith('A') ? 'B' : 'A';
    expect(
      codec.read(`${prefix}.${payload}.${replacement}${signature.slice(1)}`, {
        kind: 'runs',
        queryFingerprint: 'runs-v1',
      }).ok
    ).toBe(false);
  });

  it('rejects invalid configuration and supports default TTL issuance', () => {
    expect(() => createMessageDigestCursorCodec({ secret: '' })).toThrow(
      'Invalid Message Digest cursor configuration'
    );
    expect(() =>
      createMessageDigestCursorCodec({ secret: 'secret', ttlMs: 1.5 })
    ).toThrow('Invalid Message Digest cursor configuration');
    expect(() => createMessageDigestCursorCodec({ secret: 'secret', ttlMs: 0 })).toThrow(
      'Invalid Message Digest cursor configuration'
    );
    expect(
      createMessageDigestCursorCodec({ secret: 'secret' }).issue({
        kind: 'ready_dispatches',
        queryFingerprint: 'ready-v1',
        values: [null],
      })
    ).toMatch(/^mdc1\./u);
  });

  it('rejects authenticated cursors with invalid schema, JSON, binding, time, or TTL', () => {
    const now = Date.parse('2026-07-27T12:00:00.000Z');
    const codec = createMessageDigestCursorCodec({
      secret: 'synthetic-cursor-secret',
      now: () => now,
      ttlMs: 60_000,
    });
    const binding = { kind: 'definitions' as const, queryFingerprint: 'fingerprint-v1' };
    const base = {
      version: 1,
      kind: 'definitions',
      queryFingerprint: 'fingerprint-v1',
      values: ['value'],
      issuedAt: now,
      expiresAt: now + 60_000,
    };

    expect(codec.read(forgeCursor('not-json'), binding).ok).toBe(false);
    expect(codec.read(forgeCursor(JSON.stringify({ ...base, extra: true })), binding).ok).toBe(
      false
    );
    for (const envelope of [
      { ...base, kind: 'runs' },
      { ...base, queryFingerprint: 'different' },
      { ...base, issuedAt: now + 31_000, expiresAt: now + 91_000 },
      { ...base, expiresAt: now },
      { ...base, expiresAt: now + 59_000 },
    ]) {
      expect(codec.read(forgeCursor(JSON.stringify(envelope)), binding).ok).toBe(false);
    }
  });
});

function forgeCursor(payloadJson: string): string {
  const key = createHash('sha256')
    .update('message-digest-cursor-v1\0', 'utf8')
    .update('synthetic-cursor-secret', 'utf8')
    .digest();
  const payload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signature = createHmac('sha256', key).update(payload, 'utf8').digest('base64url');
  return `mdc1.${payload}.${signature}`;
}

export function definition(): MessageDigestDefinitionDocument {
  return {
    version: 1 as const,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Synthetic daily digest',
    nameSortKey: 'synthetic daily digest',
    status: 'active' as const,
    listStatus: 'active' as const,
    attentionCode: null,
    revision: 1,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: false,
    source: {
      type: 'private_whatsapp' as const,
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group' as const,
      displayName: 'Synthetic group',
      messageCount: 123,
      participantCount: 8,
      lastActivityAt: '2026-07-27T11:00:00.000Z',
      sourceRevision: 'synthetic-source-revision',
    },
    instructions: {
      templateId: 'fishing_group' as const,
      text: 'Write a concrete Polish digest using only facts from this synthetic source window.',
      revision: '1.0.0',
    },
    schedule: { kind: 'daily' as const, localTime: '03:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary' as const,
      readinessObservationVersion: 'synthetic-readiness-v1',
      readinessObservedAt: '2026-07-27T00:00:00.000Z',
    },
    checkpointAt: '2026-07-27T00:00:00.000Z',
    nextRunAt: '2026-07-28T01:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

export function state(): MessageDigestStateDocument {
  return {
    version: 1 as const,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    revision: 1,
    checkpointAt: '2026-07-27T00:00:00.000Z',
    continuityMemoryMarkdown: '',
    precedingRunId: null,
    precedingRunHash: null,
    pendingWindow: pendingWindow(),
    updatedAt: '2026-07-27T01:00:00.000Z',
  };
}

function pendingWindow(): NonNullable<MessageDigestStateDocument['pendingWindow']> {
  return {
    runId: 'mdr_run_001',
    trigger: 'manual' as const,
    requestIdDigest: 'b'.repeat(64),
    windowStart: '2026-07-27T00:00:00.000Z',
    windowEnd: '2026-07-27T01:00:00.000Z',
    definitionRevision: 1,
    stateRevision: 1,
    erasureEpoch: 0,
    reservedAt: '2026-07-27T01:00:00.000Z',
  };
}

export function run(): MessageDigestRunDocument {
  return {
    version: 1 as const,
    runId: 'mdr_run_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    definitionNameSnapshot: 'Synthetic daily',
    recordRole: 'canonical' as const,
    visibilityMigrationId: null,
    definitionRevision: 1,
    instructionRevision: '1.0.0',
    trigger: 'manual' as const,
    requestIdDigest: 'b'.repeat(64),
    windowStart: '2026-07-27T00:00:00.000Z',
    windowEnd: '2026-07-27T01:00:00.000Z',
    scheduledBoundary: '2026-07-27T01:00:00.000Z',
    generationStatus: 'queued' as const,
    processingStage: 'queued' as const,
    lease: null,
    deliveryAuthorization: null,
    attempts: 0,
    sourceSnapshot: definition().source,
    instructionsSnapshot: definition().instructions,
    scheduleSnapshot: definition().schedule,
    headline: null,
    summaryMarkdown: null,
    evidenceMessageRefs: [],
    continuityMemoryMarkdown: null,
    effectiveMessageCount: null,
    promptVersion: null,
    model: null,
    usage: null,
    delivery: {
      type: 'whatsapp_primary' as const,
      status: 'not_sent' as const,
      idempotencyKey: 'message_digest_run_001',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T01:00:00.000Z',
    updatedAt: '2026-07-27T01:00:00.000Z',
    completedAt: null,
  };
}

export function outbox(): MessageDigestDispatchOutboxDocument {
  const payloadJson = JSON.stringify({ runId: 'mdr_run_001', type: 'message-digest.run' });
  return {
    version: 1 as const,
    outboxId: 'mdo_run_request_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    kind: 'run_request' as const,
    status: 'pending' as const,
    payloadJson,
    payloadDigest: createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
    attempts: 0,
    nextAttemptAt: '2026-07-27T01:00:00.000Z',
    claim: null,
    publishedAt: null,
    terminalCode: null,
    createdAt: '2026-07-27T01:00:00.000Z',
    updatedAt: '2026-07-27T01:00:00.000Z',
    expiresAt: 1_775_000_000,
  };
}

function erasure(): MessageDigestErasureRequestDocument {
  return {
    version: 1 as const,
    erasureRequestId: 'mde_request_001',
    requestIdDigest: 'c'.repeat(64),
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    erasureEpoch: 1,
    stage: 'runs' as const,
    cursor: null,
    deletedCounts: { runs: 0, outbox: 0, state: 0, definition: 0, legacy: 0 },
    createdAt: '2026-07-27T01:00:00.000Z',
    updatedAt: '2026-07-27T01:00:00.000Z',
    completedAt: null,
    expiresAt: null,
  };
}

function migrationActivation(): MessageDigestMigrationActivationDocument {
  return {
    version: 1 as const,
    migrationId: 'mdm_fishing_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    status: 'preparing' as const,
    leaseOwnerDigest: null,
    leaseExpiresAt: null,
    step: 'created',
    cutoverDeadline: '2026-07-28T00:00:00.000Z',
    baselineHash: null,
    replayHash: null,
    safeCounts: {},
    createdAt: '2026-07-27T01:00:00.000Z',
    updatedAt: '2026-07-27T01:00:00.000Z',
  };
}
