/**
 * Mapping helpers that transform synced Linear issue data into display-ready response shapes.
 */

/** Shape returned by issue display endpoints. */
export interface IssueDisplayResponse {
  identifier: string;
  title: string;
  state: { name: string; type: string };
  priority: number;
  assignee: { id: string; name: string } | null;
  labels: { id: string; name: string }[];
  url: string;
  commentCount: number;
  lastCommentAt: string | null;
}

/**
 * Build an {@link IssueDisplayResponse} from a synced issue record and its comment summary.
 */
export function buildIssueDisplayResponse(
  issue: {
    id: string;
    identifier: string;
    title: string;
    state: string;
    stateType: string;
    priority: number;
    assigneeId: string | null;
    assigneeName: string | null;
    labels: { id: string; name: string; color: string }[];
    url: string;
  },
  commentSummary: { commentCount: number; lastCommentAt: string | null }
): IssueDisplayResponse {
  return {
    identifier: issue.identifier,
    title: issue.title,
    state: { name: issue.state, type: issue.stateType },
    priority: issue.priority,
    /* v8 ignore start -- ts-type: assigneeName always set when assigneeId is non-null @preserve */
    assignee: issue.assigneeId !== null ? { id: issue.assigneeId, name: issue.assigneeName ?? '' } : null,
    /* v8 ignore stop @preserve */
    labels: issue.labels.map((label) => ({ id: label.id, name: label.name })),
    url: issue.url,
    commentCount: commentSummary.commentCount,
    lastCommentAt: commentSummary.lastCommentAt,
  };
}

/**
 * Derive a comment summary (count + last comment timestamp) from an array of comments.
 * Assumes comments are sorted chronologically (oldest first) — the last element is treated as the most recent.
 */
export function toCommentSummary(comments: { createdAt: string }[]): { commentCount: number; lastCommentAt: string | null } {
  return {
    commentCount: comments.length,
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess makes indexed access possibly undefined despite length > 0 guard @preserve */
    lastCommentAt: comments.length > 0 ? (comments[comments.length - 1]?.createdAt ?? null) : null,
    /* v8 ignore stop @preserve */
  };
}
