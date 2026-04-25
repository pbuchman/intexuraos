import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const EXCLUDED_DIR = '__tests__';

const RAW_STATE_LOGGER_PATTERN =
  /logger\.(?:info|warn|error|debug|fatal|trace)\s*\(\s*\{[^}]*?(?<![\w.])state(?![\w.:])[^}]*?\}/;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === EXCLUDED_DIR) continue;
      if (entry === 'node_modules') continue;
      if (entry === 'dist') continue;
      walk(full, files);
    } else if (st.isFile() && full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('audit: no raw state in logger payloads under apps/user-service/src', () => {
  it('contains no logger.<method>({ ..., state, ... }) call sites', () => {
    const files = walk(ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (RAW_STATE_LOGGER_PATTERN.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
