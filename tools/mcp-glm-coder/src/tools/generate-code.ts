import { z } from 'zod';
import type { GLMClient } from '../api/glm-client.js';
import type { MetricsCollector } from '../metrics/collector.js';
import { loadProjectContext, loadFileContext, estimateTokens } from '../config/project-context.js';
import { buildSystemPrompt, buildUserPrompt } from '../config/system-prompt.js';
import {
  validateTypeScript,
  categorizeError,
  quickSyntaxCheck,
  shouldSkipTypeScriptValidation,
} from '../validation/typescript.js';
import type { GenerateCodeParams, ValidationResult } from '../types.js';
import { logger } from '../utils/logger.js';

export const generateCodeSchema = z.object({
  task: z.string().describe('What code to implement'),
  contextFiles: z.array(z.string()).optional().describe('Paths to files that provide context'),
  targetFile: z.string().optional().describe('Where this code will live'),
  style: z.enum(['minimal', 'documented', 'defensive']).optional().describe('Code style'),
});

const MAX_ATTEMPTS = 3;

export async function generateCode(
  params: GenerateCodeParams,
  glmClient: GLMClient,
  metrics: MetricsCollector,
  cwd: string
): Promise<{ content: string; success: boolean; attempts: number }> {
  const projectContext = loadProjectContext(cwd);
  const fileContext = params.contextFiles ? loadFileContext(params.contextFiles, cwd) : '';

  const contextTokens = estimateTokens(projectContext + fileContext);

  const callId = metrics.startCall({
    taskType: 'generate_code',
    taskDescription: params.task,
    contextFilesCount: params.contextFiles?.length ?? 0,
    contextTokensEstimate: contextTokens,
    targetFile: params.targetFile ?? null,
  });

  logger.info('Starting code generation', {
    callId,
    task: params.task.slice(0, 100),
    contextFiles: params.contextFiles?.length ?? 0,
    targetFile: params.targetFile,
    style: params.style,
  });

  const systemPrompt = buildSystemPrompt({
    projectContext,
    targetFile: params.targetFile,
    style: params.style,
  });

  let lastCode = '';
  let lastErrors: string[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    logger.info('Generation attempt', { attempt, maxAttempts: MAX_ATTEMPTS });

    const userPrompt = buildUserPrompt(
      params.task,
      fileContext,
      attempt > 1 ? lastErrors : undefined
    );

    try {
      const result = await glmClient.generateCode({
        systemPrompt,
        userPrompt,
      });

      lastCode = result.content;

      const syntaxCheck = quickSyntaxCheck(lastCode);
      if (!syntaxCheck.ok) {
        logger.warn('Syntax check failed', { errors: syntaxCheck.errors });
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

      let validation: ValidationResult = { ok: true, errors: [], warnings: [] };

      if (params.targetFile?.endsWith('.ts') || params.targetFile?.endsWith('.tsx')) {
        const skipCheck = shouldSkipTypeScriptValidation(params.task, params.targetFile, cwd);
        if (skipCheck.skip) {
          logger.info('Skipping TypeScript validation', { reason: skipCheck.reason });
        } else {
          validation = validateTypeScript(lastCode, cwd);
        }
      }

      if (validation.ok) {
        logger.info('Validation passed', { attempt });

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

        return { content: lastCode, success: true, attempts };
      }

      logger.warn('Validation failed', { errors: validation.errors.slice(0, 3) });
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
      logger.error('API error', { error: errorMsg });
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

  logger.error('Generation failed', { attempts: MAX_ATTEMPTS });

  metrics.finishCall({
    finalSuccess: false,
    outputTokensEstimate: estimateTokens(lastCode),
    validationErrors: lastErrors,
  });

  const warningComment = `// WARNING: GLM generation failed validation after ${MAX_ATTEMPTS} attempts
// Last errors: ${lastErrors.slice(0, 3).join(', ')}
// Review and fix manually

`;

  return { content: warningComment + lastCode, success: false, attempts };
}
