import { stripDockerHeaders } from '../log-formatter.js';
import { AGENT_CONTRACTS, type AgentContract, type FieldSpec } from './contracts.js';
import { extractAssistantText } from './ndjson-extractor.js';

/**
 * [INT-1470] Set of all known field names + aliases from every contract,
 * normalized (lowercase + strip spaces/underscores). Used by `parseKeyValues`
 * to distinguish a genuine `- key: value` line from a prose summary bullet
 * like `- Key decision: ...` that happens to contain a colon.
 *
 * A `- <text>:` line only opens a new key if `normalize(text)` is in this
 * set; otherwise, when a key is already open, the line is treated as a
 * continuation of the current value.
 */
const normalizeKeyName = (key: string): string => key.toLowerCase().replace(/[\s_]+/g, '');

const KNOWN_KEY_NORMALIZED: ReadonlySet<string> = ((): ReadonlySet<string> => {
  const set = new Set<string>();
  for (const contract of Object.values(AGENT_CONTRACTS)) {
    for (const field of contract.fields) {
      set.add(normalizeKeyName(field.name));
      for (const alias of field.alias ?? []) {
        set.add(normalizeKeyName(alias));
      }
    }
  }
  return set;
})();

/**
 * [INT-1470] Alternation of the real AGENT_FINAL markers, used to detect a
 * boundary between two blocks in a transcript. Restricting to markers that
 * actually appear in `AGENT_CONTRACTS` prevents a fake `FAKE_AGENT_FINAL:`
 * line inside a block body from prematurely terminating parsing. The
 * `ask_agent` marker is empty and skipped so the alternation can never
 * match the empty string.
 */
const KNOWN_MARKERS: readonly string[] = Object.values(AGENT_CONTRACTS)
  .map((c) => c.marker)
  .filter((m) => m !== '');

const KNOWN_MARKER_ALTERNATION = KNOWN_MARKERS.map((m) =>
  m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
).join('|');

/**
 * Locate the last standalone `<MARKER>` line in the transcript and return
 * everything from that line to the end of the block, stripped of log-driver
 * prefixes. The marker must be the dominant content of its own line
 * (optionally wrapped in markdown emphasis, backticks, or a leading
 * log-driver prefix). Markers buried inside diffs or code blocks are
 * ignored.
 *
 * Returns null if no standalone-line marker is present anywhere in the
 * transcript — even after the [INT-1560] NDJSON-aware fallback.
 *
 * [INT-1560] Two-phase locate. Phase 1 runs the strict line-anchored search
 * over the docker-header-stripped transcript exactly as before, preserving
 * every existing fixture and external caller. Phase 2 only runs when phase
 * 1 returns null: it parses each NDJSON line as a Claude SDK event and
 * substitutes any extractable assistant `text` / result `result` field with
 * its un-escaped content (`extractAssistantText`), then re-runs the strict
 * search. This catches the production case where the agent's final block
 * exists only as a JSON-escaped string inside an `{"type":"assistant",...}`
 * event — captured from the live home-dev orchestrator on 2026-04-25
 * (see `__tests__/fixtures/completion-verifier/raw-rawlogs/`).
 */
export function locateFinalBlock(transcript: string, marker: string): string | null {
  const normalized = stripDockerHeaders(transcript);
  const direct = locateBlockInLines(normalized.split('\n'), marker);
  if (direct !== null) return direct;
  const extracted = extractAssistantText(normalized);
  return locateBlockInLines(extracted.split('\n'), marker);
}

function isPostFinalRuntimeBoundary(line: string): boolean {
  const trimmed = line.trim().replace(/^\[[^\]]+\]\s+/, '');
  if (trimmed === '') return false;

  if (trimmed.startsWith('Codex attempt finished with exit code:')) {
    return true;
  }

  if (!trimmed.startsWith('{')) return false;

  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    return parsed.type === 'turn.completed';
  } catch {
    return false;
  }
}

function locateBlockInLines(lines: readonly string[], marker: string): string | null {
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
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces `?? ''` fallback but `i < lines.length` guarantees lines[i] is always a string; the fallback branch is unreachable @preserve */
    if (pattern.test(lines[i] ?? '')) {
      lastMatchIdx = i;
    }
    /* v8 ignore stop @preserve */
  }
  if (lastMatchIdx < 0) {
    return null;
  }

  // Body = from the marker line through end-of-block.
  // End-of-block triggers (take the first one hit):
  //   - closing code fence ``` on its own line
  //   - another *_AGENT_FINAL: line
  //   - Codex post-final runtime lifecycle telemetry
  //   - EOF
  const body: string[] = [];
  // [INT-1470] Restrict end-of-block detection to the known real markers
  // (see KNOWN_MARKER_ALTERNATION). A generic `[A-Z_]+_AGENT_FINAL:` class
  // would terminate on fake/typo markers like `FAKE_AGENT_FINAL:` quoted in
  // the body of a legitimate block.
  const anyAgentFinalPattern = new RegExp(
    `^\\s*(?:\\[[^\\]]+\\]\\s+)?[*_\`]*\\s*(?:${KNOWN_MARKER_ALTERNATION})[*_\`:]*\\s*$`
  );
  for (let i = lastMatchIdx; i < lines.length; i += 1) {
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces `?? ''` fallback but `i < lines.length` guarantees lines[i] is always a string; the fallback branch is unreachable @preserve */
    const line = lines[i] ?? '';
    /* v8 ignore stop @preserve */
    if (i > lastMatchIdx) {
      if (/^\s*`{3}\s*$/.test(line)) break;
      if (anyAgentFinalPattern.test(line)) break;
      if (isPostFinalRuntimeBoundary(line)) break;
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
 *
 * [INT-1470] Once a key has been opened, any non-empty line that is itself
 * NOT a new `- <key>:` line is appended to the current value. This is the
 * common "bulleted summary without 2-space indent" pattern, e.g.:
 *   - Summary:
 *   * bullet 1
 *   * bullet 2
 * Previously an unindented `*` line closed the key and `summary` came back
 * empty, which falsely reported `missingRequired: ['summary']`. The key
 * closes only when we hit a new key-line match, another AGENT_FINAL
 * marker, a closing fence, or EOF.
 *
 * [INT-1470 review follow-up] A `- <text>:` line is recognised as a new key
 * ONLY when `normalize(text)` matches a field name or alias registered in
 * `AGENT_CONTRACTS`. Otherwise — e.g. prose bullets inside a summary like
 * `- Key decision: rewrote the verifier` — the line is appended to the
 * currently-open key instead of hijacking it. The whitelist is built once
 * at module load from the contract registry (see KNOWN_KEY_NORMALIZED).
 */
export function parseKeyValues(block: string): Record<string, string> {
  const lines = block.split('\n');
  const result: Record<string, string> = {};
  let currentKey: string | null = null;

  const keyLinePattern = /^\s*-\s+([^:]+?)\s*:\s*(.*)$/;

  for (const line of lines) {
    const match = keyLinePattern.exec(line);
    if (match) {
      /* v8 ignore start -- ts-type: TypeScript's noUncheckedIndexedAccess types regex capture groups as `string | undefined` even when the regex guarantees both groups match (every alternative has exactly 2 `.*`-style captures); the `?? ''` fallback arms are unreachable at runtime @preserve */
      const candidateKey = match[1] ?? '';
      if (KNOWN_KEY_NORMALIZED.has(normalizeKeyName(candidateKey))) {
        currentKey = candidateKey;
        result[currentKey] = match[2] ?? '';
        continue;
      }
      /* v8 ignore stop @preserve */
      // Matched `- <text>:` syntactically but `<text>` is not a known field
      // name/alias — this is a prose bullet (e.g. `- Key decision: ...`)
      // inside a summary. Fall through to the continuation branch below.
    }
    if (currentKey !== null) {
      // Not a new key-line → continuation of the current value (including
      // unindented bullet lines emitted by agents without 2-space indent).
      // Blank lines are preserved as-is to keep multi-paragraph summaries
      // readable once stripped.
      /* v8 ignore start -- ts-type: result[currentKey] was just assigned above when the key was opened; the `?? ''` fallback is unreachable because currentKey always points to an existing entry at this point @preserve */
      result[currentKey] = `${result[currentKey] ?? ''}\n${line}`;
      /* v8 ignore stop @preserve */
    }
    // If no current key is open and the line isn't a new key, drop it —
    // it's pre-block narrative.
  }

  // Strip paired outer emphasis from each final value.
  for (const key of Object.keys(result)) {
    /* v8 ignore start -- ts-type: iterating Object.keys(result) guarantees result[key] is defined; the `?? ''` fallback is unreachable @preserve */
    result[key] = stripOuterEmphasis((result[key] ?? '').trim());
    /* v8 ignore stop @preserve */
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

/** Result of coercing a raw key-value record against an AgentContract. */
export interface CoercionResult {
  /** Typed field values keyed by canonical field name. */
  data: Record<string, unknown>;
  /** Required fields that were absent or failed coercion. */
  missingRequired: string[];
  /** Non-fatal issues (malformed optional values, alias usage, unknown keys). */
  warnings: string[];
}

const BOOL_TRUE = new Set(['1', 'yes', 'true', 'used']);
const BOOL_FALSE = new Set(['0', 'no', 'false', 'not used', 'not_used']);

const DEFAULT_EMPTY_ALIASES: readonly string[] = ['', 'none', 'None', 'N/A', 'n/a'];

export function coerceFields(
  record: Readonly<Record<string, string>>,
  contract: AgentContract
): CoercionResult {
  const data: Record<string, unknown> = {};
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  // Normalize a key for semantic comparison: lowercase + strip spaces/underscores.
  // This lets us detect whether an alias match is just a casing/punctuation
  // variant of the canonical name (e.g. `Outcome`/`outcome`, `CI evidence`/
  // `ci_evidence`) vs a genuine semantic rename (`execution_memory_ids_used`
  // → `memory_ids_used`). Only semantic renames should emit a warning so
  // callers aren't flooded with cosmetic "deprecated alias" noise.
  const normalizeKey = (key: string): string => key.toLowerCase().replace(/[\s_]+/g, '');

  // Resolve the canonical value for each field (check name then aliases).
  const rawFor = (field: FieldSpec): { raw: string | undefined; sourceKey?: string } => {
    if (Object.prototype.hasOwnProperty.call(record, field.name)) {
      return { raw: record[field.name], sourceKey: field.name };
    }
    for (const alias of field.alias ?? []) {
      if (Object.prototype.hasOwnProperty.call(record, alias)) {
        // Only warn when the alias is semantically different from the
        // canonical field name (not just a casing/underscore/space variant).
        if (normalizeKey(alias) !== normalizeKey(field.name)) {
          warnings.push(
            `field ${field.name} was read from deprecated alias ${alias}; rename the emitter`
          );
        }
        return { raw: record[alias], sourceKey: alias };
      }
    }
    return { raw: undefined };
  };

  const emptyAliases = (field: FieldSpec): readonly string[] =>
    field.emptyAliases ?? DEFAULT_EMPTY_ALIASES;

  const isEmpty = (field: FieldSpec, raw: string | undefined): boolean => {
    if (raw === undefined) return true;
    return emptyAliases(field).includes(raw.trim());
  };

  for (const field of contract.fields) {
    const { raw } = rawFor(field);

    if (isEmpty(field, raw)) {
      // Default values per kind.
      switch (field.kind) {
        case 'csv':
          data[field.name] = [];
          break;
        case 'int':
          data[field.name] = null;
          break;
        case 'bool01':
          data[field.name] = null;
          break;
        default:
          data[field.name] = '';
      }
      if (field.required) {
        // Exception: execution.pr may be empty when outcome='failed'. Both
        // `outcome` (canonical) and `Outcome` (Title Case alias) keys are
        // covered by dedicated tests in block-parser.test.ts. The final
        // `?? ''` is a type-safety fallback for the branch where the record
        // has neither key — that path is unreachable in practice (the
        // execution contract requires `outcome`, so such a block already
        // failed the `outcome` required check above), but retained as a
        // defensive comparison against the empty string that yields `false`.
        if (
          field.name === 'pr' &&
          contract.marker === 'EXECUTION_AGENT_FINAL:' &&
          (record['outcome'] ?? record['Outcome'] ?? '').trim().toLowerCase() === 'failed'
        ) {
          continue;
        }
        missingRequired.push(field.name);
      }
      continue;
    }

    /* v8 ignore start -- ts-type: `isEmpty(field, raw)` above returned false, which means raw is defined (see isEmpty: `if (raw === undefined) return true`); the `?? ''` fallback is unreachable @preserve */
    const trimmed = (raw ?? '').trim();
    /* v8 ignore stop @preserve */

    switch (field.kind) {
      case 'string': {
        data[field.name] = trimmed;
        break;
      }
      case 'url': {
        if (!/^https?:\/\//.test(trimmed)) {
          if (field.required) missingRequired.push(field.name);
          else warnings.push(`field ${field.name} is not an http(s) URL: ${trimmed}`);
          data[field.name] = '';
        } else {
          data[field.name] = trimmed;
        }
        break;
      }
      case 'int': {
        // Accept a pure integer literal (optional sign), OR a leading integer
        // followed by whitespace and a parenthesized annotation, e.g.
        // "0 (review submitted as single body with no inline comments)".
        // Reject non-numeric tokens like "two" or "n/a".
        const intMatch = /^(-?\d+)(?:\s+\(.*\))?$/.exec(trimmed);
        const captured = intMatch?.[1];
        if (captured !== undefined) {
          data[field.name] = Number.parseInt(captured, 10);
        } else {
          data[field.name] = null;
          warnings.push(`field ${field.name} not a valid int: ${trimmed}`);
        }
        break;
      }
      case 'bool01': {
        const lower = trimmed.toLowerCase();
        if (BOOL_TRUE.has(lower)) data[field.name] = true;
        else if (BOOL_FALSE.has(lower)) data[field.name] = false;
        else {
          data[field.name] = null;
          warnings.push(`field ${field.name} not a valid bool: ${trimmed}`);
        }
        break;
      }
      case 'csv': {
        data[field.name] = trimmed
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== '');
        break;
      }
      case 'enum': {
        /* v8 ignore start -- ts-type: every enum field in every contract declares enumValues; FieldSpec types it as optional for the non-enum kinds, but the `?? []` fallback is unreachable in the enum branch @preserve */
        const values = field.enumValues ?? [];
        /* v8 ignore stop @preserve */
        const canonical = values.find((v) => v.toLowerCase() === trimmed.toLowerCase());
        if (canonical === undefined) {
          /* v8 ignore start -- upstream: every enum field in every contract is declared required=true (outcome in planning/execution/remediation, comment_replied in pull_request); the `else warnings.push(...)` branch for an optional enum is unreachable from the current contract set. Kept for future optional-enum support @preserve */
          if (field.required) missingRequired.push(field.name);
          else warnings.push(`field ${field.name} not in enum: ${trimmed}`);
          /* v8 ignore stop @preserve */
          data[field.name] = '';
        } else {
          data[field.name] = canonical;
        }
        break;
      }
    }
  }

  // Note keys in record but not in contract → unknown-key warning, not an error.
  const knownNames = new Set<string>();
  for (const f of contract.fields) {
    knownNames.add(f.name);
    for (const a of f.alias ?? []) knownNames.add(a);
  }
  for (const key of Object.keys(record)) {
    if (!knownNames.has(key)) {
      warnings.push(`unknown key in AGENT_FINAL block: ${key}`);
    }
  }

  return { data, missingRequired, warnings };
}
