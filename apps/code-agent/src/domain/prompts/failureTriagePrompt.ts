/**
 * Prompt for triaging *_ENFORCEMENT_FAILED errors.
 *
 * A single user-scoped LLM call (not an agent with tools) that reads the
 * error context and recent log lines to decide if retrying would help.
 *
 * INT-1375: Self-healing failure triage.
 */

export const FAILURE_TRIAGE_PROMPT_VERSION = '1.0.0';

const MAX_LOG_LINES = 20;

export interface TriagePromptInput {
  errorCode: string;
  errorMessage: string;
  recentLogLines: string[];
}

export interface TriageResponse {
  shouldRetry: boolean;
  reason: string;
}

export function buildFailureTriagePrompt(input: TriagePromptInput): string {
  const logLines = input.recentLogLines.slice(-MAX_LOG_LINES);
  const logSection =
    logLines.length > 0 ? logLines.join('\n') : '(no log lines available)';

  return `You are a failure triage system for automated code tasks. A task failed with an enforcement error, meaning the AI agent did not produce the required output format.

## Error Details
- **Error Code:** ${input.errorCode}
- **Error Message:** ${input.errorMessage}

## Recent Log Lines (last ${String(logLines.length)}):
\`\`\`
${logSection}
\`\`\`

## Your Task
Analyze whether this failure is likely transient (retrying with a fresh context would succeed) or permanent (a systematic issue that will fail again).

Transient indicators: the agent was close to completing, hit a context limit, made a formatting mistake, or had a timing issue.
Permanent indicators: the task is fundamentally impossible, the requirements contradict each other, or there's a systematic misunderstanding.

Respond with ONLY a JSON object:
\`\`\`json
{"shouldRetry": true/false, "reason": "brief explanation"}
\`\`\``;
}

export function parseTriageResponse(rawResponse: string): TriageResponse {
  try {
    // Handle markdown code block wrapping
    const jsonMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(rawResponse);
    /* v8 ignore start -- regex: capture group 1 always present when regex matches; `?? rawResponse` is a noUncheckedIndexedAccess fallback that is unreachable @preserve */
    const jsonStr = jsonMatch !== null ? (jsonMatch[1] ?? rawResponse) : rawResponse;
    /* v8 ignore stop @preserve */

    const parsed: unknown = JSON.parse(jsonStr.trim());

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'shouldRetry' in parsed &&
      typeof (parsed as Record<string, unknown>)['shouldRetry'] === 'boolean' &&
      'reason' in parsed &&
      typeof (parsed as Record<string, unknown>)['reason'] === 'string'
    ) {
      return {
        shouldRetry: (parsed as { shouldRetry: boolean }).shouldRetry,
        reason: (parsed as { shouldRetry: boolean; reason: string }).reason,
      };
    }

    return {
      shouldRetry: false,
      reason: `Unexpected response structure: ${jsonStr.trim().slice(0, 100)}`,
    };
  } catch {
    return {
      shouldRetry: false,
      reason: `Failed to parse triage response: ${rawResponse.slice(0, 100)}`,
    };
  }
}
