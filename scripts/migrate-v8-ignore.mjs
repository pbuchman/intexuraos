#!/usr/bin/env node

// Migrates v8 ignore comments from old format to start/stop format.
// Old format: [v8 ignore <CATEGORY> -- <reason>]
// New format: [v8 ignore start -- <CATEGORY>: <reason> @preserve] ... [v8 ignore stop @preserve]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

// Match current format: /* v8 ignore <CATEGORY> -- <reason> */
const V8_IGNORE_OLD_REGEX =
  /\/\*\s*v8\s+ignore\s+(ts-type|regex|module-init|async-timing|test-infra|upstream|module-mock|schema|source-map|auth-guard)\s+--\s+(.+?)\s*\*\//;

function* walkDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    if (entry.name === '__tests__') continue;

    if (entry.isDirectory()) {
      yield* walkDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield fullPath;
    }
  }
}

function skipCommentBlock(lines, startIdx) {
  const line = lines[startIdx]?.trim() ?? '';

  if (line.startsWith('//')) {
    return startIdx + 1;
  }

  if (line.startsWith('/*') || line.startsWith('/**')) {
    if (line.includes('*/') && line.indexOf('*/') > line.indexOf('/*')) {
      return startIdx + 1;
    }
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].includes('*/')) {
        return i + 1;
      }
    }
    return startIdx + 1;
  }

  return startIdx;
}

function findCodeStart(lines, startIdx) {
  let idx = startIdx;
  while (idx < lines.length) {
    const line = lines[idx]?.trim() ?? '';

    if (line === '') {
      idx++;
      continue;
    }

    if (line.startsWith('//')) {
      idx++;
      continue;
    }

    if (line.startsWith('/*') || line.startsWith('/**')) {
      idx = skipCommentBlock(lines, idx);
      continue;
    }

    return idx;
  }
  return startIdx;
}

function findStatementEnd(lines, startLineIdx) {
  let braceCount = 0;
  let parenCount = 0;
  let bracketCount = 0;
  let foundStart = false;
  let inString = false;
  let stringChar = '';
  let inTemplateString = false;

  for (let i = startLineIdx; i < lines.length; i++) {
    const line = lines[i];

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const prevChar = j > 0 ? line[j - 1] : '';

      if (prevChar === '\\' && (inString || inTemplateString)) {
        continue;
      }

      if (char === '`') {
        inTemplateString = !inTemplateString;
        continue;
      }

      if ((char === '"' || char === "'") && !inTemplateString) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (inString || inTemplateString) {
        continue;
      }

      if (char === '{') {
        braceCount++;
        foundStart = true;
      } else if (char === '}') {
        braceCount--;
      } else if (char === '(') {
        parenCount++;
      } else if (char === ')') {
        parenCount--;
      } else if (char === '[') {
        bracketCount++;
      } else if (char === ']') {
        bracketCount--;
      }
    }

    if (foundStart && braceCount === 0) {
      return i;
    }

    if (braceCount === 0 && parenCount === 0 && bracketCount === 0) {
      const trimmed = line.trim();
      if (trimmed.endsWith(';') || trimmed.endsWith(',')) {
        return i;
      }
    }

    if (i === startLineIdx && !line.includes('{') && braceCount === 0 && parenCount === 0) {
      const trimmed = line.trim();
      if (trimmed.endsWith(';') || trimmed.endsWith(',')) {
        return i;
      }
    }
  }

  return startLineIdx;
}

function findBlockEnd(lines, startLineIdx) {
  let braceCount = 0;
  let foundStart = false;
  let inString = false;
  let stringChar = '';
  let inTemplateString = false;

  for (let i = startLineIdx; i < lines.length; i++) {
    const line = lines[i];

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const prevChar = j > 0 ? line[j - 1] : '';

      if (prevChar === '\\' && (inString || inTemplateString)) {
        continue;
      }

      if (char === '`') {
        inTemplateString = !inTemplateString;
        continue;
      }

      if ((char === '"' || char === "'") && !inTemplateString) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (inString || inTemplateString) {
        continue;
      }

      if (char === '{') {
        braceCount++;
        foundStart = true;
      } else if (char === '}') {
        braceCount--;
        if (foundStart && braceCount === 0) {
          return i;
        }
      }
    }
  }

  return startLineIdx;
}

function migrateFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let modified = false;
  let changeCount = 0;

  // Process from bottom to top to preserve line numbers
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const match = V8_IGNORE_OLD_REGEX.exec(line);

    if (match) {
      const category = match[1];
      const reason = match[2].trim();
      const matchIndex = match.index;
      const matchEnd = matchIndex + match[0].length;
      const beforeComment = line.substring(0, matchIndex).trim();
      const afterComment = line.substring(matchEnd).trim();
      const indent = line.match(/^(\s*)/)?.[1] ?? '';

      // Pattern 1: } /* v8 ignore... */ else if (...) { or } /* v8 ignore... */ else {
      // Need to wrap the else/else-if block
      if (
        beforeComment.endsWith('}') &&
        (afterComment.startsWith('else') || afterComment.startsWith('catch'))
      ) {
        // First, split this line: keep } on current, put else... on next line
        const closingBrace = beforeComment;
        const elseOrCatch = afterComment;

        lines[i] = `${indent}${closingBrace}`;
        lines.splice(
          i + 1,
          0,
          `${indent}/* v8 ignore start -- ${category}: ${reason} @preserve */`
        );
        lines.splice(i + 2, 0, `${indent}${elseOrCatch}`);

        // Now find where the else/catch block ends, starting from the new line i+2
        const blockEndIdx = findBlockEnd(lines, i + 2);
        const endIndent = lines[blockEndIdx]?.match(/^(\s*)/)?.[1] ?? indent;
        lines.splice(blockEndIdx + 1, 0, `${endIndent}/* v8 ignore stop @preserve */`);

        modified = true;
        changeCount++;
        continue;
      }

      // Pattern 2: } catch /* v8 ignore... */ { - comment between catch and opening brace
      if (beforeComment.match(/}\s*catch$/) && afterComment.startsWith('{')) {
        // Wrap the catch block
        const blockEndIdx = findBlockEnd(lines, i);

        // Reconstruct the line without the comment, add start/stop around block
        const cleanLine = beforeComment + ' ' + afterComment;
        lines[i] = `${indent}/* v8 ignore start -- ${category}: ${reason} @preserve */`;
        lines.splice(i + 1, 0, `${indent}${cleanLine}`);

        const newBlockEndIdx = blockEndIdx + 1;
        const endIndent = lines[newBlockEndIdx]?.match(/^(\s*)/)?.[1] ?? indent;
        lines.splice(newBlockEndIdx + 1, 0, `${endIndent}/* v8 ignore stop @preserve */`);

        modified = true;
        changeCount++;
        continue;
      }

      // Pattern 3: Inline comment at end of line (e.g., "return value; /* v8 ignore... */")
      if (beforeComment.length > 0 && afterComment === '') {
        // Wrap just this statement
        lines[i] =
          `${indent}/* v8 ignore start -- ${category}: ${reason} @preserve */\n${indent}${beforeComment}\n${indent}/* v8 ignore stop @preserve */`;
        modified = true;
        changeCount++;
        continue;
      }

      // Pattern 4: Comment is on its own line, followed by next statement
      if (beforeComment === '' && afterComment === '') {
        const nextLineIdx = i + 1;
        if (nextLineIdx < lines.length) {
          const codeStartIdx = findCodeStart(lines, nextLineIdx);
          const endLineIdx = findStatementEnd(lines, codeStartIdx);
          const nextIndent = lines[codeStartIdx]?.match(/^(\s*)/)?.[1] ?? '';

          lines[i] = `${indent}/* v8 ignore start -- ${category}: ${reason} @preserve */`;
          lines.splice(endLineIdx + 1, 0, `${nextIndent}/* v8 ignore stop @preserve */`);
          modified = true;
          changeCount++;
        }
        continue;
      }

      // Pattern 5: Inline comment in middle of statement (complex case)
      // For now, just wrap the whole line
      if (beforeComment.length > 0 && afterComment.length > 0) {
        const cleanLine = beforeComment + ' ' + afterComment;
        lines[i] =
          `${indent}/* v8 ignore start -- ${category}: ${reason} @preserve */\n${indent}${cleanLine}\n${indent}/* v8 ignore stop @preserve */`;
        modified = true;
        changeCount++;
        continue;
      }
    }
  }

  if (modified) {
    writeFileSync(filePath, lines.join('\n'));
  }

  return { modified, changeCount };
}

function main() {
  const dirs = ['apps', 'packages', 'workers'];
  let totalFiles = 0;
  let modifiedFiles = 0;
  let totalChanges = 0;

  for (const dir of dirs) {
    const fullDir = resolve(ROOT_DIR, dir);
    for (const file of walkDir(fullDir)) {
      totalFiles++;
      const result = migrateFile(file);
      if (result.modified) {
        modifiedFiles++;
        totalChanges += result.changeCount;
        console.log(`✓ ${file.replace(ROOT_DIR + '/', '')}: ${result.changeCount} change(s)`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Files scanned: ${totalFiles}`);
  console.log(`Files modified: ${modifiedFiles}`);
  console.log(`Comments migrated: ${totalChanges}`);
}

main();
