export type TimeRangePreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'custom';

export interface TimeRangeState {
  preset: TimeRangePreset;
  customFrom?: string;
  customTo?: string;
}

export interface ResolvedTimeRange {
  from: string;
  to: string;
}

function startOfDay(d: Date): string {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.toISOString();
}

function endOfDay(d: Date): string {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c.toISOString();
}

/** Resolves a preset to { from, to } ISO strings at call time */
export function resolveTimeRange(state: TimeRangeState): ResolvedTimeRange {
  const now = new Date();
  switch (state.preset) {
    case 'today':
      return { from: startOfDay(now), to: now.toISOString() };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'last7days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    case 'last30days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    case 'custom':
      return { from: state.customFrom ?? '', to: state.customTo ?? '' };
  }
}
