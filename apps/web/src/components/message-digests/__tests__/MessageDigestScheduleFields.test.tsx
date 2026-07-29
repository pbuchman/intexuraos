/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  MessageDigestDeliveryReadiness,
  MessageDigestSchedule,
} from '@/types/messageDigests';
import {
  MessageDigestScheduleFields,
  type MessageDigestScheduleFieldsProps,
} from '../MessageDigestScheduleFields.js';

describe('MessageDigestScheduleFields', () => {
  afterEach(() => {
    cleanup();
  });

  it('reveals the weekly day only for weekly cadence and emits a closed schedule union', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderFields({ onChange });

    expect(screen.queryByRole('combobox', { name: 'Day of week' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Weekly' }));
    expect(screen.getByRole('combobox', { name: 'Day of week' })).toHaveValue('monday');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Day of week' }), 'thursday');
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'weekly',
      weekday: 'thursday',
      localTime: '07:30',
      timeZone: 'Europe/Warsaw',
    });

    await user.click(screen.getByRole('radio', { name: 'Weekdays' }));
    expect(screen.queryByRole('combobox', { name: 'Day of week' })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'weekdays',
      localTime: '07:30',
      timeZone: 'Europe/Warsaw',
    });
  });

  it('edits local time and IANA zone without calculating a boundary in the browser', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderFields({ onChange });

    await user.clear(screen.getByLabelText('Delivery time'));
    await user.type(screen.getByLabelText('Delivery time'), '09:15');
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'daily',
      localTime: '09:15',
      timeZone: 'Europe/Warsaw',
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Time zone' }), 'UTC');
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'daily',
      localTime: '09:15',
      timeZone: 'UTC',
    });
  });

  it('shows only backend-calculated boundaries and the exact DST rule', () => {
    renderFields();

    expect(screen.getByText(/Next delivery:/)).toHaveTextContent('Jul 28, 2026, 7:30 AM');
    expect(screen.getByText(/Times are calculated by the service/)).toBeInTheDocument();
    expect(screen.getByText(/first valid instant that day/i)).toBeInTheDocument();
    expect(screen.getByText(/earlier occurrence/i)).toBeInTheDocument();
  });

  it.each([
    ['ready', 'WhatsApp delivery is ready'],
    ['mapping_missing', 'No primary WhatsApp number is mapped'],
    ['disconnected', 'WhatsApp delivery is disconnected'],
    ['delivery_disabled', 'WhatsApp delivery is disabled'],
  ] as const)('renders delivery readiness %s without a recipient control', (status, copy) => {
    renderFields({ readiness: readiness(status) });

    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.queryByLabelText(/recipient|phone number/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\+?\d{8,}/u);
  });

  it('offers an explicit retry when readiness observation is unavailable', async () => {
    const user = userEvent.setup();
    const onRefreshReadiness = vi.fn().mockResolvedValue(undefined);
    renderFields({ readiness: null, readinessError: 'Temporarily unavailable', onRefreshReadiness });

    expect(screen.getByText('WhatsApp delivery status unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry delivery check' }));
    expect(onRefreshReadiness).toHaveBeenCalledOnce();
  });

  it('associates schedule errors with their controls and announces every failure', () => {
    renderFields({
      localTimeError: 'Choose a valid local time.',
      timeZoneError: 'Choose a supported time zone.',
      preview: null,
      previewError: 'Schedule preview unavailable',
      readiness: null,
      readinessError: 'Delivery readiness unavailable',
    });

    expect(screen.getByLabelText('Delivery time')).toHaveAttribute(
      'aria-describedby',
      'digest-local-time-error'
    );
    expect(screen.getByLabelText('Time zone')).toHaveAttribute(
      'aria-describedby',
      'digest-time-zone-error'
    );
    for (const message of [
      'Choose a valid local time.',
      'Choose a supported time zone.',
      'Schedule preview unavailable',
    ]) {
      expect(screen.getByText(message)).toHaveAttribute('role', 'alert');
    }
    expect(screen.getByText('WhatsApp delivery status unavailable').parentElement).toHaveAttribute(
      'role',
      'alert'
    );
  });
});

function renderFields(
  overrides: Partial<MessageDigestScheduleFieldsProps> = {}
): ReturnType<typeof render> {
  function Harness(): React.JSX.Element {
    const { value: initialValue, onChange, ...otherOverrides } = overrides;
    const [value, setValue] = useState<MessageDigestSchedule>(
      initialValue ?? {
        kind: 'daily',
        localTime: '07:30',
        timeZone: 'Europe/Warsaw',
      }
    );
    return (
      <MessageDigestScheduleFields
        timeZones={['Europe/Warsaw', 'UTC']}
        preview={{
          evaluatedAt: '2026-07-27T12:00:00.000Z',
          precedingBoundary: '2026-07-27T05:30:00.000Z',
          nextBoundary: '2026-07-28T05:30:00.000Z',
          timeZone: 'Europe/Warsaw',
        }}
        previewLoading={false}
        previewError={null}
        readiness={readiness('ready')}
        readinessLoading={false}
        readinessError={null}
        activeRequested
        {...otherOverrides}
        value={value}
        onChange={(next): void => {
          setValue(next);
          onChange?.(next);
        }}
      />
    );
  }
  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>
  );
}

function readiness(
  status: MessageDigestDeliveryReadiness['status']
): MessageDigestDeliveryReadiness {
  if (status === 'ready') {
    return {
      status,
      maskedPrimaryNumber: '•••• 1234',
      observationVersion: 'mapping-v1',
      observedAt: '2026-07-27T12:00:00.000Z',
    };
  }
  return {
    status,
    observationVersion: 'mapping-v1',
    observedAt: '2026-07-27T12:00:00.000Z',
  };
}
