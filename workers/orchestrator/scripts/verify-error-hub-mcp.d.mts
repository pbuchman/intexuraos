export interface ErrorHubMcpVerificationConfig {
  readonly eventId: string;
  readonly host: string;
  readonly image: string;
  readonly issueId: string;
  readonly issueUrl: string;
}

export interface ErrorHubMcpEvidence {
  readonly environment: string;
  readonly eventId: string;
  readonly mcpName: string;
  readonly mcpVersion: string;
  readonly project: string;
  readonly release: string;
  readonly stack: string;
  readonly title: string;
  readonly tools: readonly ['get_issue_details', 'search_issue_events'];
}

export function parseVerificationConfiguration(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>
): ErrorHubMcpVerificationConfig;

export function buildDockerArguments(
  config: ErrorHubMcpVerificationConfig,
  containerName: string
): string[];

export function parseErrorHubMcpEntry(jsonText: string): {
  readonly args: readonly string[];
  readonly command: string;
};

export function validateMcpEvidence(input: {
  readonly initializeResult: unknown;
  readonly detailsResult: unknown;
  readonly searchResult: unknown;
  readonly expectedEventId: string;
}): ErrorHubMcpEvidence;

export function verifyErrorHubMcp(
  config: ErrorHubMcpVerificationConfig
): Promise<{ readonly issueUrl: string } & ErrorHubMcpEvidence>;
