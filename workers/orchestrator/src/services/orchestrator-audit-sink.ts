import { appendFile } from 'node:fs/promises';
import { err, getErrorMessage, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { AuditSink, LlmAuditLog } from '@intexuraos/llm-audit';

export class OrchestratorFileAuditSink implements AuditSink {
  private readonly logger: Logger;
  private readonly auditLogPath: string;

  constructor(deps: { logger: Logger; auditLogPath: string }) {
    this.logger = deps.logger;
    this.auditLogPath = deps.auditLogPath;
  }

  async save(log: LlmAuditLog): Promise<Result<void>> {
    try {
      await appendFile(
        this.auditLogPath,
        `${JSON.stringify({ time: new Date().toISOString(), audit: log })}\n`,
        'utf-8'
      );
    } catch (error) {
      return err(new Error(getErrorMessage(error)));
    }

    this.logger.info(
      {
        auditId: log.id,
        provider: log.provider,
        model: log.model,
      },
      'LLM audit log saved'
    );
    return ok(undefined);
  }
}
