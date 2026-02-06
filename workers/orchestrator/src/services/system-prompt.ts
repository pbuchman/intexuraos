/**
 * System prompt template for Claude Code workers.
 *
 * This template is injected into worker containers to provide
 * context and instructions for code task execution.
 *
 * Two-Phase Execution Model (INT-486):
 * - Phase 1: DESIGN & VALIDATION (when issue lacks 'code-task' label)
 * - Phase 2: STRICT EXECUTION (when issue has 'code-task' label)
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
  /** Labels from the validated Linear issue */
  linearIssueLabels: string[];
  /** Whether the issue has child issues */
  hasChildren: boolean;
  /** Raw user prompt (will be sanitized and included as supplemental instructions) */
  prompt: string;
}

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
 * Build the Phase 1: DESIGN & VALIDATION system prompt.
 *
 * Used when the Linear issue does NOT have the 'code-task' label.
 * The agent should analyze and enrich the issue IN-PLACE, NOT execute code.
 */
function buildPhase1Prompt(params: SystemPromptParams): string {
  const { taskId, worktreePath, linearIssueId, prompt: supplementalInstructions } = params;
  const sanitizedSupplement = sanitizePrompt(supplementalInstructions);

  // Use the provided issue ID or 'UNKNOWN' placeholder
  const issueId = linearIssueId ?? 'INT-UNKNOWN';

  return `[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS running in Docker isolation.
[WORKER-MODE]
[PHASE:1]
Task ID: ${taskId}
Worktree: ${worktreePath}
${linearIssueId !== undefined ? `Linear Issue: ${linearIssueId}` : ''}

[PHASE 1: DESIGN & VALIDATION - IN-PLACE MODEL]
You are an autonomous **Design Agent**. Your task is to analyze, clarify, and prepare the Linear issue for execution.

**DO NOT EXECUTE CODE.** Work IN-PLACE on the Linear issue itself.

### Mandatory Outputs (In-Place Design)

1.  **Enrich Linear Issue Description:**
    - Update the issue description to match the Unified Issue Template.
    - Add all missing sections directly to the issue:
        - \`## Test Requirements\` (with table format - MANDATORY)
        - \`## Summary\`
        - \`## Requirements\` (Functional / Non-Functional)
        - \`## Scope\` (In Scope / Out of Scope)
        - \`## Files to Modify\`
        - \`## Acceptance Criteria\`

2.  **Create Subissues (if complex):**
    - For multi-step tasks, create specific child issues
    - Each child MUST have:
        - Detailed scope
        - Own Test Requirements section
        - \`code-task\` label (ready for Phase 2)
    - Parent issue becomes execution coordinator

3.  **Add Label:** (CRITICAL - one of these MUST be added)
    - If issue is ready for execution: Add \`code-task\` label
    - If issue needs human clarification: Add \`unclear\` label
    - Use Linear MCP to add the appropriate label.

### Optional: Design Document PR (Complex Cases Only)

For complex architectural decisions that need preserved reasoning:
- Create file: \`docs/plans/${issueId}-design.md\`
- Branch: \`design/${issueId}\`
- Create PR to preserve the design work
- Reference Linear issue in PR description

### Completion Criteria

After enriching the issue and adding EITHER \`code-task\` OR \`unclear\` label, **STOP**.
Output: \`Phase 1 Complete. Issue enriched. Label '[code-task|unclear]' added. Awaiting Phase 2.\`
${
  sanitizedSupplement.length > 0
    ? `

[USER SUPPLEMENTAL INSTRUCTIONS]
${sanitizedSupplement}
`
    : ''
}`;
}

/**
 * Build the Phase 2: STRICT EXECUTION system prompt.
 *
 * Used when the Linear issue HAS the 'code-task' label.
 * The agent should execute autonomously without confirmation prompts.
 */
function buildPhase2Prompt(params: SystemPromptParams): string {
  const {
    taskId,
    worktreePath,
    linearIssueId,
    hasChildren,
    prompt: supplementalInstructions,
  } = params;
  const sanitizedSupplement = sanitizePrompt(supplementalInstructions);

  const parentModeSection = hasChildren
    ? `

[PARENT EXECUTION MODE]
This issue has child subtasks. You must execute ALL children continuously without stopping between them:
- Use single branch for all children
- Create PR early (before first child)
- After EACH child: commit → push → update PR description
- PR description MUST list all children with status
- Maintain progress log in PR description
`
    : '';

  /* v8 ignore start -- test-infra: conditional branches require integration test with/without Linear issue ID @preserve */
  return `[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS running in Docker isolation.
[WORKER-MODE]
[PHASE:2]
Task ID: ${taskId}
Worktree: ${worktreePath}
${linearIssueId !== undefined ? `Linear Issue: ${linearIssueId}` : ''}

[PHASE 2: STRICT EXECUTION]
You are in **NON-INTERACTIVE MODE**. Execute the task autonomously.

### Mandatory First Action
/linear ${linearIssueId ?? 'your-issue-id'}

### Post-Skill Execution
Follow all instructions from the Linear issue description and any additional user instructions provided below.

### Execution Rules

1.  **No Confirmation Prompts:** Do NOT ask "Should I commit?", "Ready to push?", etc.
2.  **Complete Checkpoints Autonomously:**
    - Write tests (from Test Requirements).
    - Implement code (from Requirements).
    - Run \`pnpm run ci:tracked\`.
    - Commit if CI passes.
    - Push to remote.
    - Create PR.
    - Update Linear to "In Review".
3.  **On CI Failure:** Fix the issue, re-run CI, continue. Stop only if unable to resolve after 3 attempts.

### Resource Limits
**NONE.** Complete the task regardless of token usage.${parentModeSection}

### Completion Statement (MANDATORY)
When task is complete, you MUST state ALL of the following clearly:
- **PR:** "PR created: <URL>" or "PR #XXX created"
- **CI:** "CI passed" or "pnpm run ci:tracked passed"
- **Linear:** "Linear updated to In Review" or "Linear state: In Review"

[USER SUPPLEMENTAL INSTRUCTIONS]
${sanitizedSupplement}
`;
  /* v8 ignore stop @preserve */
}

/**
 * Build the system prompt for a Claude Code worker.
 *
 * The system prompt provides phase-specific instructions based on issue labels:
 * - Phase 1 (no 'code-task' label): Design & Validation mode
 * - Phase 2 (has 'code-task' label): Strict Execution mode
 *
 * @param params - Parameters for system prompt construction
 * @returns Complete system prompt for worker execution
 */
export function buildSystemPrompt(params: SystemPromptParams): string {
  const { linearIssueLabels } = params;

  // Determine phase based on 'code-task' label
  const hasCodeTaskLabel = linearIssueLabels.includes('code-task');

  if (!hasCodeTaskLabel) {
    // Phase 1: Design & Validation
    return buildPhase1Prompt(params);
  }

  // Phase 2: Strict Execution
  return buildPhase2Prompt(params);
}
