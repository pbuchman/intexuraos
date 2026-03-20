import type { ServiceInfo } from '@/types';

export type ServiceTool = ServiceInfo['tools'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildTemplateValue(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return {};
  }

  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return enumValues[0];
  }

  const type = schema['type'];

  if (type === 'object' || (type === undefined && isRecord(schema['properties']))) {
    const properties = isRecord(schema['properties']) ? schema['properties'] : {};
    return Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, buildTemplateValue(value)]),
    );
  }

  if (type === 'array') {
    return [];
  }

  if (type === 'boolean') {
    return false;
  }

  if (type === 'integer' || type === 'number') {
    return 0;
  }

  return '';
}

export function buildToolInstructionBlock(tool: ServiceTool): string {
  const template = buildTemplateValue(tool.parameters);
  return `Preferred tool: ${tool.name}
Arguments template:
${JSON.stringify(template, null, 2)}`;
}

export function injectToolInstructionBlock(
  currentInstruction: string,
  tool: ServiceTool,
): string {
  const marker = `Preferred tool: ${tool.name}`;
  if (currentInstruction.includes(marker)) {
    return currentInstruction;
  }

  const block = buildToolInstructionBlock(tool);
  const trimmed = currentInstruction.trim();

  return trimmed === '' ? block : `${currentInstruction.trimEnd()}\n\n${block}`;
}

export function addPreferredTool(
  preferredTools: string[],
  toolName: string,
): string[] {
  return preferredTools.includes(toolName)
    ? preferredTools
    : [...preferredTools, toolName];
}

export function removePreferredTool(
  preferredTools: string[],
  toolName: string,
): string[] {
  return preferredTools.filter((preferredTool) => preferredTool !== toolName);
}

export function filterPreferredToolsForServices(
  preferredTools: string[],
  selectedServiceKeys: Set<string>,
  services: ServiceInfo[],
): string[] {
  const allowedTools = new Set(
    services
      .filter((service) => selectedServiceKeys.has(service.key))
      .flatMap((service) => service.tools.map((tool) => tool.name)),
  );

  return preferredTools.filter((toolName) => allowedTools.has(toolName));
}
