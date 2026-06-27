export const INTEX_AGENT_CAPABILITIES = [
  'create notes',
  'create and look up calendar events',
  'create research drafts',
  'save bookmarks',
  'create code tasks for planning or execution',
] as const;

export function buildCapabilitiesReply(intro: string): string {
  return [intro, ...INTEX_AGENT_CAPABILITIES.map((capability) => `- ${capability}`)].join('\n');
}

export function buildUnsupportedCapabilitiesReply(): string {
  return buildCapabilitiesReply('I could not safely handle that request. I can help with:');
}

export function buildCompletionFailureCapabilitiesReply(): string {
  return buildCapabilitiesReply('I could not complete that request right now. I can help with:');
}

export function buildNewSessionReadyText(): string {
  return buildCapabilitiesReply('What would you like me to help with? I can help with:');
}
