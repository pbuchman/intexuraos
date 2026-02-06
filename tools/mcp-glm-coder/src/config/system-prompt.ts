const BASE_CODING_RULES = `You are a TypeScript code generator. Follow these rules EXACTLY.

## CRITICAL OUTPUT RULES
1. Output ONLY executable TypeScript code
2. NO markdown fences (no backticks)
3. NO explanations before or after code
4. NO comments like "Here we..." or "This function..."

## IMPORT RULES (MANDATORY)
All local imports MUST have .js extension.

CORRECT FORMAT:
  import { something } from './file.js';
  import { Result } from '@intexuraos/common-types';

WRONG - DO NOT DO THIS:
  Importing without .js extension will fail!
  Importing with default syntax instead of named imports will fail!
  Always use: import { named } from './path.js';

## TYPE SAFETY RULES (MANDATORY)

### Rule 1: Always handle undefined
Array access can return undefined. Always check before using:

WRONG: Accessing array[0].property directly without checking if array[0] exists!

CORRECT:
  const item = array[0];
  if (item === undefined) return err('not found');
  return ok(item.name);

### Rule 2: Explicit boolean checks
Never use truthy/falsy. Use explicit comparisons:

WRONG: if (value) or if (!result.ok)
CORRECT: if (value !== undefined) or if (result.ok === false)

### Rule 3: Numbers in templates
Wrap numbers with String() in template literals:

WRONG: Using raw number in template
CORRECT: Use String(count) when interpolating numbers

### Rule 4: Optional properties
Use ?: syntax, not union with undefined:

WRONG: property: Type | undefined
CORRECT: property?: Type

## RESULT PATTERN (MANDATORY)
NEVER throw errors. Always use Result type:

import { ok, err, type Result } from '@intexuraos/common-types';

Function signature: Promise<Result<Data, AppError>>

Return success: return ok(data);
Return error: return err({ code: 'NOT_FOUND', message: 'Item not found' });

Check result:
  const result = await doSomething(id);
  if (result.ok === false) return result;
  const value = result.value;

## FUNCTION STRUCTURE
Every function MUST have:
1. Explicit return type
2. Type annotations for all parameters
3. Dependencies passed as parameters (not imported globals)

Example:
export async function createUser(
  data: CreateUserInput,
  deps: { repo: UserRepo; logger: Logger }
): Promise<Result<User, AppError>> {
  deps.logger.info(message);
}

## TESTING REQUIREMENTS
When writing tests:
1. Use vitest (import { describe, it, expect, vi } from 'vitest')
2. Create mocks for ALL dependencies
3. Test success AND error cases
4. Mock Logger must have ALL methods: info, warn, error, debug

Required mock structure:
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

## COMMON MISTAKES TO AVOID
1. Forgetting .js extension on imports
2. Not handling undefined from array access
3. Using bare if(value) instead of if(value !== undefined)
4. Throwing errors instead of returning Result
5. Missing return type on functions
6. Incomplete mock objects in tests`;

export interface SystemPromptOptions {
  projectContext: string;
  targetFile?: string;
  style?: 'minimal' | 'documented' | 'defensive';
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const sections = [BASE_CODING_RULES];

  if (options.projectContext) {
    sections.push(options.projectContext);
  }

  if (options.style) {
    sections.push(getStyleGuidance(options.style));
  }

  if (options.targetFile) {
    sections.push(`## Target Location\nThis code will be placed in: ${options.targetFile}`);
  }

  return sections.join('\n\n');
}

function getStyleGuidance(style: 'minimal' | 'documented' | 'defensive'): string {
  switch (style) {
    case 'minimal':
      return `## Style: Minimal
- Absolute minimum code to solve the problem
- No optional features or edge case handling
- No comments unless logic is truly complex`;

    case 'documented':
      return `## Style: Documented
- Include JSDoc comments for public functions
- Add inline comments for non-obvious logic
- Include usage examples in complex functions`;

    case 'defensive':
      return `## Style: Defensive
- Validate all inputs at function boundaries
- Handle all error cases explicitly
- Include comprehensive type guards
- Add assertions for invariants`;

    default:
      return '';
  }
}

/**
 * Map TypeScript error codes to actionable fix guidance.
 */
function getErrorGuidance(error: string): string {
  if (error.includes('TS2307') || error.includes('Cannot find module')) {
    return 'Check that the import path has .js extension for local files';
  }
  if (error.includes('TS2339') || error.includes('does not exist on type')) {
    return 'Check property names match the interface definition exactly';
  }
  if (error.includes('TS2345') || error.includes('not assignable to parameter')) {
    return 'Verify parameter types match the expected function signature';
  }
  if (error.includes('TS2532') || error.includes('possibly undefined')) {
    return 'Add explicit undefined check before accessing the value';
  }
  if (error.includes('TS2322') || error.includes('not assignable to type')) {
    return 'Check return type matches the function signature';
  }
  if (error.includes('TS18048') || error.includes('possibly null')) {
    return 'Add null check before accessing the property';
  }
  if (error.includes('Unbalanced')) {
    return 'Check for missing closing braces, parentheses, or brackets';
  }
  return 'Review the error message and fix the code accordingly';
}

export function buildUserPrompt(
  task: string,
  fileContext: string,
  previousErrors?: string[]
): string {
  const parts = [task];

  if (fileContext) {
    parts.push(`\n\n${fileContext}`);
  }

  if (previousErrors !== undefined && previousErrors.length > 0) {
    parts.push('\n\n## CRITICAL: Previous Attempt Failed');
    parts.push('The previous code failed validation. Fix ALL of these errors:');
    parts.push('');

    for (const error of previousErrors.slice(0, 5)) {
      const guidance = getErrorGuidance(error);
      parts.push(`ERROR: ${error}`);
      parts.push(`FIX: ${guidance}`);
      parts.push('');
    }

    parts.push('Generate corrected code that addresses ALL the errors above.');
  }

  return parts.join('\n');
}
