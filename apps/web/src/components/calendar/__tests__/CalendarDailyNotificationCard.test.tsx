import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarDailyNotificationCard } from '../CalendarDailyNotificationCard.js';
import {
  getCalendarDailyNotificationSettings,
  updateCalendarDailyNotificationSettings,
} from '@/services/calendarApi.js';
import { ApiError } from '@/services/apiClient.js';

vi.mock('@/services/calendarApi.js', () => ({
  getCalendarDailyNotificationSettings: vi.fn(),
  updateCalendarDailyNotificationSettings: vi.fn(),
}));

const getAccessToken = vi.fn(async () => 'token');

function settings(overrides = {}): {
  schedule: {
    enabled: boolean;
    localTime: string;
    timeZone?: string;
    nextRunAt?: string;
  };
  delivery: {
    status: string;
    reason?: string;
  };
} {
  return {
    schedule: {
      enabled: false,
      localTime: '08:00',
      timeZone: 'Europe/Warsaw',
    },
    delivery: {
      status: 'setup_required',
      reason: 'target mapping missing',
    },
    ...overrides,
  };
}

describe('CalendarDailyNotificationCard', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCalendarDailyNotificationSettings).mockResolvedValue(settings());
    vi.mocked(updateCalendarDailyNotificationSettings).mockResolvedValue(
      settings({
        schedule: {
          enabled: true,
          localTime: '07:15',
          timeZone: 'Europe/Warsaw',
          nextRunAt: '2026-07-05T05:15:00.000Z',
        },
        delivery: { status: 'ready' },
      })
    );
  });

  it('renders disabled settings and Matrix setup guidance', async () => {
    render(<CalendarDailyNotificationCard getAccessToken={getAccessToken} />);

    expect(await screen.findByText('Daily Calendar Notification')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /send a once-daily lookahead prompt/i })
    ).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: /time/i })).toBeDisabled();
    expect(screen.getByText(/Matrix delivery setup required/i)).toBeInTheDocument();
    expect(
      screen.getByText(/outbound adapter endpoint, auth token, and intex_agent target room mapping/i)
    ).toBeInTheDocument();
    expect(await screen.findByText(/target mapping missing/i)).toBeInTheDocument();
  });

  it('offers 15-minute time options and saves updates', async () => {
    const user = userEvent.setup();
    render(<CalendarDailyNotificationCard getAccessToken={getAccessToken} />);

    const toggle = await screen.findByRole('checkbox', {
      name: /send a once-daily lookahead prompt/i,
    });
    await user.click(toggle);

    const timeSelect = screen.getByRole('combobox', { name: /time/i });
    const options = within(timeSelect).getAllByRole('option');
    expect(options).toHaveLength(96);
    expect(within(timeSelect).getByRole('option', { name: '07:15' })).toBeInTheDocument();
    await user.selectOptions(timeSelect, '07:15');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(updateCalendarDailyNotificationSettings).toHaveBeenCalledWith('token', {
        enabled: true,
        localTime: '07:15',
        timeZone: 'Europe/Warsaw',
      });
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Matrix delivery is ready')).toBeInTheDocument();
  });

  it('keeps the browser timezone when unsaved schedule settings omit timezone', async () => {
    const resolvedOptions = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
    resolvedOptions.mockReturnValue({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'America/New_York',
    });
    vi.mocked(getCalendarDailyNotificationSettings).mockResolvedValue(
      settings({
        schedule: {
          enabled: false,
          localTime: '08:00',
        },
        delivery: { status: 'ready' },
      })
    );
    const user = userEvent.setup();

    render(<CalendarDailyNotificationCard getAccessToken={getAccessToken} />);

    await user.click(
      await screen.findByRole('checkbox', { name: /send a once-daily lookahead prompt/i })
    );
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(updateCalendarDailyNotificationSettings).toHaveBeenCalledWith('token', {
        enabled: true,
        localTime: '08:00',
        timeZone: 'America/New_York',
      });
    });
    resolvedOptions.mockRestore();
  });

  it('shows API errors', async () => {
    vi.mocked(getCalendarDailyNotificationSettings).mockRejectedValue(
      new ApiError('INTERNAL_ERROR', 'Calendar service failed', 500)
    );

    render(<CalendarDailyNotificationCard getAccessToken={getAccessToken} />);

    expect(await screen.findByText('Calendar service failed')).toBeInTheDocument();
  });

  it('shows transient Matrix readiness errors separately from setup guidance', async () => {
    vi.mocked(getCalendarDailyNotificationSettings).mockResolvedValue(
      settings({
        delivery: {
          status: 'error',
          message: 'Matrix adapter readiness request failed',
        },
      })
    );

    render(<CalendarDailyNotificationCard getAccessToken={getAccessToken} />);

    expect(
      await screen.findByText('Matrix delivery is temporarily unavailable')
    ).toBeInTheDocument();
    expect(screen.getByText(/Matrix adapter readiness request failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/outbound adapter endpoint/i)).not.toBeInTheDocument();
  });
});
