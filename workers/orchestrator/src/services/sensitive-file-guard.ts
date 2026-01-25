import { minimatch } from 'minimatch';

export interface GuardResult {
  reverted: string[];
  remaining: string[];
  allSensitive: boolean;
}

export class SensitiveFileGuard {
  private readonly patterns: string[];

  constructor() {
    this.patterns = [
      '**/.env',
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
    const { execSync } = await import('node:child_process');

    // Get changed files in this commit
    const result = execSync(`git diff --name-only HEAD~${String(commitCount)} HEAD`, {
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
          execSync(`git checkout HEAD~${String(commitCount)} -- "${file}"`, {
            cwd: worktreePath,
          });
          reverted.push(file);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Failed to revert ${file}:`, error);
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
