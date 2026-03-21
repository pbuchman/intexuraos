import cronParser from 'cron-parser';

export function computeNextExecution(cronExpression: string, timezone: string): string | null {
  try {
    const interval = cronParser.parseExpression(cronExpression, { tz: timezone });
    const next = interval.next();
    return next.toISOString();
  } catch {
    return null;
  }
}
