export interface ThoughtEntry {
  id: string;
  text: string;
  addedAt: string;
}

export interface MaterializedBufferState {
  thoughts: ThoughtEntry[];
  writingSamples: string[];
  styleInstructions: string | null;
  audience: string | null;
  contentGoal: string | null;
}

export function emptyState(): MaterializedBufferState {
  return {
    thoughts: [],
    writingSamples: [],
    styleInstructions: null,
    audience: null,
    contentGoal: null,
  };
}
