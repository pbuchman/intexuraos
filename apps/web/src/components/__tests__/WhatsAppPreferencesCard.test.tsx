/**
 * Tests for WhatsAppPreferencesCard component.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { WhatsAppPreferencesCard } from '../WhatsAppPreferencesCard.js';
import { ApiError } from '@/services/apiClient.js';

const mockGetAccessToken = vi.fn();

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services/whatsappPreferencesApi', () => ({
  getWhatsAppPreferences: vi.fn(),
  updateWhatsAppPreferences: vi.fn(),
}));

async function getPreferencesMock(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('@/services/whatsappPreferencesApi');
  return vi.mocked(mod.getWhatsAppPreferences);
}

async function updatePreferencesMock(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('@/services/whatsappPreferencesApi');
  return vi.mocked(mod.updateWhatsAppPreferences);
}

describe('WhatsAppPreferencesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('tok');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders heading and description', async () => {
    const getMock = await getPreferencesMock();
    getMock.mockResolvedValue({ notificationLevel: 'all' });

    render(<WhatsAppPreferencesCard />);

    expect(screen.getByText('Notification Preferences')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose which WhatsApp messages from IntexuraOS you want to receive.'
      )
    ).toBeInTheDocument();

    // Wait for the GET to resolve so the radios become enabled.
    await waitFor(() => {
      const radio = screen.getByRole('radio', { name: /all messages/i });
      expect(radio).not.toBeDisabled();
    });
  });

  it('loads the current level from the API on mount and checks the matching radio', async () => {
    const getMock = await getPreferencesMock();
    getMock.mockResolvedValue({ notificationLevel: 'important' });

    render(<WhatsAppPreferencesCard />);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledTimes(1);
    });

    const importantRadio = await screen.findByRole('radio', {
      name: /important only/i,
    });
    await waitFor(() => {
      expect(importantRadio).toBeChecked();
    });

    const allRadio = screen.getByRole('radio', { name: /all messages/i });
    expect(allRadio).not.toBeChecked();
  });

  it('disables radios while the initial GET is in flight', async () => {
    const getMock = await getPreferencesMock();
    let resolveGet: (value: { notificationLevel: 'all' | 'important' }) => void = () => {};
    getMock.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      })
    );

    render(<WhatsAppPreferencesCard />);

    const allRadio = screen.getByRole('radio', { name: /all messages/i });
    const importantRadio = screen.getByRole('radio', {
      name: /important only/i,
    });

    expect(allRadio).toBeDisabled();
    expect(importantRadio).toBeDisabled();

    resolveGet({ notificationLevel: 'all' });

    await waitFor(() => {
      expect(allRadio).not.toBeDisabled();
    });
  });

  it('clicking "Important only" calls updateWhatsAppPreferences with important', async () => {
    const getMock = await getPreferencesMock();
    const updateMock = await updatePreferencesMock();
    getMock.mockResolvedValue({ notificationLevel: 'all' });
    updateMock.mockResolvedValue({ notificationLevel: 'important' });

    render(<WhatsAppPreferencesCard />);

    const importantRadio = await screen.findByRole('radio', {
      name: /important only/i,
    });
    await waitFor(() => {
      expect(importantRadio).not.toBeDisabled();
    });

    fireEvent.click(importantRadio);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock).toHaveBeenCalledWith('tok', {
      notificationLevel: 'important',
    });

    await waitFor(() => {
      expect(importantRadio).toBeChecked();
    });
  });

  it('on PUT failure, shows an error message and reverts the selection', async () => {
    const getMock = await getPreferencesMock();
    const updateMock = await updatePreferencesMock();
    getMock.mockResolvedValue({ notificationLevel: 'all' });
    updateMock.mockRejectedValue(
      new ApiError('INTERNAL', 'Something went wrong', 500)
    );

    render(<WhatsAppPreferencesCard />);

    const allRadio = await screen.findByRole('radio', {
      name: /all messages/i,
    });
    const importantRadio = screen.getByRole('radio', {
      name: /important only/i,
    });
    await waitFor(() => {
      expect(allRadio).not.toBeDisabled();
    });

    fireEvent.click(importantRadio);

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    // Selection reverted to the previous level.
    expect(allRadio).toBeChecked();
    expect(importantRadio).not.toBeChecked();
  });
});
