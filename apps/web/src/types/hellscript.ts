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
/**
 * Materialized buffer state returned by the backend.
 * Contains the current accumulated thoughts, writing samples, and metadata.
 */
export interface HellscriptMaterializedState {
  thoughts: { id: string; text: string; addedAt: string }[];
}

export type WritingCategory = 'threads' | 'linkedin' | 'general';

export interface WritingStyleConfig {
  threads: string | null;
  linkedin: string | null;
  general: string | null;
  updatedAt: string;
}

export interface WritingSample {
  id: string;
  category: WritingCategory;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface HellscriptWorkspaceResponse {
  buffer: HellscriptBufferSummary;
  events: HellscriptEvent[];
  draftVersions: HellscriptDraftVersion[];
  state: HellscriptMaterializedState | null;
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
