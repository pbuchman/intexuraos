import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ValidationResult } from '../types.js';

/**
 * Keywords that indicate the task is asking for a partial code snippet,
 * not a complete compilable file.
 */
const SNIPPET_INDICATORS = [
  'insert',
  'add these lines',
  'add the following',
  'only the new lines',
  'output only',
  'just the',
  'snippet',
  'after the',
  'before the',
];

/**
 * Detect if a task is requesting a partial code snippet rather than a complete file.
 */
export function isPartialSnippetTask(task: string): boolean {
  const lowerTask = task.toLowerCase();
  return SNIPPET_INDICATORS.some((indicator) => lowerTask.includes(indicator));
}

/**
 * Determine if TypeScript validation should be skipped.
 * Skip when:
 * 1. Task is requesting a partial snippet (can't compile standalone)
 * 2. Target file doesn't exist yet (imports won't resolve)
 */
export function shouldSkipTypeScriptValidation(
  task: string,
  targetFile: string | undefined,
  cwd: string
): { skip: boolean; reason: string } {
  if (isPartialSnippetTask(task)) {
    return { skip: true, reason: 'partial-snippet' };
  }

  if (targetFile !== undefined) {
    const fullPath = targetFile.startsWith('/') ? targetFile : join(cwd, targetFile);
    if (!existsSync(fullPath)) {
      return { skip: true, reason: 'new-file' };
    }
  }

  return { skip: false, reason: '' };
}

export function validateTypeScript(code: string, cwd: string): ValidationResult {
  const tempFile = join(tmpdir(), `glm-validate-${Date.now()}.ts`);

  try {
    writeFileSync(tempFile, code);

    execSync(`npx tsc --noEmit --skipLibCheck "${tempFile}"`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { ok: true, errors: [], warnings: [] };
  } catch (error: unknown) {
    const stderr =
      error instanceof Error && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr)
        : '';
    const stdout =
      error instanceof Error && 'stdout' in error
        ? String((error as { stdout: unknown }).stdout)
        : '';

    const output = stderr || stdout;
    const errors = parseTypeScriptErrors(output);

    return {
      ok: false,
      errors: errors.length > 0 ? errors : ['TypeScript compilation failed'],
      warnings: [],
    };
  } finally {
    if (existsSync(tempFile)) {
      try {
        unlinkSync(tempFile);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

function parseTypeScriptErrors(output: string): string[] {
  const errorLines = output.split('\n').filter((line) => line.includes('error TS'));

  return errorLines.map((line) => {
    const match = line.match(/error (TS\d+): (.+)/);
    if (match?.[1] && match[2]) {
      return `${match[1]}: ${match[2]}`;
    }
    return line.trim();
  });
}

export function categorizeError(errors: string[]): string {
  const categories: Record<string, string[]> = {
    'type-error': ['TS2322', 'TS2345', 'TS2339', 'TS2349', 'TS2304'],
    'import-error': ['TS2307', 'TS2305', 'TS2306'],
    'syntax-error': ['TS1005', 'TS1003', 'TS1128'],
    'strict-error': ['TS2532', 'TS2531', 'TS18048'],
  };

  for (const [category, codes] of Object.entries(categories)) {
    for (const error of errors) {
      if (codes.some((code) => error.includes(code))) {
        return category;
      }
    }
  }

  return 'unknown-error';
}

export function quickSyntaxCheck(code: string): ValidationResult {
  const issues: string[] = [];

  if ((code.match(/\{/g)?.length ?? 0) !== (code.match(/\}/g)?.length ?? 0)) {
    issues.push('Unbalanced braces');
  }

  if ((code.match(/\(/g)?.length ?? 0) !== (code.match(/\)/g)?.length ?? 0)) {
    issues.push('Unbalanced parentheses');
  }

  if ((code.match(/\[/g)?.length ?? 0) !== (code.match(/\]/g)?.length ?? 0)) {
    issues.push('Unbalanced brackets');
  }

  const quotes = (code.match(/(?<!\\)'/g)?.length ?? 0) + (code.match(/(?<!\\)"/g)?.length ?? 0);
  if (quotes % 2 !== 0) {
    issues.push('Unclosed string literal');
  }

  return {
    ok: issues.length === 0,
    errors: issues,
    warnings: [],
  };
}
