/**
 * Extracts the GitHub HTML URL from a stored webhook event payload.
 *
 * Each event type stores the URL at a different path within the raw payload.
 */

type PayloadObject = Record<string, unknown>;

function isObject(value: unknown): value is PayloadObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(obj: PayloadObject, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

export function extractEventUrl(eventType: string, payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }

  switch (eventType) {
    case 'issue_comment':
    case 'pull_request_review_comment': {
      const comment = payload['comment'];
      if (!isObject(comment)) return null;
      return getString(comment, 'html_url');
    }
    case 'pull_request_review': {
      const review = payload['review'];
      if (!isObject(review)) return null;
      return getString(review, 'html_url');
    }
    case 'pull_request': {
      // For synchronize events, build a compare URL from before/after SHAs
      const before = getString(payload, 'before');
      const after = getString(payload, 'after');
      if (before !== null && after !== null) {
        const repo = payload['repository'];
        if (isObject(repo)) {
          const fullName = getString(repo, 'full_name');
          if (fullName !== null) {
            return `https://github.com/${fullName}/compare/${before}...${after}`;
          }
        }
      }
      // Fallback to PR URL for other actions (opened, closed, etc.)
      const pr = payload['pull_request'];
      if (!isObject(pr)) return null;
      return getString(pr, 'html_url');
    }
    case 'push': {
      return getString(payload, 'compare');
    }
    default:
      return null;
  }
}
