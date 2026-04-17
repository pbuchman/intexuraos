const DAY_MS = 24 * 60 * 60 * 1000;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
}

export function enumerateDates(fromIso: string, toIso: string): readonly string[] {
  const out: string[] = [];
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime();
  const toMs = new Date(`${toIso}T00:00:00Z`).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) return out;
  for (let t = fromMs; t <= toMs; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function currentMonthIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${String(y)}-${m}`;
}

export function firstDayOfMonth(monthIso: string): string {
  return `${monthIso}-01`;
}

export function lastDayOfMonth(monthIso: string): string {
  const parts = monthIso.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  if (y === undefined || m === undefined) throw new Error(`lastDayOfMonth: invalid ${monthIso}`);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthIso}-${String(lastDay).padStart(2, '0')}`;
}

export function shiftMonth(monthIso: string, delta: number): string {
  const parts = monthIso.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  if (y === undefined || m === undefined) throw new Error(`shiftMonth: invalid ${monthIso}`);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabelPl(monthIso: string): string {
  const parts = monthIso.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  if (y === undefined || m === undefined) return monthIso;
  const label = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 15)));
  return label;
}
