/**
 * Domain models for Linear integration.
 */

/** Linear issue priority values */
export type LinearPriority = 0 | 1 | 2 | 3 | 4;

/** Linear label with id, name, and color */
export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

/** Priority mapping: 0=none, 1=urgent, 2=high, 3=normal, 4=low */
export const PRIORITY_LABELS: Record<LinearPriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

/** Linear issue state categories for dashboard grouping */
export type IssueStateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

/** Linear issue from API */
export interface LinearIssue {
  id: string;
  identifier: string; // e.g., "PBU-123"
  title: string;
  description: string | null;
  priority: LinearPriority;
  state: {
    id: string;
    name: string;
    type: IssueStateCategory;
  };
  url: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Parent issue UUID (null for top-level issues, populated during full sync) */
  parentId?: string | null;
  /** Number of child issues (subtasks) */
  childCount: number;
  /** Child issues (populated when includeChildren=true) */
  children: LinearIssue[];
  /** Labels associated with the issue */
  labels: LinearLabel[];
  /** Assignee data (fetched from API or webhook) */
  assignee?: { id: string; name: string } | null;
}

/** Linear issue with team ID for validation */
export interface LinearIssueWithTeam extends LinearIssue {
  teamId: string;
  /** Parent issue UUID (null for top-level issues) — required on WithTeam to prevent omission bugs */
  parentId: string | null;
  /** Number of child issues (subtasks) */
  childCount: number;
}

/** Linear team from API */
export interface LinearTeam {
  id: string;
  name: string;
  key: string; // e.g., "PBU"
}

/** User's Linear connection configuration */
export interface LinearConnection {
  userId: string;
  apiKey: string;
  teamId: string;
  teamName: string;
  webhookSecret: string | null;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Public view of connection (no sensitive data) */
export interface LinearConnectionPublic {
  connected: boolean;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a Linear issue */
export interface CreateIssueInput {
  title: string;
  description: string | null;
  priority: LinearPriority;
  teamId: string;
}

/** LLM-extracted issue data from user message */
export interface ExtractedIssueData {
  /** Issue title (required) */
  title: string;
  /** Priority level extracted from message */
  priority: LinearPriority;
  /** Functional requirements section */
  functionalRequirements: string | null;
  /** Technical details section */
  technicalDetails: string | null;
  /** Whether extraction was successful */
  valid: boolean;
  /** Error message if extraction failed */
  error: string | null;
  /** Reasoning for extraction decisions */
  reasoning: string;
}

/** Failed issue creation for manual review */
export interface FailedLinearIssue {
  id: string;
  userId: string;
  actionId: string;
  originalText: string;
  extractedTitle: string | null;
  extractedPriority: LinearPriority | null;
  error: string;
  reasoning: string | null;
  createdAt: string;
  lastRetryAt?: string;
}

/** Successfully processed action record for idempotency */
export interface ProcessedAction {
  actionId: string;
  userId: string;
  issueId: string;
  issueIdentifier: string;
  resourceUrl: string;
  createdAt: string;
}

/** Dashboard filter for issue states */
export type DashboardColumn = 'todo' | 'backlog' | 'in_progress' | 'in_review' | 'to_test' | 'done';

/** Grouped issues by dashboard column */
export interface GroupedIssues {
  todo: LinearIssue[];
  backlog: LinearIssue[];
  in_progress: LinearIssue[];
  in_review: LinearIssue[];
  to_test: LinearIssue[];
  done: LinearIssue[];
  archive: LinearIssue[];
}

/** Linear workflow state for state transition */
export interface WorkflowState {
  id: string;
  name: string;
  type: IssueStateCategory;
}

/** Map Linear state types to dashboard columns */
export function mapStateToDashboardColumn(
  stateType: IssueStateCategory,
  stateName: string
): DashboardColumn {
  const lowerName = stateName.toLowerCase();

  // In Review detection (Linear uses "started" type for these)
  if (lowerName.includes('review')) {
    return 'in_review';
  }

  // To Test / QA detection
  if (lowerName.includes('test') || lowerName.includes('qa') || lowerName.includes('quality')) {
    return 'to_test';
  }

  // Todo detection (unstarted issues that are explicitly "Todo")
  if (lowerName === 'todo') {
    return 'todo';
  }

  switch (stateType) {
    case 'backlog':
      return 'backlog';
    case 'unstarted':
      // Default unstarted to Todo unless it's specifically "Backlog"
      return lowerName === 'backlog' ? 'backlog' : 'todo';
    case 'started':
      return 'in_progress';
    case 'completed':
    case 'cancelled':
      return 'done';
    default:
      return 'todo';
  }
}

/** Locally synced Linear issue (stored in Firestore) */
export interface SyncedLinearIssue {
  id: string; /* Linear UUID (document ID) */
  identifier: string; /* e.g., "INT-444" */
  title: string;
  description: string | null;
  state: string; /* State name e.g., "In Progress" */
  stateType: IssueStateCategory; /* State type for categorization */
  priority: LinearPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  labels: LinearLabel[];
  url: string;
  userId: string; /* Owner user ID (for multi-tenant) */
  parentId: string | null; /* Parent issue UUID (null for top-level issues) */
  createdAt: string; /* ISO timestamp from Linear */
  updatedAt: string; /* ISO timestamp from Linear */
  syncedAt: string; /* When we last synced this issue */
  teamId: string; /* Linear team ID (for webhook secret lookup) */
}

/** Aggregated comment statistics for an issue (used by batch display) */
export interface CommentSummary {
  issueId: string;
  commentCount: number;
  lastCommentAt: string | null;
}

/** Locally synced Linear comment (stored in Firestore) */
export interface LinearComment {
  id: string; /* Linear UUID (document ID) */
  issueId: string; /* Linear issue UUID */
  issueIdentifier: string; /* e.g., "INT-444" */
  userId: string; /* Comment author Linear user ID */
  userName: string; /* Comment author display name */
  body: string; /* Comment body (can include markdown) */
  createdAt: string; /* ISO timestamp from Linear */
  updatedAt: string; /* ISO timestamp from Linear */
  syncedAt: string; /* When we last synced this comment */
}

/** Configuration for the issue pruning system */
export interface PruneConfig {
  /** Threshold above which pruning activates */
  activationThreshold: number;
  /** Target number of issues to delete per run */
  targetDeletionCount: number;
}

/** A candidate issue scored for deletion */
export interface PruneCandidate {
  /** Linear issue UUID */
  id: string;
  /** Human-readable identifier e.g. "INT-123" */
  identifier: string;
  /** Issue title */
  title: string;
  /** Deletion priority score (0-100, higher = more deletable) */
  score: number;
  /** Human-readable reason for deletion */
  reason: string;
  /** Classification category */
  category: 'cancelled' | 'duplicate' | 'sub-issue' | 'simple-fix' | 'review-only' | 'other';
}

/** A prune candidate stored in Firestore for user review */
export interface StoredPruneCandidate extends PruneCandidate {
  /** When the candidate was classified by Gemini */
  classifiedAt: string;
}

/** Stats returned after a pruning run */
export interface PruneStats {
  /** Whether pruning was skipped (below threshold) */
  skipped: boolean;
  /** Reason for skipping (if applicable) */
  skipReason?: string;
  /** Total active issues before pruning */
  totalActive: number;
  /** Number of candidates stored for review */
  stored: number;
  /** Number of issues remaining after storing candidates */
  remaining: number;
  /** Candidates that were stored for user review */
  storedCandidates: Omit<PruneCandidate, 'id'>[];
  /** Duration of the pruning run in milliseconds */
  durationMs: number;
}

/** Stats returned after confirming deletion of prune candidates */
export interface PruneDeleteStats {
  /** Number of issues successfully deleted from Linear */
  deleted: number;
  /** Issues that failed to delete */
  failedDeletions: { identifier: string; error: string }[];
  /** Duration of the deletion in milliseconds */
  durationMs: number;
}
