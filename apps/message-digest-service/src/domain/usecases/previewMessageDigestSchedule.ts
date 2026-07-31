import {
  previewMessageDigestSchedule as previewCalendarSchedule,
  type MessageDigestSchedule,
  type MessageDigestSchedulePreview,
} from '../schedules/messageDigestSchedule.js';

export function previewMessageDigestSchedule(input: {
  schedule: MessageDigestSchedule;
  evaluatedAt: string;
}):
  | { ok: true; preview: MessageDigestSchedulePreview }
  | { ok: false; code: 'INVALID_SCHEDULE' } {
  const result = previewCalendarSchedule(input);
  return result.ok ? { ok: true, preview: result.value } : { ok: false, code: 'INVALID_SCHEDULE' };
}
