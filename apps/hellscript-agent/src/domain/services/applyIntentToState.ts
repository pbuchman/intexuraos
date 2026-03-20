import { randomUUID } from 'node:crypto';
import type { InterpretedIntent } from '../models/hellscriptEvent.js';
import type { MaterializedBufferState, ThoughtEntry } from '../models/materializedBufferState.js';

function extractStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const raw = payload[key];
  if (!Array.isArray(raw)) return undefined;
  return raw.every((x): x is string => typeof x === 'string') ? raw : undefined;
}

function extractString(payload: Record<string, unknown>, key: string): string {
  const val = payload[key];
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

export function applyIntentToState(
  state: MaterializedBufferState,
  intent: InterpretedIntent
): MaterializedBufferState {
  switch (intent.kind) {
    case 'append_thought':
      return appendThought(state, extractString(intent.payload, 'text'));
    case 'add_writing_sample':
      return addWritingSample(state, extractString(intent.payload, 'text'));
    case 'set_style_instructions':
      return setStyleInstructions(state, extractString(intent.payload, 'instructions'));
    case 'set_metadata':
      return setMetadata(state, intent.payload);
    case 'delete_thought':
      return deleteThought(state, extractString(intent.payload, 'thoughtId'));
    case 'reorder_thoughts':
      return reorderThoughts(state, extractStringArray(intent.payload, 'thoughtIds'));
    case 'update_draft':
      return state;
    case 'fallback_append':
      return appendThought(state, extractString(intent.payload, 'text'));
  }
}

function appendThought(state: MaterializedBufferState, text: string): MaterializedBufferState {
  const entry: ThoughtEntry = {
    id: randomUUID(),
    text,
    addedAt: new Date().toISOString(),
  };
  return {
    ...state,
    thoughts: [...state.thoughts, entry],
  };
}

function addWritingSample(state: MaterializedBufferState, text: string): MaterializedBufferState {
  return {
    ...state,
    writingSamples: [...state.writingSamples, text],
  };
}

function setStyleInstructions(
  state: MaterializedBufferState,
  instructions: string
): MaterializedBufferState {
  return {
    ...state,
    styleInstructions: instructions,
  };
}

function setMetadata(
  state: MaterializedBufferState,
  payload: Record<string, unknown>
): MaterializedBufferState {
  return {
    ...state,
    ...(payload['audience'] !== undefined ? { audience: extractString(payload, 'audience') } : {}),
    ...(payload['contentGoal'] !== undefined
      ? { contentGoal: extractString(payload, 'contentGoal') }
      : {}),
  };
}

function deleteThought(state: MaterializedBufferState, thoughtId: string): MaterializedBufferState {
  const exists = state.thoughts.some((t) => t.id === thoughtId);
  if (!exists) {
    return state;
  }
  return {
    ...state,
    thoughts: state.thoughts.filter((t) => t.id !== thoughtId),
  };
}

function reorderThoughts(
  state: MaterializedBufferState,
  thoughtIds: string[] | undefined
): MaterializedBufferState {
  if (thoughtIds === undefined) {
    return state;
  }

  const currentIds = new Set(state.thoughts.map((t) => t.id));
  const newIds = new Set(thoughtIds);

  if (currentIds.size !== newIds.size) {
    return state;
  }

  for (const id of thoughtIds) {
    if (!currentIds.has(id)) {
      return state;
    }
  }

  const thoughtMap = new Map(state.thoughts.map((t) => [t.id, t]));
  const reordered = thoughtIds
    .map((id) => thoughtMap.get(id))
    .filter((t): t is ThoughtEntry => t !== undefined);

  return {
    ...state,
    thoughts: reordered,
  };
}
