#!/usr/bin/env node

/**
 * Format all markdown tables in the docs directory with proper column alignment.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function getAllFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (file.endsWith('.md')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

/**
 * Format a single markdown table with proper column alignment.
 */
function formatTable(table) {
  const lines = table.trim().split('\n');
  if (lines.length < 2) return table;

  const rows = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      const inner = trimmed.substring(
        1,
        trimmed.endsWith('|') ? trimmed.length - 1 : trimmed.length
      );
      return inner.split('|').map((cell) => cell.trim());
    }
    return [];
  });

  const headerRow = rows[0] || [];
  const separatorRow = rows[1] || [];
  const dataRows = rows.slice(2);

  const numCols = headerRow.length;
  const colWidths = [];
  for (let i = 0; i < numCols; i++) {
    let maxLen = 0;
    if (headerRow[i]) maxLen = Math.max(maxLen, headerRow[i].length);
    if (separatorRow[i]) {
      const sepContent = separatorRow[i].replace(/^:|:$/g, '');
      maxLen = Math.max(maxLen, sepContent.length);
    }
    for (const row of dataRows) {
      if (row[i]) maxLen = Math.max(maxLen, row[i].length);
    }
    colWidths.push(maxLen);
  }

  const formattedRows = [];

  const formattedHeader =
    '| ' + headerRow.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ') + ' |';
  formattedRows.push(formattedHeader);

  const formattedSep =
    '| ' +
    separatorRow
      .map((sep, i) => {
        const width = colWidths[i];
        const hasLeft = sep.startsWith(':');
        const hasRight = sep.endsWith(':');
        const dashes = '-'.repeat(Math.max(3, width - (hasLeft ? 1 : 0) - (hasRight ? 1 : 0)));
        return (hasLeft ? ':' : '') + dashes + (hasRight ? ':' : '');
      })
      .join(' | ') +
    ' |';
  formattedRows.push(formattedSep);

  for (const row of dataRows) {
    const formattedRow =
      '| ' + row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join(' | ') + ' |';
    formattedRows.push(formattedRow);
  }

  return formattedRows.join('\n');
}

/**
 * Find and format all tables in markdown content.
 */
function formatTablesInContent(content) {
  const lines = content.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('|')) {
      if (i + 1 < lines.length && lines[i + 1].includes('---')) {
        const tableLines = [line];

        i++;
        tableLines.push(lines[i]);

        i++;
        while (
          i < lines.length &&
          lines[i].trim().startsWith('|') &&
          !lines[i].trim().startsWith('```')
        ) {
          tableLines.push(lines[i]);
          i++;
        }

        const formattedTable = formatTable(tableLines.join('\n'));
        result.push(formattedTable);
        continue;
      }
    }

    result.push(line);
    i++;
  }

  return result.join('\n');
}

const docsDir = join(process.cwd(), 'docs');
const files = getAllFiles(docsDir);

let totalFiles = 0;
let totalTables = 0;
let filesWithTables = 0;

for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  const formatted = formatTablesInContent(content);

  const tableCountBefore = (content.match(/\n\|.*\|.*\n\|[-:| ]+\|/g) || []).length;

  if (formatted !== content) {
    writeFileSync(file, formatted, 'utf-8');
    totalFiles++;
    totalTables += tableCountBefore;
    filesWithTables++;
    console.log(`✓ ${file.replace(process.cwd() + '/', '')}`);
  }
}

console.log(`\nFormatted ${totalTables} tables in ${filesWithTables} files.`);
