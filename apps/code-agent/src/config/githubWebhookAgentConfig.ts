export interface GitHubWebhookAgentConfig {
  /** Master switch — disables all agent processing when false. */
  enabled: boolean;
  /** Stage 1: Log decisions without acting. */
  observeOnly: boolean;
  /** Stage 2: Send notifications but skip execution. */
  notifyOnly: boolean;
  /** Stage 3: Post GitHub comments from action plans. */
  executeComments: boolean;
  /** Stage 4: Agent owns the "processing" reaction/marker on webhook events. */
  ownsProcessingMarker: boolean;
  /** Stage 5: Agent owns the final summary reply on webhook events. */
  ownsFinalReply: boolean;
}

const FLAG_DEFS: readonly {
  key: keyof GitHubWebhookAgentConfig;
  env: string;
  defaultValue: boolean;
}[] = [
  { key: 'enabled', env: 'INTEXURAOS_GH_AGENT_ENABLED', defaultValue: false },
  { key: 'observeOnly', env: 'INTEXURAOS_GH_AGENT_OBSERVE_ONLY', defaultValue: true },
  { key: 'notifyOnly', env: 'INTEXURAOS_GH_AGENT_NOTIFY_ONLY', defaultValue: false },
  { key: 'executeComments', env: 'INTEXURAOS_GH_AGENT_EXECUTE_COMMENTS', defaultValue: false },
  { key: 'ownsProcessingMarker', env: 'INTEXURAOS_GH_AGENT_OWNS_PROCESSING_MARKER', defaultValue: false },
  { key: 'ownsFinalReply', env: 'INTEXURAOS_GH_AGENT_OWNS_FINAL_REPLY', defaultValue: false },
];

function parseStrictBoolean(value: string, envName: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new Error(
    `Invalid boolean value for ${envName}: "${value}". Expected "true" or "false".`
  );
}

export function loadGitHubWebhookAgentConfig(): GitHubWebhookAgentConfig {
  const config = {} as Record<string, boolean>;

  for (const def of FLAG_DEFS) {
    const raw = process.env[def.env];
    if (raw === undefined) {
      config[def.key] = def.defaultValue;
    } else {
      config[def.key] = parseStrictBoolean(raw, def.env);
    }
  }

  return config as unknown as GitHubWebhookAgentConfig;
}
