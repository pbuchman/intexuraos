import type { DirectiveParseResult } from './directiveParser.js';
import type { WebhookEventGroup, WorkerType } from './models.js';

export interface PlannerInput {
  eventGroup: WebhookEventGroup;
  action: string | null;
  senderLogin: string;
  body: string | null;
  hasExistingTask: boolean;
  existingTaskWorkerType: WorkerType | null;
  detectedDirective: DirectiveParseResult | null;
  senderAllowed: boolean;
  userMapped: boolean;
}

const MAX_BODY_LENGTH = 4000;

function truncateBody(body: string | null): string | null {
  if (body === null) return null;
  if (body.length <= MAX_BODY_LENGTH) return body;
  return body.slice(0, MAX_BODY_LENGTH) + '... [truncated]';
}

export function serializePlannerInput(input: PlannerInput): string {
  return JSON.stringify({
    eventGroup: input.eventGroup,
    action: input.action,
    senderLogin: input.senderLogin,
    body: truncateBody(input.body),
    hasExistingTask: input.hasExistingTask,
    existingTaskWorkerType: input.existingTaskWorkerType,
    detectedDirective: input.detectedDirective,
    senderAllowed: input.senderAllowed,
    userMapped: input.userMapped,
  });
}

const FEW_SHOT_EXAMPLES = `
## Examples

### Example 1: Coverage report (noop)
Input: { "eventGroup": "comment", "body": "## Coverage Report\\n| File | Lines |", "senderLogin": "codecov[bot]" }
Output: { "actionability": "non_actionable", "decision": { "kind": "noop" }, "reasoning": "Automated coverage report, no action needed" }

### Example 2: Human review comment (actionable)
Input: { "eventGroup": "comment", "body": "Please fix the null check in auth handler", "senderLogin": "reviewer" }
Output: { "actionability": "actionable", "decision": { "kind": "send_task_message" }, "reasoning": "Human review comment requesting specific code change" }

### Example 3: Worker directive on new PR (actionable with directive)
Input: { "eventGroup": "pull_request", "action": "opened", "detectedDirective": { "found": true, "workerType": "opus" } }
Output: { "actionability": "actionable", "decision": { "kind": "create_code_action" }, "requestedWorkerType": "opus", "reasoning": "PR opened with explicit worker directive" }

### Example 4: Worker directive on existing task (denied switch)
Input: { "eventGroup": "comment", "hasExistingTask": true, "existingTaskWorkerType": "sonnet", "detectedDirective": { "found": true, "workerType": "opus" } }
Output: { "actionability": "actionable", "decision": { "kind": "send_task_message" }, "requestedWorkerType": null, "reasoning": "Worker type switch denied: task already assigned to sonnet" }
`;

export const githubWebhookPlannerPrompt = {
  name: 'github-webhook-planner' as const,
  description: 'Classifies GitHub webhook events and produces structured action decisions',
  version: '1.0.0',

  build(input: PlannerInput): string {
    const serialized = serializePlannerInput(input);

    const policyConstraints: string[] = [];
    if (input.hasExistingTask && input.existingTaskWorkerType !== null) {
      policyConstraints.push(
        `- POLICY: Task already uses worker type "${input.existingTaskWorkerType}". Do NOT switch worker type even if a directive requests it.`
      );
    }

    const policySection =
      policyConstraints.length > 0
        ? `\n## Policy Constraints\n${policyConstraints.join('\n')}\n`
        : '';

    return `You are a GitHub webhook event planner for the IntexuraOS code agent.

## Role
Analyze the webhook event context below and produce a structured JSON decision.
You do not execute actions — you only classify and recommend.

## Hard Rules
1. Respond with valid JSON only. No markdown, no explanations outside JSON.
2. You do not execute any actions. You only recommend a decision.
3. Never claim that an action was executed or succeeded.
4. Never include secrets, tokens, or webhook signatures in your output.
5. Your output must conform to the WebhookAgentDecision schema.

## Output Schema
{
  "version": "1.0",
  "eventGroup": "<pull_request|comment|github_action_result|other>",
  "actionability": "<actionable|non_actionable|uncertain>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>",
  "requestedWorkerType": "<auto|opus|sonnet|minimax|glm|null>",
  "decision": { "kind": "<noop|send_task_message|create_pr_comment_task|create_code_action>" }
}
${policySection}${FEW_SHOT_EXAMPLES}
## Event Context
${serialized}

Produce your JSON decision:`;
  },
};
