import { FieldValue, type Firestore } from '@intexuraos/infra-firestore';
import type { Logger } from 'pino';

type LegacyExecutionPhase = 'design' | 'execution';
type AgentType = 'planning' | 'execution' | 'pull_request' | 'review';

function mapExecutionPhaseToAgentType(executionPhase: LegacyExecutionPhase): AgentType {
  return executionPhase === 'execution' ? 'execution' : 'planning';
}

interface MigrationDeps {
  firestore: Firestore;
  logger: Logger;
}

export async function runAgentRoutingContractMigration({ firestore, logger }: MigrationDeps): Promise<void> {
  const snapshot = await firestore.collection('code_tasks').get();
  let updatedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as {
      status?: string;
      executionPhase?: string;
      agentType?: string;
      followUpReason?: string;
    };

    const update: Record<string, unknown> = {};
    let needsUpdate = false;

    if (data.status === 'designed') {
      update['status'] = 'planned';
      needsUpdate = true;
    }

    if (data.executionPhase === 'design' || data.executionPhase === 'execution') {
      const mappedAgentType = mapExecutionPhaseToAgentType(data.executionPhase);
      if (data.agentType !== undefined && data.agentType !== mappedAgentType) {
        throw new Error(
          `Legacy migration conflict for task ${doc.id}: executionPhase=${data.executionPhase} agentType=${data.agentType}`
        );
      }

      update['agentType'] = mappedAgentType;
      update['executionPhase'] = FieldValue.delete();
      needsUpdate = true;
    }

    if (data.followUpReason === 'phase2_implement') {
      update['followUpReason'] = 'execution_implement';
      needsUpdate = true;
    }

    if (!needsUpdate) {
      continue;
    }

    await doc.ref.update(update);
    updatedCount++;
  }

  logger.info({ updatedCount }, 'Agent routing contract migration completed');
}

export async function assertNoLegacyAgentRoutingContractValues({ firestore, logger }: MigrationDeps): Promise<void> {
  const snapshot = await firestore.collection('code_tasks').get();
  const offenders: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() as {
      status?: string;
      executionPhase?: unknown;
      followUpReason?: unknown;
    };

    const hasLegacyExecutionPhase = data.executionPhase !== undefined;
    const hasLegacyStatus = data.status === 'designed';
    const hasLegacyFollowUpReason = data.followUpReason === 'phase2_implement';
    if (hasLegacyExecutionPhase || hasLegacyStatus || hasLegacyFollowUpReason) {
      offenders.push(doc.id);
      if (offenders.length >= 10) {
        break;
      }
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `Legacy agent-routing values remain in code_tasks after migration (sample task IDs: ${offenders.join(', ')})`
    );
  }

  logger.info('Agent routing contract migration validation passed (no legacy values)');
}
