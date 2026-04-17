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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(d: Date): string {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c.toISOString();
}

function endOfUtcDay(d: Date): string {
  const c = new Date(d);
  c.setUTCHours(23, 59, 59, 999);
  return c.toISOString();
}

/**
 * Resolves a preset to { from, to } ISO strings at call time.
 *
 * All day boundaries and offsets are computed in UTC so results are
 * deterministic across host timezones and DST transitions.
 */
export function resolveTimeRange(state: TimeRangeState): ResolvedTimeRange {
  const now = new Date();
  switch (state.preset) {
    case 'today':
      return { from: startOfUtcDay(now), to: now.toISOString() };
    case 'yesterday': {
      const y = new Date(now.getTime() - MS_PER_DAY);
      return { from: startOfUtcDay(y), to: endOfUtcDay(y) };
    }
    case 'last7days': {
      const d = new Date(now.getTime() - 7 * MS_PER_DAY);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    case 'last30days': {
      const d = new Date(now.getTime() - 30 * MS_PER_DAY);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    case 'custom':
      return { from: state.customFrom ?? '', to: state.customTo ?? '' };
  }
}
