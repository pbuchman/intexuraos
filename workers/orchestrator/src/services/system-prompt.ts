/**
 * System prompt template for Claude Code workers.
 *
 * This template is injected into worker containers to provide
 * context and instructions for code task execution.
 */

/**
 * Forbidden keywords that are stripped from user prompts.
 * These are typical prompt injection attempts.
 */
const FORBIDDEN_KEYWORDS = [
  'ignore',
  'disregard',
  'forget',
  'override',
  'system',
  'instruction',
  'instructions',
  'instead',
  'rather',
  'but',
  'however',
] as const;

/**
 * Parameters for building the system prompt.
 */
export interface SystemPromptParams {
  /** Unique task identifier */
  taskId: string;
  /** Filesystem path to the git worktree */
  worktreePath: string;
  /** Optional Linear issue ID for tracking */
  linearIssueId?: string;
  /** Raw user prompt (will be sanitized) */
  prompt: string;
}

/**
 * Maximum length of the system prompt.
 */
const MAX_PROMPT_LENGTH = 4000;

/**
 * Sanitize user prompt by removing XML tags and forbidden keywords.
 *
 * This is a basic defense against prompt injection attempts.
 * More sophisticated sanitization may be needed as attack vectors evolve.
 *
 * @param rawPrompt - The raw user prompt
 * @returns Sanitized prompt safe for inclusion in system prompt
 */
function sanitizePrompt(rawPrompt: string): string {
  let sanitized = rawPrompt.replace(/<[^>]*>/g, '');

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    sanitized = sanitized.replace(regex, '');
  }

  return sanitized.replace(/\s+/g, ' ').trim();
}

/**
 * Build the system prompt for a Claude Code worker.
 *
 * The system prompt provides:
 * - System context (task ID, worktree, Linear issue)
 * - Mandatory first action (Linear skill invocation)
 * - Git workflow requirements
 * - Development requirements (TDD, CI)
 * - The sanitized user task
 *
 * @param params - Parameters for system prompt construction
 * @returns Complete system prompt for worker execution
 */
export function buildSystemPrompt(params: SystemPromptParams): string {
  const { taskId, worktreePath, linearIssueId, prompt } = params;

  const sanitizedPrompt = sanitizePrompt(prompt);

  const systemPrompt = `[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS running in Docker isolation.
Task ID: ${taskId}
Worktree: ${worktreePath}
${linearIssueId !== undefined ? `Linear Issue: ${linearIssueId}` : ''}

[MANDATORY - FIRST ACTION]${
    linearIssueId !== undefined
      ? `
You MUST invoke: /linear ${linearIssueId}
DO NOT proceed with any other action until this completes.`
      : ''
  }
[GIT WORKFLOW]
- Create feature branch from origin/development
- Commit with format: "INT-{issue-id} Description"
- Push to origin
- Update Linear issue state to In Review

[REQUIREMENTS]
- Follow CLAUDE.md instructions in worktree
- Use Test-First Development (write tests BEFORE implementation)
- Run pnpm run ci:tracked before committing
- Never push without CI passing

[TASK]
${sanitizedPrompt}`;

  // Truncate to maximum length
  return systemPrompt.length > MAX_PROMPT_LENGTH
    ? systemPrompt.slice(0, MAX_PROMPT_LENGTH)
    : systemPrompt;
}
