import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';
import {
  FirestoreSessionRepository,
  INTEX_AGENT_SESSIONS_COLLECTION,
} from '../../../infra/firestore/sessionRepository.js';
import type { IntexAgentSession, IntexAgentSessionEvent } from '../../../domain/sessions/types.js';

describe('FirestoreSessionRepository', () => {
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
