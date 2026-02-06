import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CODING_SECTIONS = [
  'TypeScript Patterns',
  'Architecture',
  'Import Rules',
  'Response Contract',
  'Common LLM Mistakes',
  'Testing',
  'Apps & Packages',
];

function extractCodingRules(claudeMd: string): string {
  const sections: string[] = [];

  for (const header of CODING_SECTIONS) {
    const regex = new RegExp(`## ${header}[\\s\\S]*?(?=\\n## |$)`, 'i');
    const match = claudeMd.match(regex);
    if (match?.[0]) {
      sections.push(match[0].trim());
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : '';
}

function loadTsConfigSummary(cwd: string): string {
  const tsconfigPath = join(cwd, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    return '';
  }

  try {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
    const opts = tsconfig.compilerOptions ?? {};

    return `## TypeScript Configuration
- Strict mode: ${opts.strict ?? false}
- Module: ${opts.module ?? 'unknown'}
- Target: ${opts.target ?? 'unknown'}
- noUncheckedIndexedAccess: ${opts.noUncheckedIndexedAccess ?? false}
- exactOptionalPropertyTypes: ${opts.exactOptionalPropertyTypes ?? false}`;
  } catch {
    return '';
  }
}

function loadPatternExamples(cwd: string): string {
  const examples: string[] = [];

  const patternFiles = [
    'packages/common-types/src/result.ts',
    'packages/common-types/src/errors.ts',
  ];

  for (const relativePath of patternFiles) {
    const fullPath = join(cwd, relativePath);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      const truncated = content.slice(0, 2000);
      examples.push(`### Pattern: ${relativePath}\n\`\`\`typescript\n${truncated}\n\`\`\``);
    }
  }

  return examples.length > 0 ? `## Code Patterns\n\n${examples.join('\n\n')}` : '';
}

export function loadProjectContext(cwd: string): string {
  const sections: string[] = [];

  const claudeMdPaths = [join(cwd, '.claude', 'CLAUDE.md'), join(cwd, 'CLAUDE.md')];

  for (const path of claudeMdPaths) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      const rules = extractCodingRules(content);
      if (rules) {
        sections.push(`## Project Coding Rules\n\n${rules}`);
      }
      break;
    }
  }

  const tsConfig = loadTsConfigSummary(cwd);
  if (tsConfig) {
    sections.push(tsConfig);
  }

  const patterns = loadPatternExamples(cwd);
  if (patterns) {
    sections.push(patterns);
  }

  return sections.join('\n\n');
}

export function loadFileContext(files: string[], cwd: string): string {
  const contexts: string[] = [];

  for (const file of files) {
    const fullPath = file.startsWith('/') ? file : join(cwd, file);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      const truncated = content.slice(0, 4000);
      contexts.push(`### File: ${file}\n\`\`\`typescript\n${truncated}\n\`\`\``);
    }
  }

  return contexts.length > 0 ? `## Context Files\n\n${contexts.join('\n\n')}` : '';
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
