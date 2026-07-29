import { createHash } from 'node:crypto';

export const FISHING_GROUP_KEY = 'grupa-wedkarska-skool';
export const FISHING_TIME_ZONE = 'Europe/Warsaw';
export const FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS =
  'Write the digest in Polish. Create one concrete headline and 3–7 concise, high-signal facts from this window. Track active topics and participants, decisions and outcomes, moderator posts, open questions, unusual activity, participant identity/context, moderator events, and open threads. Carry forward only information needed for continuity, keep stable topic identifiers, and remove an open thread only when messages clearly close it. Historical state and the previous three summaries are context only: do not present an old fact as if it happened in this window. Preserve names as written and never invent information.';
export const LAST_MEANINGFUL_LEGACY_DATE = '2026-07-03';
export const INITIAL_REPLAY_START_DATE = '2026-07-04';
export const AUDIT_CUTOFF_DATE = '2026-07-26';
export const AUDITED_LEGACY_DOCUMENT_COUNT = 139;
export const AUDITED_MEANINGFUL_DOCUMENT_COUNT = 119;
export const AUDITED_MISSING_DATES = Object.freeze([
  '2026-07-13',
  '2026-07-14',
  '2026-07-15',
  '2026-07-16',
  '2026-07-17',
]);
export const AUDITED_EMPTY_DATES = Object.freeze([
  '2026-07-04',
  '2026-07-05',
  '2026-07-06',
  '2026-07-07',
  '2026-07-08',
  '2026-07-09',
  '2026-07-10',
  '2026-07-11',
  '2026-07-12',
  '2026-07-18',
  '2026-07-19',
  '2026-07-20',
  '2026-07-21',
  '2026-07-22',
  '2026-07-23',
  '2026-07-24',
  '2026-07-25',
  '2026-07-26',
]);

const MIGRATION_ID_PATTERN = /^mdm_[A-Za-z0-9_-]{3,160}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MODE_FLAGS = new Map([
  ['--dry-run', 'dry-run'],
  ['--apply', 'apply'],
  ['--verify', 'verify'],
  ['--activate', 'activate'],
  ['--compensate', 'compensate'],
]);
const PROTECTED_BINDING_FIELDS = [
  ['INTEXURAOS_GCP_PROJECT_ID', 'projectId'],
  ['INTEXURAOS_MESSAGE_DIGEST_MIGRATION_USER_ID', 'userId'],
  ['INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_ACCOUNT_ID', 'sourceAccountId'],
  ['INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_GENERATION_ID', 'generationId'],
  ['INTEXURAOS_MESSAGE_DIGEST_MIGRATION_CHAT_ID', 'chatId'],
  ['INTEXURAOS_MESSAGE_DIGEST_MIGRATION_GROUP_NAME', 'groupDisplayName'],
  ['INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_DIGEST_HASH', 'expectedLegacyDigestHash'],
  ['INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_STATE_HASH', 'expectedLegacyStateHash'],
];

export class MigrationContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MigrationContractError';
    this.code = code;
  }
}

export function parseFishingMigrationArgs(argv) {
  if (!Array.isArray(argv)) throw contractError('MIGRATION_ARGUMENTS_INVALID');
  const modes = [];
  let migrationId = null;
  let cutoverDeadline = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const mode = MODE_FLAGS.get(argument);
    if (mode !== undefined) {
      modes.push(mode);
      continue;
    }
    if (argument === '--migration-id') {
      if (migrationId !== null || argv[index + 1] === undefined) {
        throw contractError('MIGRATION_ARGUMENTS_INVALID');
      }
      migrationId = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--cutover-deadline') {
      if (cutoverDeadline !== null || argv[index + 1] === undefined) {
        throw contractError('MIGRATION_ARGUMENTS_INVALID');
      }
      cutoverDeadline = normalizeInstant(argv[index + 1]);
      index += 1;
      continue;
    }
    throw contractError('MIGRATION_ARGUMENTS_INVALID');
  }

  if (
    modes.length !== 1 ||
    migrationId === null ||
    !MIGRATION_ID_PATTERN.test(migrationId) ||
    (modes[0] === 'activate') !== (cutoverDeadline !== null)
  ) {
    throw contractError('MIGRATION_ARGUMENTS_INVALID');
  }
  return { mode: modes[0], migrationId, cutoverDeadline };
}

export function readProtectedFishingBinding(environment) {
  if (!isRecord(environment)) throw contractError('MIGRATION_BINDING_INVALID');
  const binding = {};
  for (const [environmentName, propertyName] of PROTECTED_BINDING_FIELDS) {
    const raw = environment[environmentName];
    if (typeof raw !== 'string' || raw.trim() === '' || raw.trim().length > 4_096) {
      throw contractError('MIGRATION_BINDING_INVALID');
    }
    binding[propertyName] = raw.trim();
  }
  if (
    !SHA256_PATTERN.test(binding.expectedLegacyDigestHash) ||
    !SHA256_PATTERN.test(binding.expectedLegacyStateHash) ||
    binding.userId.length > 256 ||
    binding.sourceAccountId.length > 512 ||
    binding.generationId.length > 512 ||
    binding.chatId.length > 4_096 ||
    binding.groupDisplayName.length > 512
  ) {
    throw contractError('MIGRATION_BINDING_INVALID');
  }
  return binding;
}

export function hashLegacyDocuments(documents) {
  if (!Array.isArray(documents)) throw contractError('LEGACY_BASELINE_INVALID');
  const normalized = documents
    .map((document) => normalizeLegacyDocumentForHash(document))
    .sort((left, right) => left.id.localeCompare(right.id));
  return sha256(stableSerialize(normalized));
}

export function hashArchiveDocuments(documents) {
  if (!Array.isArray(documents)) throw contractError('LEGACY_ARCHIVE_INVALID');
  const normalized = documents
    .map((document) => {
      if (!isRecord(document) || typeof document.id !== 'string' || !isRecord(document.data)) {
        throw contractError('LEGACY_ARCHIVE_INVALID');
      }
      return { id: document.id, data: document.data };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return sha256(stableSerialize(normalized));
}

export function analyzeLegacyBaseline(input) {
  if (
    !isRecord(input) ||
    !Array.isArray(input.documents) ||
    typeof input.expectedHash !== 'string' ||
    !SHA256_PATTERN.test(input.expectedHash)
  ) {
    throw contractError('LEGACY_BASELINE_INVALID');
  }

  const parsed = input.documents.map((document) => parseLegacyDocument(document));
  const audited = parsed.filter((document) => document.data.date <= AUDIT_CUTOFF_DATE);
  const postAudit = parsed.filter((document) => document.data.date > AUDIT_CUTOFF_DATE);
  const digestHash = hashLegacyDocuments(audited);
  const meaningful = audited.filter((document) => isMeaningfulLegacyDigest(document.data));
  const empty = audited.filter((document) => !isMeaningfulLegacyDigest(document.data));
  const lastMeaningfulDate = meaningful
    .map((document) => document.data.date)
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
  const documentsByDate = groupLegacyDocumentsByDate(audited);

  const actualEmptyRepairDates = [];
  const actualMissingRepairDates = [];
  for (const date of enumerateLocalDates(INITIAL_REPLAY_START_DATE, AUDIT_CUTOFF_DATE)) {
    const candidates = documentsByDate.get(date) ?? [];
    if (candidates.length === 0) {
      actualMissingRepairDates.push(date);
    } else if (candidates.every((candidate) => !isMeaningfulLegacyDigest(candidate.data))) {
      actualEmptyRepairDates.push(date);
    } else {
      throw contractError('LEGACY_BASELINE_CHANGED');
    }
  }

  if (
    audited.length !== AUDITED_LEGACY_DOCUMENT_COUNT ||
    meaningful.length !== AUDITED_MEANINGFUL_DOCUMENT_COUNT ||
    lastMeaningfulDate !== LAST_MEANINGFUL_LEGACY_DATE ||
    digestHash !== input.expectedHash ||
    !sameStrings(actualEmptyRepairDates, AUDITED_EMPTY_DATES) ||
    !sameStrings(actualMissingRepairDates, AUDITED_MISSING_DATES)
  ) {
    throw contractError('LEGACY_BASELINE_CHANGED');
  }

  const imported = selectLatestMeaningfulPerDate(meaningful).filter(
    (document) => document.data.date <= LAST_MEANINGFUL_LEGACY_DATE
  );
  if (imported.length !== AUDITED_MEANINGFUL_DOCUMENT_COUNT) {
    throw contractError('LEGACY_BASELINE_CHANGED');
  }

  return {
    auditedDocumentCount: audited.length,
    auditedMeaningfulCount: meaningful.length,
    auditedEmptyCount: empty.length,
    postAuditDocumentCount: postAudit.length,
    lastMeaningfulDate,
    digestHash,
    postAuditHash: hashLegacyDocuments(postAudit),
    initialRepair: {
      emptyDates: actualEmptyRepairDates,
      missingDates: actualMissingRepairDates,
    },
    imported,
  };
}

export function buildFishingMigrationPlan(instant) {
  const normalized = normalizeInstant(instant);
  if (normalized === null) throw contractError('MIGRATION_DATE_INVALID');
  const cutoverDate = localDateAt(Date.parse(normalized), FISHING_TIME_ZONE);
  const replayEndDate = previousLocalDate(cutoverDate);
  if (replayEndDate < AUDIT_CUTOFF_DATE) throw contractError('MIGRATION_DATE_INVALID');
  const replayDates = enumerateLocalDates(INITIAL_REPLAY_START_DATE, replayEndDate);
  return {
    cutoverDate,
    replayStartDate: INITIAL_REPLAY_START_DATE,
    replayEndDate,
    replayEndExclusive: warsawDayWindow(cutoverDate).windowStart,
    replayDates,
    repairDates: enumerateLocalDates(INITIAL_REPLAY_START_DATE, AUDIT_CUTOFF_DATE),
  };
}

export function warsawDayWindow(date) {
  const parsed = parseLocalDate(date);
  if (parsed === null) throw contractError('MIGRATION_DATE_INVALID');
  const next = addLocalDays(parsed, 1);
  const startMs = resolveLocalMidnight(parsed, FISHING_TIME_ZONE);
  const endMs = resolveLocalMidnight(next, FISHING_TIME_ZONE);
  return {
    date,
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
    durationHours: (endMs - startMs) / (60 * 60 * 1_000),
  };
}

export function deterministicDefinitionId(migrationId) {
  assertMigrationId(migrationId);
  return `md_${framedDigest(['fishing-message-digest-definition-v1', migrationId]).slice(0, 40)}`;
}

export function deterministicRunId(migrationId, date, kind) {
  assertMigrationId(migrationId);
  if (parseLocalDate(date) === null || (kind !== 'legacy' && kind !== 'replay')) {
    throw contractError('MIGRATION_IDENTITY_INVALID');
  }
  return `mdr_${framedDigest(['fishing-message-digest-run-v1', migrationId, date, kind]).slice(
    0,
    40
  )}`;
}

export function appendCanonicalChain(predecessorRunHash, candidate) {
  if (
    (predecessorRunHash !== null && !SHA256_PATTERN.test(predecessorRunHash)) ||
    !isRecord(candidate) ||
    typeof candidate.runId !== 'string' ||
    candidate.runId.trim() === '' ||
    parseLocalDate(candidate.date) === null ||
    typeof candidate.candidateHash !== 'string' ||
    !SHA256_PATTERN.test(candidate.candidateHash)
  ) {
    throw contractError('MIGRATION_CHAIN_INVALID');
  }
  return {
    predecessorRunHash,
    runHash: framedDigest([
      'fishing-message-digest-chain-v1',
      predecessorRunHash ?? '',
      candidate.runId,
      candidate.date,
      candidate.candidateHash,
    ]),
  };
}

export function buildSafeMigrationReport(input) {
  if (!isRecord(input)) throw contractError('MIGRATION_REPORT_INVALID');
  return {
    mode: input.mode,
    migrationId: input.migrationId,
    status: input.status,
    cutoverDate: input.cutoverDate,
    replayStartDate: input.replayStartDate,
    replayEndDate: input.replayEndDate,
    counts: { ...input.counts },
    hashes: { ...input.hashes },
  };
}

export async function runFishingMigrationDryRun(input, ports) {
  try {
    const binding = validateProtectedBinding(input?.binding);
    const migrationId = input?.migrationId;
    assertMigrationId(migrationId);
    const now = normalizeInstant(input?.now);
    if (now === null) throw contractError('MIGRATION_DATE_INVALID');
    const plan = buildFishingMigrationPlan(now);
    assertDryRunPorts(ports);

    const archive = await ports.archive.readSnapshot({
      userId: binding.userId,
      groupKey: FISHING_GROUP_KEY,
    });
    const normalizedArchive = validateLegacyArchive(archive, binding, now);
    const baseline = analyzeLegacyBaseline({
      documents: normalizedArchive.digests,
      expectedHash: binding.expectedLegacyDigestHash,
    });
    const stateHash = hashArchiveDocuments(normalizedArchive.states);
    if (stateHash !== binding.expectedLegacyStateHash) {
      throw contractError('LEGACY_STATE_BASELINE_CHANGED');
    }
    validateLegacyStateCheckpoint(normalizedArchive.states, binding);

    const definitionId = deterministicDefinitionId(migrationId);
    const candidate = await ports.migration.inspectCandidate({ migrationId, definitionId });
    if (!isCompatibleCandidate(candidate, migrationId, definitionId)) {
      throw contractError('MIGRATION_CANDIDATE_CONFLICT');
    }

    const sourceMatches = await ports.source.resolveBinding({
      userId: binding.userId,
      sourceAccountId: binding.sourceAccountId,
      generationId: binding.generationId,
      chatId: binding.chatId,
      groupDisplayName: binding.groupDisplayName,
    });
    if (!Array.isArray(sourceMatches) || sourceMatches.length !== 1) {
      throw contractError('SOURCE_BINDING_NOT_UNIQUE');
    }
    const source = validateResolvedSource(sourceMatches[0], binding);
    const readiness = await ports.source.getReadiness({ userId: binding.userId });
    if (!isReadyObservation(readiness)) throw contractError('DELIVERY_NOT_READY');

    const effects = validateEffectCounts(
      await ports.effects.countMigrationEffects({
        userId: binding.userId,
        migrationId,
        definitionId,
      })
    );
    const outboundEffects = effects.outbox + effects.outboundMessages + effects.deliveryReceipts;
    if (outboundEffects !== 0) throw contractError('MIGRATION_OUTBOUND_EFFECT_PRESENT');

    const sourceWindows = [];
    for (const date of plan.replayDates) {
      sourceWindows.push(
        await readSourceWindow({ date, binding, source, queryMessages: ports.source.queryMessages })
      );
    }
    const sourceMessages = sourceWindows.reduce(
      (total, window) => total + window.eligibleMessageCount,
      0
    );
    const visibleReplayRuns = sourceWindows.filter(
      (window) => window.eligibleMessageCount > 0
    ).length;
    const sourcePlanHash = sha256(
      stableSerialize(
        sourceWindows.map((window) => ({
          date: window.date,
          eligibleMessageCount: window.eligibleMessageCount,
          watermarkHash: window.watermarkHash,
          candidateHash: window.candidateHash,
        }))
      )
    );
    const report = buildSafeMigrationReport({
      mode: 'dry-run',
      migrationId,
      status: 'ready',
      cutoverDate: plan.cutoverDate,
      replayStartDate: plan.replayStartDate,
      replayEndDate: plan.replayEndDate,
      counts: {
        auditedLegacyDocuments: baseline.auditedDocumentCount,
        meaningfulLegacyDocuments: baseline.auditedMeaningfulCount,
        postAuditDocuments: baseline.postAuditDocumentCount,
        replayDates: plan.replayDates.length,
        visibleReplayRuns,
        sourceMessages,
        outboundEffects,
      },
      hashes: {
        baseline: baseline.digestHash,
        legacyStates: stateHash,
        postAudit: baseline.postAuditHash,
        sourcePlan: sourcePlanHash,
      },
    });
    return {
      report,
      preflight: {
        migrationId,
        definitionId,
        now,
        binding,
        plan,
        baseline,
        legacyStates: normalizedArchive.states,
        source,
        readiness,
        effects,
        candidate,
        sourceWindows,
        sourcePlanHash,
      },
    };
  } catch (error) {
    if (error instanceof MigrationContractError) throw error;
    throw contractError('MIGRATION_PREFLIGHT_FAILED');
  }
}

export async function runFishingMigrationApply(input, ports) {
  try {
    if (
      !isRecord(ports) ||
      !isRecord(ports.migration) ||
      typeof ports.migration.createShell !== 'function' ||
      typeof ports.migration.restageCompensatedCandidate !== 'function' ||
      typeof ports.migration.putCanonicalRunAndState !== 'function' ||
      typeof ports.migration.markStaged !== 'function' ||
      typeof ports.aggregateDay !== 'function'
    ) {
      throw contractError('MIGRATION_PORTS_INVALID');
    }
    const dryRun = await runFishingMigrationDryRun(input, ports);
    const preflight = dryRun.preflight;
    const shell = buildMigrationShell(preflight);
    await ports.migration.createShell(shell);

    let inspected = await ports.migration.inspectCandidate({
      migrationId: preflight.migrationId,
      definitionId: preflight.definitionId,
    });
    if (!isCompatibleCandidate(inspected, preflight.migrationId, preflight.definitionId)) {
      throw contractError('MIGRATION_CANDIDATE_CONFLICT');
    }
    if (inspected?.activation?.status === 'rollback_pending') {
      if (
        inspected.activation.step !== 'compensated' ||
        typeof inspected.activation.replayHash !== 'string' ||
        !SHA256_PATTERN.test(inspected.activation.replayHash)
      ) {
        throw contractError('MIGRATION_CANDIDATE_CONFLICT');
      }
      const restaged = await ports.migration.restageCompensatedCandidate({
        migrationId: preflight.migrationId,
        definitionId: preflight.definitionId,
        shell,
        expectedReplayHash: inspected.activation.replayHash,
        deliveryReceipts: preflight.effects.deliveryReceipts,
        restagedAt: preflight.now,
      });
      if (!isRecord(restaged) || !['restaged', 'existing'].includes(restaged.disposition)) {
        throw contractError('MIGRATION_CANDIDATE_CONFLICT');
      }
      inspected = await ports.migration.inspectCandidate({
        migrationId: preflight.migrationId,
        definitionId: preflight.definitionId,
      });
      if (!isCompatibleCandidate(inspected, preflight.migrationId, preflight.definitionId)) {
        throw contractError('MIGRATION_CANDIDATE_CONFLICT');
      }
    }
    const existingRuns = inspected?.runs ?? [];
    const existingByDate = new Map();
    for (const run of existingRuns) {
      if (
        !isRecord(run) ||
        typeof run.migrationDate !== 'string' ||
        existingByDate.has(run.migrationDate)
      ) {
        throw contractError('MIGRATION_CANDIDATE_CONFLICT');
      }
      existingByDate.set(run.migrationDate, run);
    }

    const artifacts = [
      ...preflight.baseline.imported.map((document) => ({
        kind: 'legacy',
        date: document.data.date,
        document,
      })),
      ...preflight.sourceWindows.map((window) => ({ kind: 'replay', date: window.date, window })),
    ].sort((left, right) => left.date.localeCompare(right.date));
    if (new Set(artifacts.map((artifact) => artifact.date)).size !== artifacts.length) {
      throw contractError('MIGRATION_CANDIDATE_CONFLICT');
    }

    let state = inspected?.state ?? shell.state;
    let predecessorRunHash = null;
    let encounteredMissing = false;
    const previousSummaries = [];
    let importedRuns = 0;
    let replayRuns = 0;
    let visibleReplayRuns = 0;
    let createdRuns = 0;
    let reusedRuns = 0;

    for (const artifact of artifacts) {
      const existing = existingByDate.get(artifact.date);
      let persistedRun;
      if (existing !== undefined) {
        if (encounteredMissing) throw contractError('MIGRATION_CANDIDATE_CONFLICT');
        validateExistingMigrationRun(existing, {
          migrationId: preflight.migrationId,
          definitionId: preflight.definitionId,
          artifact,
          predecessorRunHash,
        });
        predecessorRunHash = existing.runHash;
        pushPreviousSummary(previousSummaries, existing);
        persistedRun = existing;
        reusedRuns += 1;
      } else {
        encounteredMissing = true;
        if ((state.precedingRunHash ?? null) !== predecessorRunHash) {
          throw contractError('MIGRATION_CHAIN_INVALID');
        }
        const run =
          artifact.kind === 'legacy'
            ? buildImportedLegacyRun(preflight, artifact, predecessorRunHash)
            : await buildReplayedRun(
                preflight,
                artifact,
                predecessorRunHash,
                state,
                previousSummaries,
                ports.aggregateDay
              );
        const nextState = buildNextMigrationState(state, run);
        const result = await ports.migration.putCanonicalRunAndState({
          migrationId: preflight.migrationId,
          definitionId: preflight.definitionId,
          expectedPredecessorRunHash: predecessorRunHash,
          run,
          state: nextState,
        });
        if (!isRecord(result) || !['created', 'existing'].includes(result.disposition)) {
          throw contractError('MIGRATION_WRITE_FAILED');
        }
        state = nextState;
        predecessorRunHash = run.runHash;
        pushPreviousSummary(previousSummaries, run);
        persistedRun = run;
        if (result.disposition === 'created') createdRuns += 1;
        else reusedRuns += 1;
      }
      if (artifact.kind === 'legacy') importedRuns += 1;
      else {
        replayRuns += 1;
        if (isFishingVisibleReplayRun(persistedRun)) visibleReplayRuns += 1;
      }
    }

    if (
      existingRuns.length > artifacts.length ||
      predecessorRunHash === null ||
      state.checkpointAt !== preflight.plan.replayEndExclusive
    ) {
      throw contractError('MIGRATION_CHAIN_INVALID');
    }
    const safeCounts = {
      importedRuns,
      replayRuns,
      visibleReplayRuns,
      canonicalRuns: artifacts.length,
      sourceMessages: preflight.sourceWindows.reduce(
        (total, window) => total + window.eligibleMessageCount,
        0
      ),
    };
    await ports.migration.markStaged({
      migrationId: preflight.migrationId,
      definitionId: preflight.definitionId,
      replayHash: predecessorRunHash,
      safeCounts,
      finalState: state,
    });

    const effects = validateEffectCounts(
      await ports.effects.countMigrationEffects({
        userId: preflight.binding.userId,
        migrationId: preflight.migrationId,
        definitionId: preflight.definitionId,
      })
    );
    const outboundEffects = effects.outbox + effects.outboundMessages + effects.deliveryReceipts;
    if (outboundEffects !== 0) throw contractError('MIGRATION_OUTBOUND_EFFECT_PRESENT');

    return {
      report: buildSafeMigrationReport({
        mode: 'apply',
        migrationId: preflight.migrationId,
        status: 'staged',
        cutoverDate: preflight.plan.cutoverDate,
        replayStartDate: preflight.plan.replayStartDate,
        replayEndDate: preflight.plan.replayEndDate,
        counts: {
          ...safeCounts,
          createdRuns,
          reusedRuns,
          outboundEffects,
        },
        hashes: {
          baseline: preflight.baseline.digestHash,
          sourcePlan: preflight.sourcePlanHash,
          replay: predecessorRunHash,
        },
      }),
      migrationId: preflight.migrationId,
      definitionId: preflight.definitionId,
      replayHash: predecessorRunHash,
    };
  } catch (error) {
    if (error instanceof MigrationContractError) throw error;
    throw contractError('MIGRATION_APPLY_FAILED');
  }
}

export async function runFishingMigrationVerify(input, ports) {
  try {
    if (
      !isRecord(ports) ||
      !isRecord(ports.visibility) ||
      typeof ports.visibility.readPublic !== 'function' ||
      typeof ports.visibility.readFishing !== 'function'
    ) {
      throw contractError('MIGRATION_PORTS_INVALID');
    }
    const dryRun = await runFishingMigrationDryRun(input, ports);
    const preflight = dryRun.preflight;
    const candidate = preflight.candidate;
    if (
      !isRecord(candidate) ||
      !isRecord(candidate.definition) ||
      !isRecord(candidate.activation) ||
      !isRecord(candidate.state) ||
      !Array.isArray(candidate.runs)
    ) {
      throw contractError('MIGRATION_CHAIN_INCOMPLETE');
    }
    const candidateIsActive =
      candidate.definition.status === 'active' &&
      candidate.definition.activeMigrationId === preflight.migrationId &&
      candidate.activation.status === 'active';
    const candidateIsStaging =
      candidate.definition.status === 'migrating' &&
      candidate.definition.activeMigrationId === null &&
      candidate.activation.status === 'staging';
    if (
      (!candidateIsActive && !candidateIsStaging) ||
      candidate.activation.baselineHash !== preflight.baseline.digestHash
    ) {
      throw contractError('MIGRATION_CANDIDATE_CONFLICT');
    }

    const artifacts = [
      ...preflight.baseline.imported.map((document) => ({
        kind: 'legacy',
        date: document.data.date,
        document,
      })),
      ...preflight.sourceWindows.map((window) => ({ kind: 'replay', date: window.date, window })),
    ].sort((left, right) => left.date.localeCompare(right.date));
    if (candidate.runs.length < artifacts.length) {
      throw contractError('MIGRATION_CHAIN_INCOMPLETE');
    }
    if (candidate.runs.length > artifacts.length) {
      throw contractError('MIGRATION_CANONICAL_CONFLICT');
    }
    const runsByDate = new Map();
    for (const run of candidate.runs) {
      if (
        !isRecord(run) ||
        typeof run.migrationDate !== 'string' ||
        runsByDate.has(run.migrationDate) ||
        run.recordRole !== 'canonical' ||
        run.visibilityMigrationId !== (candidateIsActive ? null : preflight.migrationId) ||
        run.deliveryMode !== 'silent' ||
        run.delivery?.status !== 'not_sent'
      ) {
        throw contractError('MIGRATION_CANONICAL_CONFLICT');
      }
      runsByDate.set(run.migrationDate, run);
    }

    let predecessorRunHash = null;
    let importedRuns = 0;
    let replayRuns = 0;
    let visibleReplayRuns = 0;
    for (const artifact of artifacts) {
      const run = runsByDate.get(artifact.date);
      if (run === undefined) throw contractError('MIGRATION_CHAIN_INCOMPLETE');
      const expectedRunId = deterministicRunId(preflight.migrationId, artifact.date, artifact.kind);
      if (
        run.runId !== expectedRunId ||
        run.definitionId !== preflight.definitionId ||
        run.userId !== preflight.binding.userId ||
        run.migrationDate !== artifact.date
      ) {
        throw contractError('MIGRATION_CANONICAL_CONFLICT');
      }

      if (artifact.kind === 'legacy') {
        importedRuns += 1;
        const expected = buildImportedLegacyRun(preflight, artifact, predecessorRunHash);
        if (
          run.provenance !== 'legacy_mobile_notification' ||
          run.candidateHash !== expected.candidateHash ||
          run.effectiveMessageCount !== expected.effectiveMessageCount ||
          run.headline !== expected.headline ||
          run.summaryMarkdown !== expected.summaryMarkdown ||
          run.model !== expected.model ||
          run.completedAt !== expected.completedAt ||
          run.sourceWatermarkHash !== null ||
          run.sourceCandidateHash !== null
        ) {
          throw contractError('MIGRATION_LEGACY_PROOF_MISMATCH');
        }
      } else {
        replayRuns += 1;
        if (isFishingVisibleReplayRun(run)) visibleReplayRuns += 1;
        if (
          run.provenance !== 'private_whatsapp_replay' ||
          run.sourceCandidateHash !== artifact.window.candidateHash ||
          run.sourceWatermarkHash !== artifact.window.watermarkHash ||
          run.effectiveMessageCount !== artifact.window.eligibleMessageCount
        ) {
          throw contractError('MIGRATION_SOURCE_PROOF_MISMATCH');
        }
        const aggregate =
          run.generationStatus === 'skipped_no_activity'
            ? null
            : {
                headline: run.headline,
                summaryMarkdown: run.summaryMarkdown,
                evidenceMessageRefs: run.evidenceMessageRefs,
                continuityMemoryMarkdown: run.continuityMemoryMarkdown,
                promptVersion: run.promptVersion,
                model: run.model,
                usage: run.usage,
              };
        const expectedCandidateHash = sha256(
          stableSerialize({
            provenance: 'private_whatsapp_replay',
            date: artifact.date,
            sourceCandidateHash: artifact.window.candidateHash,
            sourceWatermarkHash: artifact.window.watermarkHash,
            aggregate,
          })
        );
        if (run.candidateHash !== expectedCandidateHash) {
          throw contractError('MIGRATION_SOURCE_PROOF_MISMATCH');
        }
      }

      const expectedChain = appendCanonicalChain(predecessorRunHash, {
        runId: run.runId,
        date: artifact.date,
        candidateHash: run.candidateHash,
      });
      if (
        run.predecessorRunHash !== expectedChain.predecessorRunHash ||
        run.runHash !== expectedChain.runHash
      ) {
        throw contractError('MIGRATION_CHAIN_BROKEN');
      }
      predecessorRunHash = run.runHash;
    }

    const lastArtifact = artifacts.at(-1);
    const lastRun = lastArtifact === undefined ? undefined : runsByDate.get(lastArtifact.date);
    if (
      predecessorRunHash === null ||
      candidate.state.checkpointAt !== preflight.plan.replayEndExclusive ||
      candidate.state.precedingRunId !== lastRun?.runId ||
      candidate.state.precedingRunHash !== predecessorRunHash ||
      candidate.state.pendingWindow !== null ||
      candidate.activation.replayHash !== predecessorRunHash
    ) {
      throw contractError('MIGRATION_CHAIN_BROKEN');
    }

    const [publicProjection, fishingProjection] = await Promise.all([
      ports.visibility.readPublic({
        userId: preflight.binding.userId,
        definitionId: preflight.definitionId,
      }),
      ports.visibility.readFishing({
        userId: preflight.binding.userId,
        legacyGroupKey: FISHING_GROUP_KEY,
      }),
    ]);
    const publicCounts = projectionCounts(publicProjection);
    const fishingCounts = projectionCounts(fishingProjection);
    const expectedVisibleDefinitions = candidateIsActive ? 1 : 0;
    const expectedVisibleRuns = candidateIsActive ? artifacts.length : 0;
    if (
      publicCounts.definitions !== expectedVisibleDefinitions ||
      publicCounts.runs !== expectedVisibleRuns ||
      fishingCounts.definitions !== expectedVisibleDefinitions ||
      fishingCounts.runs !== expectedVisibleRuns
    ) {
      throw contractError('MIGRATION_VISIBILITY_CONFLICT');
    }

    const verificationHash = sha256(
      stableSerialize({
        migrationId: preflight.migrationId,
        definitionId: preflight.definitionId,
        baselineHash: preflight.baseline.digestHash,
        sourcePlanHash: preflight.sourcePlanHash,
        replayHash: predecessorRunHash,
        runs: artifacts.map((artifact) => {
          const run = runsByDate.get(artifact.date);
          return {
            date: artifact.date,
            runId: run.runId,
            candidateHash: run.candidateHash,
            runHash: run.runHash,
            effectiveMessageCount: run.effectiveMessageCount,
          };
        }),
      })
    );
    return {
      report: buildSafeMigrationReport({
        mode: 'verify',
        migrationId: preflight.migrationId,
        status: candidateIsActive ? 'verified_active' : 'verified_staging',
        cutoverDate: preflight.plan.cutoverDate,
        replayStartDate: preflight.plan.replayStartDate,
        replayEndDate: preflight.plan.replayEndDate,
        counts: {
          importedRuns,
          replayRuns,
          visibleReplayRuns,
          canonicalRuns: artifacts.length,
          outboundEffects: 0,
          publicDefinitions: publicCounts.definitions,
          publicRuns: publicCounts.runs,
          fishingDefinitions: fishingCounts.definitions,
          fishingRuns: fishingCounts.runs,
        },
        hashes: {
          baseline: preflight.baseline.digestHash,
          sourcePlan: preflight.sourcePlanHash,
          replay: predecessorRunHash,
          verification: verificationHash,
        },
      }),
      migrationId: preflight.migrationId,
      definitionId: preflight.definitionId,
      replayHash: predecessorRunHash,
      verificationHash,
    };
  } catch (error) {
    if (error instanceof MigrationContractError) throw error;
    throw contractError('MIGRATION_VERIFY_FAILED');
  }
}

export async function runFishingMigrationActivate(input, ports) {
  try {
    if (
      !isRecord(ports) ||
      !isRecord(ports.migration) ||
      typeof ports.migration.activateAtomically !== 'function'
    ) {
      throw contractError('MIGRATION_PORTS_INVALID');
    }
    const migrationId = input?.migrationId;
    assertMigrationId(migrationId);
    const binding = validateProtectedBinding(input?.binding);
    const now = normalizeInstant(input?.now);
    const cutoverDeadline = normalizeInstant(input?.cutoverDeadline);
    if (now === null || cutoverDeadline === null || Date.parse(cutoverDeadline) < Date.parse(now)) {
      throw contractError('MIGRATION_ACTIVATION_WINDOW_INVALID');
    }

    const verified = await runFishingMigrationVerify({ migrationId, binding, now }, ports);
    const readiness = await ports.source.getReadiness({ userId: binding.userId });
    if (!isReadyObservation(readiness)) throw contractError('DELIVERY_NOT_READY');
    const readinessAge = Date.parse(now) - Date.parse(readiness.observedAt);
    if (readinessAge < -30_000 || readinessAge > 5 * 60 * 1_000) {
      throw contractError('DELIVERY_READINESS_STALE');
    }
    const nextRunAt = nextFishingCadenceAfter(
      Date.parse(cutoverDeadline) > Date.parse(now) ? cutoverDeadline : now
    );
    const result = await ports.migration.activateAtomically({
      migrationId,
      definitionId: verified.definitionId,
      replayHash: verified.replayHash,
      verificationHash: verified.verificationHash,
      replayEndExclusive: buildFishingMigrationPlan(now).replayEndExclusive,
      cutoverDeadline,
      nextRunAt,
      readiness: {
        observationVersion: readiness.observationVersion,
        observedAt: normalizeInstant(readiness.observedAt),
      },
      activatedAt: now,
    });
    if (!isRecord(result) || !['activated', 'existing'].includes(result.disposition)) {
      throw contractError('MIGRATION_ACTIVATION_CONFLICT');
    }

    const active = await runFishingMigrationVerify({ migrationId, binding, now }, ports);
    if (active.report.status !== 'verified_active') {
      throw contractError('MIGRATION_ACTIVATION_CONFLICT');
    }
    return {
      report: {
        ...active.report,
        mode: 'activate',
        status: 'active',
      },
      migrationId,
      definitionId: active.definitionId,
      replayHash: active.replayHash,
      verificationHash: active.verificationHash,
      nextRunAt,
    };
  } catch (error) {
    if (error instanceof MigrationContractError) throw error;
    throw contractError('MIGRATION_ACTIVATE_FAILED');
  }
}

export async function runFishingMigrationCompensate(input, ports) {
  try {
    if (
      !isRecord(ports) ||
      !isRecord(ports.migration) ||
      typeof ports.migration.inspectCandidate !== 'function' ||
      typeof ports.migration.compensateAtomically !== 'function' ||
      !isRecord(ports.effects) ||
      typeof ports.effects.countMigrationEffects !== 'function' ||
      !isRecord(ports.visibility) ||
      typeof ports.visibility.readPublic !== 'function' ||
      typeof ports.visibility.readFishing !== 'function'
    ) {
      throw contractError('MIGRATION_PORTS_INVALID');
    }
    const migrationId = input?.migrationId;
    assertMigrationId(migrationId);
    const binding = validateProtectedBinding(input?.binding);
    const now = normalizeInstant(input?.now);
    if (now === null) throw contractError('MIGRATION_DATE_INVALID');
    const definitionId = deterministicDefinitionId(migrationId);
    const candidate = await ports.migration.inspectCandidate({ migrationId, definitionId });
    if (
      !isRecord(candidate) ||
      !isRecord(candidate.definition) ||
      !isRecord(candidate.activation) ||
      !isRecord(candidate.state) ||
      !Array.isArray(candidate.runs) ||
      !['staging', 'active', 'rollback_pending'].includes(candidate.activation.status)
    ) {
      throw contractError('MIGRATION_CANDIDATE_CONFLICT');
    }
    const effects = validateEffectCounts(
      await ports.effects.countMigrationEffects({
        userId: binding.userId,
        migrationId,
        definitionId,
      })
    );
    const outboundEffects = effects.outbox + effects.outboundMessages + effects.deliveryReceipts;
    const unsafeRun = candidate.runs.some(
      (run) =>
        !isRecord(run) ||
        run.delivery?.status !== 'not_sent' ||
        run.lease !== null ||
        run.deliveryAuthorization !== null
    );
    if (candidate.state.pendingWindow !== null || outboundEffects !== 0 || unsafeRun) {
      throw contractError('MIGRATION_COMPENSATION_FORBIDDEN');
    }

    const result = await ports.migration.compensateAtomically({
      migrationId,
      definitionId,
      expectedReplayHash: candidate.activation.replayHash,
      compensatedAt: now,
    });
    if (!isRecord(result) || !['compensated', 'existing'].includes(result.disposition)) {
      throw contractError('MIGRATION_COMPENSATION_CONFLICT');
    }
    const hidden = await ports.migration.inspectCandidate({ migrationId, definitionId });
    if (
      !isRecord(hidden) ||
      !isRecord(hidden.definition) ||
      !isRecord(hidden.activation) ||
      !Array.isArray(hidden.runs) ||
      hidden.definition.status !== 'migrating' ||
      hidden.definition.activeMigrationId !== null ||
      hidden.activation.status !== 'rollback_pending' ||
      hidden.runs.some((run) => run.visibilityMigrationId !== migrationId)
    ) {
      throw contractError('MIGRATION_COMPENSATION_CONFLICT');
    }
    const [publicProjection, fishingProjection] = await Promise.all([
      ports.visibility.readPublic({ userId: binding.userId, definitionId }),
      ports.visibility.readFishing({
        userId: binding.userId,
        legacyGroupKey: FISHING_GROUP_KEY,
      }),
    ]);
    const publicCounts = projectionCounts(publicProjection);
    const fishingCounts = projectionCounts(fishingProjection);
    if (
      publicCounts.definitions !== 0 ||
      publicCounts.runs !== 0 ||
      fishingCounts.definitions !== 0 ||
      fishingCounts.runs !== 0
    ) {
      throw contractError('MIGRATION_VISIBILITY_CONFLICT');
    }
    const plan = buildFishingMigrationPlan(now);
    return {
      report: buildSafeMigrationReport({
        mode: 'compensate',
        migrationId,
        status: 'rollback_pending',
        cutoverDate: plan.cutoverDate,
        replayStartDate: plan.replayStartDate,
        replayEndDate: plan.replayEndDate,
        counts: {
          canonicalRuns: hidden.runs.length,
          outboundEffects,
        },
        hashes: {
          baseline: hidden.activation.baselineHash,
          replay: hidden.activation.replayHash,
        },
      }),
      migrationId,
      definitionId,
    };
  } catch (error) {
    if (error instanceof MigrationContractError) throw error;
    throw contractError('MIGRATION_COMPENSATE_FAILED');
  }
}

export function nextFishingCadenceAfter(instant) {
  const normalized = normalizeInstant(instant);
  if (normalized === null) throw contractError('MIGRATION_DATE_INVALID');
  const instantMs = Date.parse(normalized);
  let date = parseLocalDate(localDateAt(instantMs, FISHING_TIME_ZONE));
  if (date === null) throw contractError('MIGRATION_DATE_INVALID');
  for (let offset = 0; offset <= 2; offset += 1) {
    const candidateDate = addLocalDays(date, offset);
    const candidate = resolveLocalTime(candidateDate, 3, 0, FISHING_TIME_ZONE);
    if (candidate > instantMs) return new Date(candidate).toISOString();
  }
  throw contractError('MIGRATION_DATE_INVALID');
}

function projectionCounts(value) {
  if (!isRecord(value) || !Array.isArray(value.definitions) || !Array.isArray(value.runs)) {
    throw contractError('MIGRATION_VISIBILITY_CONFLICT');
  }
  return { definitions: value.definitions.length, runs: value.runs.length };
}

function isFishingVisibleReplayRun(run) {
  return (
    isRecord(run) &&
    run.provenance === 'private_whatsapp_replay' &&
    run.generationStatus === 'completed' &&
    typeof run.headline === 'string' &&
    typeof run.summaryMarkdown === 'string' &&
    Number.isInteger(run.effectiveMessageCount) &&
    run.effectiveMessageCount > 0
  );
}

function buildMigrationShell(preflight) {
  const firstImported = preflight.baseline.imported[0];
  if (firstImported === undefined) throw contractError('LEGACY_BASELINE_CHANGED');
  const createdAt = preflight.now;
  const firstWindow = warsawDayWindow(firstImported.data.date);
  const definition = {
    version: 1,
    definitionId: preflight.definitionId,
    userId: preflight.binding.userId,
    name: preflight.binding.groupDisplayName,
    nameSortKey: preflight.binding.groupDisplayName.toLocaleLowerCase(),
    status: 'migrating',
    listStatus: 'paused',
    attentionCode: null,
    revision: 1,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: false,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: preflight.binding.sourceAccountId,
      generationId: preflight.binding.generationId,
      chatId: preflight.binding.chatId,
      chatType: 'group',
      displayName: preflight.binding.groupDisplayName,
      ...(Number.isInteger(preflight.source.messageCount)
        ? { messageCount: preflight.source.messageCount }
        : {}),
      ...(Number.isInteger(preflight.source.participantCount)
        ? { participantCount: preflight.source.participantCount }
        : {}),
      ...(typeof preflight.source.lastActivityAt === 'string'
        ? { lastActivityAt: preflight.source.lastActivityAt }
        : {}),
      sourceRevision: preflight.source.sourceRevision,
    },
    instructions: {
      templateId: 'fishing_group',
      text: FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
      revision: '1.0.0',
    },
    schedule: { kind: 'daily', localTime: '03:00', timeZone: FISHING_TIME_ZONE },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: preflight.readiness.observationVersion,
      readinessObservedAt: normalizeInstant(preflight.readiness.observedAt),
    },
    checkpointAt: firstWindow.windowStart,
    nextRunAt: preflight.plan.replayEndExclusive,
    lastRunAt: null,
    latestRun: null,
    createRequestIdDigest: framedDigest([
      'fishing-message-digest-create-v1',
      preflight.migrationId,
    ]),
    activeMigrationId: null,
    legacyAlias: { groupKey: FISHING_GROUP_KEY },
    createdAt,
    updatedAt: createdAt,
  };
  const state = {
    version: 1,
    definitionId: preflight.definitionId,
    userId: preflight.binding.userId,
    revision: 1,
    checkpointAt: firstWindow.windowStart,
    continuityMemoryMarkdown: '',
    precedingRunId: null,
    precedingRunHash: null,
    pendingWindow: null,
    updatedAt: createdAt,
  };
  const activation = {
    version: 1,
    migrationId: preflight.migrationId,
    userId: preflight.binding.userId,
    definitionId: preflight.definitionId,
    legacyGroupKey: FISHING_GROUP_KEY,
    status: 'staging',
    leaseOwnerDigest: null,
    leaseExpiresAt: null,
    step: 'shell_created',
    cutoverDeadline: preflight.plan.replayEndExclusive,
    baselineHash: preflight.baseline.digestHash,
    replayHash: null,
    safeCounts: {
      auditedLegacyDocuments: preflight.baseline.auditedDocumentCount,
      meaningfulLegacyDocuments: preflight.baseline.auditedMeaningfulCount,
    },
    createdAt,
    updatedAt: createdAt,
  };
  return { definition, state, activation };
}

function buildImportedLegacyRun(preflight, artifact, predecessorRunHash) {
  const document = artifact.document;
  const summary = document.data.summary;
  const window = warsawDayWindow(artifact.date);
  const summaryMarkdown = renderLegacySummaryMarkdown(summary);
  const continuityMemoryMarkdown =
    artifact.date === LAST_MEANINGFUL_LEGACY_DATE
      ? renderLegacyContinuityMarkdown(
          preflight.legacyStates,
          preflight.baseline.imported.slice(-4)
        )
      : summaryMarkdown.slice(0, 8_000);
  const candidateHash = sha256(
    stableSerialize({
      provenance: 'legacy_mobile_notification',
      document: normalizeLegacyDocumentForHash(document),
      summaryMarkdown,
      continuityMemoryMarkdown,
    })
  );
  const runId = deterministicRunId(preflight.migrationId, artifact.date, 'legacy');
  const chain = appendCanonicalChain(predecessorRunHash, {
    runId,
    date: artifact.date,
    candidateHash,
  });
  return buildMigrationRun({
    preflight,
    runId,
    date: artifact.date,
    window,
    provenance: 'legacy_mobile_notification',
    sourceRevision: 'unavailable:legacy-mobile-notification',
    sourceWatermarkHash: null,
    sourceCandidateHash: null,
    candidateHash,
    chain,
    generationStatus: 'completed',
    processingStage: 'completed',
    headline: summary.headline,
    summaryMarkdown,
    evidenceMessageRefs: [],
    continuityMemoryMarkdown,
    effectiveMessageCount: summary.messageCount,
    promptVersion: 'legacy-mobile-digest@4.0.0',
    model: document.data.modelId,
    usage: null,
    completedAt: normalizeInstant(document.data.generatedAt),
    createdAt: normalizeInstant(document.data.generatedAt),
  });
}

async function buildReplayedRun(
  preflight,
  artifact,
  predecessorRunHash,
  state,
  previousSummaries,
  aggregateDay
) {
  const window = artifact.window;
  let aggregate = null;
  if (window.eligibleMessageCount > 0) {
    aggregate = await aggregateDay({
      migrationId: preflight.migrationId,
      definitionId: preflight.definitionId,
      userId: preflight.binding.userId,
      date: artifact.date,
      chatType: 'group',
      conversationLabel: preflight.binding.groupDisplayName,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      instructions: FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
      continuityMemoryMarkdown: state.continuityMemoryMarkdown,
      previousSummaries: [...previousSummaries],
      messages: window.messages,
    });
    validateAggregate(aggregate, window.messages);
  }
  const candidateHash = sha256(
    stableSerialize({
      provenance: 'private_whatsapp_replay',
      date: artifact.date,
      sourceCandidateHash: window.candidateHash,
      sourceWatermarkHash: window.watermarkHash,
      aggregate,
    })
  );
  const runId = deterministicRunId(preflight.migrationId, artifact.date, 'replay');
  const chain = appendCanonicalChain(predecessorRunHash, {
    runId,
    date: artifact.date,
    candidateHash,
  });
  const empty = aggregate === null;
  return buildMigrationRun({
    preflight,
    runId,
    date: artifact.date,
    window,
    provenance: 'private_whatsapp_replay',
    sourceRevision: preflight.source.sourceRevision,
    sourceWatermarkHash: window.watermarkHash,
    sourceCandidateHash: window.candidateHash,
    candidateHash,
    chain,
    generationStatus: empty ? 'skipped_no_activity' : 'completed',
    processingStage: empty ? 'skipped_no_activity' : 'completed',
    headline: aggregate?.headline ?? null,
    summaryMarkdown: aggregate?.summaryMarkdown ?? null,
    evidenceMessageRefs: aggregate?.evidenceMessageRefs ?? [],
    continuityMemoryMarkdown: aggregate?.continuityMemoryMarkdown ?? state.continuityMemoryMarkdown,
    effectiveMessageCount: window.eligibleMessageCount,
    promptVersion: aggregate?.promptVersion ?? null,
    model: aggregate?.model ?? null,
    usage: aggregate?.usage ?? null,
    completedAt: window.windowEnd,
    createdAt: window.windowEnd,
  });
}

function buildMigrationRun(input) {
  const sourceSnapshot = {
    type: 'private_whatsapp',
    sourceAccountId: input.preflight.binding.sourceAccountId,
    generationId: input.preflight.binding.generationId,
    chatId: input.preflight.binding.chatId,
    chatType: 'group',
    displayName: input.preflight.binding.groupDisplayName,
    sourceRevision: input.sourceRevision,
  };
  return {
    version: 1,
    runId: input.runId,
    userId: input.preflight.binding.userId,
    definitionId: input.preflight.definitionId,
    definitionNameSnapshot: input.preflight.binding.groupDisplayName,
    recordRole: 'canonical',
    visibilityMigrationId: input.preflight.migrationId,
    migrationDate: input.date,
    provenance: input.provenance,
    deliveryMode: 'silent',
    predecessorRunHash: input.chain.predecessorRunHash,
    runHash: input.chain.runHash,
    sourceWatermarkHash: input.sourceWatermarkHash,
    sourceCandidateHash: input.sourceCandidateHash,
    candidateHash: input.candidateHash,
    definitionRevision: 1,
    instructionRevision: '1.0.0',
    trigger: 'scheduled',
    requestIdDigest: framedDigest([
      'fishing-message-digest-migration-request-v1',
      input.preflight.migrationId,
      input.date,
    ]),
    windowStart: input.window.windowStart,
    windowEnd: input.window.windowEnd,
    scheduledBoundary: input.window.windowStart,
    generationStatus: input.generationStatus,
    processingStage: input.processingStage,
    lease: null,
    deliveryAuthorization: null,
    attempts: 1,
    sourceSnapshot,
    instructionsSnapshot: {
      templateId: 'fishing_group',
      text: FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
      revision: '1.0.0',
    },
    scheduleSnapshot: { kind: 'daily', localTime: '03:00', timeZone: FISHING_TIME_ZONE },
    headline: input.headline,
    summaryMarkdown: input.summaryMarkdown,
    evidenceMessageRefs: input.evidenceMessageRefs,
    continuityMemoryMarkdown: input.continuityMemoryMarkdown,
    effectiveMessageCount: input.effectiveMessageCount,
    promptVersion: input.promptVersion,
    model: input.model,
    usage: input.usage,
    delivery: {
      type: 'whatsapp_primary',
      status: 'not_sent',
      idempotencyKey: `message-digest:${input.runId}`,
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: input.createdAt,
    updatedAt: input.completedAt,
    completedAt: input.completedAt,
  };
}

function buildNextMigrationState(state, run) {
  return {
    ...state,
    revision: state.revision + 1,
    checkpointAt: run.windowEnd,
    continuityMemoryMarkdown: run.continuityMemoryMarkdown ?? state.continuityMemoryMarkdown,
    precedingRunId: run.runId,
    precedingRunHash: run.runHash,
    pendingWindow: null,
    updatedAt: run.completedAt ?? run.updatedAt,
  };
}

function validateExistingMigrationRun(run, input) {
  const expectedRunId = deterministicRunId(
    input.migrationId,
    input.artifact.date,
    input.artifact.kind
  );
  if (
    run.runId !== expectedRunId ||
    run.definitionId !== input.definitionId ||
    run.visibilityMigrationId !== input.migrationId ||
    run.recordRole !== 'canonical' ||
    run.deliveryMode !== 'silent' ||
    run.migrationDate !== input.artifact.date ||
    run.predecessorRunHash !== input.predecessorRunHash ||
    typeof run.runHash !== 'string' ||
    !SHA256_PATTERN.test(run.runHash) ||
    run.delivery?.status !== 'not_sent'
  ) {
    throw contractError('MIGRATION_CANDIDATE_CONFLICT');
  }
  if (
    input.artifact.kind === 'replay' &&
    (run.provenance !== 'private_whatsapp_replay' ||
      run.sourceCandidateHash !== input.artifact.window.candidateHash ||
      run.sourceWatermarkHash !== input.artifact.window.watermarkHash ||
      run.effectiveMessageCount !== input.artifact.window.eligibleMessageCount)
  ) {
    throw contractError('MIGRATION_CANDIDATE_CONFLICT');
  }
  if (input.artifact.kind === 'legacy' && run.provenance !== 'legacy_mobile_notification') {
    throw contractError('MIGRATION_CANDIDATE_CONFLICT');
  }
}

function validateAggregate(value, messages) {
  if (
    !isRecord(value) ||
    typeof value.headline !== 'string' ||
    value.headline.trim() === '' ||
    value.headline.length > 200 ||
    typeof value.summaryMarkdown !== 'string' ||
    value.summaryMarkdown.length > 12_000 ||
    !Array.isArray(value.evidenceMessageRefs) ||
    value.evidenceMessageRefs.length > 1_000 ||
    typeof value.continuityMemoryMarkdown !== 'string' ||
    value.continuityMemoryMarkdown.length > 8_000 ||
    typeof value.promptVersion !== 'string' ||
    value.promptVersion.trim() === '' ||
    typeof value.model !== 'string' ||
    value.model.trim() === '' ||
    !isRecord(value.usage)
  ) {
    throw contractError('MIGRATION_AGGREGATE_INVALID');
  }
  const allowed = new Set(messages.map((message) => message.messageRef));
  const observed = new Set();
  for (const reference of value.evidenceMessageRefs) {
    if (typeof reference !== 'string' || !allowed.has(reference) || observed.has(reference)) {
      throw contractError('MIGRATION_AGGREGATE_INVALID');
    }
    observed.add(reference);
  }
}

function pushPreviousSummary(previousSummaries, run) {
  if (run.headline === null || run.summaryMarkdown === null) return;
  previousSummaries.push({
    runId: run.runId,
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
    headline: run.headline,
    summaryMarkdown: run.summaryMarkdown,
    continuityMemoryMarkdown: run.continuityMemoryMarkdown ?? '',
  });
  if (previousSummaries.length > 3) previousSummaries.shift();
}

function renderLegacySummaryMarkdown(summary) {
  const lines = [`## ${summary.headline}`];
  for (const bullet of Array.isArray(summary.bullets) ? summary.bullets : []) {
    if (typeof bullet === 'string' && bullet.trim() !== '') lines.push(`- ${bullet}`);
  }
  const structuredSections = [
    ['Threads', summary.threads],
    ['Moderator posts', summary.moderatorPosts],
    ['Open questions', summary.openQuestions],
    ['Activity outliers', summary.activityOutliers],
  ];
  for (const [label, value] of structuredSections) {
    if (Array.isArray(value) && value.length > 0) {
      lines.push(`### ${label}`, stableSerialize(value));
    }
  }
  return lines.join('\n').slice(0, 12_000);
}

function renderLegacyContinuityMarkdown(states, summaries) {
  const latestState = [...states]
    .sort((left, right) => left.data.date.localeCompare(right.data.date))
    .at(-1);
  const content = [
    '## Legacy continuity checkpoint',
    latestState === undefined ? '' : stableSerialize(latestState.data.state),
    '## Previous summaries',
    ...summaries.map((document) => renderLegacySummaryMarkdown(document.data.summary)),
  ].join('\n');
  return content.slice(0, 8_000);
}

function validateProtectedBinding(value) {
  if (!isRecord(value)) throw contractError('MIGRATION_BINDING_INVALID');
  const stringFields = [
    'projectId',
    'userId',
    'sourceAccountId',
    'generationId',
    'chatId',
    'groupDisplayName',
    'expectedLegacyDigestHash',
    'expectedLegacyStateHash',
  ];
  for (const field of stringFields) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      throw contractError('MIGRATION_BINDING_INVALID');
    }
  }
  if (
    !SHA256_PATTERN.test(value.expectedLegacyDigestHash) ||
    !SHA256_PATTERN.test(value.expectedLegacyStateHash)
  ) {
    throw contractError('MIGRATION_BINDING_INVALID');
  }
  return value;
}

function assertDryRunPorts(ports) {
  if (
    !isRecord(ports) ||
    !isRecord(ports.archive) ||
    typeof ports.archive.readSnapshot !== 'function' ||
    !isRecord(ports.source) ||
    typeof ports.source.resolveBinding !== 'function' ||
    typeof ports.source.getReadiness !== 'function' ||
    typeof ports.source.queryMessages !== 'function' ||
    !isRecord(ports.migration) ||
    typeof ports.migration.inspectCandidate !== 'function' ||
    !isRecord(ports.effects) ||
    typeof ports.effects.countMigrationEffects !== 'function'
  ) {
    throw contractError('MIGRATION_PORTS_INVALID');
  }
}

function validateLegacyArchive(value, binding, now) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.digests) ||
    !Array.isArray(value.states) ||
    !Array.isArray(value.locks) ||
    !Array.isArray(value.backfills)
  ) {
    throw contractError('LEGACY_ARCHIVE_INVALID');
  }
  for (const lock of value.locks) {
    if (!isOwnedLegacyRecord(lock, binding) || typeof lock.data.expiresAt !== 'string') {
      throw contractError('LEGACY_ARCHIVE_INVALID');
    }
    const expiresAt = normalizeInstant(lock.data.expiresAt);
    if (expiresAt === null) throw contractError('LEGACY_ARCHIVE_INVALID');
    if (Date.parse(expiresAt) > Date.parse(now)) throw contractError('LEGACY_LOCK_ACTIVE');
  }
  for (const backfill of value.backfills) {
    if (!isOwnedLegacyRecord(backfill, binding) || typeof backfill.data.status !== 'string') {
      throw contractError('LEGACY_ARCHIVE_INVALID');
    }
    if (backfill.data.status === 'queued' || backfill.data.status === 'running') {
      throw contractError('LEGACY_BACKFILL_ACTIVE');
    }
  }
  return value;
}

function isOwnedLegacyRecord(value, binding) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isRecord(value.data) &&
    value.data.userId === binding.userId &&
    value.data.groupKey === FISHING_GROUP_KEY
  );
}

function validateLegacyStateCheckpoint(states, binding) {
  if (states.length === 0) throw contractError('LEGACY_STATE_BASELINE_CHANGED');
  for (const document of states) {
    if (
      !isOwnedLegacyRecord(document, binding) ||
      typeof document.data.date !== 'string' ||
      parseLocalDate(document.data.date) === null ||
      !isRecord(document.data.state) ||
      document.data.state.userId !== binding.userId ||
      document.data.state.groupKey !== FISHING_GROUP_KEY
    ) {
      throw contractError('LEGACY_STATE_BASELINE_CHANGED');
    }
  }
  const latest = states
    .map((document) => document.data.date)
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
  if (latest !== LAST_MEANINGFUL_LEGACY_DATE) {
    throw contractError('LEGACY_STATE_BASELINE_CHANGED');
  }
}

function isCompatibleCandidate(candidate, migrationId, definitionId) {
  if (candidate === null) return true;
  if (!isRecord(candidate)) return false;
  if (!isRecord(candidate.definition) || !isRecord(candidate.activation)) return false;
  if (
    candidate.definition.definitionId !== definitionId ||
    candidate.activation.migrationId !== migrationId ||
    candidate.activation.definitionId !== definitionId
  ) {
    return false;
  }
  if (!Array.isArray(candidate.runs)) return false;
  const active =
    candidate.definition.status === 'active' &&
    candidate.definition.activeMigrationId === migrationId &&
    candidate.activation.status === 'active';
  const hidden =
    candidate.definition.status === 'migrating' &&
    candidate.definition.activeMigrationId === null &&
    ['staging', 'rollback_pending'].includes(candidate.activation.status);
  if (!active && !hidden) return false;
  return candidate.runs.every(
    (run) =>
      isRecord(run) &&
      run.definitionId === definitionId &&
      run.visibilityMigrationId === (active ? null : migrationId)
  );
}

function validateResolvedSource(value, binding) {
  if (!isRecord(value)) throw contractError('SOURCE_BINDING_CHANGED');
  if (value.generationId !== binding.generationId) {
    throw contractError('SOURCE_GENERATION_CHANGED');
  }
  if (
    value.sourceAccountId !== binding.sourceAccountId ||
    value.chatId !== binding.chatId ||
    value.chatType !== 'group' ||
    value.displayName !== binding.groupDisplayName ||
    typeof value.sourceRevision !== 'string' ||
    value.sourceRevision.trim() === ''
  ) {
    throw contractError('SOURCE_BINDING_CHANGED');
  }
  return value;
}

function isReadyObservation(value) {
  return (
    isRecord(value) &&
    value.status === 'ready' &&
    typeof value.observationVersion === 'string' &&
    value.observationVersion.trim() !== '' &&
    typeof value.observedAt === 'string' &&
    normalizeInstant(value.observedAt) !== null
  );
}

function validateEffectCounts(value) {
  if (!isRecord(value)) throw contractError('MIGRATION_EFFECTS_INVALID');
  const result = {};
  for (const field of ['outbox', 'outboundMessages', 'deliveryReceipts']) {
    const count = value[field];
    if (!Number.isInteger(count) || count < 0) {
      throw contractError('MIGRATION_EFFECTS_INVALID');
    }
    result[field] = count;
  }
  return result;
}

async function readSourceWindow(input) {
  const window = warsawDayWindow(input.date);
  const messages = [];
  const pageProofs = [];
  const cursors = new Set();
  let cursor;
  let windowSourceRevision;
  for (let page = 0; page < 50; page += 1) {
    const result = await input.queryMessages({
      date: input.date,
      userId: input.binding.userId,
      sourceAccountId: input.binding.sourceAccountId,
      generationId: input.binding.generationId,
      chatId: input.binding.chatId,
      chatType: 'group',
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (
      !isRecord(result) ||
      typeof result.sourceRevision !== 'string' ||
      result.sourceRevision.trim() === ''
    ) {
      throw contractError('SOURCE_WINDOW_INVALID');
    }
    if (windowSourceRevision === undefined) {
      windowSourceRevision = result.sourceRevision;
    } else if (result.sourceRevision !== windowSourceRevision) {
      throw contractError('SOURCE_GENERATION_CHANGED');
    }
    if (!Array.isArray(result.messages)) throw contractError('SOURCE_WINDOW_INVALID');
    const pageMessages = [];
    for (const message of result.messages) {
      validateSourceMessage(message, window, messages);
      messages.push(message);
      pageMessages.push(message);
    }
    if (messages.length > 5_000) throw contractError('SOURCE_WINDOW_TOO_LARGE');
    if (
      result.highWatermark !== null &&
      (typeof result.highWatermark !== 'string' ||
        result.highWatermark.length === 0 ||
        result.highWatermark.length > 8_192)
    ) {
      throw contractError('SOURCE_WINDOW_INVALID');
    }
    const orderedPageMessages = [...pageMessages].sort(
      (left, right) =>
        left.eventTimestamp.localeCompare(right.eventTimestamp) ||
        left.messageRef.localeCompare(right.messageRef)
    );
    const lastPageMessage = orderedPageMessages.at(-1);
    pageProofs.push({
      messageCount: orderedPageMessages.length,
      lastEventTimestamp: lastPageMessage?.eventTimestamp ?? null,
      lastMessageRef: lastPageMessage?.messageRef ?? null,
      terminal: result.nextCursor === null,
    });
    if (result.nextCursor === null) break;
    if (
      typeof result.nextCursor !== 'string' ||
      result.nextCursor.length === 0 ||
      result.nextCursor.length > 8_192 ||
      cursors.has(result.nextCursor)
    ) {
      throw contractError('SOURCE_WINDOW_INVALID');
    }
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
    if (page === 49) throw contractError('SOURCE_WINDOW_TOO_LARGE');
  }
  const normalizedMessages = [...messages].sort(
    (left, right) =>
      left.eventTimestamp.localeCompare(right.eventTimestamp) ||
      left.messageRef.localeCompare(right.messageRef)
  );
  return {
    ...window,
    eligibleMessageCount: normalizedMessages.length,
    watermarkHash: sha256(stableSerialize(pageProofs)),
    candidateHash: sha256(stableSerialize(normalizedMessages)),
    messages: normalizedMessages,
  };
}

function validateSourceMessage(value, window, observed) {
  if (
    !isRecord(value) ||
    typeof value.messageRef !== 'string' ||
    !SHA256_PATTERN.test(value.messageRef) ||
    typeof value.eventTimestamp !== 'string' ||
    normalizeInstant(value.eventTimestamp) === null ||
    Date.parse(value.eventTimestamp) < Date.parse(window.windowStart) ||
    Date.parse(value.eventTimestamp) >= Date.parse(window.windowEnd) ||
    !['inbound', 'outbound', 'system'].includes(value.direction) ||
    typeof value.authorLabel !== 'string' ||
    value.authorLabel.length > 512 ||
    typeof value.text !== 'string' ||
    value.text.length > 262_144 ||
    !['text', 'media_caption', 'transcription', 'reaction', 'system'].includes(value.contentKind) ||
    observed.some((message) => message.messageRef === value.messageRef)
  ) {
    throw contractError('SOURCE_WINDOW_INVALID');
  }
}

function parseLegacyDocument(value) {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.data)) {
    throw contractError('LEGACY_BASELINE_INVALID');
  }
  const data = value.data;
  if (
    value.id.trim() === '' ||
    typeof data.userId !== 'string' ||
    data.userId.trim() === '' ||
    data.userId.length > 256 ||
    data.groupKey !== FISHING_GROUP_KEY ||
    typeof data.date !== 'string' ||
    parseLocalDate(data.date) === null ||
    !isRecord(data.summary) ||
    data.summary.date !== data.date ||
    data.summary.groupKey !== FISHING_GROUP_KEY ||
    !Number.isInteger(data.summary.messageCount) ||
    data.summary.messageCount < 0 ||
    !Number.isInteger(data.generation) ||
    data.generation < 1 ||
    typeof data.generatedAt !== 'string' ||
    normalizeInstant(data.generatedAt) === null ||
    typeof data.modelId !== 'string' ||
    data.modelId.trim() === ''
  ) {
    throw contractError('LEGACY_BASELINE_INVALID');
  }
  return value;
}

function normalizeLegacyDocumentForHash(value) {
  const document = parseLegacyDocument(value);
  return { id: document.id, data: document.data };
}

function isMeaningfulLegacyDigest(data) {
  return data.summary.messageCount > 0;
}

function groupLegacyDocumentsByDate(documents) {
  const grouped = new Map();
  for (const document of documents) {
    const existing = grouped.get(document.data.date) ?? [];
    existing.push(document);
    grouped.set(document.data.date, existing);
  }
  return grouped;
}

function selectLatestMeaningfulPerDate(documents) {
  const grouped = groupLegacyDocumentsByDate(documents);
  const selected = [];
  for (const candidates of grouped.values()) {
    candidates.sort(
      (left, right) =>
        left.data.generatedAt.localeCompare(right.data.generatedAt) ||
        left.data.generation - right.data.generation ||
        left.id.localeCompare(right.id)
    );
    const latest = candidates.at(-1);
    if (latest !== undefined) selected.push(latest);
  }
  return selected.sort((left, right) => left.data.date.localeCompare(right.data.date));
}

function stableSerialize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw contractError('LEGACY_BASELINE_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  if (!isRecord(value)) throw contractError('LEGACY_BASELINE_INVALID');
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(',')}}`;
}

function enumerateLocalDates(fromDate, toDate) {
  const from = parseLocalDate(fromDate);
  const to = parseLocalDate(toDate);
  if (from === null || to === null || localDateOrdinal(from) > localDateOrdinal(to)) {
    throw contractError('MIGRATION_DATE_INVALID');
  }
  const dates = [];
  for (let current = from; localDateOrdinal(current) <= localDateOrdinal(to); ) {
    dates.push(formatLocalDate(current));
    current = addLocalDays(current, 1);
  }
  return dates;
}

function previousLocalDate(date) {
  const parsed = parseLocalDate(date);
  if (parsed === null) throw contractError('MIGRATION_DATE_INVALID');
  return formatLocalDate(addLocalDays(parsed, -1));
}

function parseLocalDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function addLocalDays(date, days) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localDateOrdinal(date) {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function formatLocalDate(date) {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(
    date.day
  ).padStart(2, '0')}`;
}

function resolveLocalMidnight(date, timeZone) {
  return resolveLocalTime(date, 0, 0, timeZone);
}

function resolveLocalTime(date, hour, minute, timeZone) {
  const wallTimeMs = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  for (let offsetHours = -14; offsetHours <= 14; offsetHours += 1) {
    const candidate = wallTimeMs - offsetHours * 60 * 60 * 1_000;
    const local = localDateTimeAt(candidate, timeZone);
    if (
      local.year === date.year &&
      local.month === date.month &&
      local.day === date.day &&
      local.hour === hour &&
      local.minute === minute &&
      local.second === 0
    ) {
      return candidate;
    }
  }
  throw contractError('MIGRATION_DATE_INVALID');
}

function localDateAt(instantMs, timeZone) {
  const local = localDateTimeAt(instantMs, timeZone);
  return formatLocalDate(local);
}

function localDateTimeAt(instantMs, timeZone) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instantMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function normalizeInstant(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function assertMigrationId(value) {
  if (typeof value !== 'string' || !MIGRATION_ID_PATTERN.test(value)) {
    throw contractError('MIGRATION_IDENTITY_INVALID');
  }
}

function framedDigest(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(String(part.length)).update(':').update(part);
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contractError(code) {
  return new MigrationContractError(code);
}
