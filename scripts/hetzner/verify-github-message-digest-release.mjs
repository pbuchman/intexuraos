#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  deriveMessageDigestMigrationId,
  verifyReleaseAttestation,
} from './message-digest-cutover-support.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export async function verifyGithubMessageDigestRelease(options = {}) {
  const environment = options.environment ?? process.env;
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const git = options.git ?? ((args) => execFileSync('git', args, { encoding: 'utf8' }).trim());
  const repository = required(environment.GITHUB_REPOSITORY, REPOSITORY_PATTERN);
  const mergeSha = required(environment.GITHUB_SHA, SHA_PATTERN);
  const token = required(environment.GH_TOKEN ?? environment.GITHUB_TOKEN, /^.{1,8192}$/u);
  if (typeof fetchImplementation !== 'function') throw safeError('CUTOVER_GITHUB_CONFIG_INVALID');

  const pulls = await githubJson(
    fetchImplementation,
    token,
    `https://api.github.com/repos/${repository}/commits/${mergeSha}/pulls`
  );
  if (!Array.isArray(pulls)) throw safeError('CUTOVER_ASSOCIATED_PR_INVALID');
  const matchingPulls = pulls.filter(
    (pull) =>
      isRecord(pull) &&
      pull.merged_at !== null &&
      pull.merge_commit_sha === mergeSha &&
      isRecord(pull.head) &&
      typeof pull.head.sha === 'string' &&
      SHA_PATTERN.test(pull.head.sha)
  );
  if (matchingPulls.length !== 1) throw safeError('CUTOVER_ASSOCIATED_PR_INVALID');
  const pull = matchingPulls[0];
  const prHeadSha = pull.head.sha;
  const [headCommit, mergeCommit] = await Promise.all([
    githubJson(
      fetchImplementation,
      token,
      `https://api.github.com/repos/${repository}/git/commits/${prHeadSha}`
    ),
    githubJson(
      fetchImplementation,
      token,
      `https://api.github.com/repos/${repository}/git/commits/${mergeSha}`
    ),
  ]);
  const prHeadTree = readTreeSha(headCommit);
  const mergeTree = readTreeSha(mergeCommit);
  const localMergeTree = git(['rev-parse', `${mergeSha}^{tree}`]);
  if (localMergeTree !== mergeTree) throw safeError('CUTOVER_TREE_MISMATCH');
  const verified = verifyReleaseAttestation({
    mergeSha,
    mergeTree,
    prHeadSha,
    prHeadTree,
    prHeadCommitMessage: headCommit.message,
    stagedTree: localMergeTree,
  });
  return {
    ...verified,
    migrationId: deriveMessageDigestMigrationId(mergeSha),
    prNumber: pull.number,
  };
}

async function githubJson(fetchImplementation, token, url) {
  let response;
  try {
    response = await fetchImplementation(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw safeError('CUTOVER_GITHUB_UNAVAILABLE');
  }
  if (!response?.ok) throw safeError('CUTOVER_GITHUB_UNAVAILABLE');
  try {
    return await response.json();
  } catch {
    throw safeError('CUTOVER_GITHUB_RESPONSE_INVALID');
  }
}

function readTreeSha(commit) {
  if (
    !isRecord(commit) ||
    typeof commit.message !== 'string' ||
    !isRecord(commit.tree) ||
    typeof commit.tree.sha !== 'string' ||
    !SHA_PATTERN.test(commit.tree.sha)
  ) {
    throw safeError('CUTOVER_GITHUB_RESPONSE_INVALID');
  }
  return commit.tree.sha;
}

function required(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw safeError('CUTOVER_GITHUB_CONFIG_INVALID');
  }
  return value;
}

function safeError(code) {
  return new Error(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath !== null && entryPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyGithubMessageDigestRelease();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'CUTOVER_RELEASE_ATTESTATION_FAILED';
    process.stderr.write(
      `${/^[A-Z0-9_]+$/u.test(code) ? code : 'CUTOVER_RELEASE_ATTESTATION_FAILED'}\n`
    );
    process.exitCode = 1;
  }
}
