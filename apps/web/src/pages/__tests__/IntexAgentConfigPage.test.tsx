/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  mockGetIntexAgentPreferences,
  mockSaveIntexAgentPreferences,
  mockClearIntexAgentPreferences,
  mockGetAccessToken,
} = vi.hoisted(() => ({
  mockGetIntexAgentPreferences: vi.fn(),
  mockSaveIntexAgentPreferences: vi.fn(),
  mockClearIntexAgentPreferences: vi.fn(),
  mockGetAccessToken: vi.fn(),
}));

vi.mock('@/services/intexAgentApi', () => ({
  getIntexAgentPreferences: mockGetIntexAgentPreferences,
  saveIntexAgentPreferences: mockSaveIntexAgentPreferences,
  clearIntexAgentPreferences: mockClearIntexAgentPreferences,
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/components', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
}));

describe('IntexAgentConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockGetIntexAgentPreferences.mockResolvedValue({
      instructions: '',
      updatedAt: null,
    });
    mockSaveIntexAgentPreferences.mockResolvedValue({
      instructions: 'hello world',
      updatedAt: '2026-06-27T10:00:00.000Z',
    });
    mockClearIntexAgentPreferences.mockResolvedValue({
      instructions: '',
      updatedAt: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads existing preferences on mount', async () => {
    mockGetIntexAgentPreferences.mockResolvedValueOnce({
      instructions: 'Always invite Monika',
      updatedAt: '2026-06-27T09:00:00.000Z',
    });

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Always invite Monika')).toBeInTheDocument();
    });
    expect(mockGetIntexAgentPreferences).toHaveBeenCalledWith('test-token');
  });

  it('disables the Save button when instructions are empty or unchanged', async () => {
    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(mockGetIntexAgentPreferences).toHaveBeenCalled();
    });

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('saves preferences when Save is clicked after typing', async () => {
    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(mockGetIntexAgentPreferences).toHaveBeenCalled();
    });

    const textarea = screen.getByLabelText(/personal instructions/i);
    fireEvent.change(textarea, { target: { value: 'hello world' } });

    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSaveIntexAgentPreferences).toHaveBeenCalledWith('test-token', 'hello world');
    });
  });

  it('surfaces an error when loading fails', async () => {
    mockGetIntexAgentPreferences.mockRejectedValueOnce(new Error('boom'));

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  it('surfaces an error when saving fails', async () => {
    mockSaveIntexAgentPreferences.mockRejectedValueOnce(new Error('save failed'));

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(mockGetIntexAgentPreferences).toHaveBeenCalled();
    });

    const textarea = screen.getByLabelText(/personal instructions/i);
    fireEvent.change(textarea, { target: { value: 'something new' } });

    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('save failed')).toBeInTheDocument();
    });
  });

  it('clears preferences when Clear is clicked and confirmed', async () => {
    mockGetIntexAgentPreferences.mockResolvedValueOnce({
      instructions: 'existing pref',
      updatedAt: '2026-06-27T09:00:00.000Z',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('existing pref')).toBeInTheDocument();
    });

    const clearButton = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockClearIntexAgentPreferences).toHaveBeenCalledWith('test-token');
    });

    confirmSpy.mockRestore();
  });

  it('does not clear preferences when confirm is cancelled', async () => {
    mockGetIntexAgentPreferences.mockResolvedValueOnce({
      instructions: 'existing pref',
      updatedAt: '2026-06-27T09:00:00.000Z',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('existing pref')).toBeInTheDocument();
    });

    const clearButton = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockClearIntexAgentPreferences).not.toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });
});