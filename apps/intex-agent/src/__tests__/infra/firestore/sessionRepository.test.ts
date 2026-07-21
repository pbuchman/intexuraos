import { createHash } from 'node:crypto';

import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import {
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { describe, expect, it } from 'vitest';
import {
  FirestoreSessionRepository,
  INTEX_AGENT_SESSION_EVENTS_COLLECTION,
  INTEX_AGENT_SESSIONS_COLLECTION,
  parseMatrixCorpusEventDocument,
  parseMatrixCorpusSessionDocument,
} from '../../../infra/firestore/sessionRepository.js';
import type {
  IntexAgentMatrixCorpusProfileV1,
  IntexAgentSession,
  IntexAgentSessionEvent,
} from '../../../domain/sessions/types.js';
import type {
  MatrixCorpusSession,
  MatrixCorpusSessionIdentity,
} from '../../../domain/ports/sessionRepository.js';
import { FirestoreMatrixCorpusManifestRepository } from '../../../infra/firestore/matrixCorpusManifestRepository.js';

describe('FirestoreSessionRepository', () => {
  it('parses only exact Matrix session and event document shapes', () => {
    const base = matrixSession();
    expect(parseMatrixCorpusSessionDocument(base.id, base)).toEqual(base);
    const profile = base.matrixCorpusProfile;
    for (const invalid of [
      null,
      [],
      { ...base, extra: true },
      { ...base, id: 'other' },
      { ...base, userId: '' },
      { ...base, channel: 'web' },
      { ...base, status: 'invalid' },
      { ...base, startedAt: 'invalid' },
      { ...base, lastUserMessageAt: 'invalid' },
      { ...base, endedAt: 1 },
      { ...base, endedAt: 'invalid' },
      { ...base, lastAssistantMessageAt: 1 },
      { ...base, lastAssistantMessageAt: 'invalid' },
      { ...base, startReason: 'invalid' },
      { ...base, endReason: 1 },
      { ...base, endReason: 'invalid' },
      { ...base, activeTool: 1 },
      { ...base, activeTool: 'invalid' },
      { ...base, summary: 1 },
      { ...base, matrixCorpusProfile: null },
      { ...base, lastEventSequence: 0.5 },
      { ...base, lastEventSequence: -1 },
      { ...base, lastEventSequence: 10_001 },
      { ...base, matrixCorpusProfile: { ...profile, extra: true } },
      { ...base, matrixCorpusProfile: { ...profile, scenarioLabel: 1 } },
      { ...base, matrixCorpusProfile: { ...profile, version: 2 } },
      { ...base, matrixCorpusProfile: { ...profile, kind: 'invalid' } },
      { ...base, matrixCorpusProfile: { ...profile, runtimeAudience: 'production' } },
      { ...base, matrixCorpusProfile: { ...profile, leaseFence: '0' } },
      { ...base, matrixCorpusProfile: { ...profile, runId: '' } },
      { ...base, matrixCorpusProfile: { ...profile, scenarioId: '' } },
      { ...base, matrixCorpusProfile: { ...profile, scenarioNumber: 1.5 } },
      { ...base, matrixCorpusProfile: { ...profile, scenarioNumber: 0 } },
      { ...base, matrixCorpusProfile: { ...profile, scenarioNumber: 21 } },
      { ...base, matrixCorpusProfile: { ...profile, scenarioLabel: '' } },
      { ...base, matrixCorpusProfile: { ...profile, scenarioLabel: 'x'.repeat(129) } },
      { ...base, matrixCorpusProfile: { ...profile, executionMode: 'real_tools' } },
      { ...base, matrixCorpusProfile: { ...profile, agentModel: 'or:minimax/minimax-m3' } },
      { ...base, matrixCorpusProfile: { ...profile, evaluatorModel: 'or:deepseek/deepseek-v4-flash' } },
      { ...base, matrixCorpusProfile: { ...profile, promptPreferencesVersion: 1.5 } },
      { ...base, matrixCorpusProfile: { ...profile, promptPreferencesVersion: -1 } },
      { ...base, matrixCorpusProfile: { ...profile, promptPreferencesDigest: 1 } },
      { ...base, matrixCorpusProfile: { ...profile, promptPreferencesDigest: 'invalid' } },
      { ...base, matrixCorpusProfile: { ...profile, userTimeZone: 1 } },
      { ...base, matrixCorpusProfile: { ...profile, userTimeZone: 'Invalid/Zone' } },
      { ...base, matrixCorpusProfile: { ...profile, mockProfile: { invalid: true } } },
      { ...base, matrixCorpusProfile: { ...profile, expectedToolSchedule: [{ invalid: true }] } },
      { ...base, matrixCorpusProfile: { ...profile, mockProfileDigest: 1 } },
      { ...base, matrixCorpusProfile: { ...profile, mockProfileDigest: 'invalid' } },
      { ...base, matrixCorpusProfile: { ...profile, mockProfileDigest: '0'.repeat(64) } },
    ])
      expect(parseMatrixCorpusSessionDocument(base.id, invalid)).toBeUndefined();

    const storedEvent = { ...event(), eventSequence: 1 };
    expect(parseMatrixCorpusEventDocument(storedEvent)).toEqual(storedEvent);
    for (const invalid of [
      null,
      { ...storedEvent, extra: true },
      { ...storedEvent, eventSequence: 1.5 },
      { ...storedEvent, eventSequence: 0 },
      { ...storedEvent, id: 1 },
      { ...storedEvent, id: '' },
      { ...storedEvent, sessionId: 1 },
      { ...storedEvent, sessionId: '' },
      { ...storedEvent, userId: 1 },
      { ...storedEvent, userId: '' },
      { ...storedEvent, type: 1 },
      { ...storedEvent, type: 'invalid' },
      { ...storedEvent, payload: null },
      { ...storedEvent, payload: { text: 'x'.repeat(70_000) } },
      { ...storedEvent, createdAt: 1 },
      { ...storedEvent, createdAt: 'invalid' },
    ])
      expect(parseMatrixCorpusEventDocument(invalid)).toBeUndefined();
  });

  it('lists user sessions newest first and excludes other users', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'older', startedAt: '2026-06-24T09:00:00.000Z' }));
    await repo.createSession(session({ id: 'newer', startedAt: '2026-06-24T10:00:00.000Z' }));
    await repo.createSession(session({ id: 'other-user', userId: 'user-2' }));

    await expect(repo.listSessions('user-1')).resolves.toMatchObject([
      { id: 'newer', userId: 'user-1' },
      { id: 'older', userId: 'user-1' },
    ]);
  });

  it('finds the open WhatsApp session for a user', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'completed', status: 'completed' }));
    await repo.createSession(session({ id: 'waiting', status: 'waiting_for_user' }));

    await expect(repo.findOpenSession('user-1')).resolves.toMatchObject({
      id: 'waiting',
      status: 'waiting_for_user',
    });
  });

  it('finds the newest continuable WhatsApp session for a user', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(
      session({
        id: 'older-waiting',
        status: 'waiting_for_user',
        lastUserMessageAt: '2026-06-24T09:00:00.000Z',
      })
    );
    await repo.createSession(
      session({
        id: 'newer-waiting',
        status: 'waiting_for_user',
        lastUserMessageAt: '2026-06-24T10:00:00.000Z',
      })
    );
    await repo.createSession(
      session({
        id: 'completed',
        status: 'completed',
        lastUserMessageAt: '2026-06-24T10:30:00.000Z',
      })
    );

    await expect(repo.findContinuableSession('user-1')).resolves.toMatchObject({
      id: 'newer-waiting',
      status: 'waiting_for_user',
    });
  });

  it('returns null when a session is missing or belongs to another user', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'other-user-session', userId: 'user-2' }));

    await expect(repo.getSession('missing', 'user-1')).resolves.toBeNull();
    await expect(repo.getSession('other-user-session', 'user-1')).resolves.toBeNull();
  });

  it('returns an owning user session by id', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'session-1' }));

    await expect(repo.getSession('session-1', 'user-1')).resolves.toMatchObject({
      id: 'session-1',
      userId: 'user-1',
    });
  });

  it('returns null when no open session exists', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'completed', status: 'completed' }));

    await expect(repo.findOpenSession('user-1')).resolves.toBeNull();
  });

  it('updates a session without dropping existing fields', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'session-1' }));
    const updated = await repo.updateSession('session-1', {
      status: 'completed',
      endedAt: '2026-06-24T10:05:00.000Z',
      endReason: 'tool_completed',
      summary: 'Saved a note',
    });

    expect(updated).toMatchObject({
      id: 'session-1',
      userId: 'user-1',
      status: 'completed',
      endReason: 'tool_completed',
      summary: 'Saved a note',
    });
  });

  it('rejects an ordinary update when the session does not exist', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await expect(
      repo.updateSession('missing-session', { status: 'completed' })
    ).rejects.toThrow();
  });

  it('clears activeTool when the session update sets it to null', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'session-1', activeTool: 'create_calendar_event' }));
    const updated = await repo.updateSession('session-1', {
      status: 'waiting_for_user',
      activeTool: null,
    });

    expect(updated.activeTool).toBeUndefined();
    await expect(repo.getSession('session-1', 'user-1')).resolves.not.toHaveProperty(
      'activeTool'
    );
  });

  it('normalizes stored null activeTool values when reading old session documents', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc('session-null-active-tool')
      .set({
        ...session({ id: 'session-null-active-tool' }),
        activeTool: null,
      });

    await expect(repo.getSession('session-null-active-tool', 'user-1')).resolves.not.toHaveProperty(
      'activeTool'
    );
  });

  it('preserves activeTool when reading a session with an active tool', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'session-active-tool', activeTool: 'create_note' }));

    await expect(repo.getSession('session-active-tool', 'user-1')).resolves.toMatchObject({
      id: 'session-active-tool',
      activeTool: 'create_note',
    });
  });

  it('returns events in chronological order for the owning user only', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await repo.createSession(session({ id: 'session-1' }));
    await repo.appendEvent(event({ id: 'event-2', createdAt: '2026-06-24T10:02:00.000Z' }));
    await repo.appendEvent(event({ id: 'event-1', createdAt: '2026-06-24T10:01:00.000Z' }));
    await repo.appendEvent(event({ id: 'other-user-event', userId: 'user-2' }));

    await expect(repo.listEvents('session-1', 'user-1')).resolves.toMatchObject([
      { id: 'event-1' },
      { id: 'event-2' },
    ]);
  });

  it('keeps missing ordinary sessions empty and rejects Matrix fields on ordinary creation', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await expect(repo.listEvents('missing', 'user-1')).resolves.toEqual([]);
    await expect(
      repo.createSession({ ...session(), matrixCorpusProfile: matrixProfile() } as never)
    ).rejects.toThrow('Matrix corpus session requires exact lane');
    await expect(
      repo.createSession({ ...session(), lastEventSequence: 0 } as never)
    ).rejects.toThrow('Matrix corpus session requires exact lane');
    await expect(repo.appendEvent(event({ sessionId: 'missing' }))).resolves.toBeUndefined();
  });

  it('uses session event order as a tie-breaker when events share the same timestamp', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const createdAt = '2026-06-24T10:00:00.000Z';

    await repo.createSession(session({ id: 'session-1' }));
    await repo.appendEvent(event({ id: 'assistant', type: 'assistant_message', createdAt }));
    await repo.appendEvent(event({ id: 'unsupported', type: 'unsupported_request', createdAt }));
    await repo.appendEvent(event({ id: 'user', type: 'user_message', createdAt }));
    await repo.appendEvent(event({ id: 'closed', type: 'session_closed', createdAt }));
    await repo.appendEvent(event({ id: 'started', type: 'session_started', createdAt }));

    await expect(repo.listEvents('session-1', 'user-1')).resolves.toMatchObject([
      { id: 'started' },
      { id: 'user' },
      { id: 'unsupported' },
      { id: 'assistant' },
      { id: 'closed' },
    ]);
  });

  it('uses event id as the final tie-breaker for matching event type and timestamp', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const createdAt = '2026-06-24T10:00:00.000Z';

    await repo.createSession(session({ id: 'session-1' }));
    await repo.appendEvent(event({ id: 'user-z', type: 'user_message', createdAt }));
    await repo.appendEvent(event({ id: 'user-a', type: 'user_message', createdAt }));

    await expect(repo.listEvents('session-1', 'user-1')).resolves.toMatchObject([
      { id: 'user-a' },
      { id: 'user-z' },
    ]);
  });

  it('keeps Matrix-corpus sessions out of every ordinary session and event lane', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await repo.createSession(session({ id: 'ordinary', status: 'waiting_for_user' }));
    const ordinaryBefore = await firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc('ordinary')
      .get();
    await createManifest(manifestRepo, firestore);
    await repo.createMatrixCorpusSession({
      identity: matrixIdentity(),
      session: matrixSession(),
      now: '2026-06-24T10:00:00.000Z',
    });

    await expect(repo.listSessions('user-1')).resolves.toMatchObject([{ id: 'ordinary' }]);
    await expect(repo.getSession('matrix-session-1', 'user-1')).resolves.toBeNull();
    await expect(repo.findOpenSession('user-1')).resolves.toMatchObject({ id: 'ordinary' });
    await expect(repo.findContinuableSession('user-1')).resolves.toMatchObject({ id: 'ordinary' });
    await expect(repo.listEvents('matrix-session-1', 'user-1')).resolves.toEqual([]);
    const ordinaryAfter = await firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc('ordinary')
      .get();
    expect(ordinaryAfter.data()).toEqual(ordinaryBefore.data());
  });

  it('atomically creates one exact test session and appends its immutable manifest binding', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await createManifest(manifestRepo, firestore);

    await expect(
      repo.createMatrixCorpusSession({
        identity: matrixIdentity(),
        session: matrixSession(),
        now: '2026-06-24T10:00:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      session: { id: 'matrix-session-1', lastEventSequence: 0 },
    });
    await expect(
      repo.createMatrixCorpusSession({
        identity: matrixIdentity(),
        session: matrixSession(),
        now: '2026-06-24T10:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'already_applied' });
    await expect(manifestRepo.getExact(matrixIdentity())).resolves.toMatchObject({
      ok: true,
      manifest: {
        scenarioBindings: [
          {
            scenarioId: 'scenario_001',
            scenarioNumber: 1,
            scenarioLabel: 'Create a note in one message',
            sessionId: 'matrix-session-1',
          },
        ],
      },
    });
  });

  it('fails closed for invalid, missing, ordinary, corrupt, and foreign exact-lane reads', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });

    await expect(
      repo.getMatrixCorpusSessionExact({ ...matrixIdentity(), sessionId: '' })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    await expect(repo.getMatrixCorpusSessionExact(matrixIdentity())).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    await firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc('matrix-session-1')
      .set(session({ id: 'matrix-session-1' }));
    await expect(repo.getMatrixCorpusSessionExact(matrixIdentity())).resolves.toEqual({
      ok: false,
      code: 'INVALID_LANE',
    });
    await firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc('matrix-session-1')
      .set({ ...matrixSession(), extra: true });
    await expect(repo.getMatrixCorpusSessionExact(matrixIdentity())).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_SESSION',
    });
    await firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc('matrix-session-1')
      .set(
        matrixSession({
          matrixCorpusProfile: { ...matrixProfile(), leaseFence: '8' },
        })
      );
    await expect(repo.getMatrixCorpusSessionExact(matrixIdentity())).resolves.toEqual({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
  });

  it('validates manifest and active-context roots before creating an exact-lane session', async () => {
    const input = {
      identity: matrixIdentity(),
      session: matrixSession(),
      now: '2026-06-24T10:00:00.000Z',
    };
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      await expect(repo.createMatrixCorpusSession({ ...input, now: 'invalid' })).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      await expect(repo.createMatrixCorpusSession(input)).resolves.toEqual({
        ok: false,
        code: 'MANIFEST_MISMATCH',
      });
    }
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      await firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_1')
        .set({ corrupt: true });
      await expect(repo.createMatrixCorpusSession(input)).resolves.toEqual({
        ok: false,
        code: 'MANIFEST_MISMATCH',
      });
    }
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
      await createManifest(manifestRepo, firestore);
      await firestore
        .collection('intex_agent_matrix_corpus_run_contexts')
        .doc('run_1')
        .set({
          version: 1,
          status: 'finalized',
          runtimeAudience: 'home-dev',
          runId: 'run_1',
          userId: 'user-1',
          leaseFence: '7',
          scenarioContextCount: 0,
          finalizedAt: input.now,
        });
      await expect(repo.createMatrixCorpusSession(input)).resolves.toEqual({
        ok: false,
        code: 'RUN_NOT_ACTIVE',
      });
    }
  });

  it('rejects exact-lane creation identity mismatches and conflicting stored sessions', async () => {
    const now = '2026-06-24T10:00:00.000Z';
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      await expect(
        repo.createMatrixCorpusSession({
          identity: matrixIdentity(),
          session: null as never,
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(
        repo.createMatrixCorpusSession({
          identity: matrixIdentity(),
          session: matrixSession({ id: 'other-session' }),
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    }
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
      await createManifest(manifestRepo, firestore);
      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set({ ...matrixSession(), extra: true });
      await expect(
        repo.createMatrixCorpusSession({
          identity: matrixIdentity(),
          session: matrixSession(),
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_SESSION' });
      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set(
          matrixSession({
            matrixCorpusProfile: { ...matrixProfile(), leaseFence: '8' },
          })
        );
      await expect(
        repo.createMatrixCorpusSession({
          identity: matrixIdentity(),
          session: matrixSession(),
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    }
  });

  it('rejects pre-existing manifest bindings that collide with a new exact session', async () => {
    const now = '2026-06-24T10:00:00.000Z';
    for (const existingBinding of [
      {
        scenarioId: 'scenario_001',
        scenarioNumber: 1,
        scenarioLabel: 'Scenario 001/020',
        sessionId: 'another-session',
      },
      {
        scenarioId: 'scenario_existing',
        scenarioNumber: 2,
        scenarioLabel: 'Scenario 002/020',
        sessionId: 'another-session',
      },
      {
        scenarioId: 'scenario_existing',
        scenarioNumber: 1,
        scenarioLabel: 'Scenario 001/020',
        sessionId: 'matrix-session-1',
      },
    ]) {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
      await createManifest(manifestRepo, firestore);
      await firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_1')
        .update({ scenarioBindings: [existingBinding] });
      const usesSecondScenario = existingBinding.scenarioId !== 'scenario_001';
      const identity = usesSecondScenario
        ? { ...matrixIdentity(), scenarioId: 'scenario_002' }
        : matrixIdentity();
      const candidate = usesSecondScenario
        ? matrixSession({
            matrixCorpusProfile: {
              ...matrixProfile(),
              scenarioId: 'scenario_002',
              scenarioNumber: 2,
              scenarioLabel: 'Scenario 002/020',
            },
          })
        : matrixSession();

      await expect(
        repo.createMatrixCorpusSession({ identity, session: candidate, now })
      ).resolves.toEqual({ ok: false, code: 'MANIFEST_MISMATCH' });
    }
  });

  it('fails closed across exact-lane update roots and invalid updates', async () => {
    const now = '2026-06-24T10:00:00.000Z';
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      await expect(
        repo.updateMatrixCorpusSessionExact({
          identity: { ...matrixIdentity(), leaseFence: '0' },
          update: { status: 'completed' },
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    }
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
      await createManifest(manifestRepo, firestore);
      await expect(
        repo.updateMatrixCorpusSessionExact({
          identity: matrixIdentity(),
          update: { status: 'completed' },
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set({ corrupt: true });
      await expect(
        repo.updateMatrixCorpusSessionExact({
          identity: matrixIdentity(),
          update: { status: 'completed' },
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_SESSION' });

      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set(
          matrixSession({
            matrixCorpusProfile: { ...matrixProfile(), leaseFence: '8' },
          })
        );
      await expect(
        repo.updateMatrixCorpusSessionExact({
          identity: matrixIdentity(),
          update: { status: 'completed' },
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });

      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set(matrixSession());
      await expect(
        repo.updateMatrixCorpusSessionExact({
          identity: matrixIdentity(),
          update: { status: 'invalid' } as never,
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    }
  });

  it('applies valid exact-lane updates and removes a nullable active tool', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await createManifest(manifestRepo, firestore);
    await repo.createMatrixCorpusSession({
      identity: matrixIdentity(),
      session: matrixSession({ activeTool: 'create_note' }),
      now: '2026-06-24T10:00:00.000Z',
    });

    await expect(
      repo.updateMatrixCorpusSessionExact({
        identity: matrixIdentity(),
        update: { status: 'waiting_for_user', activeTool: null },
        now: '2026-06-24T10:01:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      session: { status: 'waiting_for_user' },
    });
    const updated = await repo.getMatrixCorpusSessionExact(matrixIdentity());
    expect(updated).toMatchObject({ ok: true, session: { status: 'waiting_for_user' } });
    if (updated.ok) expect(updated.session.activeTool).toBeUndefined();
  });

  it('fails exact-lane mutations when manifest or active context roots are absent', async () => {
    const now = '2026-06-24T10:00:00.000Z';
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set(matrixSession());
      await expect(
        repo.updateMatrixCorpusSessionExact({
          identity: matrixIdentity(),
          update: { status: 'completed' },
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'RUN_NOT_ACTIVE' });
    }
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
      await manifestRepo.createOrGet({
        version: 1,
        runtimeAudience: 'home-dev',
        runId: 'run_1',
        userId: 'user-1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        scenarioBindings: [],
        artifactStage: null,
        terminalCandidate: null,
        createdAt: now,
      });
      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set(matrixSession());
      await expect(
        repo.appendMatrixCorpusEvent({
          identity: matrixIdentity(),
          event: event({ id: 'no-context', sessionId: 'matrix-session-1' }),
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'RUN_NOT_ACTIVE' });
    }
  });

  it('rejects profile changes, wrong exact-lane identities, and production-session conversion', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await createManifest(manifestRepo, firestore);
    await repo.createMatrixCorpusSession({
      identity: matrixIdentity(),
      session: matrixSession(),
      now: '2026-06-24T10:00:00.000Z',
    });

    await expect(
      repo.createMatrixCorpusSession({
        identity: matrixIdentity(),
        session: matrixSession({
          matrixCorpusProfile: {
            ...matrixProfile(),
            promptPreferencesDigest: 'd'.repeat(64),
          },
        }),
        now: '2026-06-24T10:00:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(
      repo.getMatrixCorpusSessionExact({ ...matrixIdentity(), leaseFence: '8' })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });

    await repo.createSession(session({ id: 'ordinary-existing' }));
    await expect(
      repo.createMatrixCorpusSession({
        identity: { ...matrixIdentity(), sessionId: 'ordinary-existing' },
        session: matrixSession({ id: 'ordinary-existing' }),
        now: '2026-06-24T10:00:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_LANE' });
  });

  it('appends monotonic exact-lane events and returns the committed sequence on replay', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await createManifest(manifestRepo, firestore);
    await repo.createMatrixCorpusSession({
      identity: matrixIdentity(),
      session: matrixSession(),
      now: '2026-06-24T10:00:00.000Z',
    });
    const firstEvent = event({
      id: 'matrix-event-1',
      sessionId: 'matrix-session-1',
      payload: { text: 'private test message' },
    });

    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: firstEvent,
        now: '2026-06-24T10:00:00.000Z',
      })
    ).resolves.toEqual({ ok: true, disposition: 'applied', sequence: 1 });
    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: firstEvent,
        now: '2026-06-24T10:00:00.000Z',
      })
    ).resolves.toEqual({ ok: true, disposition: 'already_applied', sequence: 1 });
    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: { ...firstEvent, payload: { text: 'changed' } },
        now: '2026-06-24T10:00:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(repo.listMatrixCorpusEventsExact(matrixIdentity())).resolves.toMatchObject({
      ok: true,
      events: [{ id: 'matrix-event-1', eventSequence: 1 }],
    });
    await expect(repo.getMatrixCorpusSessionExact(matrixIdentity())).resolves.toMatchObject({
      ok: true,
      session: { lastEventSequence: 1 },
    });
  });

  it('fails closed for invalid, missing, corrupt, foreign, and mismatched event appends', async () => {
    const now = '2026-06-24T10:00:00.000Z';
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      await expect(
        repo.appendMatrixCorpusEvent({
          identity: matrixIdentity(),
          event: { ...event({ sessionId: 'matrix-session-1' }), extra: true } as never,
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(
        repo.appendMatrixCorpusEvent({
          identity: matrixIdentity(),
          event: event({ sessionId: 'matrix-session-1' }),
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    }
    {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
      await createManifest(manifestRepo, firestore);
      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set({ ...matrixSession(), extra: true });
      await expect(
        repo.appendMatrixCorpusEvent({
          identity: matrixIdentity(),
          event: event({ sessionId: 'matrix-session-1' }),
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_SESSION' });
      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set(
          matrixSession({
            matrixCorpusProfile: { ...matrixProfile(), leaseFence: '8' },
          })
        );
      await expect(
        repo.appendMatrixCorpusEvent({
          identity: matrixIdentity(),
          event: event({ sessionId: 'matrix-session-1' }),
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set(matrixSession());
      for (const mismatchedEvent of [
        event({ sessionId: 'other-session' }),
        event({ sessionId: 'matrix-session-1', userId: 'other-user' }),
      ]) {
        await expect(
          repo.appendMatrixCorpusEvent({
            identity: matrixIdentity(),
            event: mismatchedEvent,
            now,
          })
        ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
      }
      await firestore
        .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
        .doc('corrupt-event')
        .set({ id: 'corrupt-event', sessionId: 'matrix-session-1', corrupt: true });
      await expect(
        repo.appendMatrixCorpusEvent({
          identity: matrixIdentity(),
          event: event({ id: 'corrupt-event', sessionId: 'matrix-session-1' }),
          now,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_EVENT' });
    }
  });

  it('applies and validates optional session updates while appending exact events', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await createManifest(manifestRepo, firestore);
    await repo.createMatrixCorpusSession({
      identity: matrixIdentity(),
      session: matrixSession(),
      now: '2026-06-24T10:00:00.000Z',
    });

    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: event({ id: 'updated-event', sessionId: 'matrix-session-1' }),
        sessionUpdate: { status: 'executing_tool', activeTool: 'create_note' },
        now: '2026-06-24T10:01:00.000Z',
      })
    ).resolves.toEqual({ ok: true, disposition: 'applied', sequence: 1 });
    await expect(repo.getMatrixCorpusSessionExact(matrixIdentity())).resolves.toMatchObject({
      ok: true,
      session: { status: 'executing_tool', activeTool: 'create_note' },
    });
    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: event({ id: 'invalid-update', sessionId: 'matrix-session-1' }),
        sessionUpdate: { status: 'invalid' } as never,
        now: '2026-06-24T10:02:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('rejects corrupt exact event collections and non-contiguous sequences', async () => {
    const cases = [
      {
        sessionSequence: 1,
        storedEvents: [{ id: 'corrupt', sessionId: 'matrix-session-1', corrupt: true }],
      },
      {
        sessionSequence: 1,
        storedEvents: [],
      },
      {
        sessionSequence: 1,
        storedEvents: [
          { ...event({ id: 'foreign-user', sessionId: 'matrix-session-1', userId: 'other-user' }), eventSequence: 1 },
        ],
      },
      {
        sessionSequence: 1,
        storedEvents: [
          { ...event({ id: 'sequence-gap', sessionId: 'matrix-session-1' }), eventSequence: 2 },
        ],
      },
    ];
    for (const fixture of cases) {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repo = new FirestoreSessionRepository({ firestore });
      await firestore
        .collection(INTEX_AGENT_SESSIONS_COLLECTION)
        .doc('matrix-session-1')
        .set(matrixSession({ lastEventSequence: fixture.sessionSequence }));
      for (const storedEvent of fixture.storedEvents) {
        await firestore
          .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
          .doc(String(storedEvent.id))
          .set(storedEvent);
      }
      await expect(repo.listMatrixCorpusEventsExact(matrixIdentity())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_EVENT',
      });
    }
    const repo = new FirestoreSessionRepository({
      firestore: createFakeFirestore() as unknown as Firestore,
    });
    await expect(
      repo.listMatrixCorpusEventsExact({ ...matrixIdentity(), sessionId: '' })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('serializes competing exact-lane appends and never lets ordinary mutation APIs touch test sessions', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await createManifest(manifestRepo, firestore);
    await repo.createMatrixCorpusSession({
      identity: matrixIdentity(),
      session: matrixSession(),
      now: '2026-06-24T10:00:00.000Z',
    });
    const first = repo.appendMatrixCorpusEvent({
      identity: matrixIdentity(),
      event: event({
        id: 'matrix-event-a',
        sessionId: 'matrix-session-1',
      }),
      now: '2026-06-24T10:00:00.000Z',
    });
    const second = repo.appendMatrixCorpusEvent({
      identity: matrixIdentity(),
      event: event({
        id: 'matrix-event-b',
        sessionId: 'matrix-session-1',
      }),
      now: '2026-06-24T10:00:00.000Z',
    });
    const results = await Promise.all([first, second]);
    expect(results).toContainEqual({ ok: true, disposition: 'applied', sequence: 1 });
    expect(results).toContainEqual({ ok: true, disposition: 'applied', sequence: 2 });
    await expect(repo.listMatrixCorpusEventsExact(matrixIdentity())).resolves.toMatchObject({
      ok: true,
      events: [{ eventSequence: 1 }, { eventSequence: 2 }],
    });

    await expect(
      repo.updateSession('matrix-session-1', { status: 'completed' })
    ).rejects.toThrow('Matrix corpus session requires exact lane');
    await expect(
      repo.appendEvent(
        event({ id: 'ordinary-write', sessionId: 'matrix-session-1' })
      )
    ).rejects.toThrow('Matrix corpus session requires exact lane');
  });

  it('defensively clones the immutable profile and rejects sequence exhaustion', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await createManifest(manifestRepo, firestore);
    const created = await repo.createMatrixCorpusSession({
      identity: matrixIdentity(),
      session: matrixSession(),
      now: '2026-06-24T10:00:00.000Z',
    });
    if (!created.ok) throw new Error('fixture create failed');
    created.session.matrixCorpusProfile.mockProfile.calls.push({} as never);
    await expect(repo.getMatrixCorpusSessionExact(matrixIdentity())).resolves.toMatchObject({
      ok: true,
      session: { matrixCorpusProfile: { mockProfile: { calls: [] } } },
    });

    await firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc('matrix-session-1')
      .update({ lastEventSequence: 10_000 });
    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: event({
          id: 'overflow',
          sessionId: 'matrix-session-1',
        }),
        now: '2026-06-24T10:00:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'SEQUENCE_EXHAUSTED' });
  });

  it('rejects every exact-lane mutation after the run context is finalized', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestoreSessionRepository({ firestore });
    const manifestRepo = new FirestoreMatrixCorpusManifestRepository({ firestore });
    await createManifest(manifestRepo, firestore);
    await repo.createMatrixCorpusSession({
      identity: matrixIdentity(),
      session: matrixSession(),
      now: '2026-06-24T10:00:00.000Z',
    });
    const committed = event({ id: 'matrix-event-1', sessionId: 'matrix-session-1' });
    await repo.appendMatrixCorpusEvent({
      identity: matrixIdentity(),
      event: committed,
      now: '2026-06-24T10:00:00.000Z',
    });
    await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .set({
        version: 1,
        status: 'finalized',
        runtimeAudience: 'home-dev',
        runId: 'run_1',
        userId: 'user-1',
        leaseFence: '7',
        scenarioContextCount: 0,
        finalizedAt: '2026-06-24T10:01:00.000Z',
      });

    const secondIdentity = {
      ...matrixIdentity(),
      scenarioId: 'scenario_002',
      sessionId: 'matrix-session-2',
    };
    await expect(
      repo.createMatrixCorpusSession({
        identity: secondIdentity,
        session: matrixSession({
          id: 'matrix-session-2',
          matrixCorpusProfile: {
            ...matrixProfile(),
            scenarioId: 'scenario_002',
            scenarioNumber: 2,
            scenarioLabel: 'Scenario 002/020',
          },
        }),
        now: '2026-06-24T10:02:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_NOT_ACTIVE' });
    await expect(
      repo.updateMatrixCorpusSessionExact({
        identity: matrixIdentity(),
        update: { status: 'completed' },
        now: '2026-06-24T10:02:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_NOT_ACTIVE' });
    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: committed,
        now: '2026-06-24T10:02:00.000Z',
      })
    ).resolves.toEqual({ ok: true, disposition: 'already_applied', sequence: 1 });
    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: { ...committed, payload: { text: 'changed replay' } },
        now: '2026-06-24T10:02:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(
      repo.appendMatrixCorpusEvent({
        identity: matrixIdentity(),
        event: event({ id: 'late-event', sessionId: 'matrix-session-1' }),
        now: '2026-06-24T10:02:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'RUN_NOT_ACTIVE' });
  });
});

function session(overrides: Partial<IntexAgentSession> = {}): IntexAgentSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    channel: 'whatsapp',
    status: 'active',
    startedAt: '2026-06-24T10:00:00.000Z',
    lastUserMessageAt: '2026-06-24T10:00:00.000Z',
    startReason: 'no_active_session',
    ...overrides,
  };
}

function event(overrides: Partial<IntexAgentSessionEvent> = {}): IntexAgentSessionEvent {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'user_message',
    payload: { text: 'hello' },
    createdAt: '2026-06-24T10:00:00.000Z',
    ...overrides,
  };
}

function mockProfile(): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  };
}

function matrixProfile(): IntexAgentMatrixCorpusProfileV1 {
  const profile = mockProfile();
  return {
    version: 1 as const,
    kind: 'matrix_corpus' as const,
    runtimeAudience: 'home-dev' as const,
    leaseFence: '7',
    runId: 'run_1',
    scenarioId: 'scenario_001',
    scenarioNumber: 1,
    scenarioLabel: 'Create a note in one message',
    executionMode: 'strict_mock_tools' as const,
    agentModel: 'or:deepseek/deepseek-v4-flash' as const,
    evaluatorModel: 'or:minimax/minimax-m3' as const,
    promptPreferencesVersion: 2,
    promptPreferencesDigest: 'b'.repeat(64),
    userTimeZone: 'Europe/Warsaw',
    mockProfile: profile,
    mockProfileDigest: createHash('sha256')
      .update(canonicalMatrixCorpusStrictToolMockProfileV1(profile), 'utf8')
      .digest('hex'),
    expectedToolSchedule: [],
  };
}

function matrixSession(overrides: Partial<MatrixCorpusSession> = {}): MatrixCorpusSession {
  return {
    ...session({ id: 'matrix-session-1' }),
    matrixCorpusProfile: matrixProfile(),
    lastEventSequence: 0,
    ...overrides,
  };
}

function matrixIdentity(): MatrixCorpusSessionIdentity {
  return {
    runId: 'run_1',
    scenarioId: 'scenario_001',
    sessionId: 'matrix-session-1',
    userId: 'user-1',
    leaseFence: '7',
  };
}

async function createManifest(
  repository: FirestoreMatrixCorpusManifestRepository,
  firestore: Firestore
): Promise<void> {
  await repository.createOrGet({
    version: 1,
    runtimeAudience: 'home-dev',
    runId: 'run_1',
    userId: 'user-1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    scenarioBindings: [],
    artifactStage: null,
    terminalCandidate: null,
    createdAt: '2026-06-24T10:00:00.000Z',
  });
  await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set({
    version: 1,
    status: 'active',
    runtimeAudience: 'home-dev',
    runId: 'run_1',
    userId: 'user-1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    promptPreferencesVersion: 2,
    promptPreferencesDigest: 'b'.repeat(64),
    encryptedPromptContext: {
      algorithm: 'aes-256-gcm',
      keyVersion: 'key_v1',
      nonce: Buffer.alloc(12).toString('base64url'),
      ciphertext: Buffer.from('context').toString('base64url'),
      authenticationTag: Buffer.alloc(16).toString('base64url'),
    },
    userTimeZone: 'Europe/Warsaw',
    createdAt: '2026-06-24T10:00:00.000Z',
    expiresAt: '2026-06-25T10:00:00.000Z',
    invalidatedAt: null,
  });
}
