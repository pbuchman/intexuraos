import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import type { GLMClient } from '../api/glm-client.js';
import type { MetricsCollector } from '../metrics/collector.js';
import { loadProjectContext, estimateTokens } from '../config/project-context.js';
import { validateTypeScript, categorizeError, quickSyntaxCheck } from '../validation/typescript.js';
import type { GenerateTestsParams, ValidationResult } from '../types.js';
import { logger } from '../utils/logger.js';

const MAX_ATTEMPTS = 3;

export const generateTestsSchema = z.object({
  sourceFile: z.string().describe('Path to the file to test'),
  testStyle: z.enum(['unit', 'integration']).optional().describe('Type of tests to generate'),
  coverage: z.enum(['full', 'happy-path']).optional().describe('Coverage level'),
});

const TEST_SYSTEM_PROMPT = `You are a TypeScript test generator. Follow these rules EXACTLY.

## CRITICAL OUTPUT RULES
1. Output ONLY executable test code - NO MARKDOWN FENCES
2. Code must compile and run without modification
3. NO explanations before or after the code
4. All imports must use .js extension for local files

## VITEST SETUP (MANDATORY)
Always import from vitest: describe, it, expect, vi, beforeEach, afterEach

Example:
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

## MOCK PATTERNS (CRITICAL)

### Logger Mock - MUST HAVE ALL 4 METHODS
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

WRONG: Missing any of the 4 methods will cause TypeScript errors!
WRONG: Using pino() or real logger imports!

### Repository Mock Pattern
Create mockRepo with methods matching the repository interface.
Each method should be vi.fn() with proper return type.

For Result-returning methods:
mockRepo.find = vi.fn().mockResolvedValue(ok(data));
mockRepo.create = vi.fn().mockResolvedValue(err({ code: 'ERROR' }));

### External Dependencies
Mock ALL external dependencies. Never import real implementations.
Use vi.mock() for module mocking when needed.

### Reset mocks in beforeEach
Call vi.clearAllMocks() in beforeEach to prevent test pollution.

## RESULT TYPE HANDLING (MANDATORY)

### Checking Results
WRONG: if (result.ok) - truthy check causes TypeScript strict errors!
CORRECT: if (result.ok === true) - explicit comparison

### Accessing Result Values
WRONG: result.value without checking ok first!
CORRECT: if (result.ok === true) { const data = result.value; }

### Import Pattern
import { ok, err, type Result } from '@intexuraos/common-core';

## TEST STRUCTURE

### For Use Cases (domain/usecases)
describe('useCaseName', () => {
  let mockDeps: { repo: MockRepo; logger: MockLogger };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeps = { repo: mockRepo, logger: mockLogger };
  });

  describe('success cases', () => {
    it('description', async () => {
      mockDeps.repo.find.mockResolvedValue(ok(data));
      const result = await useCase(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value).toEqual(expected);
      }
    });
  });

  describe('error cases', () => {
    it('description', async () => {
      mockDeps.repo.find.mockResolvedValue(err({ code: 'NOT_FOUND' }));
      const result = await useCase(input, mockDeps);
      expect(result.ok).toBe(false);
    });
  });
});

### For Routes (routes/)
Use app.inject() for integration tests.
Import: buildServer from '../server.js' (or '../app.js')
Import: setServices, resetServices from '../services.js'

## COMMON MISTAKES TO AVOID
1. Forgetting .js extension on local imports
2. Missing Logger mock methods (need all 4: info, warn, error, debug)
3. Using truthy check (if (result.ok)) instead of explicit (if (result.ok === true))
4. Accessing result.value without narrowing with ok check first
5. Not resetting mocks in beforeEach
6. Using real implementations instead of mocks

## COVERAGE REQUIREMENTS
- Test ALL branches: success and error paths
- Test edge cases: empty arrays, null values, boundary conditions
- Verify mock calls with toHaveBeenCalledWith`;

function inferTestPath(sourceFile: string): string {
  const dir = dirname(sourceFile);
  const file = basename(sourceFile, '.ts');

  if (sourceFile.includes('/domain/usecases/')) {
    return join(dir.replace('/domain/usecases', '/domain/useCases'), `${file}.test.ts`);
  }
  if (sourceFile.includes('/domain/useCases/')) {
    return join(dir, `${file}.test.ts`);
  }
  if (sourceFile.includes('/routes/')) {
    const appDir = dir.replace('/routes', '');
    return join(appDir, '__tests__', 'routes', `${file}.test.ts`);
  }
  if (sourceFile.includes('/infra/')) {
    return join(dir, `${file}.test.ts`);
  }

  return join(dir, '__tests__', `${file}.test.ts`);
}

function extractTestContext(sourceFile: string, cwd: string): string {
  const fullPath = sourceFile.startsWith('/') ? sourceFile : join(cwd, sourceFile);

  if (!existsSync(fullPath)) {
    return '';
  }

  const sourceCode = readFileSync(fullPath, 'utf-8');

  const imports = sourceCode
    .split('\n')
    .filter((line) => line.startsWith('import '))
    .join('\n');

  const functionMatch = sourceCode.match(/export (?:async )?function (\w+)/);
  const functionName = functionMatch?.[1] ?? 'unknown';

  const depsMatch = sourceCode.match(/interface \w*Deps\s*\{[\s\S]*?\}/);
  const depsType = depsMatch?.[0] ?? '';

  return `## Source File: ${sourceFile}

### Function Name: ${functionName}

### Imports:
${imports}

### Dependencies Type:
${depsType}

### Full Source:
\`\`\`typescript
${sourceCode}
\`\`\``;
}

/**
 * Build the user prompt for test generation, including previous errors if any.
 */
function buildTestUserPrompt(
  params: GenerateTestsParams,
  sourceContext: string,
  targetFile: string,
  previousErrors?: string[]
): string {
  const coverageGuidance =
    params.coverage === 'happy-path'
      ? 'Focus on the main success path. Skip edge cases.'
      : 'Cover ALL branches: success cases, error cases, and edge cases.';

  const styleGuidance =
    params.testStyle === 'integration'
      ? 'Write integration tests using app.inject(). Test the full HTTP request/response cycle.'
      : 'Write unit tests. Mock all dependencies. Test the function in isolation.';

  const parts = [
    `Generate ${params.testStyle ?? 'unit'} tests for the following source file.`,
    '',
    styleGuidance,
    coverageGuidance,
    '',
    sourceContext,
    '',
    `Output the complete test file that can be saved to: ${targetFile}`,
  ];

  if (previousErrors !== undefined && previousErrors.length > 0) {
    parts.push('');
    parts.push('## PREVIOUS ATTEMPT FAILED - FIX THESE ERRORS:');
    for (const error of previousErrors.slice(0, 5)) {
      parts.push(`- ${error}`);
    }
    parts.push('');
    parts.push('Review the error messages above and generate corrected test code.');
  }

  return parts.join('\n');
}

export async function generateTests(
  params: GenerateTestsParams,
  glmClient: GLMClient,
  metrics: MetricsCollector,
  cwd: string
): Promise<{ content: string; success: boolean; attempts: number; targetFile: string }> {
  const targetFile = inferTestPath(params.sourceFile);
  const sourceContext = extractTestContext(params.sourceFile, cwd);
  const projectContext = loadProjectContext(cwd);

  const contextTokens = estimateTokens(sourceContext + projectContext);

  const callId = metrics.startCall({
    taskType: 'generate_tests',
    taskDescription: `Tests for ${params.sourceFile}`,
    contextFilesCount: 1,
    contextTokensEstimate: contextTokens,
    targetFile,
  });

  logger.info('Starting test generation', {
    sourceFile: params.sourceFile,
    targetFile,
    testStyle: params.testStyle ?? 'unit',
    coverage: params.coverage ?? 'full',
  });

  const systemPrompt = `${TEST_SYSTEM_PROMPT}

${projectContext}`;

  void callId;

  let lastCode = '';
  let lastErrors: string[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    logger.info('Test generation attempt', { attempt, maxAttempts: MAX_ATTEMPTS });

    const userPrompt = buildTestUserPrompt(
      params,
      sourceContext,
      targetFile,
      attempt > 1 ? lastErrors : undefined
    );

    try {
      const result = await glmClient.generateCode({
        systemPrompt,
        userPrompt,
      });

      lastCode = result.content;

      // Quick syntax check first
      const syntaxCheck = quickSyntaxCheck(lastCode);
      if (!syntaxCheck.ok) {
        logger.warn('Test syntax check failed', { errors: syntaxCheck.errors });
        lastErrors = syntaxCheck.errors;
        metrics.recordAttempt({
          attemptNumber: attempt,
          latencyMs: result.latencyMs,
          success: false,
          errorCategory: 'syntax-error',
          tokensEstimate: result.tokensUsed,
        });
        continue;
      }

      // TypeScript validation for test files
      let validation: ValidationResult = { ok: true, errors: [], warnings: [] };
      if (targetFile.endsWith('.test.ts') || targetFile.endsWith('.spec.ts')) {
        validation = validateTypeScript(lastCode, cwd);
      }

      if (validation.ok) {
        logger.info('Test validation passed', { attempt });

        metrics.recordAttempt({
          attemptNumber: attempt,
          latencyMs: result.latencyMs,
          success: true,
          tokensEstimate: result.tokensUsed,
        });

        metrics.finishCall({
          finalSuccess: true,
          outputTokensEstimate: estimateTokens(lastCode),
          validationErrors: [],
        });

        return {
          content: lastCode,
          success: true,
          attempts,
          targetFile,
        };
      }

      logger.warn('Test validation failed', { errors: validation.errors.slice(0, 5) });
      lastErrors = validation.errors;

      metrics.recordAttempt({
        attemptNumber: attempt,
        latencyMs: result.latencyMs,
        success: false,
        errorCategory: categorizeError(validation.errors),
        tokensEstimate: result.tokensUsed,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Test generation API error', { error: errorMsg, attempt });
      lastErrors = [errorMsg];

      metrics.recordAttempt({
        attemptNumber: attempt,
        latencyMs: 0,
        success: false,
        errorCategory: 'api-error',
        tokensEstimate: 0,
      });
    }
  }

  // All attempts failed
  logger.error('Test generation failed after all attempts', { attempts: MAX_ATTEMPTS });

  metrics.finishCall({
    finalSuccess: false,
    outputTokensEstimate: estimateTokens(lastCode),
    validationErrors: lastErrors,
  });

  const warningComment = `// WARNING: GLM test generation failed validation after ${MAX_ATTEMPTS} attempts
// Last errors: ${lastErrors.slice(0, 3).join(', ')}
// Review and fix manually

`;

  return {
    content: warningComment + lastCode,
    success: false,
    attempts,
    targetFile,
  };
}
