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
