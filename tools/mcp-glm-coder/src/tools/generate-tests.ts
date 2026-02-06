import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import type { GLMClient } from '../api/glm-client.js';
import type { MetricsCollector } from '../metrics/collector.js';
import { loadProjectContext, estimateTokens } from '../config/project-context.js';
import type { GenerateTestsParams } from '../types.js';
import { logger } from '../utils/logger.js';

export const generateTestsSchema = z.object({
  sourceFile: z.string().describe('Path to the file to test'),
  testStyle: z.enum(['unit', 'integration']).optional().describe('Type of tests to generate'),
  coverage: z.enum(['full', 'happy-path']).optional().describe('Coverage level'),
});

const TEST_SYSTEM_PROMPT = `You are a TypeScript test generator. Follow these rules EXACTLY.

## OUTPUT RULES
1. Output ONLY executable test code
2. NO markdown fences
3. NO explanations

## VITEST SETUP
Always import from vitest: describe, it, expect, vi, beforeEach, afterEach

## MOCK PATTERNS
Mock ALL external dependencies. Never import real implementations.

### Logger Mock (REQUIRED for any code using Logger)
Create mockLogger with ALL four methods: info, warn, error, debug
Each method should be vi.fn()

### Repository Mock Pattern
Create mockRepo with methods matching the repository interface.
Each method should be vi.fn()

### Reset mocks in beforeEach
Call vi.clearAllMocks() in beforeEach

## TEST STRUCTURE

### For Use Cases (domain/usecases)
Structure: describe block with mockDeps, success cases describe, error cases describe

Success test pattern:
1. Setup mock return value with mockResolvedValue(ok(data))
2. Call the use case
3. Assert result.ok is true
4. Use if (result.ok === true) before accessing result.value

Error test pattern:
1. Setup mock return value with mockResolvedValue(err({ code: 'ERROR_CODE' }))
2. Call the use case
3. Assert result.ok is false

### For Routes (routes/)
Use app.inject() for integration tests.
Import buildApp from app.js
Import setServices, resetServices from services.js

Setup: setServices with mocks, buildApp
Teardown: resetServices, app.close

Test with app.inject({ method, url, payload })

## RESULT TYPE HANDLING
Always check result.ok before accessing the value property.
Pattern: if (result.ok === true) then access the value
Never access the value property without checking ok first.

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

  const coverageGuidance =
    params.coverage === 'happy-path'
      ? 'Focus on the main success path. Skip edge cases.'
      : 'Cover ALL branches: success cases, error cases, and edge cases.';

  const styleGuidance =
    params.testStyle === 'integration'
      ? 'Write integration tests using app.inject(). Test the full HTTP request/response cycle.'
      : 'Write unit tests. Mock all dependencies. Test the function in isolation.';

  const userPrompt = `Generate ${params.testStyle ?? 'unit'} tests for the following source file.

${styleGuidance}
${coverageGuidance}

${sourceContext}

Output the complete test file that can be saved to: ${targetFile}`;

  void callId;

  try {
    const result = await glmClient.generateCode({
      systemPrompt,
      userPrompt,
    });

    metrics.recordAttempt({
      attemptNumber: 1,
      latencyMs: result.latencyMs,
      success: true,
      tokensEstimate: result.tokensUsed,
    });

    metrics.finishCall({
      finalSuccess: true,
      outputTokensEstimate: estimateTokens(result.content),
      validationErrors: [],
    });

    logger.info('Tests generated successfully');

    return {
      content: result.content,
      success: true,
      attempts: 1,
      targetFile,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Test generation failed', { error: errorMsg });

    metrics.recordAttempt({
      attemptNumber: 1,
      latencyMs: 0,
      success: false,
      errorCategory: 'api-error',
      tokensEstimate: 0,
    });

    metrics.finishCall({
      finalSuccess: false,
      outputTokensEstimate: 0,
      validationErrors: [errorMsg],
    });

    return {
      content: `// Test generation failed: ${errorMsg}`,
      success: false,
      attempts: 1,
      targetFile,
    };
  }
}
