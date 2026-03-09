import { readFile, glob } from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { SessionJsonlEntry } from './transcript-formatter.js';

function isValidEntry(raw: unknown): raw is SessionJsonlEntry {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['type'] !== 'string') return false;
  if (obj['type'] !== 'user' && obj['type'] !== 'assistant') return false;
  if (typeof obj['message'] !== 'object' || obj['message'] === null) return false;
  const msg = obj['message'] as Record<string, unknown>;
  return Array.isArray(msg['content']);
}

export async function readSessionTranscript(
  secretsBasePath: string,
  taskId: string,
  logger: Logger
): Promise<SessionJsonlEntry[]> {
  const basePath = join(secretsBasePath, `claude-session-${taskId}`);
  const pattern = join(basePath, 'projects', '**', '*.jsonl');
  const entries: SessionJsonlEntry[] = [];

  try {
    for await (const filePath of glob(pattern)) {
      const content = await readFile(filePath, 'utf-8');
      let skippedLines = 0;
      for (const line of content.split('\n')) {
        if (line.trim() === '') continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (isValidEntry(parsed)) {
            entries.push(parsed);
          }
        } catch {
          skippedLines++;
        }
      }
      if (skippedLines > 0) {
        logger.warn({ filePath, skippedLines }, 'Skipped malformed JSONL lines in transcript file');
      }
    }
  } catch (error) {
    logger.warn(
      { secretsBasePath, taskId, error: getErrorMessage(error) },
      'Failed to read session transcript'
    );
  }

  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return entries;
}
