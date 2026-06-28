/**
 * Tests for intexAgentApi service.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getIntexAgentPreferences,
  getIntexAgentPromptPreferences,
  getIntexAgentPromptPreferenceVersion,
  getIntexAgentSession,
  addIntexAgentPromptPreference,
  deleteIntexAgentPromptPreference,
  listIntexAgentPromptPreferenceVersions,
  listIntexAgentSessionEvents,
  listIntexAgentSessions,
  saveIntexAgentPreferences,
  testIntexAgentExternalSave,
  updateIntexAgentPromptPreference,
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

  it('GETs /preferences from intex-agent', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const preferences = {
      instructions: '',
      externalSave: {
        enabled: false,
        endpointUrl: '',
        cfAccessClientId: '',
        cfAccessClientSecret: '',
        source: 'ios-shortcuts',
      },
      updatedAt: null,
    };
    vi.mocked(apiRequest).mockResolvedValue(preferences);

    const result = await getIntexAgentPreferences(TOKEN);

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe('/preferences');
    expect(result).toEqual(preferences);
  });

  it('PUTs full preferences including external save config', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      instructions: '',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: '************',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T10:00:00.000Z',
    });

    await saveIntexAgentPreferences(TOKEN, {
      instructions: '',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
    });

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe('/preferences');
    expect(call?.[3]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String(call?.[3]?.body))).toEqual({
      instructions: '',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
    });
  });

  it('POSTs /preferences/external-save/test', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      status: 'success',
      message: 'Connection successful',
    });

    const result = await testIntexAgentExternalSave(TOKEN, {
      enabled: true,
      endpointUrl: 'https://external-save.example.com/intex',
      cfAccessClientId: 'cf-client-id',
      cfAccessClientSecret: 'cf-client-secret',
      source: 'ios-shortcuts',
    });

    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call?.[1]).toBe('/preferences/external-save/test');
    expect(call?.[3]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(call?.[3]?.body))).toEqual({
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
    });
    expect(result).toEqual({
      status: 'success',
      message: 'Connection successful',
    });
  });

  it('calls prompt preference endpoints', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const current = {
      userId: 'user-1',
      schemaVersion: 1,
      currentVersion: 1,
      items: [
        {
          id: 'pref_1',
          text: 'When I invite Jakub, use jakub@gmail.com.',
          createdAt: '2026-06-28T10:00:00.000Z',
          updatedAt: '2026-06-28T10:00:00.000Z',
        },
      ],
      renderedPromptBlock:
        'User Preferences v1:\n1. (id: pref_1) "When I invite Jakub, use jakub@gmail.com."',
      createdAt: '2026-06-28T10:00:00.000Z',
      updatedAt: '2026-06-28T10:00:00.000Z',
      updatedBy: { actor: 'web_ui', userId: 'user-1' },
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, currentVersion: 2 })
      .mockResolvedValueOnce({ ...current, currentVersion: 3, items: [], renderedPromptBlock: '' })
      .mockResolvedValueOnce([
        {
          version: 3,
          changeType: 'delete',
          changedItemId: 'pref_1',
          previousText: 'When I invite Jakub, use jakub@gmail.com.',
          itemCount: 0,
          createdAt: '2026-06-28T10:02:00.000Z',
          createdBy: { actor: 'web_ui', userId: 'user-1' },
        },
      ])
      .mockResolvedValueOnce({
        id: 'user-1_1',
        userId: 'user-1',
        version: 1,
        items: current.items,
        renderedPromptBlock: current.renderedPromptBlock,
        changeType: 'add',
        changedItemId: 'pref_1',
        nextText: 'When I invite Jakub, use jakub@gmail.com.',
        itemCount: 1,
        createdAt: '2026-06-28T10:00:00.000Z',
        createdBy: { actor: 'web_ui', userId: 'user-1' },
      });

    await expect(getIntexAgentPromptPreferences(TOKEN)).resolves.toEqual(current);
    await addIntexAgentPromptPreference(TOKEN, {
      text: 'When I invite Jakub, use jakub@gmail.com.',
      expectedVersion: 0,
    });
    await updateIntexAgentPromptPreference(TOKEN, 'pref_1', {
      text: 'When I invite Jakub, use jakub.nowak@gmail.com.',
      expectedVersion: 1,
    });
    await deleteIntexAgentPromptPreference(TOKEN, 'pref_1', { expectedVersion: 2 });
    await listIntexAgentPromptPreferenceVersions(TOKEN);
    await getIntexAgentPromptPreferenceVersion(TOKEN, 1);

    expect(vi.mocked(apiRequest).mock.calls.map((call) => call[1])).toEqual([
      '/preferences/prompt',
      '/preferences/prompt/items',
      '/preferences/prompt/items/pref_1',
      '/preferences/prompt/items/pref_1',
      '/preferences/prompt/versions',
      '/preferences/prompt/versions/1',
    ]);
    expect(vi.mocked(apiRequest).mock.calls[1]?.[3]).toMatchObject({ method: 'POST' });
    expect(vi.mocked(apiRequest).mock.calls[2]?.[3]).toMatchObject({ method: 'PATCH' });
    expect(vi.mocked(apiRequest).mock.calls[3]?.[3]).toMatchObject({ method: 'DELETE' });
  });
});
