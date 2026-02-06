/**
 * Determines if a PR comment should trigger a Claude task.
 *
 * A comment is actionable if:
 * 1. It mentions @claude-bot (explicit request for Claude)
 * 2. It mentions @claude (shorthand)
 * 3. It's from the PR author AND contains a question or request pattern
 *
 * Bot comments are never actionable (prevents infinite loops).
 */

export interface CommentContext {
  body: string;
  senderLogin: string;
  senderType: string;
  prAuthorLogin?: string;
}

const CLAUDE_MENTIONS = [
  '@claude-bot',
  '@claude',
  '@intexura-claude',
];

const REQUEST_PATTERNS = [
  /please\s+(fix|update|change|add|remove|implement|refactor)/i,
  /can\s+you\s+(fix|update|change|add|remove|implement|refactor)/i,
  /could\s+you\s+(fix|update|change|add|remove|implement|refactor)/i,
  /\?\s*$/,  // Ends with question mark
];

export function isActionableComment(context: CommentContext): boolean {
  const { body, senderType } = context;

  // Never process bot comments (prevents infinite loops)
  if (senderType === 'Bot') {
    return false;
  }

  // Empty body is not actionable
  if (!body || body.trim().length === 0) {
    return false;
  }

  const lowerBody = body.toLowerCase();

  // Check for Claude mentions (explicit request)
  for (const mention of CLAUDE_MENTIONS) {
    if (lowerBody.includes(mention.toLowerCase())) {
      return true;
    }
  }

  // Check if from PR author with request pattern
  // This is more permissive for PR authors since they own the context
  if (context.prAuthorLogin !== undefined && context.prAuthorLogin !== '' && context.senderLogin === context.prAuthorLogin) {
    for (const pattern of REQUEST_PATTERNS) {
      if (pattern.test(body)) {
        return true;
      }
    }
  }

  return false;
}
