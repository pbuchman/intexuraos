/**
 * HTTP-level shapes for the GitHub webhook endpoint.
 *
 * These types describe the minimal headers and body fields the route reads
 * from the Fastify request. The route validates nothing beyond what GitHub
 * guarantees; deeper parsing happens in `infra/github-event-parser.ts`.
 */

export interface GitHubWebhookHeaders {
  'x-hub-signature-256': string;
  'x-github-event': string;
}

export interface GitHubWebhookBody {
  action?: string;
  repository?: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
    };
  };
  pull_request?: {
    id: number;
    number: number;
    title?: string;
    body?: string | null;
    state?: string;
    closed_at?: string | null;
    merged_at?: string | null;
  };
  sender?: {
    login: string;
    id: number;
    type?: string;
  };
}
