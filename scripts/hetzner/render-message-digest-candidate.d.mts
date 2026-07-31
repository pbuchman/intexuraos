export interface CandidateApp {
  name: string;
  env: Record<string, string> & { PORT: string };
  [key: string]: unknown;
}

export function renderMessageDigestCandidateConfig(config: {
  apps: Array<Record<string, unknown>>;
}): { apps: CandidateApp[] };
