import { WorkerTypeSchema, type WorkerType } from './models.js';

/**
 * Supported directive syntaxes:
 *   Slash command:  /intex worker=<type>
 *   HTML comment:   <!-- intex:worker=<type> -->
 *
 * Valid worker types: auto, opus, sonnet, minimax, glm
 */

const VALID_WORKER_TYPES = new Set<string>(WorkerTypeSchema.options);

const SLASH_COMMAND_RE = /\/intex\s+worker=(\S+)/gi;
const HTML_COMMENT_RE = /<!--\s*intex:worker=(\S+?)\s*-->/gi;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;

export interface DirectiveFound {
  found: true;
  workerType: WorkerType;
  source: 'explicit_comment';
  matches: readonly string[];
}

export interface DirectiveNotFound {
  found: false;
  reason?: 'no_directive' | 'invalid_worker_type' | 'conflicting_directives';
}

export type DirectiveParseResult = DirectiveFound | DirectiveNotFound;

function stripCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_RE, '').replace(INLINE_CODE_RE, '');
}

interface RawMatch {
  workerType: string;
  fragment: string;
}

function findMatches(text: string): RawMatch[] {
  const cleaned = stripCodeBlocks(text);
  const results: RawMatch[] = [];

  for (const match of cleaned.matchAll(SLASH_COMMAND_RE)) {
    const raw = match[1];
    /* v8 ignore start -- ts-type: match[1] always defined when regex has capture group @preserve */
    if (raw === undefined) continue;
    /* v8 ignore stop @preserve */
    const normalized = raw.replace(/[^a-zA-Z]/g, '').toLowerCase();
    results.push({ workerType: normalized, fragment: match[0] });
  }

  for (const match of cleaned.matchAll(HTML_COMMENT_RE)) {
    const raw = match[1];
    /* v8 ignore start -- ts-type: match[1] always defined when regex has capture group @preserve */
    if (raw === undefined) continue;
    /* v8 ignore stop @preserve */
    const normalized = raw.toLowerCase();
    results.push({ workerType: normalized, fragment: match[0] });
  }

  return results;
}

export function parseWorkerTypeDirective(
  body: string | null | undefined
): DirectiveParseResult {
  if (body === null || body === undefined || body.length === 0) {
    return { found: false, reason: 'no_directive' };
  }

  const rawMatches = findMatches(body);

  if (rawMatches.length === 0) {
    return { found: false, reason: 'no_directive' };
  }

  const invalidMatch = rawMatches.find((m) => !VALID_WORKER_TYPES.has(m.workerType));
  if (invalidMatch !== undefined) {
    return { found: false, reason: 'invalid_worker_type' };
  }

  const uniqueTypes = new Set(rawMatches.map((m) => m.workerType));
  if (uniqueTypes.size > 1) {
    return { found: false, reason: 'conflicting_directives' };
  }

  const workerType = rawMatches[0]?.workerType;
  /* v8 ignore start -- ts-type: rawMatches[0] guaranteed defined after length > 0 check @preserve */
  if (workerType === undefined) {
    return { found: false, reason: 'no_directive' };
  }
  /* v8 ignore stop @preserve */

  return {
    found: true,
    workerType: workerType as WorkerType,
    source: 'explicit_comment',
    matches: rawMatches.map((m) => m.fragment),
  };
}
