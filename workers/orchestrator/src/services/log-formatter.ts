/**
 * Summarize multi-line text to first + last non-empty lines.
 * Returns the original text when it has 2 or fewer non-empty lines.
 */
export function summarizeFirstLast(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length <= 2) return lines.join('\n');
  /* v8 ignore start -- ts-type: lines.length > 2 guarantees index 0 and last index are defined; ?? fallback is unreachable @preserve */
  const first = lines[0] ?? '';
  const last = lines[lines.length - 1] ?? '';
  /* v8 ignore stop @preserve */
  const omitted = lines.length - 2;
  return `${first}\n  ... (${String(omitted)} ${omitted === 1 ? 'line' : 'lines'} omitted) ...\n${last}`;
}

const DOCKER_HEADER_SIZE = 8;

// Matches ANSI/VT100 escape sequences: ESC [ ... final-byte
// Covers SGR color codes, cursor movement, erase sequences, etc.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

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
  return result.replace(ANSI_ESCAPE_RE, '');
}

function isDockerHeaderAt(str: string, pos: number): boolean {
  const streamType = str.charCodeAt(pos);
  if (streamType > 2) return false;
  return (
    str.charCodeAt(pos + 1) === 0 && str.charCodeAt(pos + 2) === 0 && str.charCodeAt(pos + 3) === 0
  );
}
