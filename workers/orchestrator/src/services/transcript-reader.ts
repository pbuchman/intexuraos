import { readFile, glob } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionJsonlEntry } from './transcript-formatter.js';

function isValidEntry(raw: unknown): raw is SessionJsonlEntry {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['type'] !== 'string') return false;
  if (typeof obj['message'] !== 'object' || obj['message'] === null) return false;
  const msg = obj['message'] as Record<string, unknown>;
  return Array.isArray(msg['content']);
}

export async function readSessionTranscript(
  secretsBasePath: string,
  taskId: string
): Promise<SessionJsonlEntry[]> {
  const basePath = join(secretsBasePath, `claude-session-${taskId}`);
  const pattern = join(basePath, 'projects', '**', '*.jsonl');
  const entries: SessionJsonlEntry[] = [];

  try {
    for await (const filePath of glob(pattern)) {
      const content = await readFile(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        if (line.trim() === '') continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (isValidEntry(parsed)) {
            entries.push(parsed);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Glob or read failure — return empty
  }

  return entries;
}
