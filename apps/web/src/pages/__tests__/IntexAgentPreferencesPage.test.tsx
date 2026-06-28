/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  mockGetPromptPreferences,
  mockAddPromptPreference,
  mockUpdatePromptPreference,
  mockDeletePromptPreference,
  mockListVersions,
  mockGetVersion,
  mockGetAccessToken,
} = vi.hoisted(() => ({
  mockGetPromptPreferences: vi.fn(),
  mockAddPromptPreference: vi.fn(),
  mockUpdatePromptPreference: vi.fn(),
  mockDeletePromptPreference: vi.fn(),
  mockListVersions: vi.fn(),
  mockGetVersion: vi.fn(),
  mockGetAccessToken: vi.fn(),
}));

vi.mock('@/services/intexAgentApi', () => ({
  getIntexAgentPromptPreferences: mockGetPromptPreferences,
  addIntexAgentPromptPreference: mockAddPromptPreference,
  updateIntexAgentPromptPreference: mockUpdatePromptPreference,
  deleteIntexAgentPromptPreference: mockDeletePromptPreference,
  listIntexAgentPromptPreferenceVersions: mockListVersions,
  getIntexAgentPromptPreferenceVersion: mockGetVersion,
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/components', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
}));

const currentPreferences = {
  userId: 'user-1',
  schemaVersion: 1 as const,
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
  updatedBy: { actor: 'web_ui' as const, userId: 'user-1' },
};

const versions = [
  {
    version: 1,
    changeType: 'add' as const,
    changedItemId: 'pref_1',
    nextText: 'When I invite Jakub, use jakub@gmail.com.',
    itemCount: 1,
    createdAt: '2026-06-28T10:00:00.000Z',
    createdBy: { actor: 'web_ui' as const, userId: 'user-1' },
  },
];

describe('IntexAgentPreferencesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockGetPromptPreferences.mockResolvedValue(currentPreferences);
    mockListVersions.mockResolvedValue(versions);
    mockGetVersion.mockResolvedValue({
      id: 'user-1_1',
      userId: 'user-1',
      ...versions[0],
      items: currentPreferences.items,
      renderedPromptBlock: currentPreferences.renderedPromptBlock,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads current preferences, prompt preview, and version history', async () => {
    const { IntexAgentPreferencesPage } = await import('../IntexAgentPreferencesPage');
    render(<IntexAgentPreferencesPage />);

    expect(screen.getByText(/loading preferences/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('INTEX Agent Preferences')).toBeInTheDocument();
      expect(screen.getByText('Current version 1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('When I invite Jakub, use jakub@gmail.com.')).toBeInTheDocument();
      expect(screen.getByText(/User Preferences v1:/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /version 1/i })).toBeInTheDocument();
    });
  });

  it('adds, edits, and deletes preference rows', async () => {
    const addedPreferences = {
      ...currentPreferences,
      currentVersion: 2,
      items: [
        ...currentPreferences.items,
        {
          id: 'pref_2',
          text: 'When I ask about decisions, criticize my choices.',
          createdAt: '2026-06-28T10:01:00.000Z',
          updatedAt: '2026-06-28T10:01:00.000Z',
        },
      ],
      renderedPromptBlock:
        `${currentPreferences.renderedPromptBlock}\n2. (id: pref_2) "When I ask about decisions, criticize my choices."`,
    };
    mockAddPromptPreference.mockResolvedValueOnce(addedPreferences);
    mockUpdatePromptPreference.mockResolvedValueOnce({
      ...addedPreferences,
      currentVersion: 3,
      items: [
        currentPreferences.items[0],
        { ...addedPreferences.items[1], text: 'When I ask about decisions, challenge my choices.' },
      ],
    });
    mockDeletePromptPreference.mockResolvedValueOnce({
      ...currentPreferences,
      currentVersion: 4,
      items: [],
      renderedPromptBlock: '',
    });

    const { IntexAgentPreferencesPage } = await import('../IntexAgentPreferencesPage');
    render(<IntexAgentPreferencesPage />);
    await screen.findByDisplayValue('When I invite Jakub, use jakub@gmail.com.');

    fireEvent.change(screen.getByLabelText(/new preference/i), {
      target: { value: 'When I ask about decisions, criticize my choices.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add preference/i }));

    await waitFor(() => {
      expect(mockAddPromptPreference).toHaveBeenCalledWith('test-token', {
        text: 'When I ask about decisions, criticize my choices.',
        expectedVersion: 1,
      });
      expect(screen.getByDisplayValue('When I ask about decisions, criticize my choices.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[1] as HTMLElement);
    fireEvent.change(screen.getByLabelText('Edit pref_2'), {
      target: { value: 'When I ask about decisions, challenge my choices.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save pref_2/i }));

    await waitFor(() => {
      expect(mockUpdatePromptPreference).toHaveBeenCalledWith('test-token', 'pref_2', {
        text: 'When I ask about decisions, challenge my choices.',
        expectedVersion: 2,
      });
    });

    fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0] as HTMLElement);
    expect(screen.getByText(/remains visible in version history/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove preference/i }));

    await waitFor(() => {
      expect(mockDeletePromptPreference).toHaveBeenCalledWith('test-token', 'pref_1', {
        expectedVersion: 3,
      });
    });
  });

  it('shows selected historical version prompt block', async () => {
    const { IntexAgentPreferencesPage } = await import('../IntexAgentPreferencesPage');
    render(<IntexAgentPreferencesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /version 1/i }));

    await waitFor(() => {
      expect(mockGetVersion).toHaveBeenCalledWith('test-token', 1);
      expect(screen.getByText(/Historical version 1/i)).toBeInTheDocument();
      expect(screen.getAllByText(/User Preferences v1:/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('refreshes current preferences after a version conflict', async () => {
    const refreshed = {
      ...currentPreferences,
      currentVersion: 2,
      items: [
        ...currentPreferences.items,
        {
          id: 'pref_other',
          text: 'Another device changed preferences.',
          createdAt: '2026-06-28T10:02:00.000Z',
          updatedAt: '2026-06-28T10:02:00.000Z',
        },
      ],
    };
    mockAddPromptPreference.mockRejectedValueOnce({
      code: 'VERSION_CONFLICT',
      message: 'Preferences changed before save',
    });
    mockGetPromptPreferences.mockResolvedValueOnce(currentPreferences).mockResolvedValueOnce(refreshed);

    const { IntexAgentPreferencesPage } = await import('../IntexAgentPreferencesPage');
    render(<IntexAgentPreferencesPage />);
    await screen.findByDisplayValue('When I invite Jakub, use jakub@gmail.com.');

    fireEvent.change(screen.getByLabelText(/new preference/i), {
      target: { value: 'When I ask about decisions, criticize my choices.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add preference/i }));

    await waitFor(() => {
      expect(screen.getByText(/preferences changed before save/i)).toBeInTheDocument();
      expect(screen.getByText('Current version 2')).toBeInTheDocument();
    });
  });
});
