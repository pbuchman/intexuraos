import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';

const RetryOctokit = Octokit.plugin(retry);

export function createRetryOctokit(jwt: string): InstanceType<typeof RetryOctokit> {
  return new RetryOctokit({
    auth: jwt,
    request: { retries: 3 },
  });
}
