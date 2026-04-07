export type IntentKind =
  | 'append_thought'
  | 'delete_thought'
  | 'reorder_thoughts'
  | 'update_draft'
  | 'fallback_append';

export interface InterpretedIntent {
  kind: IntentKind;
  payload: Record<string, unknown>;
  fallbackReason?: string;
}

export interface HellscriptEvent {
  id: string;
  bufferId: string;
  rawUtterance: string;
  intent: InterpretedIntent;
  createdAt: string;
}
