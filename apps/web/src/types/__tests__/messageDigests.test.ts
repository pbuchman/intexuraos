import { describe, expect, it } from 'vitest';
import {
  formatMessageDigestDateTime,
  getMessageDigestDeliveryStatusLabel,
  getMessageDigestGenerationStatusLabel,
  getMessageDigestScheduleLabel,
  getMessageDigestSourceTypeLabel,
  getMessageDigestStatusLabel,
  isValidMessageDigestTimeZone,
  maskMessageDigestPrimaryNumber,
} from '../messageDigests.js';
import type {
  CreateMessageDigestInput,
  MessageDigestDefinition,
  MessageDigestRun,
  MessageDigestSchedule,
} from '../messageDigests.js';

describe('Message Digest presentation helpers', () => {
  it('uses explicit text labels for definition, generation, and delivery status', () => {
    expect(getMessageDigestStatusLabel('active')).toBe('Active');
    expect(getMessageDigestStatusLabel('paused')).toBe('Paused');
    expect(getMessageDigestStatusLabel('needs_attention')).toBe('Needs attention');
    expect(getMessageDigestStatusLabel('deleting')).toBe('Deleting');
    expect(getMessageDigestGenerationStatusLabel('skipped_no_activity')).toBe(
      'Skipped — no new messages'
    );
    expect(getMessageDigestDeliveryStatusLabel('ambiguous')).toBe('Send status needs review');
  });

  it('labels group and direct sources without exposing an identifier', () => {
    expect(getMessageDigestSourceTypeLabel('group')).toBe('Group');
    expect(getMessageDigestSourceTypeLabel('direct')).toBe('Direct');
  });

  it('locally masks readiness values and never renders a prefix or full number', () => {
    expect(maskMessageDigestPrimaryNumber('+48•••123')).toBe('•••• 123');
    expect(maskMessageDigestPrimaryNumber('+48 600 123 456')).toBe('•••• 3456');
    expect(maskMessageDigestPrimaryNumber(undefined)).toBe('Primary WhatsApp');
  });

  it('formats valid instants in the persisted IANA zone and fails closed', () => {
    expect(isValidMessageDigestTimeZone('Europe/Warsaw')).toBe(true);
    expect(isValidMessageDigestTimeZone('Not/A_Time_Zone')).toBe(false);
    expect(formatMessageDigestDateTime('2026-07-27T12:00:00.000Z', 'Europe/Warsaw')).toBe(
      'Jul 27, 2026, 2:00 PM'
    );
    expect(formatMessageDigestDateTime('not-a-date', 'Europe/Warsaw')).toBe('—');
    expect(formatMessageDigestDateTime('2026-07-27T12:00:00.000Z', 'Not/A_Time_Zone')).toBe('—');
  });

  it('represents daily, weekdays, and every weekly cadence without recipient state', () => {
    const schedules: MessageDigestSchedule[] = [
      { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
      { kind: 'weekdays', localTime: '08:00', timeZone: 'Europe/Warsaw' },
      ...(
        [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ] as const
      ).map(
        (weekday): MessageDigestSchedule => ({
          kind: 'weekly',
          weekday,
          localTime: '09:15',
          timeZone: 'Europe/Warsaw',
        })
      ),
    ];

    expect(schedules.map((schedule) => schedule.kind)).toEqual([
      'daily',
      'weekdays',
      'weekly',
      'weekly',
      'weekly',
      'weekly',
      'weekly',
      'weekly',
      'weekly',
    ]);
    expect(JSON.stringify(schedules)).not.toMatch(/recipient|phoneNumber/u);
  });

  it.each([
    [{ kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' }, 'Daily at 07:30'],
    [
      { kind: 'weekdays', localTime: '08:00', timeZone: 'Europe/Warsaw' },
      'Weekdays at 08:00',
    ],
    [
      {
        kind: 'weekly',
        weekday: 'thursday',
        localTime: '09:15',
        timeZone: 'Europe/Warsaw',
      },
      'Every Thursday at 09:15',
    ],
  ] as const)('labels a %s calendar schedule', (schedule, expected) => {
    expect(getMessageDigestScheduleLabel(schedule)).toBe(expected);
  });

  it('keeps recipient and private owner/source identities outside public DTOs', () => {
    type ForbiddenTopLevelKey =
      | 'recipient'
      | 'phoneNumber'
      | 'userId'
      | 'sourceAccountId'
      | 'generationId';
    type ForbiddenKeys =
      | Extract<keyof CreateMessageDigestInput, ForbiddenTopLevelKey>
      | Extract<keyof CreateMessageDigestInput['source'], ForbiddenTopLevelKey>
      | Extract<keyof MessageDigestDefinition, ForbiddenTopLevelKey>
      | Extract<keyof MessageDigestDefinition['source'], 'sourceAccountId' | 'generationId'>
      | Extract<keyof MessageDigestRun, ForbiddenTopLevelKey>
      | Extract<keyof MessageDigestRun['source'], 'sourceAccountId' | 'generationId'>;
    const noForbiddenKeys: [ForbiddenKeys] extends [never] ? true : false = true;

    expect(noForbiddenKeys).toBe(true);
  });
});
