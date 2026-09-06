/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  mockGetIntexAgentPreferences,
  mockSaveIntexAgentPreferences,
  mockClearIntexAgentPreferences,
  mockTestIntexAgentExternalSave,
  mockGetAccessToken,
} = vi.hoisted(() => ({
  mockGetIntexAgentPreferences: vi.fn(),
  mockSaveIntexAgentPreferences: vi.fn(),
  mockClearIntexAgentPreferences: vi.fn(),
  mockTestIntexAgentExternalSave: vi.fn(),
  mockGetAccessToken: vi.fn(),
}));

vi.mock('@/services/intexAgentApi', () => ({
  getIntexAgentPreferences: mockGetIntexAgentPreferences,
  saveIntexAgentPreferences: mockSaveIntexAgentPreferences,
  clearIntexAgentPreferences: mockClearIntexAgentPreferences,
  testIntexAgentExternalSave: mockTestIntexAgentExternalSave,
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
      externalSave: {
        enabled: false,
        endpointUrl: '',
        cfAccessClientId: '',
        cfAccessClientSecret: '',
        source: 'ios-shortcuts',
      },
      updatedAt: null,
    });
    mockSaveIntexAgentPreferences.mockResolvedValue({
      instructions: 'hello world',
      externalSave: {
        enabled: false,
        endpointUrl: '',
        cfAccessClientId: '',
        cfAccessClientSecret: '',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T10:00:00.000Z',
    });
    mockClearIntexAgentPreferences.mockResolvedValue({
      instructions: '',
      externalSave: {
        enabled: false,
        endpointUrl: '',
        cfAccessClientId: '',
        cfAccessClientSecret: '',
        source: 'ios-shortcuts',
      },
      updatedAt: null,
    });
    mockTestIntexAgentExternalSave.mockResolvedValue({
      status: 'success',
      message: 'Connection successful',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads existing preferences on mount', async () => {
    mockGetIntexAgentPreferences.mockResolvedValueOnce({
      instructions: 'Always invite Monika',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: '************',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T09:00:00.000Z',
    });

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://external-save.example.com/intex')).toBeInTheDocument();
      expect(screen.getByDisplayValue('cf-client-id')).toBeInTheDocument();
      expect(screen.getByDisplayValue('************')).toBeInTheDocument();
      expect(screen.getByDisplayValue('ios-shortcuts')).toBeInTheDocument();
    });
    expect(mockGetIntexAgentPreferences).toHaveBeenCalledWith('test-token');
  });

  it('disables the Save button when external save is unchanged', async () => {
    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(mockGetIntexAgentPreferences).toHaveBeenCalled();
    });

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('saves external save configuration without instructions', async () => {
    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(mockGetIntexAgentPreferences).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByLabelText(/enable external save/i));
    fireEvent.change(screen.getByLabelText(/endpoint url/i), {
      target: { value: 'https://external-save.example.com/intex' },
    });
    fireEvent.change(screen.getByLabelText(/cloudflare access client id/i), {
      target: { value: 'cf-client-id' },
    });
    fireEvent.change(screen.getByLabelText(/cloudflare access client secret/i), {
      target: { value: 'cf-client-secret' },
    });

    const saveButton = screen.getByRole('button', { name: /save/i });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSaveIntexAgentPreferences).toHaveBeenCalledWith('test-token', {
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
  });

  it('tests the external save connection', async () => {
    mockGetIntexAgentPreferences.mockResolvedValueOnce({
      instructions: '',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: '************',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T09:00:00.000Z',
    });

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://external-save.example.com/intex')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(mockTestIntexAgentExternalSave).toHaveBeenCalledWith('test-token', {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: '************',
        source: 'ios-shortcuts',
      });
      expect(screen.getByText('Connection successful')).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText(/endpoint url/i), {
      target: { value: 'https://external-save.example.com/intex' },
    });

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
      externalSave: {
        enabled: false,
        endpointUrl: '',
        cfAccessClientId: '',
        cfAccessClientSecret: '',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T09:00:00.000Z',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(screen.getByText(/Last updated:/i)).toBeInTheDocument();
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
      externalSave: {
        enabled: false,
        endpointUrl: '',
        cfAccessClientId: '',
        cfAccessClientSecret: '',
        source: 'ios-shortcuts',
      },
      updatedAt: '2026-06-27T09:00:00.000Z',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const { IntexAgentConfigPage } = await import('../IntexAgentConfigPage');
    render(<IntexAgentConfigPage />);

    await waitFor(() => {
      expect(screen.getByText(/Last updated:/i)).toBeInTheDocument();
    });

    const clearButton = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockClearIntexAgentPreferences).not.toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });
});
