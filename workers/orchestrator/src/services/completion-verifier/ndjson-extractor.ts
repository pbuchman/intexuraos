/**
 * [INT-1560] NDJSON-aware text extractor for the completion verifier.
 *
 * Why this exists. The deployed worker invokes Claude with
 * `--print --verbose --output-format stream-json` (see
 * `workers/code-worker/entrypoint.sh`). The agent's emitted assistant text —
 * including any `*_AGENT_FINAL:` block — therefore lives only inside Claude
 * SDK NDJSON events of the form
 *   `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}`
 * where `text` is a JSON-escaped string with literal `\n` two-character
 * sequences instead of real newlines. After `stripDockerHeaders`, the marker
 * is still buried inside that one big JSON line and never appears on its own
 * line, so the strict line-anchored regex in `locateFinalBlock` cannot match
 * it. Production verdict before this fallback shipped: `TASK_RUNTIME_HARD_ERROR
 * — No PLANNING_AGENT_FINAL: block in transcript`, even when the agent
 * emitted a perfectly valid block.
 *
 * Confirmed live by instrumenting `task-dispatcher.ts` on home-dev to dump
 * the exact `rawLogs` passed to `runVerification` (see the
 * `planning-probe-unclear.rawlogs.txt` fixture and INT-1560 evidence notes).
 *
 * What this does. Iterates the transcript line by line. When a line parses
 * as a Claude SDK assistant message with a `text` content block, the line
 * is REPLACED by the un-escaped text (so embedded `\n` become real newlines
 * the locator can split on). Same for terminal `result` events whose
 * `result` field carries the agent's final string. All other lines —
 * non-JSON, malformed JSON, system/user/rate-limit events, assistant events
 * with only tool_use blocks — pass through unchanged. The output is
 * therefore still aligned line-for-line with the input for every line that
 * isn't an extractable text-bearing event.
 */

interface AssistantContentBlock {
  type?: unknown;
  text?: unknown;
}

interface AssistantEvent {
  type?: unknown;
  message?: { content?: unknown };
}

interface ResultEvent {
  type?: unknown;
  result?: unknown;
}

function extractFromAssistantEvent(obj: AssistantEvent): string | null {
  if (obj.type !== 'assistant') return null;
  const content = obj.message?.content;
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const block of content as AssistantContentBlock[]) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    }
  }
  if (texts.length === 0) return null;
  return texts.join('\n');
}

function extractFromResultEvent(obj: ResultEvent): string | null {
  if (obj.type !== 'result') return null;
  return typeof obj.result === 'string' ? obj.result : null;
}

/**
 * Substitutes line-encoded Claude SDK `assistant`/`result` text events with
 * their decoded text content, leaving every other line untouched. Pure and
 * synchronous; no I/O.
 */
export function extractAssistantText(transcript: string): string {
  if (transcript === '') return '';
  const lines = transcript.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('{')) {
      out.push(line);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      out.push(line);
      continue;
    }
    // The startsWith('{') pre-filter guarantees `parsed` is either a thrown
    // SyntaxError (handled above) or a JS object (JSON.parse on a string
    // beginning with `{` cannot return a non-object literal). No null check
    // here — `null` literally serializes as `null`, not `{...}`, so it can
    // never reach this point.
    const obj = parsed as AssistantEvent & ResultEvent;
    const extracted = extractFromAssistantEvent(obj) ?? extractFromResultEvent(obj);
    if (extracted === null) {
      out.push(line);
      continue;
    }
    out.push(extracted);
  }
  return out.join('\n');
}
