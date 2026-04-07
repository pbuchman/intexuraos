export interface ThoughtEntry {
  id: string;
  text: string;
  addedAt: string;
}

export interface MaterializedBufferState {
  thoughts: ThoughtEntry[];
}

export function emptyState(): MaterializedBufferState {
  return {
    thoughts: [],
  };
}
