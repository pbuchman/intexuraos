const DOCKER_HEADER_SIZE = 8;

// Matches ANSI/VT100 escape sequences: ESC [ ... final-byte
// Covers SGR color codes, cursor movement, erase sequences, etc.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

// Matches the RFC3339 nanosecond timestamp Docker prepends to every log line
// when `container.logs({ timestamps: true })` is requested:
//   2026-04-17T16:12:19.476123456Z <content>
// Anchored at line start (`m` flag) and consumes the trailing space so the
// downstream content (verifier regex anchors, JSON parsers, etc.) sees a
// pristine line. No-op on logs that don't carry the prefix (e.g. the file-tail
// path used by LogForwarder, which reads the worker's stdout file directly).
const DOCKER_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /gm;

/**
 * Strip Docker multiplexed stream headers from raw log content.
 * Docker attach/logs streams prefix each frame with 8 bytes:
 *   [stream_type, 0, 0, 0, size_b3, size_b2, size_b1, size_b0]
 *
 * Headers can appear both at line starts AND mid-content when a long
 * message (e.g. hook_response JSON) spans multiple Docker frames.
 * We scan the entire string for the binary pattern and remove all matches.
 */
export function stripDockerHeaders(raw: string): string {
  let result = '';
  let i = 0;
  while (i < raw.length) {
    if (i + DOCKER_HEADER_SIZE <= raw.length && isDockerHeaderAt(raw, i)) {
      i += DOCKER_HEADER_SIZE;
    } else {
      result += raw.charAt(i);
      i++;
    }
  }
  return result.replace(ANSI_ESCAPE_RE, '').replace(DOCKER_TIMESTAMP_RE, '');
}

function isDockerHeaderAt(str: string, pos: number): boolean {
  const streamType = str.charCodeAt(pos);
  if (streamType > 2) return false;
  return (
    str.charCodeAt(pos + 1) === 0 && str.charCodeAt(pos + 2) === 0 && str.charCodeAt(pos + 3) === 0
  );
}

/**
 * Strip heavyweight metadata fields from JSONL lines that inflate lines
 * to 64KB+. Targets `tool_use_result` which contains the entire original
 * file content for Edit/Write undo and is never consumed by logFormatter.
 */
export function stripBulkMetadata(content: string): string {
  if (!content.includes('"tool_use_result"')) return content;

  return content
    .split('\n')
    .map((line) => {
      if (!line.includes('"tool_use_result"')) return line;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if ('tool_use_result' in obj) {
          const { tool_use_result: _, ...rest } = obj;
          return JSON.stringify(rest);
        }
      } catch {
        // Partial/invalid JSON — pass through unchanged
      }
      return line;
    })
    .join('\n');
}
