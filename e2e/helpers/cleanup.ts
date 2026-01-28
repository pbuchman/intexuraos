/**
 * Cleanup helpers for E2E tests.
 *
 * Provides utilities to clean up GitHub resources created during testing.
 */

import { execSync } from 'node:child_process';
import type { CodeTask } from './client.js';

/**
 * Delete a git branch using gh CLI.
 *
 * @param branchName - Branch name to delete
 * @param repoPath - Path to repository (default: current directory)
 */
export function deleteBranch(branchName: string, repoPath = process.cwd()): void {
  try {
    // Use git push with --delete
    execSync(`git push origin --delete ${branchName}`, {
      cwd: repoPath,
      stdio: 'pipe',
    });
  } catch {
    // Silently fail - cleanup is best-effort
  }
}

/**
 * Close a pull request using gh CLI.
 *
 * @param prUrl - Full URL of the PR
 * @param repoPath - Path to repository (default: current directory)
 */
export function closePR(prUrl: string, repoPath = process.cwd()): void {
  try {
    // Extract PR number from URL
    // Format: https://github.com/owner/repo/pull/123
    const match = /\/pull\/(\d+)$/.exec(prUrl);
    if (match === null) {
      return;
    }

    const prNumber = match[1] ?? '0'; // Fallback if somehow undefined

    // Close PR with comment
    execSync(
      `gh pr close ${prNumber} --comment "E2E test cleanup: Auto-closing test PR" --delete-branch=false`,
      {
        cwd: repoPath,
        stdio: 'pipe',
      }
    );
  } catch {
    // Silently fail - cleanup is best-effort
  }
}

/**
 * Clean up multiple branches.
 *
 * @param branchNames - Array of branch names to delete
 * @param repoPath - Path to repository
 */
export function cleanupBranches(branchNames: string[], repoPath = process.cwd()): void {
  for (const branch of branchNames) {
    deleteBranch(branch, repoPath);
  }
}

/**
 * Clean up multiple PRs.
 *
 * @param prUrls - Array of PR URLs to close
 * @param repoPath - Path to repository
 */
export function cleanupPRs(prUrls: string[], repoPath = process.cwd()): void {
  for (const prUrl of prUrls) {
    if (prUrl !== '') {
      closePR(prUrl, repoPath);
    }
  }
}

/**
 * Clean up resources from a completed task.
 *
 * @param task - Code task with results
 * @param repoPath - Path to repository
 */
export function cleanupTask(task: CodeTask, repoPath = process.cwd()): void {
  if (task.result?.branch !== undefined) {
    deleteBranch(task.result.branch, repoPath);
  }
  if (task.result?.prUrl !== undefined && task.result.prUrl !== '') {
    closePR(task.result.prUrl, repoPath);
  }
}

/**
 * Clean up resources from multiple tasks.
 *
 * @param tasks - Array of code tasks
 * @param repoPath - Path to repository
 */
export function cleanupTasks(tasks: CodeTask[], repoPath = process.cwd()): void {
  for (const task of tasks) {
    cleanupTask(task, repoPath);
  }
}

/**
 * Get all test branches for cleanup.
 * Looks for branches with test/e2e- prefix.
 *
 * @param repoPath - Path to repository
 * @returns Array of branch names
 */
export function getTestBranches(repoPath = process.cwd()): string[] {
  try {
    const output = execSync('git branch -r --list "origin/test/e2e-*"', {
      cwd: repoPath,
      stdio: 'pipe',
    });

    const branches = output
      .toString()
      .trim()
      .split('\n')
      .map((line) => line.replace('origin/', '').trim())
      .filter(Boolean);

    return branches;
  } catch {
    return [];
  }
}

/**
 * Clean up all test branches (utility function for manual cleanup).
 *
 * @param repoPath - Path to repository
 */
export function cleanupAllTestBranches(repoPath = process.cwd()): void {
  const branches = getTestBranches(repoPath);
  cleanupBranches(branches, repoPath);
}
