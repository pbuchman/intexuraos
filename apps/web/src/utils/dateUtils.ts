export interface WeekRange {
  start: Date;
  end: Date;
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
