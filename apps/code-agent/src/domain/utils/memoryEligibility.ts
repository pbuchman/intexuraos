const MEMORY_ELIGIBLE_AGENTS = new Set(['execution', 'planning', 'review']);

export function isMemoryEligibleAgent(
  agentType: string | undefined // @allow-undefined-type -- mirrors existing CodeTask.agentType
): boolean {
  return agentType !== undefined && MEMORY_ELIGIBLE_AGENTS.has(agentType);
}
