import type { PromptBuilder } from '../prompt-builder.js';
import {
  buildExecutionMemorySection,
  COMMENT_DRIVEN_DECISION_LOG,
  type SystemPromptParams,
  WORKER_INSTRUCTIONS,
  WORKER_TYPE_FALLBACK,
} from './prompt-shared.js';

function renderSentryIssueContext(params: SystemPromptParams): string {
  const issue = params.sentryIssue;
  if (issue === undefined) {
    return `- Organization: unknown
- Project: unknown
- Issue ID: unknown
- Issue URL: unknown
- Title: unknown
- Action: unknown
- Received at: unknown`;
  }

  return [
    `- Organization: ${issue.organizationSlug}`,
    `- Project: ${issue.projectSlug}`,
    ...(issue.projectId !== undefined ? [`- Project ID: ${issue.projectId}`] : []),
    `- Issue ID: ${issue.issueId}`,
    ...(issue.issueShortId !== undefined ? [`- Short ID: ${issue.issueShortId}`] : []),
    `- Issue URL: ${issue.issueUrl}`,
    `- Title: ${issue.title}`,
    `- Action: ${issue.action}`,
    ...(issue.eventId !== undefined ? [`- Event ID: ${issue.eventId}`] : []),
    `- Received at: ${issue.receivedAt}`,
  ].join('\n');
}

type EvidenceProvider = 'sentry' | 'error_hub' | 'none';

function selectEvidenceProvider(issueUrl: string | undefined): EvidenceProvider {
  if (issueUrl === undefined) return 'none';

  let url: URL;
  try {
    url = new URL(issueUrl);
  } catch {
    return 'none';
  }

  const errorHubHost = process.env['INTEXURAOS_ERROR_HUB_HOST']?.trim().toLowerCase();
  if (
    errorHubHost !== undefined &&
    errorHubHost !== '' &&
    url.host.toLowerCase() === errorHubHost
  ) {
    return 'error_hub';
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'sentry.io' || hostname.endsWith('.sentry.io')) {
    return 'sentry';
  }

  return 'none';
}

function renderEvidenceProvider(params: SystemPromptParams): string {
  const provider = selectEvidenceProvider(params.sentryIssue?.issueUrl);
  if (provider === 'sentry') {
    return `### Evidence Provider (MANDATORY)
Selected evidence MCP: \`sentry\`
Use only the \`sentry\` MCP for this task. Do not query \`error_hub\`.
If that MCP is unavailable, use the Sentry REST API with \`SENTRY_AUTH_TOKEN\` from the worker environment.`;
  }

  if (provider === 'error_hub') {
    return `### Evidence Provider (MANDATORY)
Selected evidence MCP: \`error_hub\`
Use only the \`error_hub\` MCP for this task. Do not query \`sentry\`.
If that MCP is unavailable, use only these private Sentry-compatible reads at \`https://$ERROR_HUB_HOST\`:
- GET /api/0/organizations/{org}/issues/{issueId}/
- GET /api/0/organizations/{org}/issues/{issueId}/events/latest/
- GET /api/0/organizations/{org}/issues/{issueId}/events/{eventId}/
- GET /api/0/organizations/{org}/issues/{issueId}/events/
- GET /api/0/projects/{org}/{projectSlugOrId}/
The fixed bearer value is syntactic only; network reachability is the access boundary.`;
  }

  return `### Evidence Provider (MANDATORY)
Selected evidence MCP: none
The issue URL host matches neither the configured \`ERROR_HUB_HOST\` nor Sentry SaaS. Do not query either evidence MCP. Finish with outcome \`failed\` and report the provider mismatch.`;
}

export const sentryPrompt: PromptBuilder<SystemPromptParams> = {
  name: 'orchestrator-sentry',
  description: 'Sentry agent system prompt for autonomous issue fixing or code-level suppression',
  version: '1.0.0',
  build(params: SystemPromptParams): string {
    const { taskId, linearIssueId, linearIssueTitle, taskUrl, workerType, modelName } = params;

    return `[SYSTEM CONTEXT]
You are an IntexuraOS code worker running in Docker isolation.
[WORKER-MODE]
[AGENT:SENTRY]
Task ID: ${taskId}
Worktree: /repo
${linearIssueId !== undefined ? `Linear Issue: ${linearIssueId}` : ''}

${WORKER_INSTRUCTIONS}

[SENTRY AGENT MODE]
You are in NON-INTERACTIVE MODE. Fix the Sentry issue autonomously.
System prompt instructions are the source of truth. The user prompt is secondary context.
No user interaction is allowed.

Use the Linear MCP tools for all Linear operations. Do NOT use the /linear skill.

### Sentry Issue Context
${renderSentryIssueContext(params)}

${renderEvidenceProvider(params)}

### Required Sentry Investigation
1. Fetch current Sentry issue details before editing code.
2. Fetch recent events for the same Sentry issue and inspect stack traces, tags, culprit, release, environment, and frequency.
3. Use only the selected evidence provider and its documented fallback.
4. Record the exact Sentry URL and event evidence you used.

### Reproduction
You must attempt reproduction when feasible.
- If feasible, create or run a focused reproduction using repository tests, fixtures, logs, or a small script.
- If not feasible, record why reproduction is not feasible in concrete terms.
- The final PR body and SENTRY_AGENT_FINAL block must include the reproduction attempt or why-not.

### Only Two Successful Outcomes
There are only two successful outcomes:
1. bug fix
2. code-level suppression of a clearly non-error report

Do NOT ignore, mute, archive, or resolve the issue only in Sentry.
Do NOT complete successfully without code changes and a GitHub PR.
Suppression is allowed only when the evidence proves the report is not an application error; implement the suppression directly in code and explain why it is safe.

${COMMENT_DRIVEN_DECISION_LOG}
${buildExecutionMemorySection(params.executionMemoryContext)}

### Implementation Flow
1. Read the Linear issue and all comments first.
2. Fetch current Sentry issue details and recent events.
3. Attempt reproduction, or document why reproduction is not feasible.
4. Implement either the bug fix or code-level suppression.
5. Run focused verification commands and then broader tracked verification as appropriate.
6. Open a pull request targeting development.

### PR Requirements
The PR body must include:
- Sentry URL
- Linear issue
- Verification commands
- Outcome rationale, either bug fix or code-level suppression
- Reproduction evidence or why reproduction was not feasible

### PR Description Context
- Linear: [${linearIssueId ?? 'INT-XXX'}${linearIssueTitle !== undefined ? ` ${linearIssueTitle}` : ''}](https://linear.app/pbuchman/issue/${linearIssueId ?? 'INT-XXX'})
${taskUrl !== undefined ? `- IntexuraOS Code Task: [View task](${taskUrl})` : ''}
- Sentry: ${params.sentryIssue?.issueUrl ?? '<Sentry issue URL>'}
- Worker Type: \`${workerType ?? WORKER_TYPE_FALLBACK}\`
- Model: \`${modelName ?? 'default'}\`

### Completion Criteria (MANDATORY LAST MESSAGE)

Your LAST message must include exactly this block:

\`\`\`
SENTRY_AGENT_FINAL:
- outcome: <fixed|suppressed|failed>
- pr: <GitHub PR URL>
- sentry_issue: <Sentry issue URL>
- linear_issue: <Linear issue URL>
- verification: <commands run and result>
- reproduction: <attempted reproduction evidence, or why reproduction was not feasible>
- suppression_rationale: <required when outcome=suppressed, otherwise n/a>
- failure_reason: <short structured reason when outcome=failed, otherwise n/a>
- summary: <concise bullet-point list, max 5-6 points>
\`\`\`

For outcome fixed or suppressed, pr MUST be a full GitHub PR URL.
For outcome failed, pr may be empty, but the task will finish as failed.

After this block, stop. Do not append any other checklist or schema payload.`;
  },
};
