/**
 * Tests for intexAgentApi service.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getIntexAgentSession,
  listIntexAgentSessionEvents,
  listIntexAgentSessions,
} from '../intexAgentApi.js';
import type { IntexAgentSession, IntexAgentSessionEvent } from '../../types/index.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    intexAgentUrl: 'https://intex-agent.test',
  },
}));

const TOKEN = 'tok';

const sampleSession: IntexAgentSession = {
  id: 'session-1',
  userId: 'user-1',
  channel: 'whatsapp',
  status: 'active',
  startedAt: '2026-06-24T10:00:00Z',
  lastUserMessageAt: '2026-06-24T10:00:00Z',
  startReason: 'no_active_session',
  activeTool: 'create_note',
  summary: 'Create a note',
};

const sampleEvent: IntexAgentSessionEvent = {
  id: 'event-1',
  sessionId: 'session-1',
  userId: 'user-1',
  type: 'session_started',
  payload: { reason: 'no_active_session', explicit: true },
  createdAt: '2026-06-24T10:00:00Z',
};

describe('intexAgentApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GETs /sessions from intex-agent', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue([sampleSession]);

    const result = await listIntexAgentSessions(TOKEN);

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[0]).toBe('https://intex-agent.test');
    expect(call?.[1]).toBe('/sessions');
    expect(call?.[2]).toBe(TOKEN);
    expect(result).toEqual([sampleSession]);
  });

  it('GETs /sessions/:sessionId', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue(sampleSession);

    const result = await getIntexAgentSession(TOKEN, 'session 1');

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe('/sessions/session%201');
    expect(result).toBe(sampleSession);
  });

  it('GETs /sessions/:sessionId/events', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue([sampleEvent]);

    const result = await listIntexAgentSessionEvents(TOKEN, 'session 1');

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe('/sessions/session%201/events');
    expect(result).toEqual([sampleEvent]);
  });
});
