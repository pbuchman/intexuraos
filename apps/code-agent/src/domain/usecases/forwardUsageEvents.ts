import type { Logger, Result } from '@intexuraos/common-core';
import type { UsageServiceClient, UsageIngestRequest, UsageIngestResponse, UsageServiceError } from '@intexuraos/internal-clients';

export interface ForwardUsageEventsDeps {
  usageServiceClient: UsageServiceClient;
  logger: Logger;
}

export async function forwardUsageEvents(
  request: UsageIngestRequest,
  deps: ForwardUsageEventsDeps
): Promise<Result<UsageIngestResponse, UsageServiceError>> {
  const result = await deps.usageServiceClient.ingestEvents(request);
  if (!result.ok) {
    deps.logger.error({ error: result.error }, 'Failed to forward usage events to llm-usage-service');
    return result;
  }
  deps.logger.info(
    { accepted: result.value.accepted, duplicates: result.value.duplicates },
    'Usage events forwarded to llm-usage-service'
  );
  return result;
}
