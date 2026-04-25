import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const EXCLUDED_DIR = '__tests__';

/**
 * Audit pattern explanation:
 *
 * Leading identifier (non-capturing): `logger`, `request.log`, `req.log`,
 *   `reply.log`, `fastify.log`, `app.log`, or `this.logger`. This catches the
 *   logger forms used across user-service routes and use-cases.
 *
 * Body matcher: `[^}]*?` non-greedy so it cannot cross a closing brace and
 *   accidentally span multiple object literals. The `s` (dotAll) flag does not
 *   affect this character class — `[^}]` already matches newlines on its own.
 *   The flag is kept for clarity and as a safety net if the body matcher is
 *   ever changed to use `.`.
 *
 * Bare `state` token guards:
 *   - `(?<![\w.])` lookbehind prevents matches like `state.foo`, `myState`, or
 *     `nestedState`.
 *   - `(?![\w.])` lookahead prevents `stateFoo`, `state.foo`. NOTE: the `:`
 *     character must NOT appear here — the dangerous regression form
 *     `{ state: rawState }` (key-form) MUST be caught.
 *
 * The `s` flag on the regex enables dotAll so the matcher works against the
 * full file content rather than line-by-line input.
 */
const RAW_STATE_LOGGER_PATTERN =
  /(?:logger|(?:request|req|reply|fastify|app)\.log|this\.logger)\.(?:info|warn|error|debug|fatal|trace)\s*\(\s*\{[^}]*?(?<![\w.])state(?![\w.])[^}]*?\}/s;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === EXCLUDED_DIR) continue;
      if (entry === 'node_modules') continue;
      if (entry === 'dist') continue;
      walk(full, files);
    } else if (st.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Returns the 1-based line number of the given character index in `content`,
 * computed by counting `\n` characters up to that index. Used purely for
 * diagnostic output when the audit fires.
 */
function lineNumberOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

describe('audit: no raw state in logger payloads under apps/user-service/src', () => {
  it('contains no logger.<method>({ ..., state, ... }) call sites', () => {
    const files = walk(ROOT);
    const offenders: string[] = [];
    // Clone the pattern with the `g` flag so we can iterate every match in the
    // file via repeated `exec()` calls, not just the first. The base pattern
    // already carries the `s` flag, which we preserve.
    const globalPattern = new RegExp(RAW_STATE_LOGGER_PATTERN.source, 'gs');
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      globalPattern.lastIndex = 0;
      let match: RegExpExecArray | null = globalPattern.exec(content);
      while (match !== null) {
        const lineNo = lineNumberOf(content, match.index);
        const snippet = match[0].replace(/\s+/g, ' ').slice(0, 160);
        offenders.push(`${file}:${String(lineNo)}: ${snippet}`);
        match = globalPattern.exec(content);
      }
    }
    expect(
      offenders,
      `Found raw 'state' in logger calls:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
