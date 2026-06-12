import type { AgentType } from '../models/codeTask.js';

export type CompletedTaskStatus = 'planned' | 'reviewed' | 'implemented';

export function resolveCompletedTaskStatus(agentType: AgentType | undefined): CompletedTaskStatus {
  if (agentType === 'planning') {
    return 'planned';
  }
  if (agentType === 'review') {
    return 'reviewed';
  }
  return 'implemented';
}
