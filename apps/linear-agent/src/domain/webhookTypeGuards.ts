/**
 * Type guards for Linear webhook payload data.
 *
 * Distinguishes between Issue and Comment webhook payloads at runtime.
 */

/** Issue webhook data structure (from Linear webhook payload) */
export interface IssueWebhookData {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  state: {
    id: string;
    name: string;
    type: string;
  };
  assignee: {
    id: string;
    name: string;
  } | null;
  labels: {
    id: string;
    name: string;
  }[];
  team: {
    id: string;
    key: string;
  };
  parent?: {
    id: string;
  };
}

/** Comment webhook data structure (from Linear webhook payload) */
export interface CommentWebhookData {
  id: string;
  issueId: string;
  issueIdentifier: string;
  user: {
    id: string;
    name: string;
  };
  body: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Type guard to check if data is an Issue webhook payload.
 * Issues have a 'team' field containing team info.
 *
 * Note: This only checks for the presence of 'team' field to determine the type.
 * Full field validation happens during processing after team connection checks.
 */
export function isIssueWebhookData(data: unknown): data is IssueWebhookData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;

  // Issue data must have 'team' as an object
  return 'team' in record && typeof record['team'] === 'object' && record['team'] !== null;
}

/**
 * Type guard to check if data is a Comment webhook payload.
 * Comments have an 'issueId' field linking to their parent issue.
 *
 * Note: This only checks for the presence of 'issueId' field to determine the type.
 * Full field validation happens during processing after issue lookup.
 */
export function isCommentWebhookData(data: unknown): data is CommentWebhookData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;

  // Comment data must have 'issueId' as a string
  return 'issueId' in record && typeof record['issueId'] === 'string';
}
