import { z } from 'zod';

/** Canonical list of agent types the verifier recognizes. */
export type CompletionAgentType =
  | 'planning'
  | 'execution'
  | 'pull_request'
  | 'review'
  | 'remediation'
  | 'ask_agent'
  | 'sentry';

export const RESUME_SUMMARY_SCHEMA = z.object({
  summary: z.string(),
});
