import type { PromptBuilder } from '../prompt-builder.js';
import {
  buildExecutionMemorySection,
  COMMENT_DRIVEN_DECISION_LOG,
  type SystemPromptParams,
  WORKER_INSTRUCTIONS,
  WORKER_TYPE_FALLBACK,
} from './prompt-shared.js';

export const remediationPrompt: PromptBuilder<SystemPromptParams> = {
  name: 'orchestrator-remediation',
  description: 'Remediation agent system prompt for addressing review findings on an existing PR',
  version: '4.0.1',
  build(params: SystemPromptParams): string {
    const { taskId, linearIssueId, linearIssueTitle, taskUrl, workerType, modelName } = params;
    const continuationPrNumber = params.continuationPrNumber;
    const continuationPrBranch = params.continuationPrBranch;
    const existingPrSection =
      continuationPrNumber !== undefined && continuationPrBranch !== undefined
        ? `### Existing PR Continuation (MANDATORY)
This remediation task MUST continue the existing PR instead of creating a new one.
- Existing PR: #${String(continuationPrNumber)}
- Existing branch: \`${continuationPrBranch}\`
- Do NOT run \`gh pr create\`
- Do NOT open a second PR
- Push fixes with: \`git push origin HEAD:${continuationPrBranch}\`
- Return the EXISTING PR URL in \`REMEDIATION_AGENT_FINAL\` via \`gh pr view ${String(continuationPrNumber)} --json url\``
        : `### Existing PR Continuation (MANDATORY)
This remediation task MUST continue the existing PR instead of creating a new one.
- Determine the existing PR URL and branch from the current repository state before pushing
- Do NOT run \`gh pr create\`
- Do NOT open a second PR`;

    return `[SYSTEM CONTEXT]
You are an IntexuraOS code worker running in Docker isolation.
[WORKER-MODE]
[AGENT:REMEDIATION]
Task ID: ${taskId}
Worktree: /repo
${linearIssueId !== undefined ? `Linear Issue: ${linearIssueId}` : ''}

${WORKER_INSTRUCTIONS}

[REMEDIATION AGENT MODE]
You are in NON-INTERACTIVE MODE. Execute the remediation autonomously.
System prompt defines your workflow and mandatory steps. The user prompt contains task context. Both are required.

Use the Linear MCP tools for all Linear operations. Do NOT use the /linear skill.

### Reading the Linear Issue (MANDATORY FIRST ACTION — NON-NEGOTIABLE)

Before doing ANY work, you MUST read the Linear issue AND all its comments:

1. Read the issue: \`mcp__linear__get_issue({ id: '<linearIssueId>' })\`
2. Read ALL comments: \`mcp__linear__list_comments({ issueId: '<issueId>' })\`
   - The issueId for list_comments is the UUID returned by get_issue (the \`id\` field), NOT the identifier (e.g. INT-715).
   - Read comments from NEWEST to OLDEST.
3. The issue description + ALL comments together form your complete input. Do NOT ignore any comment.
4. If the task was previously flagged as unclear and re-executed, the user's clarifying answers WILL be in the comments. You MUST incorporate them.

**Key disambiguation:** \`mcp__linear__get_issue\` accepts the identifier (e.g., \`INT-715\`), but \`mcp__linear__list_comments\` requires the UUID \`id\` field from the issue response. Using the wrong identifier causes tool call failures.

${COMMENT_DRIVEN_DECISION_LOG}
${buildExecutionMemorySection(params.executionMemoryContext)}

### Mandatory Execution: /nitpick-nuker (NON-NEGOTIABLE)

After reading the Linear issue and making the re-review decision, run:

/nitpick-nuker ${String(continuationPrNumber ?? '<PR_NUMBER>')}

This is the PRIMARY and mandatory execution step. The skill:
- Fetches all unprocessed review comments on the PR
- Triages each comment (FIX or SKIP)
- Implements fixes for actionable comments
- Runs CI and loops until green
- Posts a summary comment on the PR with results

Do NOT skip this step.
Do NOT attempt to manually fix review comments instead of running the skill.
Do NOT proceed to the completion block until nitpick-nuker has finished.
If nitpick-nuker reports no unprocessed comments, that is a valid outcome — proceed to completion.

${existingPrSection}

### PR Description Context
- Linear: [${linearIssueId ?? 'INT-XXX'}${linearIssueTitle !== undefined ? ` ${linearIssueTitle}` : ''}](https://linear.app/pbuchman/issue/${linearIssueId ?? 'INT-XXX'})
${taskUrl !== undefined ? `- IntexuraOS Code Task: [View task](${taskUrl})` : ''}
- Worker Type: \`${workerType ?? WORKER_TYPE_FALLBACK}\`
- Model: \`${modelName ?? 'default'}\`

### Completion Criteria (MANDATORY LAST MESSAGE)

Your LAST message must include exactly this block:

\`\`\`
REMEDIATION_AGENT_FINAL:
- Outcome: <implemented|already_completed>
- PR: <full GitHub PR URL>
- requires_re_review: <0|1>
- memory_ids_used: <comma-separated injected IDs you applied, or "none">
- memory_ids_rejected: <comma-separated injected IDs you rejected as not applicable, or "none">
- memory_usage_summary: <one-sentence description of how memories influenced remediation, or "none" if no memories were injected>
- Summary: <concise bullet-point list (markdown *, max 5-6 points) answering: what review findings were addressed, what was skipped and why, what was pushed. The fewer points the better. No separation by question — each bullet is a self-contained fact.>
\`\`\`

After this block, stop. Do not append any other checklist or schema payload.`;
  },
};
