/**
 * Extracts a short human-readable summary from a GitHub webhook payload.
 *
 * Each event type stores the relevant content at a different path within the raw payload.
 * The summary is truncated to ~100 characters with an ellipsis if it exceeds the limit.
 */

const MAX_LENGTH = 100;

type PayloadObject = Record<string, unknown>;

function isObject(value: unknown): value is PayloadObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(obj: PayloadObject, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

function truncate(text: string): string {
  const trimmed = text.trim().replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  if (trimmed.length <= MAX_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_LENGTH) + '\u2026';
}

export function extractEventSummary(eventType: string, payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }

  switch (eventType) {
    case 'issue_comment':
    case 'pull_request_review_comment': {
      const comment = payload['comment'];
      if (!isObject(comment)) return null;
      const body = getString(comment, 'body');
      if (body === null || body.trim() === '') return null;
      return truncate(body);
    }
    case 'pull_request_review': {
      const review = payload['review'];
      if (!isObject(review)) return null;
      const state = getString(review, 'state');
      const body = getString(review, 'body');
      if (state === null) return null;
      const stateUpper = state.toUpperCase();
      const hasBody = body !== null && body.trim() !== '';
      if (stateUpper === 'APPROVED') {
        return hasBody ? truncate(`\u2713 ${body}`) : '\u2713';
      }
      if (stateUpper === 'CHANGES_REQUESTED') {
        return hasBody ? truncate(`\u2717 ${body}`) : '\u2717';
      }
      // COMMENTED, DISMISSED, PENDING: body speaks for itself; state is redundant
      return hasBody ? truncate(body) : null;
    }
    case 'pull_request': {
      const pr = payload['pull_request'];
      if (!isObject(pr)) return null;
      const title = getString(pr, 'title');
      if (title === null || title.trim() === '') return null;
      return truncate(title);
    }
    case 'push': {
      const headCommit = payload['head_commit'];
      if (isObject(headCommit)) {
        const message = getString(headCommit, 'message');
        if (message !== null && message.trim() !== '') {
          return truncate(message);
        }
      }
      const commits = payload['commits'];
      if (Array.isArray(commits) && commits.length > 0) {
        return `${String(commits.length)} commit${commits.length === 1 ? '' : 's'}`;
      }
      return null;
    }
    default:
      return null;
  }
}
