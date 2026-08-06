import { describe, expect, it, vi } from 'vitest';
import {
  AUDITED_EMPTY_DATES,
  AUDITED_MISSING_DATES,
  FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
  FISHING_GROUP_KEY,
  MigrationContractError,
  analyzeLegacyBaseline,
  appendCanonicalChain,
  buildFishingMigrationPlan,
  buildSafeMigrationReport,
  deterministicDefinitionId,
  deterministicRunId,
  hashArchiveDocuments,
  hashLegacyDocuments,
  parseFishingMigrationArgs,
  readProtectedFishingBinding,
  runFishingMigrationActivate,
  runFishingMigrationApply,
  runFishingMigrationCompensate,
  runFishingMigrationDryRun,
  runFishingMigrationVerify,
  warsawDayWindow,
} from '../message-digests/fishing-group-migration.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

type TestMock = ReturnType<typeof vi.fn>;

interface ProtectedBinding {
  projectId: string;
  userId: string;
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  groupDisplayName: string;
  expectedLegacyDigestHash: string;
  expectedLegacyStateHash: string;
}

interface ArchiveDocument {
  id: string;
  data: Record<string, unknown>;
}

interface LegacyStateDocument {
  id: string;
  data: {
    userId: string;
    groupKey: string;
    date: string;
    state: {
      userId: string;
      groupKey: string;
      updatedAt: string;
      identityLedger: unknown[];
      moderatorEvents: unknown[];
      openThreads: unknown[];
      recentSummaryDates: string[];
    };
  };
}

interface DryRunArchive {
  digests: LegacyDocument[];
  states: LegacyStateDocument[];
  locks: ArchiveDocument[];
  backfills: ArchiveDocument[];
}

interface DryRunPorts {
  archive: { readSnapshot: TestMock };
  source: {
    resolveBinding: TestMock;
    getReadiness: TestMock;
    queryMessages: TestMock;
  };
  migration: {
    inspectCandidate: TestMock;
    createShell: TestMock;
    restageCompensatedCandidate: TestMock;
    putCanonicalRunAndState: TestMock;
    markStaged: TestMock;
    activateAtomically: TestMock;
    compensateAtomically: TestMock;
  };
  effects: { countMigrationEffects: TestMock };
  aggregateDay: TestMock;
  publish: TestMock;
  visibility: { readPublic: TestMock; readFishing: TestMock };
}

interface DryRunFixture {
  binding: ProtectedBinding;
  archive: DryRunArchive;
  ports: DryRunPorts;
}

interface CandidateDefinition extends Record<string, unknown> {
  definitionId: string;
  status: string;
  listStatus: string;
  activeMigrationId: string | null;
}

interface CandidateActivation extends Record<string, unknown> {
  status: string;
  step: string;
  replayHash: string | null;
  safeCounts: Record<string, number>;
}

interface CandidateState extends Record<string, unknown> {
  checkpointAt: string;
  continuityMemoryMarkdown: string;
  precedingRunId: string | null;
  precedingRunHash: string | null;
  pendingWindow: Record<string, unknown> | null;
}

interface CandidateRun extends Record<string, unknown> {
  runId: string;
  runHash: string;
  migrationDate: string;
  provenance: string;
  recordRole: string;
  predecessorRunHash: string | null;
  visibilityMigrationId: string | null;
  effectiveMessageCount: number;
  sourceCandidateHash: string | null;
  sourceWatermarkHash: string | null;
  completedAt: string;
  delivery: { status: string; acceptedAt?: string };
}

interface Candidate {
  definition: CandidateDefinition | null;
  activation: CandidateActivation | null;
  state: CandidateState | null;
  runs: CandidateRun[];
}

interface ApplyFixture extends DryRunFixture {
  candidate: Candidate;
  archiveWrites: number;
  createdRunCount: number;
  crashAfterActivation: boolean;
}

interface AggregateResult {
  headline: string;
  summaryMarkdown: string;
  evidenceMessageRefs: string[];
  continuityMemoryMarkdown: string;
  promptVersion: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
}

interface ValidatedSource extends Record<string, unknown> {
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: string;
  displayName: string;
  messageCount: number;
  participantCount: number;
  lastActivityAt: string;
  sourceRevision: string;
}

interface SourceMessage {
  messageRef: string;
  eventTimestamp: string;
  direction: string;
  authorLabel: string;
  text: string;
  contentKind: string;
}

interface LegacySummary {
  date: string;
  groupKey: string;
  messageCount: number;
  headline: string;
  bullets: string[];
  threads: unknown[];
  moderatorPosts: unknown[];
  openQuestions: unknown[];
  activityOutliers: unknown[];
}

describe('fishing Message Digest migration contract', () => {
  it('accepts exactly one mode and a bounded safe migration id', () => {
    expect(
      parseFishingMigrationArgs(['--dry-run', '--migration-id', 'mdm_release_abc123'])
    ).toEqual({
      mode: 'dry-run',
      migrationId: 'mdm_release_abc123',
      cutoverDeadline: null,
    });
    expect(
      parseFishingMigrationArgs([
        '--activate',
        '--migration-id',
        'mdm_release_abc123',
        '--cutover-deadline',
        '2026-07-28T02:30:00.000Z',
      ])
    ).toEqual({
      mode: 'activate',
      migrationId: 'mdm_release_abc123',
      cutoverDeadline: '2026-07-28T02:30:00.000Z',
    });

    for (const argv of [
      [],
      ['--dry-run', '--apply', '--migration-id', 'mdm_release_abc123'],
      ['--dry-run'],
      ['--dry-run', '--migration-id', 'unsafe id'],
      ['--activate', '--migration-id', 'mdm_release_abc123'],
      [
        '--verify',
        '--migration-id',
        'mdm_release_abc123',
        '--cutover-deadline',
        '2026-07-28T02:30:00.000Z',
      ],
      ['--dry-run', '--migration-id', 'mdm_release_abc123', '--unknown', 'private-value'],
    ]) {
      expect(() => parseFishingMigrationArgs(argv)).toThrow(MigrationContractError);
    }
  });

  it('requires protected binding inputs without exposing their values in errors', () => {
    const protectedValues = {
      INTEXURAOS_GCP_PROJECT_ID: 'private-project-sentinel',
      INTEXURAOS_MESSAGE_DIGEST_MIGRATION_USER_ID: 'private-user-sentinel',
      INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_ACCOUNT_ID: 'private-account-sentinel',
      INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_GENERATION_ID: 'private-generation-sentinel',
      INTEXURAOS_MESSAGE_DIGEST_MIGRATION_CHAT_ID: 'private-chat-sentinel',
      INTEXURAOS_MESSAGE_DIGEST_MIGRATION_GROUP_NAME: 'private-group-name-sentinel',
      INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_DIGEST_HASH: HASH_A,
      INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_STATE_HASH: HASH_B,
    };

    expect(readProtectedFishingBinding(protectedValues)).toEqual({
      projectId: protectedValues.INTEXURAOS_GCP_PROJECT_ID,
      userId: protectedValues.INTEXURAOS_MESSAGE_DIGEST_MIGRATION_USER_ID,
      sourceAccountId: protectedValues.INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_ACCOUNT_ID,
      generationId: protectedValues.INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_GENERATION_ID,
      chatId: protectedValues.INTEXURAOS_MESSAGE_DIGEST_MIGRATION_CHAT_ID,
      groupDisplayName: protectedValues.INTEXURAOS_MESSAGE_DIGEST_MIGRATION_GROUP_NAME,
      expectedLegacyDigestHash:
        protectedValues.INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_DIGEST_HASH,
      expectedLegacyStateHash:
        protectedValues.INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_STATE_HASH,
    });

    for (const missing of Object.keys(protectedValues)) {
      const environment: Record<string, string> = { ...protectedValues };
      Reflect.deleteProperty(environment, missing);
      try {
        readProtectedFishingBinding(environment);
        throw new Error('expected protected binding validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(MigrationContractError);
        const message = String(error);
        for (const value of Object.values(protectedValues)) expect(message).not.toContain(value);
      }
    }
  });

  it('validates the immutable 139/119 baseline and exact initial repair classification', () => {
    const documents = auditedLegacyDocuments();
    const baseline = analyzeLegacyBaseline({
      documents,
      expectedHash: hashLegacyDocuments(documents),
    });

    expect(baseline).toMatchObject({
      auditedDocumentCount: 139,
      auditedMeaningfulCount: 119,
      auditedEmptyCount: 20,
      postAuditDocumentCount: 0,
      lastMeaningfulDate: '2026-07-03',
      digestHash: hashLegacyDocuments(documents),
    });
    expect(baseline.initialRepair.emptyDates).toEqual(AUDITED_EMPTY_DATES);
    expect(baseline.initialRepair.missingDates).toEqual(AUDITED_MISSING_DATES);
    expect(baseline.imported.map((item) => item.data.date).at(-1)).toBe('2026-07-03');
    expect(baseline.imported).toHaveLength(119);
  });

  it('separates post-audit additions without weakening the immutable baseline hash', () => {
    const documents = auditedLegacyDocuments();
    const expectedHash = hashLegacyDocuments(documents);
    documents.push(legacyDocument('post-audit', '2026-07-27', 7));

    const baseline = analyzeLegacyBaseline({ documents, expectedHash });

    expect(baseline.postAuditDocumentCount).toBe(1);
    expect(baseline.postAuditHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(baseline.digestHash).toBe(expectedHash);
  });

  it('fails closed on changed counts, classifications, latest date, or baseline hash', () => {
    const documents = auditedLegacyDocuments();
    const expectedHash = hashLegacyDocuments(documents);
    const mutations = [
      documents.slice(1),
      documents.map((item) =>
        item.data.date === '2026-07-04'
          ? { ...item, data: { ...item.data, summary: meaningfulSummary('2026-07-04', 4) } }
          : item
      ),
      documents.map((item) =>
        item.data.date === '2026-07-03'
          ? { ...item, data: { ...item.data, summary: emptySummary('2026-07-03') } }
          : item
      ),
    ];

    for (const changed of mutations) {
      expect(() => analyzeLegacyBaseline({ documents: changed, expectedHash })).toThrow(
        MigrationContractError
      );
    }
    expect(() => analyzeLegacyBaseline({ documents, expectedHash: HASH_B })).toThrow(
      MigrationContractError
    );
  });

  it('plans replay dynamically through the last fully closed Warsaw day', () => {
    const plan = buildFishingMigrationPlan('2026-07-28T12:00:00.000Z');

    expect(plan.cutoverDate).toBe('2026-07-28');
    expect(plan.replayEndExclusive).toBe('2026-07-27T22:00:00.000Z');
    expect(plan.replayDates[0]).toBe('2026-07-04');
    expect(plan.replayDates.at(-1)).toBe('2026-07-27');
    expect(plan.replayDates).toHaveLength(24);
    expect(plan.repairDates).toHaveLength(23);
  });

  it('uses half-open Warsaw windows across 23-hour and 25-hour DST days', () => {
    const spring = warsawDayWindow('2026-03-29');
    const autumn = warsawDayWindow('2026-10-25');

    expect(spring).toEqual({
      date: '2026-03-29',
      windowStart: '2026-03-28T23:00:00.000Z',
      windowEnd: '2026-03-29T22:00:00.000Z',
      durationHours: 23,
    });
    expect(autumn).toEqual({
      date: '2026-10-25',
      windowStart: '2026-10-24T22:00:00.000Z',
      windowEnd: '2026-10-25T23:00:00.000Z',
      durationHours: 25,
    });
  });

  it('derives deterministic opaque definition and run ids', () => {
    expect(deterministicDefinitionId('mdm_release_abc123')).toMatch(/^md_[0-9a-f]{40}$/u);
    expect(deterministicRunId('mdm_release_abc123', '2026-07-03', 'legacy')).toMatch(
      /^mdr_[0-9a-f]{40}$/u
    );
    expect(deterministicRunId('mdm_release_abc123', '2026-07-04', 'replay')).toBe(
      deterministicRunId('mdm_release_abc123', '2026-07-04', 'replay')
    );
    expect(deterministicRunId('mdm_release_abc123', '2026-07-04', 'replay')).not.toBe(
      deterministicRunId('mdm_release_abc123', '2026-07-04', 'legacy')
    );
  });

  it('builds a strictly sequential predecessor chain', () => {
    const first = appendCanonicalChain(null, {
      runId: 'mdr_first',
      date: '2026-07-03',
      candidateHash: HASH_A,
    });
    const second = appendCanonicalChain(first.runHash, {
      runId: 'mdr_second',
      date: '2026-07-04',
      candidateHash: HASH_B,
    });

    expect(first.predecessorRunHash).toBeNull();
    expect(first.runHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.predecessorRunHash).toBe(first.runHash);
    expect(second.runHash).not.toBe(first.runHash);
    expect(
      appendCanonicalChain(first.runHash, {
        runId: 'mdr_second',
        date: '2026-07-04',
        candidateHash: HASH_B,
      })
    ).toEqual(second);
  });

  it('selects only safe dates, counts, hashes, and statuses for reporting', () => {
    const report = buildSafeMigrationReport({
      mode: 'dry-run',
      migrationId: 'mdm_release_abc123',
      status: 'ready',
      cutoverDate: '2026-07-28',
      replayStartDate: '2026-07-04',
      replayEndDate: '2026-07-27',
      counts: { legacy: 139, replay: 24 },
      hashes: { baseline: HASH_A, replay: HASH_B },
      protected: {
        userId: 'private-user-sentinel',
        chatId: 'private-chat-sentinel',
        prompt: 'private-prompt-sentinel',
        phone: '+48123123123',
      },
    });
    const serialized = JSON.stringify(report);

    expect(report).toEqual({
      mode: 'dry-run',
      migrationId: 'mdm_release_abc123',
      status: 'ready',
      cutoverDate: '2026-07-28',
      replayStartDate: '2026-07-04',
      replayEndDate: '2026-07-27',
      counts: { legacy: 139, replay: 24 },
      hashes: { baseline: HASH_A, replay: HASH_B },
    });
    for (const secret of [
      'private-user-sentinel',
      'private-chat-sentinel',
      'private-prompt-sentinel',
      '+48123123123',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('fishing Message Digest migration dry-run', () => {
  it('queries Private WhatsApp with the exact strict request allowlist', async () => {
    const fixture = dryRunFixture();

    await runFishingMigrationDryRun(
      {
        migrationId: 'mdm_release_abc123',
        binding: fixture.binding,
        now: '2026-07-28T12:00:00.000Z',
      },
      fixture.ports
    );

    const expectedFirstPageKeys = [
      'chatId',
      'chatType',
      'date',
      'generationId',
      'limit',
      'sourceAccountId',
      'userId',
      'windowEnd',
      'windowStart',
    ];
    for (const [input] of fixture.ports.source.queryMessages.mock.calls) {
      const expectedKeys =
        input.cursor === undefined
          ? expectedFirstPageKeys
          : [...expectedFirstPageKeys, 'cursor'].sort((left, right) => left.localeCompare(right));
      expect(Object.keys(input).sort((left, right) => left.localeCompare(right))).toEqual(
        expectedKeys
      );
    }
  });

  it('preflights the exact source windows with safe counts and zero mutations', async () => {
    const fixture = dryRunFixture();

    const result = await runFishingMigrationDryRun(
      {
        migrationId: 'mdm_release_abc123',
        binding: fixture.binding,
        now: '2026-07-28T12:00:00.000Z',
      },
      fixture.ports
    );

    expect(result.report).toMatchObject({
      mode: 'dry-run',
      migrationId: 'mdm_release_abc123',
      status: 'ready',
      cutoverDate: '2026-07-28',
      replayStartDate: '2026-07-04',
      replayEndDate: '2026-07-27',
      counts: {
        auditedLegacyDocuments: 139,
        meaningfulLegacyDocuments: 119,
        replayDates: 24,
        visibleReplayRuns: 24,
        sourceMessages: 48,
        outboundEffects: 0,
      },
    });
    expect(result.preflight.sourceWindows).toHaveLength(24);
    expect(result.preflight.sourceWindows[0]).toMatchObject({
      date: '2026-07-04',
      eligibleMessageCount: 2,
    });
    expect(result.preflight.sourceWindows[0]?.watermarkHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(fixture.ports.source.queryMessages).toHaveBeenCalledTimes(48);
    expect(fixture.ports.migration.createShell).not.toHaveBeenCalled();
    expect(fixture.ports.migration.putCanonicalRunAndState).not.toHaveBeenCalled();
    expect(fixture.ports.aggregateDay).not.toHaveBeenCalled();
    expect(fixture.ports.publish).not.toHaveBeenCalled();
  });

  it('keeps later legacy states as audit while freezing continuity at the last meaningful checkpoint', async () => {
    const fixture = dryRunFixture();
    fixture.archive.states.push(legacyStateDocument('2026-07-30'));

    const result = await runDryRun(fixture);

    expect(result.report).toMatchObject({
      counts: {
        frozenLegacyStateDocuments: 1,
        postCheckpointLegacyStateDocuments: 1,
      },
      hashes: {
        legacyStates: fixture.binding.expectedLegacyStateHash,
        postCheckpointLegacyStates: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    expect(result.preflight.legacyStates.map((document) => document.data.date)).toEqual([
      '2026-07-03',
    ]);
  });

  it.each([
    { label: 'zero source matches', sourceMatches: [] },
    {
      label: 'multiple source matches',
      sourceMatches: [validatedSource(), validatedSource({ chatId: 'another-private-chat' })],
    },
  ])('fails closed for $label', async ({ sourceMatches }) => {
    const fixture = dryRunFixture();
    fixture.ports.source.resolveBinding.mockResolvedValue(sourceMatches);

    await expect(
      runFishingMigrationDryRun(
        {
          migrationId: 'mdm_release_abc123',
          binding: fixture.binding,
          now: '2026-07-28T12:00:00.000Z',
        },
        fixture.ports
      )
    ).rejects.toMatchObject({ code: 'SOURCE_BINDING_NOT_UNIQUE' });
  });

  it.each([
    ['sourceAccountId', 'different-private-account', 'SOURCE_BINDING_CHANGED'],
    ['generationId', 'different-private-generation', 'SOURCE_GENERATION_CHANGED'],
    ['chatId', 'different-private-chat', 'SOURCE_BINDING_CHANGED'],
    ['chatType', 'direct', 'SOURCE_BINDING_CHANGED'],
    ['displayName', 'different-private-name', 'SOURCE_BINDING_CHANGED'],
  ] as const)('fails closed when source %s changes', async (field, value, code) => {
    const fixture = dryRunFixture();
    fixture.ports.source.resolveBinding.mockResolvedValue([validatedSource({ [field]: value })]);

    await expect(
      runFishingMigrationDryRun(
        {
          migrationId: 'mdm_release_abc123',
          binding: fixture.binding,
          now: '2026-07-28T12:00:00.000Z',
        },
        fixture.ports
      )
    ).rejects.toMatchObject({ code });
  });

  it('requires first-number delivery readiness before reporting ready', async () => {
    const fixture = dryRunFixture();
    fixture.ports.source.getReadiness.mockResolvedValue({
      status: 'mapping_missing',
      observationVersion: 'safe-readiness-v2',
      observedAt: '2026-07-28T11:59:00.000Z',
    });

    await expect(
      runFishingMigrationDryRun(
        {
          migrationId: 'mdm_release_abc123',
          binding: fixture.binding,
          now: '2026-07-28T12:00:00.000Z',
        },
        fixture.ports
      )
    ).rejects.toMatchObject({ code: 'DELIVERY_NOT_READY' });
  });

  it.each([
    {
      label: 'unexpired lock',
      mutate: (fixture: DryRunFixture): void => {
        fixture.archive.locks.push({
          id: 'private-lock-id',
          data: {
            userId: fixture.binding.userId,
            groupKey: FISHING_GROUP_KEY,
            holder: 'cron',
            expiresAt: '2026-07-28T12:01:00.000Z',
          },
        });
      },
      code: 'LEGACY_LOCK_ACTIVE',
    },
    {
      label: 'running backfill',
      mutate: (fixture: DryRunFixture): void => {
        fixture.archive.backfills.push({
          id: 'private-backfill-id',
          data: {
            userId: fixture.binding.userId,
            groupKey: FISHING_GROUP_KEY,
            status: 'running',
          },
        });
      },
      code: 'LEGACY_BACKFILL_ACTIVE',
    },
  ])('blocks on $label', async ({ mutate, code }) => {
    const fixture = dryRunFixture();
    mutate(fixture);

    await expect(
      runFishingMigrationDryRun(
        {
          migrationId: 'mdm_release_abc123',
          binding: fixture.binding,
          now: '2026-07-28T12:00:00.000Z',
        },
        fixture.ports
      )
    ).rejects.toMatchObject({ code });
  });

  it('rejects changed digest/state hashes and a conflicting deterministic candidate', async () => {
    const changedDigest = dryRunFixture();
    required(changedDigest.archive.digests[0]).data.summary.headline = 'Changed baseline';
    await expect(runDryRun(changedDigest)).rejects.toMatchObject({
      code: 'LEGACY_BASELINE_CHANGED',
    });

    const changedState = dryRunFixture();
    required(changedState.archive.states[0]).data.state.updatedAt = '2026-01-01T00:00:00.000Z';
    await expect(runDryRun(changedState)).rejects.toMatchObject({
      code: 'LEGACY_STATE_BASELINE_CHANGED',
    });

    const conflicting = dryRunFixture();
    conflicting.ports.migration.inspectCandidate.mockResolvedValue({
      definition: { definitionId: 'md_conflicting_candidate' },
      activation: null,
      runs: [],
      state: null,
    });
    await expect(runDryRun(conflicting)).rejects.toMatchObject({
      code: 'MIGRATION_CANDIDATE_CONFLICT',
    });
  });

  it('rejects unstable pagination/source revision and any pre-existing outbound effect', async () => {
    const unstable = dryRunFixture();
    unstable.ports.source.queryMessages.mockResolvedValueOnce({
      messages: [sourceMessage('2026-07-04', 1)],
      sourceRevision: 'private-window-revision-first-page',
      highWatermark: 'private-watermark-first-page',
      nextCursor: 'private-cursor-first-page',
    });
    unstable.ports.source.queryMessages.mockResolvedValueOnce({
      messages: [sourceMessage('2026-07-04', 2)],
      sourceRevision: 'private-window-revision-changed-page',
      highWatermark: 'private-watermark-second-page',
      nextCursor: null,
    });
    await expect(runDryRun(unstable)).rejects.toMatchObject({ code: 'SOURCE_GENERATION_CHANGED' });

    const outbound = dryRunFixture();
    outbound.ports.effects.countMigrationEffects.mockResolvedValue({
      outbox: 1,
      outboundMessages: 0,
      deliveryReceipts: 0,
    });
    await expect(runDryRun(outbound)).rejects.toMatchObject({
      code: 'MIGRATION_OUTBOUND_EFFECT_PRESENT',
    });
  });

  it('never returns or throws protected source/message values', async () => {
    const fixture = dryRunFixture();
    const result = await runDryRun(fixture);
    const serialized = JSON.stringify(result.report);
    for (const secret of protectedSentinels(fixture)) expect(serialized).not.toContain(secret);

    fixture.ports.source.queryMessages.mockRejectedValueOnce(
      new Error(
        `provider included ${fixture.binding.chatId} ${sourceMessage('2026-07-04', 1).text}`
      )
    );
    try {
      await runDryRun(fixture);
      throw new Error('expected source read to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationContractError);
      const safeError = String(error);
      for (const secret of protectedSentinels(fixture)) expect(safeError).not.toContain(secret);
    }
  });
});

describe('fishing Message Digest migration apply', () => {
  it('stages one hidden definition, 119 legacy imports, and every WhatsApp replay date silently', async () => {
    const fixture = applyFixture();

    const result = await runApply(fixture);

    expect(result.report).toMatchObject({
      mode: 'apply',
      status: 'staged',
      counts: {
        importedRuns: 119,
        replayRuns: 24,
        visibleReplayRuns: 24,
        canonicalRuns: 143,
        outboundEffects: 0,
      },
    });
    expect(fixture.candidate.definition).toMatchObject({
      definitionId: deterministicDefinitionId('mdm_release_abc123'),
      userId: fixture.binding.userId,
      status: 'migrating',
      listStatus: 'paused',
      activeMigrationId: null,
      legacyAlias: { groupKey: FISHING_GROUP_KEY },
      instructions: {
        templateId: 'fishing_group',
        text: FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
        revision: '1.0.0',
      },
      schedule: { kind: 'daily', localTime: '03:00', timeZone: 'Europe/Warsaw' },
    });
    expect(fixture.candidate.activation).toMatchObject({
      migrationId: 'mdm_release_abc123',
      status: 'staging',
      definitionId: fixture.candidate.definition?.definitionId,
    });
    expect(fixture.candidate.runs).toHaveLength(143);
    expect(
      fixture.candidate.runs.filter((run) => run.provenance === 'legacy_mobile_notification')
    ).toHaveLength(119);
    expect(
      fixture.candidate.runs.filter((run) => run.provenance === 'private_whatsapp_replay')
    ).toHaveLength(24);
    for (const run of fixture.candidate.runs) {
      expect(run).toMatchObject({
        recordRole: 'canonical',
        visibilityMigrationId: 'mdm_release_abc123',
        deliveryMode: 'silent',
        delivery: { status: 'not_sent' },
      });
      expect(run.outbox).toBeUndefined();
      expect(run.receipt).toBeUndefined();
    }
    expect(fixture.ports.aggregateDay).toHaveBeenCalledTimes(24);
    expect(fixture.ports.publish).not.toHaveBeenCalled();
    expect(fixture.archiveWrites).toBe(0);
  });

  it('preserves legacy output metadata and retains archive documents byte-for-byte', async () => {
    const fixture = applyFixture();
    const archiveBefore = structuredClone(fixture.archive);

    await runApply(fixture);

    const legacyRun = fixture.candidate.runs.find(
      (run) => run.provenance === 'legacy_mobile_notification'
    );
    const legacyDocument = fixture.archive.digests.find(
      (document) => document.data.date === legacyRun?.migrationDate
    );
    expect(legacyRun).toMatchObject({
      runId: deterministicRunId('mdm_release_abc123', legacyRun?.migrationDate ?? '', 'legacy'),
      generationStatus: 'completed',
      processingStage: 'completed',
      model: legacyDocument?.data.modelId,
      effectiveMessageCount: legacyDocument?.data.summary.messageCount,
      completedAt: legacyDocument?.data.generatedAt,
      sourceWatermarkHash: null,
    });
    expect(legacyRun?.headline).toBe(legacyDocument?.data.summary.headline);
    expect(legacyRun?.summaryMarkdown).toContain(legacyDocument?.data.summary.bullets[0]);
    expect(fixture.archive).toEqual(archiveBefore);
  });

  it('persists a chronological predecessor chain and final bounded continuity state', async () => {
    const fixture = applyFixture();

    await runApply(fixture);

    const ordered = [...fixture.candidate.runs].sort((left, right) =>
      left.migrationDate.localeCompare(right.migrationDate)
    );
    for (const [index, run] of ordered.entries()) {
      expect(run.predecessorRunHash).toBe(index === 0 ? null : ordered[index - 1]?.runHash);
      expect(run.runHash).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(fixture.candidate.state).toMatchObject({
      checkpointAt: '2026-07-27T22:00:00.000Z',
      pendingWindow: null,
      precedingRunId: ordered.at(-1)?.runId,
      precedingRunHash: ordered.at(-1)?.runHash,
    });
    expect(fixture.candidate.state?.continuityMemoryMarkdown.length).toBeLessThanOrEqual(8_000);
    expect(fixture.candidate.activation?.replayHash).toBe(ordered.at(-1)?.runHash);
  });

  it('builds imported continuity from the exact meaningful checkpoint, not a later audit state', async () => {
    const fixture = applyFixture();
    fixture.archive.states.push(legacyStateDocument('2026-07-30'));

    await runApply(fixture);

    const checkpointRun = fixture.candidate.runs.find(
      (run) => run.provenance === 'legacy_mobile_notification' && run.migrationDate === '2026-07-03'
    );
    expect(checkpointRun?.continuityMemoryMarkdown).toContain('2026-07-03T03:06:00.000Z');
    expect(checkpointRun?.continuityMemoryMarkdown).not.toContain('2026-07-30T03:06:00.000Z');
  });

  it('resumes a partial failure invisibly and does not regenerate already staged days', async () => {
    const fixture = applyFixture();
    let aggregateCalls = 0;
    fixture.ports.aggregateDay.mockImplementation(async (input: { date: string }) => {
      aggregateCalls += 1;
      if (aggregateCalls === 4) throw new Error(`private provider failure ${input.date}`);
      return aggregateResult(input.date);
    });

    await expect(runApply(fixture)).rejects.toMatchObject({ code: 'MIGRATION_APPLY_FAILED' });
    expect(fixture.candidate.definition?.status).toBe('migrating');
    expect(fixture.candidate.definition?.activeMigrationId).toBeNull();
    expect(fixture.candidate.runs.every((run) => run.visibilityMigrationId !== null)).toBe(true);
    const stagedBeforeResume = fixture.candidate.runs.length;
    expect(stagedBeforeResume).toBe(122);

    fixture.ports.aggregateDay.mockImplementation(async (input: { date: string }) =>
      aggregateResult(input.date)
    );
    fixture.ports.aggregateDay.mockClear();
    const resumed = await runApply(fixture);

    expect(resumed.report.status).toBe('staged');
    expect(fixture.candidate.runs).toHaveLength(143);
    expect(fixture.ports.aggregateDay).toHaveBeenCalledTimes(21);
  });

  it('reruns with identical IDs/hashes and performs no second LLM call or duplicate write', async () => {
    const fixture = applyFixture();
    await runApply(fixture);
    const firstCandidate = structuredClone(fixture.candidate);
    fixture.ports.aggregateDay.mockClear();
    fixture.createdRunCount = 0;
    fixture.ports.source.queryMessages.mockImplementation(
      async (input: { date: string; cursor?: string }) => {
        const page = input.cursor === undefined ? 1 : 2;
        return {
          messages: [sourceMessage(input.date, page)],
          sourceRevision: `private-rotated-window-source-revision-${input.date}`,
          highWatermark: `private-rotated-watermark-${input.date}-${String(page)}`,
          nextCursor: page === 1 ? `private-rotated-cursor-${input.date}` : null,
        };
      }
    );

    const rerun = await runApply(fixture);

    expect(rerun.report.status).toBe('staged');
    expect(fixture.ports.aggregateDay).not.toHaveBeenCalled();
    expect(fixture.createdRunCount).toBe(0);
    expect(fixture.candidate).toEqual(firstCandidate);
  });

  it('records an empty source day canonically without invoking the LLM', async () => {
    const fixture = applyFixture();
    fixture.ports.source.queryMessages.mockImplementation(
      async (input: { date: string; cursor?: string }) => {
        if (input.date === '2026-07-27') {
          return {
            messages: [],
            sourceRevision: `private-window-source-revision-${input.date}`,
            highWatermark: null,
            nextCursor: null,
          };
        }
        const page = input.cursor === undefined ? 1 : 2;
        return {
          messages: [sourceMessage(input.date, page)],
          sourceRevision: `private-window-source-revision-${input.date}`,
          highWatermark: `private-watermark-${input.date}-${String(page)}`,
          nextCursor: page === 1 ? `private-cursor-${input.date}` : null,
        };
      }
    );

    const applied = await runApply(fixture);

    expect(fixture.ports.aggregateDay).toHaveBeenCalledTimes(23);
    expect(applied.report.counts).toMatchObject({ replayRuns: 24, visibleReplayRuns: 23 });
    expect(fixture.candidate.runs.find((run) => run.migrationDate === '2026-07-27')).toMatchObject({
      generationStatus: 'skipped_no_activity',
      processingStage: 'skipped_no_activity',
      effectiveMessageCount: 0,
      headline: null,
      summaryMarkdown: null,
    });
    const verified = await runVerify(fixture);
    expect(verified.report.counts).toMatchObject({ replayRuns: 24, visibleReplayRuns: 23 });
  });
});

describe('fishing Message Digest migration verify', () => {
  it('proves the complete unique chain, exact source counts/hashes, and zero outbound delta', async () => {
    const fixture = applyFixture();
    await runApply(fixture);

    const result = await runVerify(fixture);

    expect(result.report).toMatchObject({
      mode: 'verify',
      status: 'verified_staging',
      counts: {
        importedRuns: 119,
        replayRuns: 24,
        visibleReplayRuns: 24,
        canonicalRuns: 143,
        outboundEffects: 0,
        publicDefinitions: 0,
        publicRuns: 0,
        fishingDefinitions: 0,
        fishingRuns: 0,
      },
    });
    expect(result.verificationHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.replayHash).toBe(fixture.candidate.runs.at(-1)?.runHash);
  });

  it.each([
    {
      label: 'incomplete prefix',
      mutate: (fixture: ApplyFixture): void => {
        fixture.candidate.runs.pop();
      },
      code: 'MIGRATION_CHAIN_INCOMPLETE',
    },
    {
      label: 'duplicate date',
      mutate: (fixture: ApplyFixture): void => {
        const run = structuredClone(required(fixture.candidate.runs.at(-1)));
        run.runId = 'mdr_duplicate_date';
        fixture.candidate.runs.push(run);
      },
      code: 'MIGRATION_CANONICAL_CONFLICT',
    },
    {
      label: 'audit artifact mixed into candidate',
      mutate: (fixture: ApplyFixture): void => {
        required(fixture.candidate.runs[0]).recordRole = 'audit';
      },
      code: 'MIGRATION_CANONICAL_CONFLICT',
    },
    {
      label: 'broken predecessor chain',
      mutate: (fixture: ApplyFixture): void => {
        required(fixture.candidate.runs[3]).predecessorRunHash = HASH_B;
      },
      code: 'MIGRATION_CHAIN_BROKEN',
    },
    {
      label: 'broken run hash',
      mutate: (fixture: ApplyFixture): void => {
        required(fixture.candidate.runs[3]).runHash = HASH_B;
      },
      code: 'MIGRATION_CHAIN_BROKEN',
    },
  ])('rejects $label', async ({ mutate, code }) => {
    const fixture = applyFixture();
    await runApply(fixture);
    mutate(fixture);

    await expect(runVerify(fixture)).rejects.toMatchObject({ code });
  });

  it.each([
    {
      label: 'source count mismatch',
      mutate: (run: CandidateRun): void => {
        run.effectiveMessageCount += 1;
      },
    },
    {
      label: 'source candidate hash mismatch',
      mutate: (run: CandidateRun): void => {
        run.sourceCandidateHash = HASH_B;
      },
    },
    {
      label: 'source watermark mismatch',
      mutate: (run: CandidateRun): void => {
        run.sourceWatermarkHash = HASH_B;
      },
    },
  ])('rejects replay $label', async ({ mutate }) => {
    const fixture = applyFixture();
    await runApply(fixture);
    const replay = required(
      fixture.candidate.runs.find((run) => run.provenance === 'private_whatsapp_replay')
    );
    mutate(replay);

    await expect(runVerify(fixture)).rejects.toMatchObject({
      code: 'MIGRATION_SOURCE_PROOF_MISMATCH',
    });
  });

  it('rejects a stale source generation and any outbound delta on re-verification', async () => {
    const stale = applyFixture();
    await runApply(stale);
    stale.ports.source.resolveBinding.mockResolvedValue([
      validatedSource({ generationId: 'different-private-generation' }),
    ]);
    await expect(runVerify(stale)).rejects.toMatchObject({ code: 'SOURCE_GENERATION_CHANGED' });

    const outbound = applyFixture();
    await runApply(outbound);
    outbound.ports.effects.countMigrationEffects.mockResolvedValue({
      outbox: 0,
      outboundMessages: 0,
      deliveryReceipts: 1,
    });
    await expect(runVerify(outbound)).rejects.toMatchObject({
      code: 'MIGRATION_OUTBOUND_EFFECT_PRESENT',
    });
  });

  it('fails if staged records leak through either public or Fishing projection', async () => {
    const fixture = applyFixture();
    await runApply(fixture);
    fixture.ports.visibility.readPublic.mockResolvedValue({
      definitions: [fixture.candidate.definition],
      runs: [],
    });
    await expect(runVerify(fixture)).rejects.toMatchObject({
      code: 'MIGRATION_VISIBILITY_CONFLICT',
    });

    fixture.ports.visibility.readPublic.mockResolvedValue({ definitions: [], runs: [] });
    fixture.ports.visibility.readFishing.mockResolvedValue({
      definitions: [],
      runs: [fixture.candidate.runs[0]],
    });
    await expect(runVerify(fixture)).rejects.toMatchObject({
      code: 'MIGRATION_VISIBILITY_CONFLICT',
    });
  });

  it('produces the same verification hash on an unchanged rerun', async () => {
    const fixture = applyFixture();
    await runApply(fixture);

    const first = await runVerify(fixture);
    const second = await runVerify(fixture);

    expect(second).toEqual(first);
    expect(fixture.candidate.runs).toHaveLength(143);
  });
});

describe('fishing Message Digest migration activation and compensation', () => {
  it('activates the verified chain atomically after a fresh ready observation', async () => {
    const fixture = applyFixture();
    await runApply(fixture);

    const result = await runActivate(fixture);

    expect(result.report).toMatchObject({
      mode: 'activate',
      status: 'active',
      counts: { canonicalRuns: 143, outboundEffects: 0 },
    });
    expect(fixture.candidate.activation).toMatchObject({
      status: 'active',
      cutoverDeadline: '2026-07-28T13:30:00.000Z',
      replayHash: fixture.candidate.runs.at(-1)?.runHash,
    });
    expect(fixture.candidate.definition).toMatchObject({
      status: 'active',
      listStatus: 'active',
      activeMigrationId: 'mdm_release_abc123',
      checkpointAt: '2026-07-27T22:00:00.000Z',
      nextRunAt: '2026-07-29T01:00:00.000Z',
    });
    expect(fixture.candidate.runs.every((run) => run.visibilityMigrationId === null)).toBe(true);
    const publicProjection = await fixture.ports.visibility.readPublic();
    const fishingProjection = await fixture.ports.visibility.readFishing();
    expect(publicProjection).toMatchObject({
      definitions: [fixture.candidate.definition],
      runs: expect.arrayContaining([expect.objectContaining({ recordRole: 'canonical' })]),
    });
    expect(publicProjection.runs).toHaveLength(143);
    expect(fishingProjection.runs).toHaveLength(143);
    expect(fixture.ports.source.getReadiness).toHaveBeenCalledTimes(4);
  });

  it('requires readiness to be ready and freshly observed immediately before activation', async () => {
    const notReady = applyFixture();
    await runApply(notReady);
    notReady.ports.source.getReadiness.mockResolvedValueOnce({
      status: 'ready',
      observationVersion: 'safe-readiness-verify',
      observedAt: '2026-07-28T11:59:00.000Z',
    });
    notReady.ports.source.getReadiness.mockResolvedValueOnce({
      status: 'disconnected',
      observationVersion: 'safe-readiness-activation',
      observedAt: '2026-07-28T12:00:00.000Z',
    });
    await expect(runActivate(notReady)).rejects.toMatchObject({ code: 'DELIVERY_NOT_READY' });
    expect(notReady.candidate.definition?.status).toBe('migrating');

    const stale = applyFixture();
    await runApply(stale);
    stale.ports.source.getReadiness.mockResolvedValueOnce({
      status: 'ready',
      observationVersion: 'safe-readiness-verify',
      observedAt: '2026-07-28T11:59:00.000Z',
    });
    stale.ports.source.getReadiness.mockResolvedValueOnce({
      status: 'ready',
      observationVersion: 'safe-readiness-activation',
      observedAt: '2026-07-28T11:50:00.000Z',
    });
    await expect(runActivate(stale)).rejects.toMatchObject({
      code: 'DELIVERY_READINESS_STALE',
    });
    expect(stale.candidate.definition?.status).toBe('migrating');
  });

  it('resumes idempotently after the activation transaction commits but the caller loses its reply', async () => {
    const fixture = applyFixture();
    await runApply(fixture);
    fixture.crashAfterActivation = true;

    await expect(runActivate(fixture)).rejects.toMatchObject({ code: 'MIGRATION_ACTIVATE_FAILED' });
    expect(fixture.candidate.definition?.status).toBe('active');
    const activatedSnapshot = structuredClone(fixture.candidate);

    fixture.crashAfterActivation = false;
    const resumed = await runActivate(fixture);

    expect(resumed.report.status).toBe('active');
    expect(fixture.candidate).toEqual(activatedSnapshot);
  });

  it('compensates an activated migration by atomically re-hiding the complete chain', async () => {
    const fixture = applyFixture();
    await runApply(fixture);
    await runActivate(fixture);

    const result = await runCompensate(fixture);

    expect(result.report).toMatchObject({
      mode: 'compensate',
      status: 'rollback_pending',
      counts: { canonicalRuns: 143, outboundEffects: 0 },
    });
    expect(fixture.candidate.definition).toMatchObject({
      status: 'migrating',
      listStatus: 'paused',
      activeMigrationId: null,
    });
    expect(fixture.candidate.activation?.status).toBe('rollback_pending');
    expect(
      fixture.candidate.runs.every((run) => run.visibilityMigrationId === 'mdm_release_abc123')
    ).toBe(true);
    await expect(fixture.ports.visibility.readPublic()).resolves.toEqual({
      definitions: [],
      runs: [],
    });
    await expect(fixture.ports.visibility.readFishing()).resolves.toEqual({
      definitions: [],
      runs: [],
    });
  });

  it.each([
    {
      label: 'pending reservation',
      mutate: (fixture: ApplyFixture): void => {
        required(fixture.candidate.state).pendingWindow = { runId: 'mdr_pending' };
      },
    },
    {
      label: 'outbox record',
      mutate: (fixture: ApplyFixture): void => {
        fixture.ports.effects.countMigrationEffects.mockResolvedValue({
          outbox: 1,
          outboundMessages: 0,
          deliveryReceipts: 0,
        });
      },
    },
    {
      label: 'delivery effect',
      mutate: (fixture: ApplyFixture): void => {
        const finalRun = required(fixture.candidate.runs.at(-1));
        finalRun.delivery.status = 'sent';
        finalRun.delivery.acceptedAt = '2026-07-28T12:01:00.000Z';
      },
    },
  ])('refuses compensation with any $label', async ({ mutate }) => {
    const fixture = applyFixture();
    await runApply(fixture);
    await runActivate(fixture);
    mutate(fixture);

    await expect(runCompensate(fixture)).rejects.toMatchObject({
      code: 'MIGRATION_COMPENSATION_FORBIDDEN',
    });
    expect(fixture.candidate.definition?.status).toBe('active');
  });

  it('makes activation and compensation retries byte-identical', async () => {
    const fixture = applyFixture();
    await runApply(fixture);
    const firstActivation = await runActivate(fixture);
    const activeSnapshot = structuredClone(fixture.candidate);
    const secondActivation = await runActivate(fixture);
    expect(secondActivation).toEqual(firstActivation);
    expect(fixture.candidate).toEqual(activeSnapshot);

    const firstCompensation = await runCompensate(fixture);
    const hiddenSnapshot = structuredClone(fixture.candidate);
    const secondCompensation = await runCompensate(fixture);
    expect(secondCompensation).toEqual(firstCompensation);
    expect(fixture.candidate).toEqual(hiddenSnapshot);
  });

  it('reuses the same migration identity for a complete cycle after compensation', async () => {
    const fixture = applyFixture();
    await runApply(fixture);
    await runVerify(fixture);
    await runActivate(fixture);
    await runCompensate(fixture);
    const hiddenRunIds = fixture.candidate.runs.map((run) => run.runId);
    const createdRunsBeforeRetry = fixture.createdRunCount;
    const aggregatesBeforeRetry = fixture.ports.aggregateDay.mock.calls.length;

    const reapplied = await runApply(fixture);
    const reverified = await runVerify(fixture);
    const reactivated = await runActivate(fixture);

    expect(reapplied.report).toMatchObject({
      mode: 'apply',
      status: 'staged',
      counts: { createdRuns: 0, reusedRuns: 143, outboundEffects: 0 },
    });
    expect(reverified.report.status).toBe('verified_staging');
    expect(reactivated.report.status).toBe('active');
    expect(fixture.ports.migration.restageCompensatedCandidate).toHaveBeenCalledOnce();
    expect(fixture.ports.migration.restageCompensatedCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryReceipts: 0 })
    );
    expect(fixture.candidate.runs.map((run) => run.runId)).toEqual(hiddenRunIds);
    expect(fixture.createdRunCount).toBe(createdRunsBeforeRetry);
    expect(fixture.ports.aggregateDay).toHaveBeenCalledTimes(aggregatesBeforeRetry);
    expect(fixture.candidate.runs.every((run) => run.visibilityMigrationId === null)).toBe(true);
    expect(fixture.ports.publish).not.toHaveBeenCalled();
  }, 30_000);
});

function auditedLegacyDocuments(): LegacyDocument[] {
  const documents: LegacyDocument[] = [];
  const meaningfulDates = datesEndingAt('2026-07-03', 119);
  for (const [index, date] of meaningfulDates.entries()) {
    documents.push(legacyDocument(`meaningful-${String(index).padStart(3, '0')}`, date, index + 1));
  }
  const firstMeaningfulDate = required(meaningfulDates[0]);
  documents.push(legacyDocument('old-empty-1', previousDate(firstMeaningfulDate), 0));
  documents.push(legacyDocument('old-empty-2', previousDate(previousDate(firstMeaningfulDate)), 0));
  for (const date of AUDITED_EMPTY_DATES) {
    documents.push(legacyDocument(`empty-${date}`, date, 0));
  }
  return documents;
}

interface LegacyDocument {
  id: string;
  data: {
    userId: string;
    groupKey: string;
    date: string;
    summary: LegacySummary;
    generation: number;
    generatedAt: string;
    modelId: string;
  };
}

function dryRunFixture(): DryRunFixture {
  const digests = auditedLegacyDocuments();
  const states = [legacyStateDocument('2026-07-03')];
  const binding = {
    projectId: 'private-project-sentinel',
    userId: 'private-user-sentinel',
    sourceAccountId: 'private-account-sentinel',
    generationId: 'private-generation-sentinel',
    chatId: 'private-chat-sentinel',
    groupDisplayName: 'private-group-name-sentinel',
    expectedLegacyDigestHash: hashLegacyDocuments(digests),
    expectedLegacyStateHash: hashArchiveDocuments(states),
  };
  const archive = {
    digests,
    states,
    locks: [] as ArchiveDocument[],
    backfills: [] as ArchiveDocument[],
  };
  const queryMessages = vi.fn(async (input: { date: string; cursor?: string }) => {
    const page = input.cursor === undefined ? 1 : 2;
    return {
      messages: [sourceMessage(input.date, page)],
      sourceRevision: `private-window-source-revision-${input.date}`,
      highWatermark: `private-watermark-${input.date}-${String(page)}`,
      nextCursor: page === 1 ? `private-cursor-${input.date}` : null,
    };
  });
  const ports = {
    archive: {
      readSnapshot: vi.fn(async () => archive),
    },
    source: {
      resolveBinding: vi.fn(async () => [validatedSource()]),
      getReadiness: vi.fn(async () => ({
        status: 'ready',
        observationVersion: 'safe-readiness-v1',
        observedAt: '2026-07-28T11:59:00.000Z',
      })),
      queryMessages,
    },
    migration: {
      inspectCandidate: vi.fn(async () => null),
      createShell: vi.fn(),
      restageCompensatedCandidate: vi.fn(),
      putCanonicalRunAndState: vi.fn(),
      markStaged: vi.fn(),
      activateAtomically: vi.fn(),
      compensateAtomically: vi.fn(),
    },
    effects: {
      countMigrationEffects: vi.fn(async () => ({
        outbox: 0,
        outboundMessages: 0,
        deliveryReceipts: 0,
      })),
    },
    aggregateDay: vi.fn(),
    publish: vi.fn(),
    visibility: {
      readPublic: vi.fn(async () => ({ definitions: [], runs: [] })),
      readFishing: vi.fn(async () => ({ definitions: [], runs: [] })),
    },
  };
  return { binding, archive, ports };
}

function applyFixture(): ApplyFixture {
  const fixture = dryRunFixture();
  const candidate: Candidate = { definition: null, activation: null, state: null, runs: [] };
  const mutable: ApplyFixture = {
    ...fixture,
    candidate,
    archiveWrites: 0,
    createdRunCount: 0,
    crashAfterActivation: false,
  };
  fixture.ports.migration.inspectCandidate.mockImplementation(async () =>
    candidate.definition === null ? null : candidate
  );
  fixture.ports.migration.createShell.mockImplementation(
    async (input: {
      definition: CandidateDefinition;
      activation: CandidateActivation;
      state: CandidateState;
    }) => {
      if (candidate.definition === null) {
        candidate.definition = structuredClone(input.definition);
        candidate.activation = structuredClone(input.activation);
        candidate.state = structuredClone(input.state);
        return { disposition: 'created' };
      }
      return { disposition: 'existing' };
    }
  );
  fixture.ports.migration.putCanonicalRunAndState.mockImplementation(
    async (input: {
      expectedPredecessorRunHash: string | null;
      run: CandidateRun;
      state: CandidateState;
    }) => {
      const existing = candidate.runs.find((run) => run.runId === input.run.runId);
      if (existing !== undefined) {
        if (existing.runHash !== input.run.runHash) throw new Error('candidate conflict');
        return { disposition: 'existing', run: existing };
      }
      if ((candidate.state?.precedingRunHash ?? null) !== input.expectedPredecessorRunHash) {
        throw new Error('predecessor conflict');
      }
      candidate.runs.push(structuredClone(input.run));
      candidate.state = structuredClone(input.state);
      mutable.createdRunCount += 1;
      return { disposition: 'created', run: input.run };
    }
  );
  fixture.ports.migration.restageCompensatedCandidate.mockImplementation(
    async (input: { expectedReplayHash: string; restagedAt: string; deliveryReceipts: number }) => {
      if (
        input.deliveryReceipts !== 0 ||
        candidate.definition?.status !== 'migrating' ||
        candidate.definition.activeMigrationId !== null ||
        candidate.activation?.status !== 'rollback_pending' ||
        candidate.activation.step !== 'compensated' ||
        candidate.activation.replayHash !== input.expectedReplayHash ||
        candidate.state?.pendingWindow !== null ||
        candidate.state?.precedingRunHash !== input.expectedReplayHash ||
        candidate.runs.some(
          (run) =>
            run.visibilityMigrationId !== 'mdm_release_abc123' || run.delivery.status !== 'not_sent'
        )
      ) {
        throw new Error('restage conflict');
      }
      candidate.activation = {
        ...candidate.activation,
        status: 'staging',
        step: 'restaged',
        replayHash: null,
        verificationHash: null,
        updatedAt: input.restagedAt,
      };
      return { disposition: 'restaged' };
    }
  );
  fixture.ports.migration.markStaged = vi.fn(
    async (input: { replayHash: string; safeCounts: Record<string, number> }) => {
      if (candidate.activation?.status !== 'staging') throw new Error('activation not staging');
      candidate.activation.status = 'staging';
      candidate.activation.step = 'staged';
      candidate.activation.replayHash = input.replayHash;
      candidate.activation.safeCounts = structuredClone(input.safeCounts);
    }
  );
  fixture.ports.migration.activateAtomically = vi.fn(
    async (input: {
      migrationId: string;
      replayHash: string;
      verificationHash: string;
      cutoverDeadline: string;
      nextRunAt: string;
      readiness: { observationVersion: string; observedAt: string };
    }) => {
      if (candidate.definition?.status === 'active') return { disposition: 'existing' };
      if (
        candidate.definition?.status !== 'migrating' ||
        candidate.activation?.status !== 'staging' ||
        candidate.activation?.replayHash !== input.replayHash
      ) {
        throw new Error('activation conflict');
      }
      candidate.runs = candidate.runs.map((run) => ({
        ...run,
        visibilityMigrationId: null,
      }));
      candidate.definition = {
        ...candidate.definition,
        status: 'active',
        listStatus: 'active',
        activeMigrationId: input.migrationId,
        checkpointAt: candidate.state?.checkpointAt,
        nextRunAt: input.nextRunAt,
        hasRuns: true,
        lastRunAt: candidate.runs.at(-1)?.completedAt,
        delivery: {
          type: 'whatsapp_primary',
          readinessObservationVersion: input.readiness.observationVersion,
          readinessObservedAt: input.readiness.observedAt,
        },
      };
      candidate.activation = {
        ...candidate.activation,
        status: 'active',
        step: 'active',
        cutoverDeadline: input.cutoverDeadline,
        verificationHash: input.verificationHash,
      };
      if (mutable.crashAfterActivation) throw new Error('synthetic lost reply');
      return { disposition: 'activated' };
    }
  );
  fixture.ports.migration.compensateAtomically = vi.fn(async () => {
    if (candidate.activation?.status === 'rollback_pending') {
      return { disposition: 'existing' };
    }
    candidate.runs = candidate.runs.map((run) => ({
      ...run,
      visibilityMigrationId: 'mdm_release_abc123',
    }));
    candidate.definition = {
      ...candidate.definition,
      status: 'migrating',
      listStatus: 'paused',
      activeMigrationId: null,
    };
    candidate.activation = {
      ...candidate.activation,
      status: 'rollback_pending',
      step: 'compensated',
    };
    return { disposition: 'compensated' };
  });
  fixture.ports.aggregateDay.mockImplementation(async (input: { date: string }) =>
    aggregateResult(input.date)
  );
  const visibleProjection = async (): Promise<{
    definitions: CandidateDefinition[];
    runs: CandidateRun[];
  }> =>
    candidate.definition?.status === 'active' &&
    candidate.activation?.status === 'active' &&
    candidate.runs.every((run) => run.visibilityMigrationId === null)
      ? { definitions: [candidate.definition], runs: candidate.runs }
      : { definitions: [], runs: [] };
  fixture.ports.visibility.readPublic.mockImplementation(visibleProjection);
  fixture.ports.visibility.readFishing.mockImplementation(visibleProjection);
  return mutable;
}

function aggregateResult(date: string): AggregateResult {
  return {
    headline: `Synthetic replay headline ${date}`,
    summaryMarkdown: `Synthetic replay summary ${date}`,
    evidenceMessageRefs: ['1'.repeat(64), '2'.repeat(64)],
    continuityMemoryMarkdown: `Synthetic continuity ${date}`,
    promptVersion: 'message-digest-aggregate@2.1.0',
    model: 'synthetic-replay-model',
    usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125, costUsd: 0.001 },
  };
}

async function runApply(
  fixture: ApplyFixture
): Promise<Awaited<ReturnType<typeof runFishingMigrationApply>>> {
  return await runFishingMigrationApply(
    {
      migrationId: 'mdm_release_abc123',
      binding: fixture.binding,
      now: '2026-07-28T12:00:00.000Z',
    },
    fixture.ports
  );
}

async function runVerify(
  fixture: ApplyFixture
): Promise<Awaited<ReturnType<typeof runFishingMigrationVerify>>> {
  return await runFishingMigrationVerify(
    {
      migrationId: 'mdm_release_abc123',
      binding: fixture.binding,
      now: '2026-07-28T12:00:00.000Z',
    },
    fixture.ports
  );
}

async function runActivate(
  fixture: ApplyFixture
): Promise<Awaited<ReturnType<typeof runFishingMigrationActivate>>> {
  return await runFishingMigrationActivate(
    {
      migrationId: 'mdm_release_abc123',
      binding: fixture.binding,
      now: '2026-07-28T12:00:00.000Z',
      cutoverDeadline: '2026-07-28T13:30:00.000Z',
    },
    fixture.ports
  );
}

async function runCompensate(
  fixture: ApplyFixture
): Promise<Awaited<ReturnType<typeof runFishingMigrationCompensate>>> {
  return await runFishingMigrationCompensate(
    {
      migrationId: 'mdm_release_abc123',
      binding: fixture.binding,
      now: '2026-07-28T12:05:00.000Z',
    },
    fixture.ports
  );
}

function validatedSource(overrides: Record<string, unknown> = {}): ValidatedSource {
  return {
    sourceAccountId: 'private-account-sentinel',
    generationId: 'private-generation-sentinel',
    chatId: 'private-chat-sentinel',
    chatType: 'group',
    displayName: 'private-group-name-sentinel',
    messageCount: 1_000,
    participantCount: 40,
    lastActivityAt: '2026-07-28T11:00:00.000Z',
    sourceRevision: 'private-source-revision-sentinel',
    ...overrides,
  };
}

function sourceMessage(date: string, sequence: number): SourceMessage {
  return {
    messageRef: sequence === 1 ? '1'.repeat(64) : '2'.repeat(64),
    eventTimestamp: `${date}T12:0${String(sequence)}:00.000Z`,
    direction: 'inbound',
    authorLabel: `private-author-${String(sequence)}`,
    text: `private-message-${date}-${String(sequence)}`,
    contentKind: 'text',
  };
}

function legacyStateDocument(date: string): LegacyStateDocument {
  return {
    id: `private-state-${date}`,
    data: {
      userId: 'private-user-sentinel',
      groupKey: FISHING_GROUP_KEY,
      date,
      state: {
        userId: 'private-user-sentinel',
        groupKey: FISHING_GROUP_KEY,
        updatedAt: `${date}T03:06:00.000Z`,
        identityLedger: [],
        moderatorEvents: [],
        openThreads: [],
        recentSummaryDates: [date],
      },
    },
  };
}

async function runDryRun(
  fixture: DryRunFixture
): Promise<Awaited<ReturnType<typeof runFishingMigrationDryRun>>> {
  return await runFishingMigrationDryRun(
    {
      migrationId: 'mdm_release_abc123',
      binding: fixture.binding,
      now: '2026-07-28T12:00:00.000Z',
    },
    fixture.ports
  );
}

function protectedSentinels(fixture: DryRunFixture): string[] {
  return [
    fixture.binding.projectId,
    fixture.binding.userId,
    fixture.binding.sourceAccountId,
    fixture.binding.generationId,
    fixture.binding.chatId,
    fixture.binding.groupDisplayName,
    'private-source-revision-sentinel',
    'private-message-2026-07-04-1',
    'private-author-1',
    'private-watermark-2026-07-04-1',
  ];
}

function legacyDocument(id: string, date: string, messageCount: number): LegacyDocument {
  return {
    id,
    data: {
      userId: 'private-user-sentinel',
      groupKey: FISHING_GROUP_KEY,
      date,
      summary: messageCount > 0 ? meaningfulSummary(date, messageCount) : emptySummary(date),
      generation: 1,
      generatedAt: `${date}T03:05:00.000Z`,
      modelId: 'synthetic-model',
    },
  };
}

function meaningfulSummary(date: string, messageCount: number): LegacySummary {
  return {
    date,
    groupKey: FISHING_GROUP_KEY,
    messageCount,
    headline: `Synthetic headline ${date}`,
    bullets: ['One', 'Two', 'Three'],
    threads: [],
    moderatorPosts: [],
    openQuestions: [],
    activityOutliers: [],
  };
}

function emptySummary(date: string): ReturnType<typeof meaningfulSummary> {
  return {
    ...meaningfulSummary(date, 0),
    headline: `No activity ${date}`,
  };
}

function datesEndingAt(endDate: string, count: number): string[] {
  const dates: string[] = [];
  let current = endDate;
  for (let index = 0; index < count; index += 1) {
    dates.push(current);
    current = previousDate(current);
  }
  return dates.reverse();
}

function previousDate(date: string): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() - 1);
  return instant.toISOString().slice(0, 10);
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing synthetic fixture value');
  return value;
}
