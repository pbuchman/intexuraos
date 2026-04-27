/**
 * NDJSON-aware text extractor for the completion verifier.
 *
 * Why this exists. The verifier reads the worker's raw stdout buffer, which
 * for both runtimes is JSONL — the marker (`*_AGENT_FINAL:`) lives inside
 * a JSON-escaped `text` field with literal `\n` two-character sequences and
 * never appears on its own line. The strict line-anchored regex in
 * `locateFinalBlock` therefore cannot match it without first un-escaping
 * the JSON.
 *
 * Two runtimes, two envelope shapes the verifier must speak:
 *
 * 1. [INT-1560] **Claude SDK** (`claude --print --verbose --output-format
 *    stream-json` — see `docker/code-worker/entrypoint.sh`):
 *      `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}`
 *    or terminal:
 *      `{"type":"result","subtype":"success","result":"..."}`
 *    Confirmed live via `planning-probe-unclear.rawlogs.txt`.
 *
 * 2. **Codex** (`codex exec --json`, codex-cli 0.125.0):
 *      `{"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}`
 *    Other codex envelopes (`thread.started`, `turn.started`, `turn.completed`,
 *    and `item.completed` for `command_execution`/`reasoning` items) carry
 *    no agent-emitted prose and pass through. Confirmed live via
 *    `codex-pull-request-final.rawlogs.txt` — task_70a75a13 was the
 *    production failure that forced this branch.
 *
 * What this does. Iterates the transcript line by line. When a line parses
 * as one of the supported envelopes, it is REPLACED by the un-escaped text
 * (so embedded `\n` become real newlines the locator can split on). All
 * other lines — non-JSON, malformed JSON, system/user/rate-limit events,
 * assistant events with only tool_use blocks, codex preamble events,
 * codex command_execution events — pass through unchanged. Output is
 * line-for-line aligned with input for every non-extractable line.
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

interface CodexItemCompletedEvent {
  type?: unknown;
  item?: { type?: unknown; text?: unknown };
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

function extractFromCodexAgentMessage(obj: CodexItemCompletedEvent): string | null {
  if (obj.type !== 'item.completed') return null;
  if (obj.item?.type !== 'agent_message') return null;
  return typeof obj.item.text === 'string' ? obj.item.text : null;
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
    const obj = parsed as AssistantEvent & ResultEvent & CodexItemCompletedEvent;
    const extracted =
      extractFromAssistantEvent(obj) ??
      extractFromResultEvent(obj) ??
      extractFromCodexAgentMessage(obj);
    if (extracted === null) {
      out.push(line);
      continue;
    }
    out.push(extracted);
  }
  return out.join('\n');
}
