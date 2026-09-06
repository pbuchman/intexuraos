#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { domainToASCII, fileURLToPath } from 'node:url';
import ts from 'typescript';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPolicyRelativePath = 'config/environments/production-dev-dependency-allowlist.json';
const REQUIRED_FORBIDDEN_HOST = 'dev.intexuraos.cloud';
const potentialHostTokenPattern = /[-A-Z0-9._%~\u0080-\u{10ffff}]+/giu;
const fallbackIgnoredDirectories = new Set(['.git']);
const allowedClassifications = new Set([
  'hibernation-profile',
  'historical-input',
  'intentional-test',
  'retained-browser-origin',
  'retained-oauth-callback',
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(args) {
  let root = defaultRoot;
  let policyRelativePath = defaultPolicyRelativePath;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) fail('--root requires a value');
      root = resolve(value);
      index += 1;
    } else if (argument === '--policy') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) fail('--policy requires a value');
      policyRelativePath = value;
      index += 1;
    } else {
      fail(`Unknown argument: ${String(argument)}`);
    }
  }

  return {
    root: realpathSync(root),
    policyRelativePath: normalizeRelativePath(policyRelativePath, '--policy'),
  };
}

function asNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} must be a non-empty string`);
  return value;
}

function asTrimmedMetadata(value, field) {
  const raw = asNonEmptyString(value, field);
  const trimmed = raw.trim();
  if (raw !== trimmed) fail(`${field} must not have leading or trailing whitespace`);
  return trimmed;
}

function assertExactKeys(value, allowedKeys, field) {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    fail(`${field} has unknown keys: ${unknownKeys.sort().join(', ')}`);
  }
}

function normalizeRelativePath(value, field) {
  const path = asNonEmptyString(value, field);
  if (
    isAbsolute(path) ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes('\n') ||
    path.includes('\r') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${field} must be a canonical repository-relative POSIX path`);
  }
  return path;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left, right) {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function assertNoSymlinkComponents(root, relativePath) {
  let current = root;
  const segments = relativePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const stat = lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink()) fail(`symlink is forbidden in scanned scope: ${relativePath}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      fail(`non-directory path component in scanned scope: ${relativePath}`);
    }
  }
}

function readStableBuffer(root, relativePath) {
  if (typeof constants.O_NOFOLLOW !== 'number') {
    fail('secure file reads require O_NOFOLLOW support');
  }
  assertNoSymlinkComponents(root, relativePath);
  const absolutePath = join(root, ...relativePath.split('/'));
  const pathBefore = lstatSync(absolutePath, { bigint: true });
  if (!pathBefore.isFile()) fail(`scanned path is not a regular file: ${relativePath}`);

  let descriptor;
  try {
    descriptor = openSync(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0)
    );
    const descriptorBefore = fstatSync(descriptor, { bigint: true });
    if (!descriptorBefore.isFile() || !sameIdentity(pathBefore, descriptorBefore)) {
      fail(`scanned file identity changed before read: ${relativePath}`);
    }
    const contents = readFileSync(descriptor);
    const descriptorAfter = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(absolutePath, { bigint: true });
    assertNoSymlinkComponents(root, relativePath);
    if (
      !sameSnapshot(descriptorBefore, descriptorAfter) ||
      !sameSnapshot(descriptorAfter, pathAfter) ||
      BigInt(contents.length) !== descriptorAfter.size
    ) {
      fail(`scanned file changed during read: ${relativePath}`);
    }
    return contents;
  } catch (error) {
    if (error instanceof Error && error.message.includes('scanned file')) throw error;
    fail(
      `cannot securely read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function hasPrefix(buffer, bytes) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function isValidatedBinaryAsset(relativePath, buffer) {
  const lowerPath = relativePath.toLowerCase();
  if (lowerPath.endsWith('.png')) {
    if (!hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      fail(`binary asset has an invalid PNG signature: ${relativePath}`);
    }
    return true;
  }
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
    if (!hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
      fail(`binary asset has an invalid JPEG signature: ${relativePath}`);
    }
    return true;
  }
  if (lowerPath.endsWith('.ico')) {
    if (!hasPrefix(buffer, [0x00, 0x00, 0x01, 0x00])) {
      fail(`binary asset has an invalid ICO signature: ${relativePath}`);
    }
    return true;
  }
  return false;
}

function decodeStrictText(relativePath, buffer) {
  if (buffer.includes(0)) fail(`text file contains a NUL byte: ${relativePath}`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    fail(`text file is not valid UTF-8: ${relativePath}`);
  }
}

function mappedText(text) {
  return { text, sourceOffsets: Array.from({ length: text.length }, (_value, index) => index) };
}

function unmappedText(text) {
  return { text, sourceOffsets: undefined };
}

function appendOffsets(target, values) {
  for (const value of values) target.push(value);
}

function replaceMapped(input, pattern, replacementFor) {
  if (input.sourceOffsets === undefined) {
    pattern.lastIndex = 0;
    const text = input.text.replace(pattern, (wholeMatch, ...arguments_) => {
      const offset = arguments_.at(-2);
      const captures = arguments_.slice(0, -2);
      const match = [wholeMatch, ...captures];
      match.index = typeof offset === 'number' ? offset : 0;
      return replacementFor(match) ?? wholeMatch;
    });
    return { text, sourceOffsets: undefined };
  }

  const textParts = [];
  const sourceOffsets = [];
  let cursor = 0;
  pattern.lastIndex = 0;
  for (const match of input.text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    textParts.push(input.text.slice(cursor, matchIndex));
    appendOffsets(sourceOffsets, input.sourceOffsets.slice(cursor, matchIndex));
    const replacement = replacementFor(match);
    if (replacement === undefined) {
      textParts.push(match[0]);
      appendOffsets(
        sourceOffsets,
        input.sourceOffsets.slice(matchIndex, matchIndex + match[0].length)
      );
    } else {
      textParts.push(replacement);
      const sourceOffset = input.sourceOffsets[matchIndex] ?? matchIndex;
      for (let index = 0; index < replacement.length; index += 1) {
        sourceOffsets.push(sourceOffset);
      }
    }
    cursor = matchIndex + match[0].length;
  }
  textParts.push(input.text.slice(cursor));
  appendOffsets(sourceOffsets, input.sourceOffsets.slice(cursor));
  return { text: textParts.join(''), sourceOffsets };
}

function codePointReplacement(rawDigits, radix) {
  const value = Number.parseInt(rawDigits, radix);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x10ffff) return undefined;
  return String.fromCodePoint(value);
}

function urlSourceCodePointReplacement(rawDigits, radix) {
  const replacement = codePointReplacement(rawDigits, radix);
  if (replacement === '\t' || replacement === '\n' || replacement === '\r') return '';
  return replacement;
}

function removeSourceLineContinuations(input) {
  return replaceMapped(input, /\\(?:\r\n|[\n\r\u2028\u2029])/gu, () => '');
}

function removeYamlLineContinuations(input) {
  return replaceMapped(input, /\\(?:\r\n|[\n\r])[ \t]*/gu, () => '');
}

function decodeJavaScriptLikeEscapes(input) {
  let output = input;
  output = replaceMapped(output, /\\U([0-9A-Fa-f]{8})/gu, (match) =>
    urlSourceCodePointReplacement(match[1] ?? '', 16)
  );
  output = replaceMapped(output, /\\u\{([0-9a-f]+)\}/giu, (match) =>
    urlSourceCodePointReplacement(match[1] ?? '', 16)
  );
  output = replaceMapped(output, /\\u([0-9a-f]{4})/giu, (match) =>
    urlSourceCodePointReplacement(match[1] ?? '', 16)
  );
  output = replaceMapped(output, /\\x([0-9a-f]{2})/giu, (match) =>
    urlSourceCodePointReplacement(match[1] ?? '', 16)
  );
  output = replaceMapped(output, /\\(?:([0-3][0-7]{2})|([0-7]{1,2}))/gu, (match) =>
    urlSourceCodePointReplacement(match[1] ?? match[2] ?? '', 8)
  );
  const simpleEscapes = new Map([
    ['b', '\b'],
    ['f', '\f'],
    ['n', ''],
    ['r', ''],
    ['t', ''],
    ['v', '\v'],
  ]);
  output = replaceMapped(output, /\\([bfnrtv])/gu, (match) => simpleEscapes.get(match[1] ?? ''));
  return replaceMapped(output, /\\([^\n\r\u2028\u2029])/gu, (match) => match[1] ?? '');
}

function decodeCssEscapes(input) {
  let output = replaceMapped(input, /\\([0-9a-f]{1,6})(?:[ \t\r\n\f])?/giu, (match) =>
    urlSourceCodePointReplacement(match[1] ?? '', 16)
  );
  output = replaceMapped(output, /\\([^\n\r\f])/gu, (match) => match[1] ?? '');
  return output;
}

function decodeShellAnsiCEscapes(input) {
  const withoutUrlWhitespaceControls = replaceMapped(input, /\\c[IJM]/giu, () => '');
  return decodeJavaScriptLikeEscapes(withoutUrlWhitespaceControls);
}

function decodeHtmlEntities(input) {
  let output = replaceMapped(input, /&#x([0-9a-f]+);?/giu, (match) =>
    urlSourceCodePointReplacement(match[1] ?? '', 16)
  );
  output = replaceMapped(output, /&#([0-9]+);?/gu, (match) =>
    urlSourceCodePointReplacement(match[1] ?? '', 10)
  );
  const namedEntities = new Map([
    ['NewLine', ''],
    ['Tab', ''],
    ['bsol', '\\'],
    ['percnt', '%'],
    ['period', '.'],
    ['shy', String.fromCodePoint(0x00ad)],
  ]);
  return replaceMapped(output, /&(NewLine|Tab|bsol|percnt|period|shy);/gu, (match) =>
    namedEntities.get(match[1] ?? '')
  );
}

function decodePercentEscapes(input) {
  return replaceMapped(input, /(?:%[0-9a-f]{2})+/giu, (match) => {
    try {
      return decodeURIComponent(match[0]);
    } catch {
      return undefined;
    }
  });
}

function collapseAdjacentStringLiteralConcatenations(input) {
  return replaceMapped(input, /(['"`])[\t \r\n]*\+[\t \r\n]*(['"`])/gu, () => '');
}

function collapseAdjacentQuotedSegments(input) {
  return replaceMapped(input, /(['"`])[\t ]*(['"`])/gu, () => '');
}

function removeShellStaticQuotes(input) {
  return replaceMapped(input, /\$?['"]/gu, () => '');
}

function expandSourceObfuscations(input) {
  const variants = [];
  const seen = new Set();
  const add = (candidate) => {
    if (seen.has(candidate.text)) return false;
    seen.add(candidate.text);
    variants.push(candidate);
    return true;
  };

  add(input);
  add(collapseAdjacentStringLiteralConcatenations(input));
  add(collapseAdjacentQuotedSegments(input));

  let percentDecoded = input;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = decodePercentEscapes(percentDecoded);
    if (next.text === percentDecoded.text) break;
    add(next);
    add(collapseAdjacentStringLiteralConcatenations(next));
    add(collapseAdjacentQuotedSegments(next));
    percentDecoded = next;
  }
  return variants;
}

function prepareUrlParserInput(input) {
  return decodeHtmlEntities(input);
}

function canonicalHostMatches(input) {
  const matches = [];
  potentialHostTokenPattern.lastIndex = 0;
  for (const tokenMatch of input.text.matchAll(potentialHostTokenPattern)) {
    const token = tokenMatch[0];
    let asciiHost;
    try {
      asciiHost = domainToASCII(token).toLowerCase().replace(/\.+$/u, '');
    } catch {
      continue;
    }
    if (asciiHost !== REQUIRED_FORBIDDEN_HOST) continue;
    const tokenIndex = tokenMatch.index ?? 0;
    matches.push(input.sourceOffsets?.[tokenIndex] ?? tokenIndex);
  }
  return matches;
}

function lexicalCanonicalizationCandidates(source) {
  const bases = [removeSourceLineContinuations(source), removeYamlLineContinuations(source)];
  const candidates = [];
  for (const base of bases) {
    const htmlDecoded = decodeHtmlEntities(base);
    const lexicalCandidates = [
      base,
      htmlDecoded,
      decodeJavaScriptLikeEscapes(base),
      decodeShellAnsiCEscapes(base),
      decodeCssEscapes(base),
      decodeJavaScriptLikeEscapes(htmlDecoded),
      decodeShellAnsiCEscapes(htmlDecoded),
      decodeCssEscapes(htmlDecoded),
      removeShellStaticQuotes(base),
      removeShellStaticQuotes(htmlDecoded),
      removeShellStaticQuotes(decodeShellAnsiCEscapes(base)),
      removeShellStaticQuotes(decodeShellAnsiCEscapes(htmlDecoded)),
    ];
    for (const lexicalCandidate of lexicalCandidates) {
      for (const expandedCandidate of expandSourceObfuscations(lexicalCandidate)) {
        const prepared = prepareUrlParserInput(expandedCandidate);
        candidates.push(
          prepared,
          replaceMapped(prepared, /[\t\n\r]/gu, () => '')
        );
      }
    }
  }
  return candidates;
}

function findLexicalCanonicalHostOffsets(contents) {
  const hasCanonicalHost = lexicalCanonicalizationCandidates(unmappedText(contents)).some(
    (candidate) => canonicalHostMatches(candidate).length > 0
  );
  if (!hasCanonicalHost) return [];

  const candidates = lexicalCanonicalizationCandidates(mappedText(contents));
  const offsets = new Set();
  const seenCandidateTexts = new Set();
  for (const candidate of candidates) {
    if (seenCandidateTexts.has(candidate.text)) continue;
    seenCandidateTexts.add(candidate.text);
    for (const offset of canonicalHostMatches(candidate)) offsets.add(offset);
  }
  return [...offsets].sort((left, right) => left - right);
}

function parseSimpleYamlScalar(rawValue) {
  const withoutAnchor = rawValue.replace(/^&[A-Za-z_][A-Za-z0-9_-]*[ \t]+/u, '');
  const match = withoutAnchor.match(
    /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([A-Za-z0-9._/-]+))(?:[ \t]+#.*)?$/u
  );
  if (match === null) return undefined;
  if (match[1] !== undefined) {
    try {
      const jsonCompatible = match[1].replace(/\\x([0-9a-f]{2})/giu, '\\u00$1');
      const parsed = JSON.parse(`"${jsonCompatible}"`);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (match[2] !== undefined) return match[2].replaceAll("''", "'");
  return match[3];
}

function parseSimpleYamlAssignment(rawAssignment) {
  const assignment = rawAssignment.match(
    /^(?:"([A-Za-z_][A-Za-z0-9_]*)"|'([A-Za-z_][A-Za-z0-9_]*)'|([A-Za-z_][A-Za-z0-9_]*))[ \t]*:[ \t]*(.+?)\s*$/u
  );
  if (assignment === null) return undefined;
  return {
    name: assignment[1] ?? assignment[2] ?? assignment[3] ?? '',
    rawValue: assignment[4] ?? '',
  };
}

function parseSimpleWorkflowEnvAssignments(rawAssignment, anchorValues) {
  const assignment = parseSimpleYamlAssignment(rawAssignment);
  if (assignment === undefined) return [];
  const alias = assignment.rawValue.match(/^\*([A-Za-z_][A-Za-z0-9_-]*)[ \t]*(?:#.*)?$/u);
  if (alias !== null) {
    return [...(anchorValues.get(alias[1] ?? '') ?? [])].map((value) => ({
      name: assignment.name,
      value,
    }));
  }
  const value = parseSimpleYamlScalar(assignment.rawValue);
  return value === undefined ? [] : [{ name: assignment.name, value }];
}

function splitSimpleInlineYamlMap(contents) {
  const assignments = [];
  let quote;
  let escaped = false;
  let cursor = 0;
  for (let index = 0; index <= contents.length; index += 1) {
    const character = contents[index];
    if (quote === '"' && character === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && !escaped) {
      if (quote === character) quote = undefined;
      else if (quote === undefined) quote = character;
    }
    escaped = false;
    if ((character === ',' && quote === undefined) || character === undefined) {
      assignments.push(contents.slice(cursor, index).trim());
      cursor = index + 1;
    }
  }
  return quote === undefined ? assignments : [];
}

const workflowEnvReferencePattern =
  /\$\{\{[ \t\r\n]*env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[[ \t\r\n]*"([A-Za-z_][A-Za-z0-9_]*)"[ \t\r\n]*\]|\[[ \t\r\n]*'([A-Za-z_][A-Za-z0-9_]*)'[ \t\r\n]*\])[ \t\r\n]*\}\}/gu;

function workflowEnvReferenceName(match) {
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function sentinelTemplateCouldFormForbiddenHost(input) {
  const sentinelMarker = 'codexsentinelplaceholder';
  for (const candidate of lexicalCanonicalizationCandidates(input)) {
    for (const token of candidate.text.matchAll(/[-A-Z0-9._%~§\u0080-\u{10ffff}]+/giu)) {
      if (!token[0].includes('§') || token[0].replaceAll('§', '') === '') continue;
      const asciiTemplate = domainToASCII(token[0].replaceAll('§', sentinelMarker)).toLowerCase();
      if (asciiTemplate === '' || !asciiTemplate.includes(sentinelMarker)) continue;
      const pattern = asciiTemplate.split(sentinelMarker).map(escapeRegExp).join('.*');
      if (new RegExp(`^${pattern}$`, 'iu').test(REQUIRED_FORBIDDEN_HOST)) return true;
    }
  }
  return false;
}

function findWorkflowFormatExpressions(contents) {
  const expressions = [];
  const startPattern = /\$\{\{[ \t\r\n]*format[ \t\r\n]*\(/giu;
  for (const startMatch of contents.matchAll(startPattern)) {
    const start = startMatch.index ?? 0;
    let quote;
    let escaped = false;
    let depth = 1;
    let cursor = start + startMatch[0].length;
    const argumentsStart = cursor;
    for (; cursor < contents.length; cursor += 1) {
      const character = contents[cursor];
      if (quote === '"' && character === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if ((character === '"' || character === "'") && !escaped) {
        if (quote === character) quote = undefined;
        else if (quote === undefined) quote = character;
      }
      escaped = false;
      if (quote !== undefined) continue;
      if (character === '(') depth += 1;
      else if (character === ')') {
        depth -= 1;
        if (depth !== 0) continue;
        const suffix = contents.slice(cursor + 1).match(/^[ \t\r\n]*\}\}/u);
        if (suffix !== null) {
          expressions.push({
            argumentsText: contents.slice(argumentsStart, cursor),
            end: cursor + 1 + suffix[0].length,
            start,
          });
        }
        break;
      }
    }
  }
  return expressions;
}

function renderWorkflowFormat(template, values) {
  const leftBrace = '\u0000LEFT_BRACE\u0000';
  const rightBrace = '\u0000RIGHT_BRACE\u0000';
  const escaped = template.replaceAll('{{', leftBrace).replaceAll('}}', rightBrace);
  const rendered = escaped.replace(
    /\{([0-9]+)\}/gu,
    (_match, index) => values[Number(index)] ?? ''
  );
  return rendered.replaceAll(leftBrace, '{').replaceAll(rightBrace, '}');
}

function replaceMappedRange(input, start, end, replacement) {
  const sourceOffset = input.sourceOffsets[start] ?? start;
  return {
    text: `${input.text.slice(0, start)}${replacement}${input.text.slice(end)}`,
    sourceOffsets: [
      ...input.sourceOffsets.slice(0, start),
      ...Array.from({ length: replacement.length }, () => sourceOffset),
      ...input.sourceOffsets.slice(end),
    ],
  };
}

function findStaticallyComputedGithubActionsHostOffsets(contents, relativePath) {
  if (!/^\.github\/workflows\/.*\.ya?ml$/iu.test(relativePath)) return [];
  workflowEnvReferencePattern.lastIndex = 0;
  const references = [...contents.matchAll(workflowEnvReferencePattern)];
  const formatExpressions = findWorkflowFormatExpressions(contents);
  if (references.length === 0 && formatExpressions.length === 0) return [];

  const valuesByName = new Map();
  const unresolvedNames = new Set();
  let hasUnsupportedEnvMap = false;
  const addValue = (assignment) => {
    const values = valuesByName.get(assignment.name) ?? new Set();
    values.add(assignment.value);
    valuesByName.set(assignment.name, values);
  };
  const addEnvAssignment = (rawAssignment, anchorValues) => {
    const parsed = parseSimpleYamlAssignment(rawAssignment);
    if (parsed === undefined) return;
    const assignments = parseSimpleWorkflowEnvAssignments(rawAssignment, anchorValues);
    if (assignments.length === 0) unresolvedNames.add(parsed.name);
    for (const assignment of assignments) addValue(assignment);
  };
  const lines = contents.split(/\r?\n/u);

  const anchorValues = new Map();
  const addAnchors = (rawAssignment) => {
    const assignment = parseSimpleYamlAssignment(rawAssignment);
    if (assignment === undefined) return;
    const anchor = assignment.rawValue.match(/^&([A-Za-z_][A-Za-z0-9_-]*)[ \t]+(.+?)\s*$/u);
    if (anchor === null) return;
    const value = parseSimpleYamlScalar(anchor[2] ?? '');
    if (value === undefined) return;
    const values = anchorValues.get(anchor[1] ?? '') ?? new Set();
    values.add(value);
    anchorValues.set(anchor[1] ?? '', values);
  };
  for (const line of lines) {
    const inlineEnv = line.match(
      /^[ ]*(?:-[ ]+)?(?:env|"env"|'env')[ \t]*:[ \t]*\{(.*)\}[ \t]*(?:#.*)?$/u
    );
    if (inlineEnv !== null) {
      for (const rawAssignment of splitSimpleInlineYamlMap(inlineEnv[1] ?? '')) {
        addAnchors(rawAssignment);
      }
      continue;
    }
    const indentation = line.match(/^[ ]*/u)?.[0].length ?? 0;
    addAnchors(line.slice(indentation).replace(/^-[ ]+/u, ''));
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const inlineEnv = lines[lineIndex].match(
      /^[ ]*(?:-[ ]+)?(?:env|"env"|'env')[ \t]*:[ \t]*\{(.*)\}[ \t]*(?:#.*)?$/u
    );
    if (inlineEnv !== null) {
      for (const rawAssignment of splitSimpleInlineYamlMap(inlineEnv[1] ?? '')) {
        addEnvAssignment(rawAssignment, anchorValues);
      }
      continue;
    }
    const envHeader = lines[lineIndex].match(
      /^([ ]*)(-[ ]+)?(?:env|"env"|'env')[ \t]*:[ \t]*(?:#.*)?$/u
    );
    if (envHeader === null) {
      if (/^[ ]*(?:-[ ]+)?(?:env|"env"|'env')[ \t]*:/u.test(lines[lineIndex])) {
        hasUnsupportedEnvMap = true;
      }
      continue;
    }
    const envIndent = (envHeader[1]?.length ?? 0) + (envHeader[2]?.length ?? 0);
    let directChildIndent;
    for (lineIndex += 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (/^[ \t]*(?:#.*)?$/u.test(line)) continue;
      const indentation = line.match(/^[ ]*/u)?.[0].length ?? 0;
      if (indentation <= envIndent) {
        lineIndex -= 1;
        break;
      }
      if (directChildIndent === undefined) directChildIndent = indentation;
      if (indentation !== directChildIndent) continue;
      addEnvAssignment(line.slice(indentation), anchorValues);
    }
  }

  const referencedNames = [...new Set(references.map(workflowEnvReferenceName))];
  const isUnresolvedName = (name) =>
    hasUnsupportedEnvMap || unresolvedNames.has(name) || !valuesByName.has(name);
  const unresolvedReferenceNames = new Set(referencedNames.filter(isUnresolvedName));

  let candidates = [mappedText(contents)];
  for (const name of referencedNames) {
    const values = valuesByName.get(name);
    if (values === undefined || isUnresolvedName(name)) continue;
    if (candidates.length * values.size > 1024) {
      fail(`GitHub Actions env expansion exceeds the safe bound in ${relativePath}`);
    }
    const expandedCandidates = [];
    const seen = new Set();
    for (const candidate of candidates) {
      for (const value of values) {
        const expanded = replaceMapped(candidate, workflowEnvReferencePattern, (match) =>
          workflowEnvReferenceName(match) === name ? value : undefined
        );
        if (seen.has(expanded.text)) continue;
        seen.add(expanded.text);
        expandedCandidates.push(expanded);
      }
    }
    candidates = expandedCandidates;
  }

  const offsets = new Set();
  let formatCandidates = candidates;
  let hasUnresolvedFormat = false;
  for (const expression of [...formatExpressions].sort((left, right) => right.start - left.start)) {
    const rawArguments = splitSimpleInlineYamlMap(expression.argumentsText);
    const template = parseSimpleYamlScalar(rawArguments[0] ?? '');
    if (template === undefined) {
      fail(`unsupported GitHub Actions format template in ${relativePath}`);
    }
    const valueOptions = [];
    let unresolved = false;
    for (const rawArgument of rawArguments.slice(1)) {
      const envArgument = rawArgument.match(
        /^env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[[ \t]*"([A-Za-z_][A-Za-z0-9_]*)"[ \t]*\]|\[[ \t]*'([A-Za-z_][A-Za-z0-9_]*)'[ \t]*\])$/u
      );
      const envName = envArgument?.[1] ?? envArgument?.[2] ?? envArgument?.[3];
      if (envName === undefined) {
        const literal = parseSimpleYamlScalar(rawArgument);
        if (literal !== undefined) {
          valueOptions.push([literal]);
          continue;
        }
      }
      const values = envName === undefined ? undefined : valuesByName.get(envName);
      if (
        envName === undefined ||
        values === undefined ||
        unresolvedNames.has(envName) ||
        hasUnsupportedEnvMap
      ) {
        unresolved = true;
        valueOptions.push(['§']);
      } else {
        valueOptions.push([...values]);
      }
    }
    const referencedIndexes = [...template.matchAll(/\{([0-9]+)\}/gu)].map((match) =>
      Number(match[1])
    );
    const highestReferencedIndex =
      referencedIndexes.length === 0 ? -1 : Math.max(...referencedIndexes);
    while (valueOptions.length <= highestReferencedIndex) {
      unresolved = true;
      valueOptions.push(['§']);
    }
    if (unresolved) hasUnresolvedFormat = true;
    let renderedValues = [[]];
    for (const options of valueOptions) {
      if (renderedValues.length * options.length > 1024) {
        fail(`GitHub Actions format expansion exceeds the safe bound in ${relativePath}`);
      }
      renderedValues = renderedValues.flatMap((prefix) =>
        options.map((value) => [...prefix, value])
      );
    }
    const replacements = [
      ...new Set(renderedValues.map((values) => renderWorkflowFormat(template, values))),
    ];
    if (formatCandidates.length * replacements.length > 1024) {
      fail(`GitHub Actions format candidate expansion exceeds the safe bound in ${relativePath}`);
    }
    const nextCandidates = [];
    const seen = new Set();
    for (const candidate of formatCandidates) {
      for (const replacement of replacements) {
        const start = candidate.sourceOffsets.findIndex((offset) => offset === expression.start);
        const endSourceOffset = expression.end - 1;
        let end = -1;
        for (let index = candidate.sourceOffsets.length - 1; index >= 0; index -= 1) {
          if (candidate.sourceOffsets[index] === endSourceOffset) {
            end = index + 1;
            break;
          }
        }
        if (start === -1 || end === -1 || start >= end) {
          fail(`cannot map GitHub Actions format expression in ${relativePath}`);
        }
        const expanded = replaceMappedRange(candidate, start, end, replacement);
        if (seen.has(expanded.text)) continue;
        seen.add(expanded.text);
        nextCandidates.push(expanded);
      }
    }
    formatCandidates = nextCandidates;
  }
  for (const candidate of formatCandidates) {
    const sentinelCandidate = replaceMapped(candidate, workflowEnvReferencePattern, (match) =>
      unresolvedReferenceNames.has(workflowEnvReferenceName(match)) ? '§' : undefined
    );
    if (sentinelTemplateCouldFormForbiddenHost(sentinelCandidate)) {
      if (unresolvedReferenceNames.size > 0) {
        fail(
          `unresolved relevant GitHub Actions env ${[...unresolvedReferenceNames].sort().join(', ')} in ${relativePath}`
        );
      }
      if (hasUnresolvedFormat) {
        fail(`unresolved relevant GitHub Actions format expression in ${relativePath}`);
      }
    }
    for (const offset of findLexicalCanonicalHostOffsets(candidate.text)) {
      offsets.add(candidate.sourceOffsets[offset] ?? offset);
    }
  }
  return [...offsets].sort((left, right) => left - right);
}

function findStaticallyComputedHostOffsets(contents, relativePath = 'dependency-input.ts') {
  const lowerPath = relativePath.toLowerCase();
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/u.test(lowerPath)) return [];

  if (
    !/[+`]|\.join\s*\(|\b(?:String|Buffer\.from|atob|decodeURI(?:Component)?)\s*\(/u.test(contents)
  ) {
    return [];
  }

  const scriptKind = lowerPath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : lowerPath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs') || lowerPath.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    relativePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  const constInitializers = new Map();
  const candidateExpressions = new Set();

  const collect = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const declarationList = node.parent;
      if (
        ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.Const) !== 0
      ) {
        const declarations = constInitializers.get(node.name.text) ?? [];
        declarations.push(node.initializer);
        constInitializers.set(node.name.text, declarations);
      }
      candidateExpressions.add(node.initializer);
    } else if (ts.isPropertyAssignment(node)) {
      candidateExpressions.add(node.initializer);
    } else if (ts.isReturnStatement(node) && node.expression !== undefined) {
      candidateExpressions.add(node.expression);
    } else if (ts.isCallExpression(node)) {
      candidateExpressions.add(node);
      for (const argument of node.arguments) candidateExpressions.add(argument);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      candidateExpressions.add(node.right);
    }
    if (ts.isTemplateExpression(node)) candidateExpressions.add(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      candidateExpressions.add(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const unwrap = (expression) => {
    let current = expression;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  };

  const decodeBase64Text = (encoded) => {
    const compact = encoded.replace(/[\t\n\r ]/gu, '');
    if (
      compact === '' ||
      compact.length > 1024 * 1024 ||
      compact.length % 4 === 1 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)
    ) {
      return undefined;
    }
    const decoded = Buffer.from(compact, 'base64');
    if (decoded.toString('base64').replace(/=+$/u, '') !== compact.replace(/=+$/u, '')) {
      return undefined;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    } catch {
      return undefined;
    }
  };

  const evaluate = (expression, resolving = new Set()) => {
    const node = unwrap(expression);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
    if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';

    if (ts.isIdentifier(node)) {
      const declarations = constInitializers.get(node.text) ?? [];
      if (declarations.length !== 1 || resolving.has(node.text)) return undefined;
      const nextResolving = new Set(resolving);
      nextResolving.add(node.text);
      return evaluate(declarations[0], nextResolving);
    }

    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const expressionValue = evaluate(span.expression, resolving);
        if (typeof expressionValue !== 'string') return undefined;
        value += expressionValue + span.literal.text;
      }
      return value;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluate(node.left, resolving);
      const right = evaluate(node.right, resolving);
      if (typeof left !== 'string' || typeof right !== 'string') return undefined;
      return left + right;
    }

    if (ts.isArrayLiteralExpression(node)) {
      const values = [];
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) return undefined;
        const value = evaluate(element, resolving);
        if (typeof value !== 'string') return undefined;
        values.push(value);
      }
      return values;
    }

    if (!ts.isCallExpression(node)) return undefined;

    if (ts.isIdentifier(node.expression)) {
      const functionName = node.expression.text;
      if (functionName === 'String' && node.arguments.length === 1) {
        const value = evaluate(node.arguments[0], resolving);
        return typeof value === 'string' ? value : undefined;
      }
      if (
        (functionName === 'decodeURI' || functionName === 'decodeURIComponent') &&
        node.arguments.length === 1
      ) {
        const value = evaluate(node.arguments[0], resolving);
        if (typeof value !== 'string') return undefined;
        try {
          return functionName === 'decodeURI' ? decodeURI(value) : decodeURIComponent(value);
        } catch {
          return undefined;
        }
      }
      if (functionName === 'atob' && node.arguments.length === 1) {
        const value = evaluate(node.arguments[0], resolving);
        return typeof value === 'string' ? decodeBase64Text(value) : undefined;
      }
    }

    if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
    const receiver = node.expression.expression;
    const method = node.expression.name.text;

    if (method === 'join') {
      const values = evaluate(receiver, resolving);
      if (!Array.isArray(values) || node.arguments.length > 1) return undefined;
      const separator = node.arguments.length === 0 ? ',' : evaluate(node.arguments[0], resolving);
      return typeof separator === 'string' ? values.join(separator) : undefined;
    }

    if (method === 'from' && ts.isIdentifier(receiver) && receiver.text === 'Buffer') {
      if (node.arguments.length < 2 || node.arguments.length > 3) return undefined;
      const value = evaluate(node.arguments[0], resolving);
      const encoding = evaluate(node.arguments[1], resolving);
      return typeof value === 'string' && encoding === 'base64'
        ? decodeBase64Text(value)
        : undefined;
    }

    if (method === 'toString') {
      const value = evaluate(receiver, resolving);
      if (typeof value !== 'string' || node.arguments.length > 1) return undefined;
      if (node.arguments.length === 0) return value;
      const encoding = evaluate(node.arguments[0], resolving);
      return encoding === 'utf8' || encoding === 'utf-8' ? value : undefined;
    }

    return undefined;
  };

  const offsets = new Set();
  for (const expression of candidateExpressions) {
    const raw = expression.getText(sourceFile);
    if (findLexicalCanonicalHostOffsets(raw).length > 0) continue;
    const value = evaluate(expression);
    if (typeof value !== 'string') continue;
    if (findLexicalCanonicalHostOffsets(value).length === 0) continue;
    offsets.add(expression.getStart(sourceFile));
  }
  return [...offsets].sort((left, right) => left - right);
}

function findCanonicalHostOffsets(contents, relativePath) {
  return [
    ...new Set([
      ...findLexicalCanonicalHostOffsets(contents),
      ...findStaticallyComputedGithubActionsHostOffsets(contents, relativePath),
      ...findStaticallyComputedHostOffsets(contents, relativePath),
    ]),
  ].sort((left, right) => left - right);
}

function assertNoDuplicateJsonObjectKeys(contents, field) {
  let cursor = 0;
  const skipWhitespace = () => {
    while (/\s/u.test(contents[cursor] ?? '')) cursor += 1;
  };
  const syntaxError = () => fail(`${field} is not valid JSON`);
  const parseString = () => {
    if (contents[cursor] !== '"') syntaxError();
    const start = cursor;
    cursor += 1;
    while (cursor < contents.length) {
      const character = contents[cursor];
      if (character === '\\') {
        cursor += 2;
        continue;
      }
      cursor += 1;
      if (character === '"') {
        try {
          return JSON.parse(contents.slice(start, cursor));
        } catch {
          syntaxError();
        }
      }
    }
    syntaxError();
  };
  const parseValue = () => {
    skipWhitespace();
    const character = contents[cursor];
    if (character === '{') {
      cursor += 1;
      skipWhitespace();
      const keys = new Set();
      if (contents[cursor] === '}') {
        cursor += 1;
        return;
      }
      while (cursor < contents.length) {
        const key = parseString();
        if (keys.has(key)) fail(`${field} has duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        skipWhitespace();
        if (contents[cursor] !== ':') syntaxError();
        cursor += 1;
        parseValue();
        skipWhitespace();
        if (contents[cursor] === '}') {
          cursor += 1;
          return;
        }
        if (contents[cursor] !== ',') syntaxError();
        cursor += 1;
        skipWhitespace();
      }
      syntaxError();
    }
    if (character === '[') {
      cursor += 1;
      skipWhitespace();
      if (contents[cursor] === ']') {
        cursor += 1;
        return;
      }
      while (cursor < contents.length) {
        parseValue();
        skipWhitespace();
        if (contents[cursor] === ']') {
          cursor += 1;
          return;
        }
        if (contents[cursor] !== ',') syntaxError();
        cursor += 1;
      }
      syntaxError();
    }
    if (character === '"') {
      parseString();
      return;
    }
    const primitive = contents
      .slice(cursor)
      .match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u)?.[0];
    if (primitive === undefined) syntaxError();
    cursor += primitive.length;
  };

  parseValue();
  skipWhitespace();
  if (cursor !== contents.length) syntaxError();
}

function readStableText(
  root,
  relativePath,
  binaryAllowlistByPath,
  matchedBinaryAllowlist,
  fileSha256ByPath
) {
  const buffer = readStableBuffer(root, relativePath);
  fileSha256ByPath?.set(relativePath, createHash('sha256').update(buffer).digest('hex'));
  if (isValidatedBinaryAsset(relativePath, buffer)) return undefined;
  const binaryEntry = binaryAllowlistByPath?.get(relativePath);
  if (binaryEntry !== undefined) {
    let isStrictText = false;
    if (!buffer.includes(0)) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        isStrictText = true;
      } catch {
        // An exact hash is required below for intentionally non-text test data.
      }
    }
    if (isStrictText) {
      fail(`binary allowlist cannot hide a valid UTF-8 text file: ${relativePath}`);
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (sha256 !== binaryEntry.sha256) {
      fail(`binary allowlist hash mismatch: ${relativePath}`);
    }
    matchedBinaryAllowlist?.add(relativePath);
    return undefined;
  }
  return decodeStrictText(relativePath, buffer);
}

function loadPolicy(root, policyRelativePath) {
  let raw;
  let policySha256;
  try {
    const buffer = readStableBuffer(root, policyRelativePath);
    if (isValidatedBinaryAsset(policyRelativePath, buffer)) fail('policy cannot be a binary asset');
    const contents = decodeStrictText(policyRelativePath, buffer);
    policySha256 = createHash('sha256').update(buffer).digest('hex');
    assertNoDuplicateJsonObjectKeys(contents, 'policy');
    raw = JSON.parse(contents);
  } catch (error) {
    fail(`cannot read policy: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    fail('policy must be an object');
  assertExactKeys(
    raw,
    new Set(['schemaVersion', 'forbiddenHost', 'allowlist', 'binaryAllowlist']),
    'policy'
  );
  if (raw.schemaVersion !== 1) fail('policy schemaVersion must be 1');
  const forbiddenHost = asNonEmptyString(raw.forbiddenHost, 'forbiddenHost');
  if (forbiddenHost !== REQUIRED_FORBIDDEN_HOST) {
    fail(`forbiddenHost must be exactly ${REQUIRED_FORBIDDEN_HOST}`);
  }
  if (!Array.isArray(raw.allowlist)) fail('allowlist must be an array');
  if (!Array.isArray(raw.binaryAllowlist)) fail('binaryAllowlist must be an array');

  const seenEntries = new Set();
  const allowlist = raw.allowlist.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`allowlist[${String(index)}] must be an object`);
    }
    assertExactKeys(
      entry,
      new Set(['path', 'lineEquals', 'expectedOccurrences', 'classification', 'owner', 'reason']),
      `allowlist[${String(index)}]`
    );
    const classification = asTrimmedMetadata(
      entry.classification,
      `allowlist[${String(index)}].classification`
    );
    if (!allowedClassifications.has(classification)) {
      fail(`allowlist[${String(index)}].classification is not allowed`);
    }
    const lineEquals = asNonEmptyString(entry.lineEquals, `allowlist[${String(index)}].lineEquals`);
    if (lineEquals.includes('\n') || lineEquals.includes('\r') || lineEquals.includes('\0')) {
      fail(`allowlist[${String(index)}].lineEquals must be exactly one text line`);
    }
    if (!Number.isSafeInteger(entry.expectedOccurrences) || entry.expectedOccurrences < 1) {
      fail(`allowlist[${String(index)}].expectedOccurrences must be a positive safe integer`);
    }
    const owner = asTrimmedMetadata(entry.owner, `allowlist[${String(index)}].owner`);
    const reason = asTrimmedMetadata(entry.reason, `allowlist[${String(index)}].reason`);
    if (owner.length < 3 || reason.length < 12) {
      fail(`allowlist[${String(index)}] must have a specific owner and reason`);
    }
    const path = normalizeRelativePath(entry.path, `allowlist[${String(index)}].path`);
    const identity = `${path}\0${lineEquals}`;
    if (seenEntries.has(identity)) fail(`duplicate allowlist entry for ${path}`);
    seenEntries.add(identity);
    return {
      path,
      lineEquals,
      expectedOccurrences: entry.expectedOccurrences,
      classification,
      owner,
      reason,
    };
  });

  const binaryPaths = new Set();
  const binaryAllowlist = raw.binaryAllowlist.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`binaryAllowlist[${String(index)}] must be an object`);
    }
    assertExactKeys(
      entry,
      new Set(['path', 'sha256', 'classification', 'owner', 'reason']),
      `binaryAllowlist[${String(index)}]`
    );
    const path = normalizeRelativePath(entry.path, `binaryAllowlist[${String(index)}].path`);
    if (binaryPaths.has(path)) fail(`duplicate binary allowlist entry for ${path}`);
    binaryPaths.add(path);
    const sha256 = asTrimmedMetadata(entry.sha256, `binaryAllowlist[${String(index)}].sha256`);
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      fail(`binaryAllowlist[${String(index)}].sha256 must be a lowercase SHA-256`);
    }
    const classification = asTrimmedMetadata(
      entry.classification,
      `binaryAllowlist[${String(index)}].classification`
    );
    if (!allowedClassifications.has(classification)) {
      fail(`binaryAllowlist[${String(index)}].classification is not allowed`);
    }
    const owner = asTrimmedMetadata(entry.owner, `binaryAllowlist[${String(index)}].owner`);
    const reason = asTrimmedMetadata(entry.reason, `binaryAllowlist[${String(index)}].reason`);
    if (owner.length < 3 || reason.length < 12) {
      fail(`binaryAllowlist[${String(index)}] must have a specific owner and reason`);
    }
    return { path, sha256, classification, owner, reason };
  });

  return { forbiddenHost, allowlist, binaryAllowlist, policySha256 };
}

function canonicalDiscoveredPath(path) {
  if (
    path === '' ||
    path.includes('\\') ||
    path.includes('\n') ||
    path.includes('\r') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`repository contains a non-canonical path: ${JSON.stringify(path)}`);
  }
  return path;
}

function gitInventory(root) {
  let topLevelBuffer;
  try {
    topLevelBuffer = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    if (existsSync(join(root, '.git'))) {
      fail(
        `cannot resolve Git repository inventory: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return undefined;
  }

  let topLevel;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    topLevel = decoder.decode(topLevelBuffer).trim();
  } catch {
    fail('Git top-level path is not valid UTF-8');
  }
  if (realpathSync(topLevel) !== root) {
    fail('--root must be the exact Git repository top level');
  }

  let output;
  try {
    output = execFileSync(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch (error) {
    fail(
      `cannot collect Git repository inventory: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let decodedPaths;
  try {
    decodedPaths = new TextDecoder('utf-8', { fatal: true }).decode(output);
  } catch {
    fail('Git inventory contains a path that is not valid UTF-8');
  }
  return decodedPaths
    .split('\0')
    .filter((path) => path !== '')
    .map(canonicalDiscoveredPath);
}

function fallbackInventory(root) {
  const files = [];
  const visit = (absolutePath) => {
    const stat = lstatSync(absolutePath);
    const relativePath = relative(root, absolutePath);
    if (stat.isSymbolicLink()) {
      fail(`symlink is forbidden in scanned scope: ${canonicalDiscoveredPath(relativePath)}`);
    }
    if (stat.isDirectory()) {
      if (relativePath !== '' && fallbackIgnoredDirectories.has(relativePath.split(sep).at(-1))) {
        return;
      }
      for (const entry of readdirSync(absolutePath).sort()) visit(join(absolutePath, entry));
      return;
    }
    if (!stat.isFile()) return;
    const canonical = sep === '/' ? relativePath : relativePath.split(sep).join('/');
    files.push(canonicalDiscoveredPath(canonical));
  };
  visit(root);
  return files;
}

function collectInventory(root) {
  const inventory = gitInventory(root) ?? fallbackInventory(root);
  return [...new Set(inventory)].sort();
}

function sourceLocation(contents, sourceOffset) {
  const lineStart = contents.lastIndexOf('\n', Math.max(0, sourceOffset - 1)) + 1;
  const nextLineBreak = contents.indexOf('\n', sourceOffset);
  const lineEnd = nextLineBreak === -1 ? contents.length : nextLineBreak;
  let line = 1;
  for (let index = 0; index < lineStart; index += 1) {
    if (contents[index] === '\n') line += 1;
  }
  return {
    line,
    column: sourceOffset - lineStart + 1,
    contents: contents.slice(lineStart, lineEnd),
  };
}

function findOccurrences(root, files, binaryAllowlist) {
  const occurrences = [];
  let textFileCount = 0;
  let binaryAssetCount = 0;
  const binaryAllowlistByPath = new Map(binaryAllowlist.map((entry) => [entry.path, entry]));
  const matchedBinaryAllowlist = new Set();
  const fileSha256ByPath = new Map();
  for (const path of files) {
    const contents = readStableText(
      root,
      path,
      binaryAllowlistByPath,
      matchedBinaryAllowlist,
      fileSha256ByPath
    );
    if (contents === undefined) {
      binaryAssetCount += 1;
      continue;
    }
    textFileCount += 1;
    for (const sourceOffset of findCanonicalHostOffsets(contents, path)) {
      const location = sourceLocation(contents, sourceOffset);
      occurrences.push({
        path,
        line: location.line,
        column: location.column,
        contents: location.contents,
      });
    }
  }
  return {
    occurrences,
    textFileCount,
    binaryAssetCount,
    matchedBinaryAllowlist,
    fileSha256ByPath,
  };
}

function verify(root, policyRelativePath) {
  const inventoryBefore = collectInventory(root);
  if (!inventoryBefore.includes(policyRelativePath)) {
    fail(`policy must be present in the repository inventory: ${policyRelativePath}`);
  }
  const policy = loadPolicy(root, policyRelativePath);
  const files = inventoryBefore.filter((path) => path !== policyRelativePath);
  const { occurrences, textFileCount, binaryAssetCount, matchedBinaryAllowlist, fileSha256ByPath } =
    findOccurrences(root, files, policy.binaryAllowlist);
  const errors = [];

  const policyAfter = readStableBuffer(root, policyRelativePath);
  const policySha256After = createHash('sha256').update(policyAfter).digest('hex');
  if (policySha256After !== policy.policySha256) {
    errors.push('Policy changed while the repository scan was running');
  }
  const inventoryAfter = collectInventory(root);
  if (JSON.stringify(inventoryAfter) !== JSON.stringify(inventoryBefore)) {
    errors.push('Repository inventory changed while the scan was running');
  }
  for (const [path, sha256Before] of fileSha256ByPath) {
    const sha256After = createHash('sha256').update(readStableBuffer(root, path)).digest('hex');
    if (sha256After !== sha256Before) {
      errors.push(`Scanned file changed after its canonical dependency check: ${path}`);
    }
  }

  for (const entry of policy.binaryAllowlist) {
    if (!matchedBinaryAllowlist.has(entry.path)) {
      errors.push(`Stale binary allowlist entry (${entry.path})`);
    }
  }

  const matchesByEntry = policy.allowlist.map((entry) =>
    occurrences.filter(
      (occurrence) => occurrence.path === entry.path && occurrence.contents === entry.lineEquals
    )
  );

  for (let index = 0; index < policy.allowlist.length; index += 1) {
    const entry = policy.allowlist[index];
    const matches = matchesByEntry[index] ?? [];
    if (matches.length !== entry.expectedOccurrences) {
      errors.push(
        `Stale or non-exact allowlist entry ${String(index)} (${entry.path}); matched ${String(matches.length)} occurrences, expected ${String(entry.expectedOccurrences)}`
      );
    }
  }

  for (const occurrence of occurrences) {
    const matchingEntries = policy.allowlist.filter(
      (entry) => entry.path === occurrence.path && entry.lineEquals === occurrence.contents
    );
    if (matchingEntries.length === 0) {
      errors.push(
        `Unallowlisted production-to-DEV dependency at ${occurrence.path}:${String(occurrence.line)}:${String(occurrence.column)}`
      );
    } else if (matchingEntries.length > 1) {
      errors.push(
        `Duplicate allowlist coverage at ${occurrence.path}:${String(occurrence.line)}:${String(occurrence.column)}`
      );
    }
  }

  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    return false;
  }

  process.stdout.write(
    `Production-to-DEV dependency gate passed: ${String(textFileCount)} UTF-8 files, ${String(binaryAssetCount)} validated binary assets, ${String(occurrences.length)} exact allowlisted occurrences\n`
  );
  return true;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const { root, policyRelativePath } = parseArgs(process.argv.slice(2));
    if (!verify(root, policyRelativePath)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `Production-to-DEV dependency gate configuration error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}

export { findCanonicalHostOffsets };
