const MEMORY_ELIGIBLE_AGENTS = new Set(['execution', 'planning', 'review', 'remediation', 'pull_request']);

export function isMemoryEligibleAgent(
  agentType: string | undefined // @allow-undefined-type -- mirrors existing CodeTask.agentType
): boolean {
  return agentType !== undefined && MEMORY_ELIGIBLE_AGENTS.has(agentType);
}
