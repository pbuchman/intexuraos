import { stripDockerHeaders } from '../log-formatter.js';

/**
 * Locate the last standalone `<MARKER>` line in the transcript and return
 * everything from that line to the end of the block, stripped of log-driver
 * prefixes. The marker must be the dominant content of its own line
 * (optionally wrapped in markdown emphasis, backticks, or a leading
 * log-driver prefix). Markers buried inside diffs or code blocks are
 * ignored.
 *
 * Returns null if no standalone-line marker is present.
 */
export function locateFinalBlock(transcript: string, marker: string): string | null {
  const normalized = stripDockerHeaders(transcript);
  const lines = normalized.split('\n');

  // Match a line whose trimmed content is MARKER, optionally wrapped in:
  //   - leading log-driver prefix: [something]
  //   - leading opening fence: ```  or ```<lang>
  //   - leading markdown emphasis: *, _, `, **, __
  //   - trailing markdown emphasis/backtick/colon artifact: **, *, `, _
  // The marker already contains its trailing `:`.
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `^\\s*(?:\\[[^\\]]+\\]\\s+)?(?:\`{3}[a-zA-Z_-]*\\s*)?[*_\`]*\\s*${escaped}[*_\`:]*\\s*$`
  );

  let lastMatchIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i] ?? '')) {
      lastMatchIdx = i;
    }
  }
  if (lastMatchIdx < 0) {
    return null;
  }

  // Body = from the marker line through end-of-block.
  // End-of-block triggers (take the first one hit):
  //   - closing code fence ``` on its own line
  //   - another *_AGENT_FINAL: line
  //   - EOF
  const body: string[] = [];
  const anyAgentFinalPattern =
    /^\s*(?:\[[^\]]+\]\s+)?[*_`]*\s*[A-Z_]+_AGENT_FINAL:[*_`:]*\s*$/;
  for (let i = lastMatchIdx; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (i > lastMatchIdx) {
      if (/^\s*`{3}\s*$/.test(line)) break;
      if (anyAgentFinalPattern.test(line)) break;
    }
    // Strip log-driver prefix from body lines.
    body.push(line.replace(/^\s*\[[^\]]+\]\s+/, ''));
  }
  return body.join('\n').trimEnd();
}

/**
 * Parse the body of an AGENT_FINAL block into a flat key-value record.
 * Lines matching `^\s*-\s+<key>:\s*<value>$` start a new entry. Indented
 * continuation lines are appended with `\n`. Values have paired outer
 * markdown emphasis (**...**, *...*, `...`, _..._) stripped once.
 *
 * Keys are preserved as-written (case, spaces, underscores all kept).
 * Callers that want canonical lookup should use the alias-aware
 * resolution in coerceFields.
 */
export function parseKeyValues(block: string): Record<string, string> {
  const lines = block.split('\n');
  const result: Record<string, string> = {};
  let currentKey: string | null = null;

  const keyLinePattern = /^\s*-\s+([^:]+?)\s*:\s*(.*)$/;

  for (const line of lines) {
    // Indented continuation lines should NOT match as new keys.
    const isIndented = /^\s{2,}/.test(line);
    const match = !isIndented ? keyLinePattern.exec(line) : null;
    if (match) {
      currentKey = match[1] ?? '';
      result[currentKey] = match[2] ?? '';
    } else if (currentKey !== null && isIndented) {
      // Indented continuation of current key's value.
      result[currentKey] = `${result[currentKey] ?? ''}\n${line}`;
    } else if (currentKey !== null && line.trim() === '') {
      // Blank inside a multi-line value — keep going; terminator is the
      // next keyed line or end of block.
      continue;
    } else {
      // Non-indented line that isn't a key → ends the current value.
      currentKey = null;
    }
  }

  // Strip paired outer emphasis from each final value.
  for (const key of Object.keys(result)) {
    result[key] = stripOuterEmphasis((result[key] ?? '').trim());
  }
  return result;
}

function stripOuterEmphasis(value: string): string {
  let v = value;
  // Peel one layer of ** / __ / * / _ / ` if paired.
  const pairs: readonly (readonly [string, string])[] = [
    ['**', '**'],
    ['__', '__'],
    ['`', '`'],
    ['*', '*'],
    ['_', '_'],
  ];
  for (const [open, close] of pairs) {
    if (v.startsWith(open) && v.endsWith(close) && v.length >= open.length + close.length) {
      v = v.slice(open.length, v.length - close.length).trim();
      break;
    }
  }
  return v;
}
