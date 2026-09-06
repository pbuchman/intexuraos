/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleCalendarConnectionPage } from '../GoogleCalendarConnectionPage.js';
import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  initiateGoogleCalendarOAuth,
} from '@/services';
import { updateCalendarDailyNotificationSettings } from '@/services/calendarApi.js';

const mockGetAccessToken = vi.fn(async () => 'token');

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services', () => ({
  ApiError: class ApiError extends Error {},
  disconnectGoogleCalendar: vi.fn(),
  getGoogleCalendarStatus: vi.fn(),
  initiateGoogleCalendarOAuth: vi.fn(),
}));

vi.mock('@/services/calendarApi.js', () => ({
  getCalendarDailyNotificationSettings: vi.fn().mockResolvedValue({
    schedule: {
      enabled: true,
      localTime: '07:15',
      timeZone: 'Europe/Warsaw',
      nextRunAt: '2026-07-05T05:15:00.000Z',
    },
    delivery: { status: 'ready' },
  }),
  updateCalendarDailyNotificationSettings: vi.fn(),
}));

vi.mock('@/components', async () => {
  const actual = await vi.importActual<typeof import('@/components')>('@/components');
  return {
    ...actual,
    Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <div>{children}</div>
    ),
  };
});

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/settings/calendar']}>
      <GoogleCalendarConnectionPage />
    </MemoryRouter>
  );
}

describe('GoogleCalendarConnectionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('token');
    vi.mocked(getGoogleCalendarStatus).mockResolvedValue({
      connected: true,
      email: 'user@example.com',
      scopes: ['calendar'],
      updatedAt: '2026-07-04T12:00:00.000Z',
    });
    vi.mocked(initiateGoogleCalendarOAuth).mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    });
    vi.mocked(updateCalendarDailyNotificationSettings).mockResolvedValue({
      schedule: {
        enabled: false,
        localTime: '08:00',
        timeZone: 'UTC',
      },
      delivery: { status: 'ready' },
    });
    vi.mocked(disconnectGoogleCalendar).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('disables daily notifications before disconnecting Google Calendar', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.mocked(updateCalendarDailyNotificationSettings).mockImplementation(async () => {
      calls.push('disable-schedule');
      return {
        schedule: {
          enabled: false,
          localTime: '08:00',
          timeZone: 'UTC',
        },
        delivery: { status: 'ready' },
      };
    });
    vi.mocked(disconnectGoogleCalendar).mockImplementation(async () => {
      calls.push('disconnect-calendar');
    });

    renderPage();

    await user.click(await screen.findByRole('button', { name: /disconnect/i }));

    await waitFor(() => {
      expect(disconnectGoogleCalendar).toHaveBeenCalledWith('token');
    });
    expect(updateCalendarDailyNotificationSettings).toHaveBeenCalledWith('token', {
      enabled: false,
      localTime: '08:00',
      timeZone: 'UTC',
    });
    expect(calls).toEqual(['disable-schedule', 'disconnect-calendar']);
  });
});
