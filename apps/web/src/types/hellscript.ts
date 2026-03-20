/**
 * Hellscript buffer summary for list view
 */
export interface HellscriptBufferSummary {
  id: string;
  userId: string;
  title: string;
  eventCount: number;
  latestDraftVersionNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Intent kinds for interpreted events
 */
export type HellscriptIntentKind =
  | 'append_thought'
  | 'add_writing_sample'
  | 'set_style_instructions'
  | 'set_metadata'
  | 'delete_thought'
  | 'reorder_thoughts'
  | 'update_draft'
  | 'fallback_append';

/**
 * Interpreted intent from hellscript-agent
 */
export interface HellscriptInterpretedIntent {
  kind: HellscriptIntentKind;
  payload: Record<string, unknown>;
  fallbackReason?: string;
}

/**
 * Hellscript event in the timeline
 */
export interface HellscriptEvent {
  id: string;
  bufferId: string;
  rawUtterance: string;
  intent: HellscriptInterpretedIntent;
  createdAt: string;
}

/**
 * Draft version for version selector
 */
export interface HellscriptDraftVersion {
  id: string;
  bufferId: string;
  versionNumber: number;
  markdown: string;
  requestText: string;
  createdAt: string;
}

/**
 * Workspace response combining buffer, events, and drafts
 */
export interface HellscriptWorkspaceResponse {
  buffer: HellscriptBufferSummary;
  events: HellscriptEvent[];
  draftVersions: HellscriptDraftVersion[];
}

/**
 * Impose request to hellscript-agent
 */
export interface HellscriptImposeRequest {
  bufferId?: string;
  utterance: string;
}

/**
 * Impose response from hellscript-agent
 */
export interface HellscriptImposeResponse {
  bufferId: string;
  action: string;
  latestDraftVersionId?: string;
}
