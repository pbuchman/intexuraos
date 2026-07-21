import { createHash } from 'node:crypto';

import type { Firestore } from '@intexuraos/infra-firestore';

import type {
  TestRunIdentity,
  TestRunCurrentAcceptance,
  TestRunCurrentAcceptanceResult,
  TestRunRepository,
  TestRunRepositoryAbandonedRecoveryResult,
  TestRunRepositoryCleanupResult,
  TestRunRepositoryFailureCode,
  TestRunRepositoryFinalizationResult,
  TestRunRepositoryGetResult,
  TestRunRepositoryListResult,
  TestRunRepositoryMutationResult,
  TestRunScenarioReadResult,
} from '../../domain/testRuns/ports/testRunRepository.js';
import {
  applyArtifactDeliveryTransition,
  applyTestRunProjectionCas,
  applyTestRunTerminalControl,
  digestArtifactCandidates,
} from '../../domain/testRuns/stateMachine.js';
import {
  selectRetainedTestRuns,
  TEST_RUN_RETENTION_QUERY_LIMIT,
} from '../../domain/testRuns/retention.js';
import { digestMatrixCorpusFinalizationProjection } from '../../domain/testRuns/projectionDigest.js';
import {
  intexAgentTestRunRecordV1Schema,
  deriveTestRunEvidenceTotals,
  matrixCorpusTerminalCandidateV1Schema,
  testRunScenarioProjectionV1Schema,
  type IntexAgentTestRunRecordV1,
  type MatrixCorpusTerminalCandidateV1,
  type TestRunArtifactDeliveryCommandV1,
  type TestRunProjectionCasCommandV1,
  type TestRunScenarioProjectionV1,
  type TestRunTerminalWinnerV1,
  type TestRunTransitionFailureCode,
} from '../../domain/testRuns/types.js';
import {
  checkTestRunDocumentSize,
  checkTestRunScenarioDocumentSize,
} from '../../domain/testRuns/sizePolicy.js';
import type { MatrixCorpusRunManifestV1 } from '../../domain/matrixCorpus/ports/matrixCorpusManifestRepository.js';
import type { MatrixCorpusPrivateScenarioContextV1 } from '../../domain/matrixCorpus/ports/matrixCorpusContextRepository.js';
import {
  INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION,
  INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION,
  INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION,
  parseMatrixCorpusRunContextDocument,
  parseMatrixCorpusScenarioContextDocument,
} from './matrixCorpusContextRepository.js';
import {
  INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION,
  parseMatrixCorpusRunManifestDocument,
} from './matrixCorpusManifestRepository.js';
import {
  INTEX_AGENT_SESSIONS_COLLECTION,
  INTEX_AGENT_SESSION_EVENTS_COLLECTION,
  parseMatrixCorpusEventDocument,
  parseMatrixCorpusSessionDocument,
} from './sessionRepository.js';
import { INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION } from './ingestReceiptRepository.js';
import { INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION } from './testConfirmationRepository.js';

type FirestoreDocumentReference = ReturnType<ReturnType<Firestore['collection']>['doc']>;

export const INTEX_AGENT_TEST_RUNS_COLLECTION = 'intex_agent_test_runs';
export const INTEX_AGENT_TEST_RUN_SCENARIOS_COLLECTION = 'intex_agent_test_run_scenarios';

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FENCE_PATTERN = /^[1-9][0-9]{0,19}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

export class FirestoreTestRunRepository implements TestRunRepository {
  constructor(private readonly deps: Readonly<{ firestore: Firestore }>) {}

  static digestTerminalCandidate(candidate: MatrixCorpusTerminalCandidateV1): string {
    const parsed = matrixCorpusTerminalCandidateV1Schema.parse(candidate);
    return createHash('sha256').update(stableJson(parsed), 'utf8').digest('hex');
  }

  static digestContextFinalization(context: unknown): string {
    return createHash('sha256').update(stableJson(context), 'utf8').digest('hex');
  }

  static digestProjection(
    record: IntexAgentTestRunRecordV1,
    projections: readonly TestRunScenarioProjectionV1[]
  ): string {
    return digestMatrixCorpusFinalizationProjection(record, projections);
  }

  async getCurrentAcceptance(userId: string): Promise<TestRunCurrentAcceptanceResult> {
    if (!SAFE_ID_PATTERN.test(userId)) return failure('INVALID_INPUT');
    const snapshot = await this.deps.firestore
      .collection(INTEX_AGENT_TEST_RUNS_COLLECTION)
      .where('userId', '==', userId)
      .get();
    const records = snapshot.docs.map((document) => parseRecord(document.data()));
    if (records.some((record) => record === null)) return failure('CORRUPT_RECORD');
    const ordered = (records as IntexAgentTestRunRecordV1[]).sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt)
    );
    const blocked = ordered
      .map(classifyCurrentAcceptance)
      .find((acceptance) => acceptance.kind === 'admission_blocked');
    const newest = ordered[0];
    return {
      ok: true,
      acceptance:
        blocked ?? (newest === undefined
          ? { kind: 'admission_ready', current: 'absent' }
          : classifyCurrentAcceptance(newest)),
    };
  }

  async listLatestForUser(
    userId: string,
    limit = 4
  ): Promise<TestRunRepositoryListResult> {
    if (!SAFE_ID_PATTERN.test(userId) || limit !== 4) return failure('INVALID_INPUT');
    const snapshot = await this.deps.firestore
      .collection(INTEX_AGENT_TEST_RUNS_COLLECTION)
      .where('userId', '==', userId)
      .where('runtimeAudience', '==', 'home-dev')
      .orderBy('startedAt', 'desc')
      .limit(limit)
      .get();
    const records = snapshot.docs.map((document) => parseRecord(document.data()));
    if (records.some((record) => record === null)) return failure('CORRUPT_RECORD');
    return { ok: true, records: structuredClone(records as IntexAgentTestRunRecordV1[]) };
  }

  async listStagedArtifactsFinishedBefore(
    input: Parameters<TestRunRepository['listStagedArtifactsFinishedBefore']>[0]
  ): Promise<TestRunRepositoryListResult> {
    if (!isRfc3339(input.cutoff) || input.limit !== 20) return failure('INVALID_INPUT');
    const snapshot = await this.deps.firestore
      .collection(INTEX_AGENT_TEST_RUNS_COLLECTION)
      .where('artifactDelivery.status', '==', 'staged')
      .where('finishedAt', '<=', input.cutoff)
      .orderBy('finishedAt', 'asc')
      .limit(input.limit)
      .get();
    const records = snapshot.docs.map((document) => parseRecord(document.data()));
    if (records.some((record) => record === null)) return failure('CORRUPT_RECORD');
    return { ok: true, records: structuredClone(records as IntexAgentTestRunRecordV1[]) };
  }

  async cleanupExactRun(
    input: Parameters<TestRunRepository['cleanupExactRun']>[0]
  ): Promise<TestRunRepositoryCleanupResult> {
    if (
      !isValidIdentity(input.currentIdentity) ||
      !isValidIdentity(input.targetIdentity) ||
      !isRfc3339(input.updatedAt) ||
      input.currentIdentity.userId !== input.targetIdentity.userId ||
      input.currentIdentity.runId === input.targetIdentity.runId ||
      input.currentIdentity.leaseFence === input.targetIdentity.leaseFence
    )
      return failure('INVALID_INPUT');

    const currentRunRef = this.runRef(input.currentIdentity.runId);
    const currentContextRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc(input.currentIdentity.runId);
    const currentManifestRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.currentIdentity.runId);
    const targetRunRef = this.runRef(input.targetIdentity.runId);
    const targetContextRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc(input.targetIdentity.runId);
    const targetManifestRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.targetIdentity.runId);
    const targetRecoveryRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION)
      .doc(input.targetIdentity.runId);
    const targetScenarioContextQuery = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .where('runId', '==', input.targetIdentity.runId);
    const retentionQuery = this.deps.firestore
      .collection(INTEX_AGENT_TEST_RUNS_COLLECTION)
      .where('userId', '==', input.currentIdentity.userId)
      .where('runtimeAudience', '==', 'home-dev')
      .orderBy('startedAt', 'desc')
      .limit(4);

    const [
      currentRunSnapshot,
      currentContextSnapshot,
      currentManifestSnapshot,
      targetRunSnapshot,
      targetContextSnapshot,
      targetManifestSnapshot,
      targetRecoverySnapshot,
      targetScenarioContextSnapshot,
      retentionSnapshot,
    ] = await Promise.all([
      currentRunRef.get(),
      currentContextRef.get(),
      currentManifestRef.get(),
      targetRunRef.get(),
      targetContextRef.get(),
      targetManifestRef.get(),
      targetRecoveryRef.get(),
      targetScenarioContextQuery.get(),
      retentionQuery.get(),
    ]);

    if (!currentRunSnapshot.exists || !currentContextSnapshot.exists || !currentManifestSnapshot.exists)
      return failure('NOT_FOUND');
    const current = parseRecord(currentRunSnapshot.data());
    const currentContext = parseMatrixCorpusRunContextDocument(currentContextSnapshot.data());
    const currentManifest = parseMatrixCorpusRunManifestDocument(currentManifestSnapshot.data());
    if (current === null || currentContext === undefined || currentManifest === undefined)
      return failure('CORRUPT_RECORD');
    if (
      !matchesIdentity(current, input.currentIdentity) ||
      !matchesIdentity(currentContext, input.currentIdentity) ||
      !matchesIdentity(currentManifest, input.currentIdentity)
    )
      return failure('CORRELATED_REPLAY_CONFLICT');
    if (
      current.lifecycle !== 'preflight' ||
      current.terminalWinner !== null ||
      currentContext.status !== 'active' ||
      currentManifest.terminalCandidate !== null ||
      currentManifest.scenarioBindings.length !== 0
    )
      return failure('INVALID_TRANSITION');

    const retentionCandidates = retentionSnapshot.docs.map((document) =>
      parseRecord(document.data())
    );
    if (retentionCandidates.some((record) => record === null))
      return failure('CORRUPT_RECORD');
    if (
      selectRetainedTestRuns(
        retentionCandidates as IntexAgentTestRunRecordV1[]
      ).some((record) => record.runId === input.targetIdentity.runId)
    )
      return failure('INVALID_TRANSITION');

    const targetRootsExist = [
      targetRunSnapshot.exists,
      targetContextSnapshot.exists,
      targetManifestSnapshot.exists,
    ];
    if (targetRootsExist.every((exists) => !exists)) {
      if (!current.retentionReconciled) return failure('EVIDENCE_MISMATCH');
      return cleanupSuccess('already_applied', current, emptyCleanupCounts());
    }
    if (targetRootsExist.some((exists) => !exists)) return failure('EVIDENCE_MISMATCH');

    const target = parseRecord(targetRunSnapshot.data());
    const targetContext = parseMatrixCorpusRunContextDocument(targetContextSnapshot.data());
    const targetManifest = parseMatrixCorpusRunManifestDocument(targetManifestSnapshot.data());
    const targetRecovery = targetRecoverySnapshot.exists
      ? parseRecoveryReceipt(targetRecoverySnapshot.data())
      : undefined;
    const targetScenarioContexts = targetScenarioContextSnapshot.docs.map((document) => ({
      ref: document.ref,
      context: parseMatrixCorpusScenarioContextDocument(document.data()),
    }));
    if (
      target === null ||
      targetContext === undefined ||
      targetManifest === undefined ||
      (targetRecoverySnapshot.exists && targetRecovery === undefined) ||
      targetScenarioContexts.some((entry) => entry.context === undefined)
    )
      return failure('CORRUPT_RECORD');
    if (
      !matchesIdentity(target, input.targetIdentity) ||
      !matchesIdentity(targetContext, input.targetIdentity) ||
      !matchesIdentity(targetManifest, input.targetIdentity) ||
      (targetRecovery !== undefined && !matchesIdentity(targetRecovery, input.targetIdentity)) ||
      targetScenarioContexts.some(
        (entry) =>
          entry.context === undefined || !matchesIdentity(entry.context, input.targetIdentity)
      )
    )
      return failure('CORRELATED_REPLAY_CONFLICT');
    if (
      !['completed', 'stopped'].includes(target.lifecycle) ||
      target.terminalWinner === null ||
      targetContext.status !== 'finalized' ||
      ['pending', 'staged'].includes(target.artifactDelivery.status)
    )
      return failure('INVALID_TRANSITION');
    if (
      target.contextFinalizationTombstoneDigest !==
        FirestoreTestRunRepository.digestContextFinalization(targetContext) ||
      stableJson(target.terminalCandidate) !== stableJson(targetManifest.terminalCandidate) ||
      (target.terminalWinner.kind === 'release' &&
        (target.terminalCandidate === null ||
          targetManifest.artifactStage === null ||
          target.terminalWinner.outcome !== target.terminalCandidate.outcome ||
          target.artifactStageDigest !== targetManifest.artifactStage.compositeDigest ||
          target.terminalCandidate.artifactStageRevision !==
            targetManifest.artifactStage.revision ||
          target.terminalCandidate.artifactCandidateDigest !==
            targetManifest.artifactStage.compositeDigest)) ||
      (target.terminalWinner.kind === 'abandoned' &&
        (targetRecovery?.eventId !== target.terminalWinner.eventId ||
          targetRecovery.payloadDigest !== target.terminalWinner.payloadDigest ||
          targetRecovery.outcome !== target.terminalWinner.outcome ||
          targetRecovery.acknowledgedAt !== target.terminalWinner.acknowledgedAt))
    )
      return failure('EVIDENCE_MISMATCH');

    const boundTargetScenarios = target.scenarios.filter(
      (scenario) => scenario.sessionId !== null
    );
    if (
      boundTargetScenarios.length !== targetManifest.scenarioBindings.length ||
      boundTargetScenarios.some((scenario) => {
        const binding = targetManifest.scenarioBindings.find(
          (candidate) => candidate.scenarioId === scenario.scenarioId
        );
        return (
          binding?.scenarioNumber !== scenario.scenarioNumber ||
          binding.scenarioLabel !== scenario.scenarioLabel ||
          binding.sessionId !== scenario.sessionId
        );
      })
    )
      return failure('EVIDENCE_MISMATCH');

    const evidence = await Promise.all(
      targetManifest.scenarioBindings.map(async (binding) => {
        const sessionRef = this.deps.firestore
          .collection(INTEX_AGENT_SESSIONS_COLLECTION)
          .doc(binding.sessionId);
        const eventQuery = this.deps.firestore
          .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
          .where('sessionId', '==', binding.sessionId);
        const confirmationQuery = this.deps.firestore
          .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
          .where('sessionId', '==', binding.sessionId);
        const ingestQuery = this.deps.firestore
          .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
          .where('sessionId', '==', binding.sessionId);
        const projectionRef = this.scenarioRef(input.targetIdentity.runId, binding.scenarioId);
        const [sessionSnapshot, eventSnapshot, confirmationSnapshot, ingestSnapshot, projectionSnapshot] =
          await Promise.all([
            sessionRef.get(),
            eventQuery.get(),
            confirmationQuery.get(),
            ingestQuery.get(),
            projectionRef.get(),
          ]);
        return {
          binding,
          sessionRef,
          sessionSnapshot,
          eventQuery,
          eventSnapshot,
          confirmationQuery,
          confirmationSnapshot,
          ingestQuery,
          ingestSnapshot,
          projectionRef,
          projectionSnapshot,
        };
      })
    );

    const childRefs: FirestoreDocumentReference[] = targetScenarioContexts.map(
      (entry) => entry.ref
    );
    const sessionRefs: FirestoreDocumentReference[] = [];
    const projectionRefs: FirestoreDocumentReference[] = [];
    const verificationQueries: ReturnType<ReturnType<Firestore['collection']>['where']>[] = [];
    const removed = emptyCleanupCounts();
    removed.scenarioContexts = targetScenarioContexts.length;
    for (const item of evidence) {
      const summary = target.scenarios.find(
        (scenario) => scenario.scenarioId === item.binding.scenarioId
      );
      const session = item.sessionSnapshot.exists
        ? parseMatrixCorpusSessionDocument(item.sessionSnapshot.id, item.sessionSnapshot.data())
        : undefined;
      const projection = item.projectionSnapshot.exists
        ? parseScenarioProjection(item.projectionSnapshot.data())
        : null;
      if (
        summary?.scenarioNumber !== item.binding.scenarioNumber ||
        summary.scenarioLabel !== item.binding.scenarioLabel ||
        summary.sessionId !== item.binding.sessionId ||
        session?.id !== item.binding.sessionId ||
        session.userId !== input.targetIdentity.userId ||
        session.matrixCorpusProfile.runId !== input.targetIdentity.runId ||
        session.matrixCorpusProfile.scenarioId !== item.binding.scenarioId ||
        session.matrixCorpusProfile.scenarioNumber !== item.binding.scenarioNumber ||
        session.matrixCorpusProfile.scenarioLabel !== item.binding.scenarioLabel ||
        session.matrixCorpusProfile.leaseFence !== input.targetIdentity.leaseFence ||
        projection?.userId !== input.targetIdentity.userId ||
        projection.runId !== input.targetIdentity.runId ||
        projection.scenarioId !== item.binding.scenarioId ||
        projection.sessionId !== item.binding.sessionId ||
        projection.sessionBindingDigest !== summary.sessionBindingDigest
      )
        return failure('EVIDENCE_MISMATCH');

      const events = item.eventSnapshot.docs.map((document) =>
        parseMatrixCorpusEventDocument(document.data())
      );
      if (
        events.some((event) => event === undefined) ||
        events.some(
          (event) =>
            event?.userId !== input.targetIdentity.userId ||
            event.sessionId !== item.binding.sessionId
        ) ||
        item.confirmationSnapshot.docs.some(
          (document) =>
            !matchesCleanupChild(
              document.data(),
              input.targetIdentity,
              item.binding,
              true
            )
        ) ||
        item.ingestSnapshot.docs.some(
          (document) =>
            !matchesCleanupChild(
              document.data(),
              input.targetIdentity,
              item.binding,
              false
            )
        )
      )
        return failure('EVIDENCE_MISMATCH');

      childRefs.push(
        ...item.eventSnapshot.docs.map((document) => document.ref),
        ...item.confirmationSnapshot.docs.map((document) => document.ref),
        ...item.ingestSnapshot.docs.map((document) => document.ref)
      );
      sessionRefs.push(item.sessionRef);
      projectionRefs.push(item.projectionRef);
      verificationQueries.push(item.eventQuery, item.confirmationQuery, item.ingestQuery);
      removed.sessions += 1;
      removed.events += item.eventSnapshot.docs.length;
      removed.confirmations += item.confirmationSnapshot.docs.length;
      removed.ingestReceipts += item.ingestSnapshot.docs.length;
      removed.scenarioProjections += 1;
    }

    for (let offset = 0; offset < childRefs.length; offset += 400) {
      const batch = this.deps.firestore.batch();
      for (const ref of childRefs.slice(offset, offset + 400)) batch.delete(ref);
      await batch.commit();
    }

    return await this.deps.firestore.runTransaction(async (transaction) => {
      const [
        stableCurrentSnapshot,
        stableTargetSnapshot,
        stableTargetContextSnapshot,
        stableTargetManifestSnapshot,
        stableScenarioContextSnapshot,
        stableTargetRecoverySnapshot,
        stableRetentionSnapshot,
      ] = await Promise.all([
        transaction.get(currentRunRef),
        transaction.get(targetRunRef),
        transaction.get(targetContextRef),
        transaction.get(targetManifestRef),
        transaction.get(targetScenarioContextQuery),
        transaction.get(targetRecoveryRef),
        transaction.get(retentionQuery),
      ]);
      const [stableSessionSnapshots, stableProjectionSnapshots, stableVerificationSnapshots] =
        await Promise.all([
          Promise.all(sessionRefs.map((ref) => transaction.get(ref))),
          Promise.all(projectionRefs.map((ref) => transaction.get(ref))),
          Promise.all(verificationQueries.map((query) => transaction.get(query))),
        ]);
      const stableCurrent = stableCurrentSnapshot.exists
        ? parseRecord(stableCurrentSnapshot.data())
        : null;
      const stableTarget = stableTargetSnapshot.exists
        ? parseRecord(stableTargetSnapshot.data())
        : null;
      const stableContext = stableTargetContextSnapshot.exists
        ? parseMatrixCorpusRunContextDocument(stableTargetContextSnapshot.data())
        : undefined;
      const stableManifest = stableTargetManifestSnapshot.exists
        ? parseMatrixCorpusRunManifestDocument(stableTargetManifestSnapshot.data())
        : undefined;
      const stableRetentionCandidates = stableRetentionSnapshot.docs.map((document) =>
        parseRecord(document.data())
      );
      if (
        stableCurrent === null ||
        stableTarget === null ||
        stableContext === undefined ||
        stableManifest === undefined
      )
        return failure('EVIDENCE_MISMATCH');
      if (
        stableRetentionCandidates.some((record) => record === null) ||
        selectRetainedTestRuns(
          stableRetentionCandidates as IntexAgentTestRunRecordV1[]
        ).some((record) => record.runId === input.targetIdentity.runId)
      )
        return failure('INVALID_TRANSITION');
      if (
        !matchesIdentity(stableCurrent, input.currentIdentity) ||
        stableJson(stableCurrent) !== stableJson(current) ||
        !matchesIdentity(stableTarget, input.targetIdentity) ||
        stableJson(stableTarget) !== stableJson(target) ||
        !matchesIdentity(stableContext, input.targetIdentity) ||
        stableJson(stableContext) !== stableJson(targetContext) ||
        !matchesIdentity(stableManifest, input.targetIdentity) ||
        stableJson(stableManifest) !== stableJson(targetManifest) ||
        stableTarget.contextFinalizationTombstoneDigest !==
          FirestoreTestRunRepository.digestContextFinalization(stableContext) ||
        stableJson(stableTarget.terminalCandidate) !==
          stableJson(stableManifest.terminalCandidate) ||
        stableTargetRecoverySnapshot.exists !== targetRecoverySnapshot.exists ||
        (stableTargetRecoverySnapshot.exists &&
          stableJson(stableTargetRecoverySnapshot.data()) !==
            stableJson(targetRecoverySnapshot.data())) ||
        stableScenarioContextSnapshot.docs.length !== 0 ||
        stableVerificationSnapshots.some((snapshot) => snapshot.docs.length !== 0)
      )
        return failure('EVIDENCE_MISMATCH');

      for (let index = 0; index < stableSessionSnapshots.length; index += 1) {
        const snapshot = stableSessionSnapshots[index] as (typeof stableSessionSnapshots)[number];
        const binding = targetManifest.scenarioBindings[
          index
        ] as (typeof targetManifest.scenarioBindings)[number];
        const session = snapshot.exists
          ? parseMatrixCorpusSessionDocument(snapshot.id, snapshot.data())
          : undefined;
        if (
          session?.id !== binding.sessionId ||
          session.userId !== input.targetIdentity.userId ||
          session.matrixCorpusProfile.runId !== input.targetIdentity.runId ||
          session.matrixCorpusProfile.scenarioId !== binding.scenarioId ||
          session.matrixCorpusProfile.leaseFence !== input.targetIdentity.leaseFence
        )
          return failure('EVIDENCE_MISMATCH');
      }
      if (
        stableProjectionSnapshots.some((snapshot, index) => {
          if (!snapshot.exists) return true;
          const projection = parseScenarioProjection(snapshot.data());
          const binding = targetManifest.scenarioBindings[
            index
          ] as (typeof targetManifest.scenarioBindings)[number];
          return (
            projection?.runId !== input.targetIdentity.runId ||
            projection.userId !== input.targetIdentity.userId ||
            projection.scenarioId !== binding.scenarioId ||
            projection.sessionId !== binding.sessionId
          );
        })
      )
        return failure('EVIDENCE_MISMATCH');

      const nextCurrent = intexAgentTestRunRecordV1Schema.parse({
        ...stableCurrent,
        revision: stableCurrent.revision + 1,
        retentionReconciled: true,
        updatedAt: input.updatedAt,
      });
      for (const ref of projectionRefs) transaction.delete(ref);
      for (const ref of sessionRefs) transaction.delete(ref);
      transaction.delete(targetRunRef);
      transaction.delete(targetContextRef);
      transaction.delete(targetManifestRef);
      if (stableTargetRecoverySnapshot.exists) transaction.delete(targetRecoveryRef);
      transaction.set(currentRunRef, cloneRecord(nextCurrent));
      removed.runs = 1;
      removed.runContexts = 1;
      removed.manifests = 1;
      return cleanupSuccess('applied', nextCurrent, removed);
    });
  }

  async createOrGet(
    record: IntexAgentTestRunRecordV1
  ): Promise<TestRunRepositoryMutationResult> {
    if (!checkTestRunDocumentSize(record).ok) return failure('DOCUMENT_TOO_LARGE');
    const parsed = intexAgentTestRunRecordV1Schema.safeParse(record);
    if (
      !parsed.success ||
      parsed.data.lifecycle !== 'preflight' ||
      parsed.data.revision !== 0 ||
      parsed.data.terminalCandidate !== null ||
      parsed.data.terminalWinner !== null
    )
      return failure('INVALID_INPUT');
    const ref = this.runRef(parsed.data.runId);
    const recoveryRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION)
      .doc(parsed.data.runId);
    return await this.deps.firestore.runTransaction(async (transaction) => {
      const [snapshot, recoverySnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(recoveryRef),
      ]);
      if (recoverySnapshot.exists) return failure('TERMINAL_CONFLICT');
      if (snapshot.exists) {
        const existing = parseRecord(snapshot.data());
        if (existing === null) return failure('CORRUPT_RECORD');
        return stableJson(existing) === stableJson(parsed.data)
          ? success('already_applied', existing)
          : failure('CORRELATED_REPLAY_CONFLICT');
      }
      transaction.set(ref, cloneRecord(parsed.data));
      return success('applied', parsed.data);
    });
  }

  async getExact(identity: TestRunIdentity): Promise<TestRunRepositoryGetResult> {
    if (!isValidIdentity(identity)) return failure('INVALID_INPUT');
    const snapshot = await this.runRef(identity.runId).get();
    if (!snapshot.exists) return failure('NOT_FOUND');
    const record = parseRecord(snapshot.data());
    if (record === null) return failure('CORRUPT_RECORD');
    if (!matchesIdentity(record, identity)) return failure('CORRELATED_REPLAY_CONFLICT');
    return { ok: true, record: cloneRecord(record) };
  }

  async getOwned(runId: string, userId: string): Promise<TestRunRepositoryGetResult> {
    if (!SAFE_ID_PATTERN.test(runId) || !SAFE_ID_PATTERN.test(userId))
      return failure('INVALID_INPUT');
    const snapshot = await this.runRef(runId).get();
    if (!snapshot.exists) return failure('NOT_FOUND');
    const record = parseRecord(snapshot.data());
    if (record === null) return failure('CORRUPT_RECORD');
    if (record.userId !== userId) return failure('NOT_FOUND');
    return { ok: true, record: cloneRecord(record) };
  }

  async getScenarioConsistent(
    input: Parameters<TestRunRepository['getScenarioConsistent']>[0]
  ): Promise<TestRunScenarioReadResult> {
    if (
      !SAFE_ID_PATTERN.test(input.runId) ||
      !SAFE_ID_PATTERN.test(input.scenarioId) ||
      !SAFE_ID_PATTERN.test(input.userId)
    )
      return failure('INVALID_INPUT');

    return await this.deps.firestore.runTransaction(async (transaction) => {
      const runSnapshot = await transaction.get(this.runRef(input.runId));
      if (!runSnapshot.exists) return failure('NOT_FOUND');
      const run = parseRecord(runSnapshot.data());
      if (run === null) return failure('CORRUPT_RECORD');
      if (run.userId !== input.userId) return failure('NOT_FOUND');
      const summary = run.scenarios.find((scenario) => scenario.scenarioId === input.scenarioId);
      if (
        summary?.sessionId === undefined ||
        summary.sessionId === null ||
        summary.sessionBindingDigest === null
      )
        return failure('NOT_FOUND');

      const projectionRef = this.scenarioRef(input.runId, input.scenarioId);
      const sessionRef = this.deps.firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc(summary.sessionId);
      const [projectionSnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(projectionRef),
        transaction.get(sessionRef),
      ]);
      if (!projectionSnapshot.exists || !sessionSnapshot.exists) return failure('NOT_FOUND');
      const projection = parseScenarioProjection(projectionSnapshot.data());
      const session = parseMatrixCorpusSessionDocument(
        sessionSnapshot.id,
        sessionSnapshot.data()
      );
      if (projection === null || session === undefined) return failure('CORRUPT_RECORD');
      if (
        projection.userId !== input.userId ||
        projection.runId !== input.runId ||
        projection.scenarioId !== input.scenarioId ||
        summary.sessionId !== projection.sessionId ||
        summary.sessionBindingDigest !== projection.sessionBindingDigest ||
        summary.scenarioRevision !== projection.scenarioRevision ||
        summary.eventWatermark !== projection.eventWatermark ||
        projection.runRevision > run.revision ||
        session.id !== summary.sessionId ||
        session.userId !== input.userId ||
        session.matrixCorpusProfile.runId !== input.runId ||
        session.matrixCorpusProfile.scenarioId !== input.scenarioId ||
        session.matrixCorpusProfile.scenarioNumber !== summary.scenarioNumber ||
        session.matrixCorpusProfile.scenarioLabel !== summary.scenarioLabel ||
        session.matrixCorpusProfile.leaseFence !== run.leaseFence ||
        session.lastEventSequence < projection.eventWatermark
      )
        return failure('CORRUPT_RECORD');

      const eventSnapshot = await transaction.get(
        this.deps.firestore
          .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
          .where('sessionId', '==', projection.sessionId)
          .where('eventSequence', '<=', projection.eventWatermark)
          .orderBy('eventSequence', 'asc')
      );

      const events = eventSnapshot.docs.map((document) =>
        parseMatrixCorpusEventDocument(document.data())
      );
      if (
        events.some((event) => event === undefined) ||
        events.length !== projection.eventWatermark ||
        events.some(
          (event, index) =>
            event?.sessionId !== projection.sessionId ||
            event.userId !== input.userId ||
            event.eventSequence !== index + 1
        )
      )
        return failure('STALE_PROJECTION');
      return {
        ok: true,
        run: cloneRecord(run),
        projection: structuredClone(projection),
        events: structuredClone(events as NonNullable<(typeof events)[number]>[]),
      };
    });
  }

  async applyProjection(
    input: Parameters<TestRunRepository['applyProjection']>[0]
  ): Promise<TestRunRepositoryMutationResult> {
    if (!isValidIdentity(input.identity)) return failure('INVALID_INPUT');
    if (input.command.nextLifecycle === 'finalizing')
      return failure('INVALID_TRANSITION');
    if (
      input.command.scenario !== null &&
      !checkTestRunScenarioDocumentSize(input.command.scenario.projection).ok
    )
      return failure('DOCUMENT_TOO_LARGE');
    const ref = this.runRef(input.identity.runId);
    return await this.deps.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return failure('NOT_FOUND');
      const current = parseRecord(snapshot.data());
      if (current === null) return failure('CORRUPT_RECORD');
      if (!matchesIdentity(current, input.identity))
        return failure('CORRELATED_REPLAY_CONFLICT');
      if (input.command.retentionReconciled === true) {
        const retentionSnapshot = await transaction.get(
          this.deps.firestore
            .collection(INTEX_AGENT_TEST_RUNS_COLLECTION)
            .where('userId', '==', input.identity.userId)
            .where('runtimeAudience', '==', 'home-dev')
            .orderBy('startedAt', 'desc')
            .limit(TEST_RUN_RETENTION_QUERY_LIMIT)
        );
        const candidates = retentionSnapshot.docs.map((document) =>
          parseRecord(document.data())
        );
        if (
          candidates.some((record) => record === null) ||
          !candidates.some(
            (record) => record !== null && matchesIdentity(record, input.identity)
          )
        )
          return failure('EVIDENCE_MISMATCH');
        const retainedIds = new Set(
          selectRetainedTestRuns(
            candidates as IntexAgentTestRunRecordV1[]
          ).map((record) => record.runId)
        );
        if (
          candidates.some(
            (record) =>
              record !== null &&
              (record.lifecycle === 'completed' || record.lifecycle === 'stopped') &&
              !retainedIds.has(record.runId)
          )
        )
          return failure('INVALID_TRANSITION');
        if (current.retentionReconciled) {
          return current.revision === input.command.expectedRevision ||
            current.revision === input.command.expectedRevision + 1
            ? success('already_applied', current)
            : failure('REVISION_CONFLICT');
        }
      }
      if (
        input.command.scenario === null &&
        input.command.retentionReconciled !== true &&
        isExactProjectionRetry(current, input.command, null)
      )
        return success('already_applied', current);
      let evidenceProjections: TestRunScenarioProjectionV1[] | null = null;
      if (input.command.scenario !== null) {
        const manifestRef = this.deps.firestore
          .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
          .doc(input.identity.runId);
        const sessionRef = this.deps.firestore
          .collection(INTEX_AGENT_SESSIONS_COLLECTION)
          .doc(input.command.scenario.sessionId);
        const eventQuery = this.deps.firestore
          .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
          .where('sessionId', '==', input.command.scenario.sessionId);
        const projectionRef = this.scenarioRef(
          input.identity.runId,
          input.command.scenario.scenarioId
        );
        const [manifestSnapshot, sessionSnapshot, eventSnapshot, projectionSnapshot] = await Promise.all([
          transaction.get(manifestRef),
          transaction.get(sessionRef),
          transaction.get(eventQuery),
          transaction.get(projectionRef),
        ]);
        const manifest = manifestSnapshot.exists
          ? parseMatrixCorpusRunManifestDocument(manifestSnapshot.data())
          : undefined;
        const session = sessionSnapshot.exists
          ? parseMatrixCorpusSessionDocument(sessionSnapshot.id, sessionSnapshot.data())
          : undefined;
        const binding = manifest?.scenarioBindings.find(
          (candidate) => candidate.scenarioId === input.command.scenario?.scenarioId
        );
        if (
          manifest?.runId !== input.identity.runId ||
          manifest.userId !== input.identity.userId ||
          manifest.leaseFence !== input.identity.leaseFence ||
          binding?.sessionId !== input.command.scenario.sessionId ||
          session?.id !== input.command.scenario.sessionId ||
          session.userId !== input.identity.userId ||
          session.matrixCorpusProfile.runId !== input.identity.runId ||
          session.matrixCorpusProfile.scenarioId !== input.command.scenario.scenarioId ||
          session.matrixCorpusProfile.leaseFence !== input.identity.leaseFence
        )
          return failure('EVIDENCE_MISMATCH');

        const events = eventSnapshot.docs.map((document) =>
          parseMatrixCorpusEventDocument(document.data())
        );
        if (
          events.some((event) => event === undefined) ||
          events.length !== session.lastEventSequence ||
          input.command.scenario.eventWatermark > session.lastEventSequence
        )
          return failure('EVENT_WATERMARK_GAP');
        const exactEvents = events as NonNullable<(typeof events)[number]>[];
        exactEvents.sort(
          (left, right) => Number(left.eventSequence) - Number(right.eventSequence)
        );
        if (
          exactEvents.some(
            (event, index) =>
              event.userId !== input.identity.userId ||
              event.sessionId !== input.command.scenario?.sessionId ||
              event.eventSequence !== index + 1
          )
        )
          return failure('EVENT_WATERMARK_GAP');
        const existingProjection = projectionSnapshot.exists
          ? parseScenarioProjection(projectionSnapshot.data())
          : null;
        if (isExactProjectionRetry(current, input.command, existingProjection))
          return success('already_applied', current);
        if (
          (projectionSnapshot.exists && existingProjection === null) ||
          (existingProjection !== null &&
            (existingProjection.runId !== input.identity.runId ||
              existingProjection.userId !== input.identity.userId ||
              existingProjection.sessionId !== input.command.scenario.sessionId ||
              existingProjection.sessionBindingDigest !==
                input.command.scenario.sessionBindingDigest ||
              existingProjection.scenarioRevision !==
                input.command.scenario.expectedScenarioRevision)) ||
          (!projectionSnapshot.exists && input.command.scenario.expectedScenarioRevision !== 0)
        )
          return failure(
            projectionSnapshot.exists ? 'SCENARIO_REVISION_CONFLICT' : 'EVIDENCE_MISMATCH'
          );
        const allProjectionSnapshot = await transaction.get(
          this.deps.firestore
            .collection(INTEX_AGENT_TEST_RUN_SCENARIOS_COLLECTION)
            .where('runId', '==', input.identity.runId)
        );
        const parsedProjections = allProjectionSnapshot.docs.map((document) =>
          parseScenarioProjection(document.data())
        );
        if (
          parsedProjections.some((projection) => projection === null) ||
          parsedProjections.some(
            (projection) =>
              projection?.runId !== input.identity.runId ||
              projection.userId !== input.identity.userId
          )
        )
          return failure('CORRUPT_RECORD');
        const byScenario = new Map(
          (parsedProjections as TestRunScenarioProjectionV1[]).map((projection) => [
            projection.scenarioId,
            projection,
          ])
        );
        byScenario.set(input.command.scenario.scenarioId, input.command.scenario.projection);
        evidenceProjections = [...byScenario.values()];
      }
      const transitioned = applyTestRunProjectionCas(current, input.command);
      if (!transitioned.ok) return failure(mapTransitionFailure(transitioned.code));
      const derived =
        evidenceProjections === null
          ? null
          : deriveTestRunEvidenceTotals(transitioned.record.scenarios, evidenceProjections);
      if (evidenceProjections !== null && derived === null)
        return failure('INVALID_TRANSITION');
      const nextRecord =
        derived === null
          ? transitioned.record
          : intexAgentTestRunRecordV1Schema.parse({
              ...transitioned.record,
              totals: derived.totals,
              cost: derived.cost,
            });
      transaction.set(ref, cloneRecord(nextRecord));
      if (input.command.scenario !== null)
        transaction.set(
          this.scenarioRef(input.identity.runId, input.command.scenario.scenarioId),
          structuredClone(input.command.scenario.projection)
        );
      return success(transitioned.disposition, nextRecord);
    });
  }

  async applyArtifactDelivery(
    input: Parameters<TestRunRepository['applyArtifactDelivery']>[0]
  ): Promise<TestRunRepositoryMutationResult> {
    if (!isValidIdentity(input.identity)) return failure('INVALID_INPUT');
    const ref = this.runRef(input.identity.runId);
    const manifestRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.identity.runId);
    return await this.deps.firestore.runTransaction(async (transaction) => {
      const [snapshot, manifestSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(manifestRef),
      ]);
      if (!snapshot.exists || !manifestSnapshot.exists) return failure('NOT_FOUND');
      const current = parseRecord(snapshot.data());
      const manifest = parseMatrixCorpusRunManifestDocument(manifestSnapshot.data());
      if (current === null || manifest === undefined) return failure('CORRUPT_RECORD');
      if (!matchesIdentity(current, input.identity) || !matchesIdentity(manifest, input.identity))
        return failure('CORRELATED_REPLAY_CONFLICT');
      if (isExactArtifactDeliveryRetry(current, manifest, input.command))
        return success('already_applied', current);
      const transitioned = applyArtifactDeliveryTransition(current, input.command);
      if (!transitioned.ok) return failure(mapTransitionFailure(transitioned.code));
      transaction.set(ref, cloneRecord(transitioned.record));
      if (input.command.next.status === 'staged') {
        if (manifest.artifactStage !== null) return failure('CORRELATED_REPLAY_CONFLICT');
        const compositeDigest = digestArtifactCandidates(
          input.command.next.jsonCandidateDigest,
          input.command.next.markdownCandidateDigest
        );
        transaction.set(manifestRef, {
          ...manifest,
          artifactStage: {
            revision: transitioned.record.revision,
            jsonCandidateDigest: input.command.next.jsonCandidateDigest,
            markdownCandidateDigest: input.command.next.markdownCandidateDigest,
            compositeDigest,
            stagedAt: input.command.updatedAt,
          },
        });
      }
      return success(transitioned.disposition, transitioned.record);
    });
  }

  async finalizeRun(
    input: Parameters<TestRunRepository['finalizeRun']>[0]
  ): Promise<TestRunRepositoryFinalizationResult> {
    const parsedCandidate = matrixCorpusTerminalCandidateV1Schema.safeParse(
      input.terminalCandidate
    );
    if (
      !isValidIdentity(input.identity) ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !isRfc3339(input.updatedAt) ||
      !SHA_256_PATTERN.test(input.artifactStageDigest) ||
      !parsedCandidate.success ||
      !matchesIdentity(parsedCandidate.data, input.identity)
    )
      return failure('INVALID_INPUT');

    const runRef = this.runRef(input.identity.runId);
    const contextRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc(input.identity.runId);
    const manifestRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.identity.runId);
    const scenarioQuery = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .where('runId', '==', input.identity.runId);

    return await this.deps.firestore.runTransaction(async (transaction) => {
      const [runSnapshot, contextSnapshot, manifestSnapshot, scenarioSnapshot] =
        await Promise.all([
          transaction.get(runRef),
          transaction.get(contextRef),
          transaction.get(manifestRef),
          transaction.get(scenarioQuery),
        ]);
      if (!runSnapshot.exists || !contextSnapshot.exists || !manifestSnapshot.exists)
        return failure('NOT_FOUND');

      const current = parseRecord(runSnapshot.data());
      const context = parseMatrixCorpusRunContextDocument(contextSnapshot.data());
      const manifest = parseMatrixCorpusRunManifestDocument(manifestSnapshot.data());
      if (current === null || context === undefined || manifest === undefined)
        return failure('CORRUPT_RECORD');
      if (
        !matchesIdentity(current, input.identity) ||
        !matchesIdentity(context, input.identity) ||
        !matchesIdentity(manifest, input.identity)
      )
        return failure('CORRELATED_REPLAY_CONFLICT');

      const scenarios = scenarioSnapshot.docs.map((document) => ({
        ref: document.ref,
        context: parseMatrixCorpusScenarioContextDocument(document.data()),
      }));
      if (scenarios.some((entry) => entry.context === undefined))
        return failure('CORRUPT_RECORD');

      if (context.status === 'finalized' || current.lifecycle === 'finalizing') {
        if (
          context.status !== 'finalized' ||
          current.lifecycle !== 'finalizing' ||
          scenarios.length !== 0 ||
          context.finalizedAt !== input.updatedAt ||
          manifest.terminalCandidate === null ||
          manifest.artifactStage === null ||
          stableJson(manifest.terminalCandidate) !== stableJson(parsedCandidate.data) ||
          stableJson(current.terminalCandidate) !== stableJson(parsedCandidate.data) ||
          current.artifactStageDigest !== input.artifactStageDigest ||
          manifest.artifactStage.compositeDigest !== input.artifactStageDigest ||
          parsedCandidate.data.artifactStageRevision !== manifest.artifactStage.revision ||
          parsedCandidate.data.artifactCandidateDigest !== manifest.artifactStage.compositeDigest ||
          current.contextFinalizationTombstoneDigest !==
            FirestoreTestRunRepository.digestContextFinalization(context)
        )
          return failure('FINALIZATION_MISMATCH');
        return finalizationSuccess('already_applied', current, context);
      }

      if (current.revision !== input.expectedRevision)
        return failure('REVISION_CONFLICT');
      if (
        current.lifecycle !== 'running' ||
        context.invalidatedAt !== null ||
        Date.parse(input.updatedAt) >= Date.parse(context.expiresAt) ||
        context.catalogDigest !== current.catalogDigest ||
        manifest.catalogDigest !== current.catalogDigest ||
        manifest.artifactStage?.revision !== parsedCandidate.data.artifactStageRevision ||
        manifest.artifactStage.compositeDigest !== input.artifactStageDigest ||
        parsedCandidate.data.artifactCandidateDigest !== manifest.artifactStage.compositeDigest ||
        manifest.terminalCandidate !== null ||
        scenarios.length !== manifest.scenarioBindings.length
      )
        return failure('FINALIZATION_MISMATCH');

      const scenarioById = new Map(
        scenarios.map((entry) => [entry.context?.scenarioId, entry])
      );
      for (const binding of manifest.scenarioBindings) {
        const scenario = scenarioById.get(binding.scenarioId)?.context;
        const projection = current.scenarios.find(
          (candidate) => candidate.scenarioId === binding.scenarioId
        );
        if (
          scenario === undefined ||
          !matchesIdentity(scenario, input.identity) ||
          scenario.invalidatedAt !== null ||
          scenario.expiresAt !== context.expiresAt ||
          scenario.baselinePromptPreferencesDigest !== context.promptPreferencesDigest ||
          projection?.scenarioNumber !== binding.scenarioNumber ||
          projection.scenarioLabel !== binding.scenarioLabel ||
          projection.sessionId !== binding.sessionId
        )
          return failure('FINALIZATION_MISMATCH');
      }

      const sessionEvidence = await Promise.all(
        manifest.scenarioBindings.map(async (binding) => {
          const sessionRef = this.deps.firestore
            .collection(INTEX_AGENT_SESSIONS_COLLECTION)
            .doc(binding.sessionId);
          const eventQuery = this.deps.firestore
            .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
            .where('sessionId', '==', binding.sessionId);
          const projectionRef = this.scenarioRef(input.identity.runId, binding.scenarioId);
          const [sessionSnapshot, eventSnapshot, projectionSnapshot] = await Promise.all([
            transaction.get(sessionRef),
            transaction.get(eventQuery),
            transaction.get(projectionRef),
          ]);
          return { binding, sessionSnapshot, eventSnapshot, projectionSnapshot };
        })
      );
      const finalizedProjections: TestRunScenarioProjectionV1[] = [];
      for (const evidence of sessionEvidence) {
        const summary = current.scenarios.find(
          (scenario) => scenario.scenarioId === evidence.binding.scenarioId
        );
        const projection = evidence.projectionSnapshot.exists
          ? parseScenarioProjection(evidence.projectionSnapshot.data())
          : null;
        const session = evidence.sessionSnapshot.exists
          ? parseMatrixCorpusSessionDocument(
              evidence.sessionSnapshot.id,
              evidence.sessionSnapshot.data()
            )
          : undefined;
        if (
          summary?.sessionBindingDigest === undefined ||
          projection?.runId !== input.identity.runId ||
          projection.userId !== input.identity.userId ||
          projection.scenarioId !== evidence.binding.scenarioId ||
          projection.sessionId !== evidence.binding.sessionId ||
          projection.sessionBindingDigest !== summary.sessionBindingDigest ||
          projection.runRevision > current.revision ||
          projection.scenarioRevision !== summary.scenarioRevision ||
          projection.eventWatermark !== summary.eventWatermark ||
          session?.id !== evidence.binding.sessionId ||
          session.userId !== input.identity.userId ||
          session.matrixCorpusProfile.runId !== input.identity.runId ||
          session.matrixCorpusProfile.scenarioId !== evidence.binding.scenarioId ||
          session.matrixCorpusProfile.leaseFence !== input.identity.leaseFence
        )
          return failure('EVIDENCE_MISMATCH');
        const events = evidence.eventSnapshot.docs.map((document) =>
          parseMatrixCorpusEventDocument(document.data())
        );
        if (
          events.some((event) => event === undefined) ||
          events.length !== session.lastEventSequence ||
          summary.eventWatermark !== session.lastEventSequence
        )
          return failure('EVENT_WATERMARK_GAP');
        const exactEvents = events as NonNullable<(typeof events)[number]>[];
        exactEvents.sort(
          (left, right) => Number(left.eventSequence) - Number(right.eventSequence)
        );
        if (
          exactEvents.some(
            (event, index) =>
              event.userId !== input.identity.userId ||
              event.sessionId !== evidence.binding.sessionId ||
              event.eventSequence !== index + 1
          )
        )
          return failure('EVENT_WATERMARK_GAP');
        finalizedProjections.push(projection);
      }

      if (
        parsedCandidate.data.projectionDigest !==
        FirestoreTestRunRepository.digestProjection(current, finalizedProjections)
      )
        return failure('FINALIZATION_MISMATCH');
      const finalizedEvidence = deriveTestRunEvidenceTotals(
        current.scenarios,
        finalizedProjections
      );
      if (
        finalizedEvidence === null ||
        stableJson(finalizedEvidence.totals) !== stableJson(current.totals) ||
        stableJson(finalizedEvidence.cost) !== stableJson(current.cost)
      )
        return failure('EVIDENCE_MISMATCH');

      const tombstone = {
        version: 1 as const,
        status: 'finalized' as const,
        runtimeAudience: 'home-dev' as const,
        runId: input.identity.runId,
        userId: input.identity.userId,
        leaseFence: input.identity.leaseFence,
        scenarioContextCount: scenarios.length,
        finalizedAt: input.updatedAt,
      };
      const tombstoneDigest =
        FirestoreTestRunRepository.digestContextFinalization(tombstone);
      const transitioned = applyTestRunProjectionCas(current, {
        expectedRevision: input.expectedRevision,
        nextLifecycle: 'finalizing',
        updatedAt: input.updatedAt,
        scenario: null,
        finalization: {
          tombstoneDigest,
          artifactStageDigest: input.artifactStageDigest,
          terminalCandidate: parsedCandidate.data,
        },
      });
      if (!transitioned.ok) return failure(mapTransitionFailure(transitioned.code));

      for (const scenario of scenarios) transaction.delete(scenario.ref);
      transaction.set(contextRef, tombstone);
      transaction.set(manifestRef, {
        ...manifest,
        terminalCandidate: structuredClone(parsedCandidate.data),
      });
      transaction.set(runRef, cloneRecord(transitioned.record));
      return finalizationSuccess('applied', transitioned.record, tombstone);
    });
  }

  async applyTerminalControl(
    input: Parameters<TestRunRepository['applyTerminalControl']>[0]
  ): Promise<TestRunRepositoryMutationResult> {
    if (!isValidIdentity(input.identity)) return failure('INVALID_INPUT');
    const ref = this.runRef(input.identity.runId);
    return await this.deps.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return failure('NOT_FOUND');
      const current = parseRecord(snapshot.data());
      if (current === null) return failure('CORRUPT_RECORD');
      if (!matchesIdentity(current, input.identity))
        return failure('CORRELATED_REPLAY_CONFLICT');
      const candidateDigest =
        current.terminalCandidate === null
          ? null
          : FirestoreTestRunRepository.digestTerminalCandidate(current.terminalCandidate);
      const transitioned = applyTestRunTerminalControl(
        current,
        input.command,
        candidateDigest
      );
      if (!transitioned.ok) return failure(mapTransitionFailure(transitioned.code));
      if (transitioned.disposition === 'applied')
        transaction.set(ref, cloneRecord(transitioned.record));
      return success(transitioned.disposition, transitioned.record);
    });
  }

  async applyAbandonedRecovery(
    input: Parameters<TestRunRepository['applyAbandonedRecovery']>[0]
  ): Promise<TestRunRepositoryAbandonedRecoveryResult> {
    if (
      !isValidIdentity(input.identity) ||
      !SAFE_ID_PATTERN.test(input.command.eventId) ||
      !SHA_256_PATTERN.test(input.command.payloadDigest) ||
      !isRfc3339(input.command.acknowledgedAt)
    )
      return failure('INVALID_INPUT');

    const runRef = this.runRef(input.identity.runId);
    const contextRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc(input.identity.runId);
    const manifestRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.identity.runId);
    const recoveryRef = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION)
      .doc(input.identity.runId);
    const scenarioQuery = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .where('runId', '==', input.identity.runId);
    const sessionQuery = this.deps.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .where('matrixCorpusProfile.runId', '==', input.identity.runId);
    const ingestQuery = this.deps.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .where('runId', '==', input.identity.runId);
    const confirmationQuery = this.deps.firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .where('runId', '==', input.identity.runId);

    return await this.deps.firestore.runTransaction(async (transaction) => {
      const [
        runSnapshot,
        contextSnapshot,
        manifestSnapshot,
        recoverySnapshot,
        scenarioSnapshot,
        sessionSnapshot,
        ingestSnapshot,
        confirmationSnapshot,
      ] = await Promise.all([
        transaction.get(runRef),
        transaction.get(contextRef),
        transaction.get(manifestRef),
        transaction.get(recoveryRef),
        transaction.get(scenarioQuery),
        transaction.get(sessionQuery),
        transaction.get(ingestQuery),
        transaction.get(confirmationQuery),
      ]);

      if (recoverySnapshot.exists) {
        const receipt = parseRecoveryReceipt(recoverySnapshot.data());
        if (receipt === undefined) return failure('CORRUPT_RECORD');
        if (!matchesIdentity(receipt, input.identity))
          return failure('CORRELATED_REPLAY_CONFLICT');
        return abandonedRecoverySuccess('already_applied', receipt);
      }

      const parsedCurrent = runSnapshot.exists ? parseRecord(runSnapshot.data()) : undefined;
      const context = contextSnapshot.exists
        ? parseMatrixCorpusRunContextDocument(contextSnapshot.data())
        : undefined;
      const manifest = manifestSnapshot.exists
        ? parseMatrixCorpusRunManifestDocument(manifestSnapshot.data())
        : undefined;
      const scenarios = scenarioSnapshot.docs.map((document) => ({
        ref: document.ref,
        context: parseMatrixCorpusScenarioContextDocument(document.data()),
      }));
      if (
        (runSnapshot.exists && parsedCurrent === null) ||
        (contextSnapshot.exists && context === undefined) ||
        (manifestSnapshot.exists && manifest === undefined) ||
        scenarios.some((entry) => entry.context === undefined)
      )
        return failure('CORRUPT_RECORD');
      const exactScenarios = scenarios as {
        ref: FirestoreDocumentReference;
        context: MatrixCorpusPrivateScenarioContextV1;
      }[];
      const current = parsedCurrent ?? undefined;
      if (
        (current !== undefined && !matchesIdentity(current, input.identity)) ||
        (context !== undefined && !matchesIdentity(context, input.identity)) ||
        (manifest !== undefined && !matchesIdentity(manifest, input.identity)) ||
        exactScenarios.some((entry) => !matchesIdentity(entry.context, input.identity))
      )
        return failure('CORRELATED_REPLAY_CONFLICT');
      if (
        sessionSnapshot.docs.some(
          (document) => !hasExactMatrixRunEvidence(document.data(), input.identity)
        ) ||
        ingestSnapshot.docs.some(
          (document) => !matchesRunFence(document.data(), input.identity)
        ) ||
        confirmationSnapshot.docs.some(
          (document) => !matchesRunFenceAndUser(document.data(), input.identity)
        )
      )
        return failure('CORRELATED_REPLAY_CONFLICT');

      const hasExecutionEvidence =
        sessionSnapshot.docs.length > 0 ||
        ingestSnapshot.docs.length > 0 ||
        confirmationSnapshot.docs.length > 0;

      if (current === undefined || current.lifecycle === 'preflight') {
        if (hasExecutionEvidence) return failure('EVIDENCE_MISMATCH');
        const hasProvisioning =
          current !== undefined ||
          context !== undefined ||
          manifest !== undefined ||
          exactScenarios.length > 0;
        if (current !== undefined) transaction.delete(runRef);
        if (context !== undefined) transaction.delete(contextRef);
        if (manifest !== undefined) transaction.delete(manifestRef);
        for (const scenario of exactScenarios) transaction.delete(scenario.ref);
        const receipt = createRecoveryReceipt(
          input,
          hasProvisioning ? 'provisioning_rolled_back' : 'provisioning_noop'
        );
        transaction.set(recoveryRef, receipt);
        return abandonedRecoverySuccess('applied', receipt);
      }

      if (current.lifecycle === 'completed' || current.lifecycle === 'stopped') {
        return {
          ok: true,
          disposition: 'already_applied',
          winner: structuredClone(current.terminalWinner as TestRunTerminalWinnerV1),
        };
      }

      if (context === undefined || manifest === undefined)
        return failure('FINALIZATION_MISMATCH');
      let contextFinalizationTombstoneDigest = current.contextFinalizationTombstoneDigest;
      if (current.lifecycle === 'running') {
        if (
          context.status !== 'active' ||
          manifest.terminalCandidate !== null ||
          context.catalogDigest !== current.catalogDigest ||
          manifest.catalogDigest !== current.catalogDigest ||
          exactScenarios.length !== manifest.scenarioBindings.length
        )
          return failure('FINALIZATION_MISMATCH');
        const scenarioById = new Map(
          exactScenarios.map((entry) => [entry.context.scenarioId, entry.context])
        );
        for (const binding of manifest.scenarioBindings) {
          const scenario = scenarioById.get(binding.scenarioId);
          if (
            scenario?.expiresAt !== context.expiresAt ||
            scenario.baselinePromptPreferencesDigest !== context.promptPreferencesDigest
          )
            return failure('FINALIZATION_MISMATCH');
        }
        const tombstone = {
          version: 1 as const,
          status: 'finalized' as const,
          runtimeAudience: 'home-dev' as const,
          runId: input.identity.runId,
          userId: input.identity.userId,
          leaseFence: input.identity.leaseFence,
          scenarioContextCount: exactScenarios.length,
          finalizedAt: input.command.acknowledgedAt,
        };
        for (const scenario of exactScenarios) transaction.delete(scenario.ref);
        transaction.set(contextRef, tombstone);
        contextFinalizationTombstoneDigest =
          FirestoreTestRunRepository.digestContextFinalization(tombstone);
      } else if (context.status !== 'finalized' || exactScenarios.length !== 0) {
        return failure('FINALIZATION_MISMATCH');
      } else if (
        current.contextFinalizationTombstoneDigest !==
        FirestoreTestRunRepository.digestContextFinalization(context)
      ) {
        return failure('FINALIZATION_MISMATCH');
      }

      const transitioned = applyTestRunTerminalControl(
        current,
        input.command,
        null
      ) as Extract<ReturnType<typeof applyTestRunTerminalControl>, { ok: true }>;
      const recoveredRecord = {
        ...transitioned.record,
        contextFinalizationTombstoneDigest,
      } as IntexAgentTestRunRecordV1;
      const winner = recoveredRecord.terminalWinner as Extract<
        TestRunTerminalWinnerV1,
        { kind: 'abandoned' }
      >;
      const receipt = createRecoveryReceipt(input, winner.outcome);
      transaction.set(runRef, cloneRecord(recoveredRecord));
      transaction.set(recoveryRef, receipt);
      return abandonedRecoverySuccess('applied', receipt);
    });
  }

  private runRef(runId: string): FirestoreDocumentReference {
    return this.deps.firestore.collection(INTEX_AGENT_TEST_RUNS_COLLECTION).doc(runId);
  }

  private scenarioRef(runId: string, scenarioId: string): FirestoreDocumentReference {
    const documentId = createHash('sha256')
      .update(`v1\u0000${runId}\u0000${scenarioId}`, 'utf8')
      .digest('hex');
    return this.deps.firestore
      .collection(INTEX_AGENT_TEST_RUN_SCENARIOS_COLLECTION)
      .doc(`v1_${documentId}`);
  }
}

function parseRecord(value: unknown): IntexAgentTestRunRecordV1 | null {
  const parsed = intexAgentTestRunRecordV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseScenarioProjection(value: unknown): TestRunScenarioProjectionV1 | null {
  const parsed = testRunScenarioProjectionV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function matchesIdentity(
  record: TestRunIdentity,
  identity: TestRunIdentity
): boolean {
  return (
    record.runId === identity.runId &&
    record.userId === identity.userId &&
    record.leaseFence === identity.leaseFence
  );
}

function classifyCurrentAcceptance(
  record: IntexAgentTestRunRecordV1
): TestRunCurrentAcceptance {
  if (
    record.lifecycle === 'preflight' ||
    record.lifecycle === 'running' ||
    record.lifecycle === 'finalizing'
  )
    return { kind: 'admission_blocked', reason: record.lifecycle };
  if (record.artifactDelivery.status === 'pending')
    return { kind: 'admission_blocked', reason: 'artifact_pending' };
  if (record.artifactDelivery.status === 'staged')
    return { kind: 'admission_blocked', reason: 'artifact_staged' };
  if (record.artifactDelivery.status === 'ready')
    return { kind: 'admission_ready', current: 'terminal_artifact_ready' };
  if (record.artifactDelivery.status === 'unknown')
    return { kind: 'admission_ready', current: 'terminal_artifact_unknown' };
  return { kind: 'admission_ready', current: 'terminal_artifact_failed' };
}

function isValidIdentity(identity: TestRunIdentity): boolean {
  return (
    SAFE_ID_PATTERN.test(identity.runId) &&
    SAFE_ID_PATTERN.test(identity.userId) &&
    FENCE_PATTERN.test(identity.leaseFence)
  );
}

function success(
  disposition: 'applied' | 'already_applied',
  record: IntexAgentTestRunRecordV1
): TestRunRepositoryMutationResult {
  return { ok: true, disposition, record: cloneRecord(record) };
}

function isExactProjectionRetry(
  current: IntexAgentTestRunRecordV1,
  command: TestRunProjectionCasCommandV1,
  storedProjection: TestRunScenarioProjectionV1 | null
): boolean {
  if (
    current.revision !== command.expectedRevision + 1 ||
    current.lifecycle !== command.nextLifecycle ||
    current.updatedAt !== command.updatedAt ||
    command.finalization !== null
  )
    return false;
  if (command.scenario === null) return storedProjection === null;
  if (storedProjection === null || stableJson(storedProjection) !== stableJson(command.scenario.projection))
    return false;
  const summary = current.scenarios.find(
    (scenario) => scenario.scenarioId === command.scenario?.scenarioId
  );
  return (
    summary !== undefined &&
    stableJson(summary) ===
      stableJson({
        ...command.scenario.summary,
        eventWatermark: command.scenario.eventWatermark,
        sessionId: command.scenario.sessionId,
        sessionBindingDigest: command.scenario.sessionBindingDigest,
      })
  );
}

function isExactArtifactDeliveryRetry(
  current: IntexAgentTestRunRecordV1,
  manifest: MatrixCorpusRunManifestV1,
  command: TestRunArtifactDeliveryCommandV1
): boolean {
  if (
    current.revision !== command.expectedRevision + 1 ||
    current.updatedAt !== command.updatedAt ||
    current.artifactDelivery.updatedAt !== command.updatedAt
  )
    return false;
  if (command.next.status === 'staged') {
    const compositeDigest = digestArtifactCandidates(
      command.next.jsonCandidateDigest,
      command.next.markdownCandidateDigest
    );
    return (
      current.artifactDelivery.status === 'staged' &&
      current.artifactStageDigest === compositeDigest &&
      manifest.artifactStage?.revision === current.revision &&
      manifest.artifactStage.jsonCandidateDigest === command.next.jsonCandidateDigest &&
      manifest.artifactStage.markdownCandidateDigest ===
        command.next.markdownCandidateDigest &&
      manifest.artifactStage.compositeDigest === compositeDigest &&
      manifest.artifactStage.stagedAt === command.updatedAt
    );
  }
  if (command.next.status === 'ready')
    return (
      current.artifactDelivery.status === 'ready' &&
      current.terminalWinner?.eventId === command.next.terminalControlEventId
    );
  if (command.next.status === 'unknown')
    return current.artifactDelivery.status === 'unknown';
  return (
    current.artifactDelivery.status === 'failed' &&
    current.artifactDelivery.failureCode === command.next.failureCode &&
    (command.next.failureCode !== 'REPORT_PUBLICATION_FAILED' ||
      current.terminalWinner?.eventId === command.next.terminalControlEventId)
  );
}

function emptyCleanupCounts(): {
  runs: number;
  sessions: number;
  events: number;
  confirmations: number;
  ingestReceipts: number;
  scenarioProjections: number;
  scenarioContexts: number;
  runContexts: number;
  manifests: number;
} {
  return {
    runs: 0,
    sessions: 0,
    events: 0,
    confirmations: 0,
    ingestReceipts: 0,
    scenarioProjections: 0,
    scenarioContexts: 0,
    runContexts: 0,
    manifests: 0,
  };
}

function cleanupSuccess(
  disposition: 'applied' | 'already_applied',
  currentRecord: IntexAgentTestRunRecordV1,
  removed: ReturnType<typeof emptyCleanupCounts>
): TestRunRepositoryCleanupResult {
  return {
    ok: true,
    disposition,
    currentRecord: cloneRecord(currentRecord),
    removed: { ...removed },
  };
}

function matchesCleanupChild(
  value: unknown,
  identity: TestRunIdentity,
  binding: Readonly<{
    scenarioId: string;
    sessionId: string;
  }>,
  requireUserAndLane: boolean
): boolean {
  const record = value as Record<string, unknown>;
  return (
    record['runId'] === identity.runId &&
    record['scenarioId'] === binding.scenarioId &&
    record['sessionId'] === binding.sessionId &&
    record['leaseFence'] === identity.leaseFence &&
    (!requireUserAndLane ||
      (record['userId'] === identity.userId &&
        record['runtimeAudience'] === 'home-dev' &&
        record['lane'] === 'matrix_corpus'))
  );
}

function finalizationSuccess(
  disposition: 'applied' | 'already_applied',
  record: IntexAgentTestRunRecordV1,
  tombstone: Readonly<{
    scenarioContextCount: number;
    finalizedAt: string;
  }>
): TestRunRepositoryFinalizationResult {
  return {
    ok: true,
    disposition,
    record: cloneRecord(record),
    tombstoneDigest: FirestoreTestRunRepository.digestContextFinalization(tombstone),
    scenarioContextCount: tombstone.scenarioContextCount,
    finalizedAt: tombstone.finalizedAt,
  };
}

interface AbandonedRecoveryReceipt extends TestRunIdentity {
  version: 1;
  runtimeAudience: 'home-dev';
  eventId: string;
  payloadDigest: string;
  outcome: Extract<
    TestRunTerminalWinnerV1,
    { kind: 'abandoned' }
  >['outcome'];
  acknowledgedAt: string;
}

function createRecoveryReceipt(
  input: Parameters<TestRunRepository['applyAbandonedRecovery']>[0],
  outcome: AbandonedRecoveryReceipt['outcome']
): AbandonedRecoveryReceipt {
  return {
    version: 1,
    runtimeAudience: 'home-dev',
    ...input.identity,
    eventId: input.command.eventId,
    payloadDigest: input.command.payloadDigest,
    outcome,
    acknowledgedAt: input.command.acknowledgedAt,
  };
}

function parseRecoveryReceipt(value: unknown): AbandonedRecoveryReceipt | undefined {
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    'acknowledgedAt',
    'eventId',
    'leaseFence',
    'outcome',
    'payloadDigest',
    'runId',
    'runtimeAudience',
    'userId',
    'version',
  ];
  if (keys.length !== expected.length || expected.some((key, index) => key !== keys[index]))
    return undefined;
  if (
    record['version'] !== 1 ||
    record['runtimeAudience'] !== 'home-dev' ||
    typeof record['runId'] !== 'string' ||
    typeof record['userId'] !== 'string' ||
    typeof record['leaseFence'] !== 'string' ||
    typeof record['eventId'] !== 'string' ||
    typeof record['payloadDigest'] !== 'string' ||
    typeof record['acknowledgedAt'] !== 'string' ||
    !isValidIdentity(record as unknown as TestRunIdentity) ||
    !SAFE_ID_PATTERN.test(record['eventId']) ||
    !SHA_256_PATTERN.test(record['payloadDigest']) ||
    !isRfc3339(record['acknowledgedAt']) ||
    !['stopped_not_evaluated', 'provisioning_noop', 'provisioning_rolled_back'].includes(
      String(record['outcome'])
    )
  )
    return undefined;
  return record as unknown as AbandonedRecoveryReceipt;
}

function abandonedRecoverySuccess(
  disposition: 'applied' | 'already_applied',
  receipt: AbandonedRecoveryReceipt
): TestRunRepositoryAbandonedRecoveryResult {
  return {
    ok: true,
    disposition,
    winner: {
      kind: 'abandoned',
      eventId: receipt.eventId,
      payloadDigest: receipt.payloadDigest,
      outcome: receipt.outcome,
      acknowledgedAt: receipt.acknowledgedAt,
    },
  };
}

function hasExactMatrixRunEvidence(value: unknown, identity: TestRunIdentity): boolean {
  const record = value as Record<string, unknown>;
  const profile = record['matrixCorpusProfile'];
  return (
    record['userId'] === identity.userId &&
    typeof profile === 'object' &&
    profile !== null &&
    !Array.isArray(profile) &&
    (profile as Record<string, unknown>)['runId'] === identity.runId &&
    (profile as Record<string, unknown>)['leaseFence'] === identity.leaseFence
  );
}

function matchesRunFence(value: unknown, identity: TestRunIdentity): boolean {
  const record = value as Record<string, unknown>;
  return record['runId'] === identity.runId && record['leaseFence'] === identity.leaseFence;
}

function matchesRunFenceAndUser(value: unknown, identity: TestRunIdentity): boolean {
  return (
    matchesRunFence(value, identity) &&
    (value as Record<string, unknown>)['userId'] === identity.userId
  );
}

function failure(
  code: TestRunRepositoryFailureCode
): Readonly<{ ok: false; code: TestRunRepositoryFailureCode }> {
  return { ok: false, code } as const;
}

function mapTransitionFailure(
  code: TestRunTransitionFailureCode
): TestRunRepositoryFailureCode {
  const mapped: Record<TestRunTransitionFailureCode, TestRunRepositoryFailureCode> = {
    INVALID_RECORD: 'CORRUPT_RECORD',
    REVISION_CONFLICT: 'REVISION_CONFLICT',
    SCENARIO_REVISION_CONFLICT: 'SCENARIO_REVISION_CONFLICT',
    EVENT_WATERMARK_GAP: 'EVENT_WATERMARK_GAP',
    INVALID_TRANSITION: 'INVALID_TRANSITION',
    FINALIZATION_MISMATCH: 'FINALIZATION_MISMATCH',
    TERMINAL_CONFLICT: 'TERMINAL_CONFLICT',
  };
  return mapped[code];
}

function cloneRecord(record: IntexAgentTestRunRecordV1): IntexAgentTestRunRecordV1 {
  return structuredClone(record);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function isRfc3339(value: string): boolean {
  return (
    Number.isFinite(Date.parse(value)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  );
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}
