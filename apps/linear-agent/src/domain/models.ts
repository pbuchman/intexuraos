/**
 * Domain models for Linear integration.
 */

/** Linear issue priority values */
export type LinearPriority = 0 | 1 | 2 | 3 | 4;

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
