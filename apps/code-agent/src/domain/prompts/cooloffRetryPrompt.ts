/**
 * Prompt for extracting Claude usage-limit reset times from failed tasks.
 *
 * A single user-scoped LLM call (not an agent with tools) that reads the
 * error message and recent log lines to extract exactly one absolute UTC
 * timestamp representing the next usage-limit reset. This is the "how long
 * must we wait?" parser that the `retry_after_cooloff` verdict feeds into.
 *
 * INT-1463: Scheduled code-task dispatch (cooloff retry branch).
 */

export const COOLOFF_RETRY_PROMPT_VERSION = '1.0.0';

const MAX_LOG_LINES = 20;

/** Upper bound guard: any parsed reset > 24h from now is implausible. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export interface CooloffPromptInput {
  errorCode: string;
  errorMessage: string;
  recentLogLines: string[];
  userTimezone?: string;
  now: Date;
}

export interface CooloffParsedResponse {
  notBeforeAt: Date;
  timezone?: string;
  sourceText?: string;
  reason: string;
}

export function buildCooloffRetryPrompt(input: CooloffPromptInput): string {
  const logLines = input.recentLogLines.slice(-MAX_LOG_LINES);
  const logSection =
    logLines.length > 0 ? logLines.join('\n') : '(no log lines available)';

  const nowIso = input.now.toISOString();
  const tzLine =
    input.userTimezone !== undefined && input.userTimezone.length > 0
      ? `- **User timezone:** ${input.userTimezone} (use this to disambiguate reset strings that lack an explicit timezone).`
      : `- **User timezone:** (not provided — if the reset string is ambiguous and has no explicit timezone, assume UTC).`;

  return `You are a cooldown parser for Claude usage-limit failures. A task failed because the user hit a Claude API usage limit, and the error message usually contains the next reset time (for example: "You've hit your limit · resets 10pm (UTC)"). Your job is to extract exactly ONE absolute UTC timestamp for when the task can be retried.

## Anchor
- **Now (UTC):** ${nowIso}
${tzLine}

## Error Details
- **Error Code:** ${input.errorCode}
- **Error Message:** ${input.errorMessage}

## Recent Log Lines (last ${String(logLines.length)}):
\`\`\`
${logSection}
\`\`\`

## Your Task
1. Find the reset time mentioned in the error or logs (e.g. "resets 10pm (UTC)", "retry after 3:00 PM PST").
2. Convert it to an absolute UTC ISO-8601 timestamp that is in the FUTURE relative to the Now anchor above, and no more than 24 hours from now.
3. If the reset string has no explicit timezone, use the user timezone above; if none provided, assume UTC.
4. Pick the single next occurrence — do not return past times or times more than a day away.

Respond with ONLY a JSON object and nothing else:
\`\`\`json
{
  "notBeforeAt": "2026-04-23T22:00:00Z",
  "timezone": "UTC",
  "sourceText": "resets 10pm (UTC)",
  "reason": "Claude usage limit resets at 10:00 PM UTC"
}
\`\`\`

Rules:
- \`notBeforeAt\` MUST be an ISO-8601 UTC timestamp ending in \`Z\`.
- \`reason\` is a short human-readable explanation.
- \`timezone\` and \`sourceText\` are optional but preferred when you can infer them.`;
}

export function parseCooloffResponse(
  raw: string,
  now: Date
): CooloffParsedResponse | null {
  try {
    // Strip markdown code fence (same pattern as parseTriageResponse).
    const jsonMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(raw);
    /* v8 ignore start -- regex: capture group 1 always present when regex matches; `?? raw` is a noUncheckedIndexedAccess fallback that is unreachable @preserve */
    const jsonStr = jsonMatch !== null ? (jsonMatch[1] ?? raw) : raw;
    /* v8 ignore stop @preserve */

    const parsed: unknown = JSON.parse(jsonStr.trim());

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    const notBeforeAtRaw = obj['notBeforeAt'];
    if (typeof notBeforeAtRaw !== 'string') {
      return null;
    }

    const reasonRaw = obj['reason'];
    if (typeof reasonRaw !== 'string') {
      return null;
    }

    const notBeforeAt = new Date(notBeforeAtRaw);
    if (Number.isNaN(notBeforeAt.getTime())) {
      return null;
    }

    const nowMs = now.getTime();
    const atMs = notBeforeAt.getTime();
    if (atMs <= nowMs) {
      return null;
    }
    if (atMs - nowMs > MAX_FUTURE_MS) {
      return null;
    }

    const result: CooloffParsedResponse = {
      notBeforeAt,
      reason: reasonRaw,
    };

    const timezoneRaw = obj['timezone'];
    if (typeof timezoneRaw === 'string') {
      result.timezone = timezoneRaw;
    }

    const sourceTextRaw = obj['sourceText'];
    if (typeof sourceTextRaw === 'string') {
      result.sourceText = sourceTextRaw;
    }

    return result;
  } catch {
    return null;
  }
}
