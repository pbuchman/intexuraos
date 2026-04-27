import { minimatch } from 'minimatch';
import type { Logger } from '@intexuraos/common-core';

export interface GuardResult {
  reverted: string[];
  remaining: string[];
  allSensitive: boolean;
}

export class SensitiveFileGuard {
  private readonly patterns: string[];

  constructor(private readonly logger: Logger) {
    this.patterns = [
      '**/.env',
      '**/.envrc',
      '**/.envrc.local',
      '**/.env.*',
      '**/credentials.json',
      '**/serviceAccountKey.json',
      '**/*.pem',
      '**/*.key',
      '**/secrets/**',
      '**/.git/config',
      '**/terraform.tfstate',
      '**/terraform.tfstate.backup',
      '**/*.tf',
      '**/state.json',
      '**/*.json.gpg',
      '**/secrets.acc',
      '**/key.json',
      '**/private_key',
      '**/id_rsa',
      '**/client_secret',
      '**/.aws/credentials',
      '**/.gcproj',
    ];
  }

  isSensitive(filePath: string): boolean {
    return this.patterns.some((pattern) => minimatch(filePath, pattern));
  }

  async checkAndRevert(worktreePath: string, commitCount: number): Promise<GuardResult> {
    const { execFileSync } = await import('node:child_process');

    const baseRef = `HEAD~${String(commitCount)}`;

    // Get changed files in this commit range. `git diff` accepts `HEAD~N` as a single
    // revision token; we pass it as one argv element so no shell parses it.
    const result = execFileSync('git', ['diff', '--name-only', baseRef, 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf-8',
    });

    const changedFiles = result.trim().split('\n').filter(Boolean);

    const reverted: string[] = [];
    const remaining: string[] = [];

    for (const file of changedFiles) {
      if (this.isSensitive(file)) {
        // Revert the file
        try {
          // `--` separates revisions from pathspecs; `file` is a literal argv element.
          execFileSync('git', ['checkout', baseRef, '--', file], { cwd: worktreePath });
          reverted.push(file);
        } catch (error) {
          this.logger.error({ file, error }, 'Failed to revert sensitive file');
          remaining.push(file);
        }
      } else {
        remaining.push(file);
      }
    }

    return {
      reverted,
      remaining,
      allSensitive: remaining.length === 0 && reverted.length > 0,
    };
  }
}
