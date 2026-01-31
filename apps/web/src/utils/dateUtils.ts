export interface WeekRange {
  start: Date;
  end: Date;
}

export interface MonthRange {
  start: Date;
  end: Date;
  year: number;
  month: number;
}

export function getStartOfWeek(date: Date): Date {
  const result = new Date(date);
  const dayOfWeek = result.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  result.setDate(result.getDate() - daysFromMonday);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function getCurrentWeekRange(): WeekRange {
  const start = getStartOfWeek(new Date());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

export function getMonthRange(year: number, month: number): MonthRange {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const start = getStartOfWeek(firstOfMonth);
  const end = new Date(lastOfMonth);
  const endDayOfWeek = end.getDay();
  const daysUntilSunday = endDayOfWeek === 0 ? 0 : 7 - endDayOfWeek;
  end.setDate(end.getDate() + daysUntilSunday + 1);
  end.setHours(0, 0, 0, 0);
  return { start, end, year, month };
}

export function getCurrentMonthRange(): MonthRange {
  const now = new Date();
  return getMonthRange(now.getFullYear(), now.getMonth());
}

export function getCalendarDays(range: MonthRange): Date[] {
  const days: Date[] = [];
  const current = new Date(range.start);
  while (current < range.end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}
