/**
 * System prompt template for Claude Code workers.
 *
 * This template is injected into worker containers via the --system-prompt flag
 * to provide context and instructions for code task execution.
 * The user prompt is passed separately via stdin (--print mode).
 *
 * Two-Phase Execution Model (INT-486):
 * - Phase 1: DESIGN & VALIDATION (when issue lacks 'code-task' label)
 * - Phase 2: STRICT EXECUTION (when issue has 'code-task' label)
 */

/**
 * Parameters for building the system prompt.
 */
export interface SystemPromptParams {
  /** Unique task identifier */
  taskId: string;
  /** Optional Linear issue ID for tracking */
  linearIssueId?: string;
  /** Optional Linear issue title (for PR descriptions) */
  linearIssueTitle?: string;
  /** Full URL to the IntexuraOS task page (for PR descriptions) */
  taskUrl?: string;
  /** Labels from the validated Linear issue */
  linearIssueLabels: string[];
  /** Whether the issue has child issues */
  hasChildren: boolean;
}

/**
 * Build the Phase 1: DESIGN & VALIDATION system prompt.
 *
 * Used when the Linear issue does NOT have the 'code-task' label.
 * The agent should analyze and enrich the issue IN-PLACE, NOT execute code.
 */
function buildPhase1Prompt(params: SystemPromptParams): string {
  const { taskId, linearIssueId } = params;

  const issueId = linearIssueId ?? 'INT-UNKNOWN';

  return `[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS running in Docker isolation.
[WORKER-MODE]
[PHASE:1]
Task ID: ${taskId}
Worktree: /repo
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

Your LAST message must include exactly this block:

\`\`\`
PHASE1_FINAL:
- Linear label set: <code-task|unclear>
- Phase 2 ready: <yes|no>
- Linear issue: <full Linear URL>
- Summary: <one short sentence>
\`\`\`

Validation rules:
- If label is \`code-task\`, Phase 2 ready must be \`yes\`.
- If label is \`unclear\`, Phase 2 ready must be \`no\`.

After this block, stop. Do not append any other checklist or schema payload.`;
}

/**
 * Build the Phase 2: STRICT EXECUTION system prompt.
 *
 * Used when the Linear issue HAS the 'code-task' label.
 * The agent should execute autonomously without confirmation prompts.
 */
function buildPhase2Prompt(params: SystemPromptParams): string {
  const { taskId, linearIssueId, linearIssueTitle, taskUrl, hasChildren } = params;

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
Worktree: /repo
${linearIssueId !== undefined ? `Linear Issue: ${linearIssueId}` : ''}

[PHASE 2: STRICT EXECUTION]
You are in **NON-INTERACTIVE MODE**. Execute the task autonomously.

### Mandatory First Action
/linear ${linearIssueId ?? 'your-issue-id'}

### Post-Skill Execution
Follow all instructions from the Linear issue description and the user prompt.

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

### PR Description Format

When creating a PR, the body MUST include these links:

1. **Linear issue link** (with issue ID and title as link text):
   \`[${linearIssueId ?? 'INT-XXX'}${linearIssueTitle !== undefined ? ` ${linearIssueTitle}` : ''}](https://linear.app/pbuchman/issue/${linearIssueId ?? 'INT-XXX'})\`

2. **IntexuraOS task link**:
   ${taskUrl !== undefined ? `[View task](${taskUrl})` : `Include the task URL if available.`}

Example PR body format:
\`\`\`
## Summary
<concise description of changes>

## References
- Linear: [${linearIssueId ?? 'INT-XXX'}${linearIssueTitle !== undefined ? ` ${linearIssueTitle}` : ''}](https://linear.app/pbuchman/issue/${linearIssueId ?? 'INT-XXX'})
${taskUrl !== undefined ? `- Task: [View task](${taskUrl})` : ''}

## Changes
<bullet list of key changes>

## Test Plan
<how changes were verified>
\`\`\`

### Resource Limits
**NONE.** Complete the task regardless of token usage.${parentModeSection}

### Completion Criteria (MANDATORY LAST MESSAGE)

Your LAST message must include exactly this block:

\`\`\`
PHASE2_FINAL:
- PR: <full GitHub PR URL>
- CI evidence: pnpm run ci:tracked successful
- Linear issue: <full Linear URL>
- Summary: <one short sentence>
\`\`\`

After this block, stop. Do not append any other checklist or schema payload.`;
  /* v8 ignore stop @preserve */
}

/**
 * Build the system prompt for a Claude Code worker.
 *
 * The system prompt provides phase-specific instructions based on issue labels:
 * - Phase 1 (no 'code-task' label): Design & Validation mode
 * - Phase 2 (has 'code-task' label): Strict Execution mode
 *
 * Note: The user prompt is NOT included here. It's passed separately via stdin
 * in --print mode (written to /secrets/user-prompt.txt).
 *
 * @param params - Parameters for system prompt construction
 * @returns Complete system prompt for worker execution
 */
export function buildSystemPrompt(params: SystemPromptParams): string {
  const { linearIssueLabels } = params;

  const hasCodeTaskLabel = linearIssueLabels.some(
    (label) => label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-') === 'code-task'
  );

  if (!hasCodeTaskLabel) {
    return buildPhase1Prompt(params);
  }

  return buildPhase2Prompt(params);
}
