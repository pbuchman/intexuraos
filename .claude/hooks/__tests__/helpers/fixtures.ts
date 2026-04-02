/**
 * Builder for creating mock hook input JSON
 * Hooks receive JSON via stdin with structure: { tool_name: string, tool_input: {...} }
 */

export interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  transcript_path?: string;
}

export interface BashInput extends HookInput {
  tool_name: 'Bash';
  tool_input: { command: string };
}

export interface EditInput extends HookInput {
  tool_name: 'Edit';
  tool_input: {
    file_path: string;
    old_string: string;
    new_string: string;
  };
}

export interface WriteInput extends HookInput {
  tool_name: 'Write';
  tool_input: {
    file_path: string;
    content: string;
  };
}

export interface SessionStartInput {
  session_type: 'SessionStart';
}

export interface LinearUpdateIssueInput extends HookInput {
  tool_name: 'mcp__linear__update_issue' | 'mcp__linear-server__update_issue';
  tool_input: {
    id: string;
    state?: string;
    [key: string]: unknown;
  };
}

export interface LinearSaveIssueInput extends HookInput {
  tool_name: 'mcp__linear__save_issue' | 'mcp__linear-server__save_issue';
  tool_input: {
    id?: string;
    state?: string;
    assignee?: string;
    delegate?: string;
    [key: string]: unknown;
  };
}

/**
 * Builder for creating hook input fixtures
 */
export const HookFixtureBuilder = {
  /**
   * Creates a Bash tool input fixture
   */
  bash(command: string): BashInput {
    return {
      tool_name: 'Bash',
      tool_input: { command },
    };
  },

  /**
   * Creates an Edit tool input fixture
   */
  edit(file_path: string, edits: { old_string: string; new_string: string }): EditInput {
    return {
      tool_name: 'Edit',
      tool_input: {
        file_path,
        old_string: edits.old_string,
        new_string: edits.new_string,
      },
    };
  },

  /**
   * Creates a Write tool input fixture
   */
  write(file_path: string, content: string): WriteInput {
    return {
      tool_name: 'Write',
      tool_input: {
        file_path,
        content,
      },
    };
  },

  /**
   * Creates a SessionStart input fixture
   */
  sessionStart(): SessionStartInput {
    return {
      session_type: 'SessionStart',
    } as SessionStartInput;
  },

  /**
   * Creates a Linear update_issue MCP tool input fixture
   */
  linearUpdateIssue(
    id: string,
    updates: { state?: string; [key: string]: unknown } = {}
  ): LinearUpdateIssueInput {
    return {
      tool_name: 'mcp__linear__update_issue',
      tool_input: { id, ...updates },
    };
  },

  /**
   * Creates a Linear update_issue MCP tool input fixture (alternate server)
   */
  linearServerUpdateIssue(
    id: string,
    updates: { state?: string; [key: string]: unknown } = {}
  ): LinearUpdateIssueInput {
    return {
      tool_name: 'mcp__linear-server__update_issue',
      tool_input: { id, ...updates },
    };
  },

  /**
   * Creates a Linear save_issue MCP tool input fixture
   */
  linearSaveIssue(
    fields: { id?: string; state?: string; assignee?: string; delegate?: string; [key: string]: unknown } = {}
  ): LinearSaveIssueInput {
    return {
      tool_name: 'mcp__linear__save_issue',
      tool_input: { ...fields },
    };
  },

  /**
   * Creates a transcript path input for ownership-check hook
   */
  withTranscript(baseInput: HookInput, transcriptPath: string): HookInput {
    return {
      ...baseInput,
      transcript_path: transcriptPath,
    };
  },

  /**
   * Converts any input to JSON string for stdin
   */
  toJSON(input: HookInput | SessionStartInput): string {
    return JSON.stringify(input);
  },
};

/**
 * Pre-built fixture patterns for common scenarios
 */
export const Fixtures = {
  // Polling patterns (should be BLOCKED by validate-polling.sh)
  polling: {
    sleepWithGhChecks: HookFixtureBuilder.bash('sleep 60 && gh pr checks 682'),
    whileLoopWithGhChecks: HookFixtureBuilder.bash(
      'while true; do gh pr checks 123; sleep 60; done'
    ),
    sleepWithGcloudDescribe: HookFixtureBuilder.bash(
      'sleep 300 && gcloud builds describe 12345 --format="value(status)"'
    ),
  },

  // Correct streaming patterns (should be ALLOWED)
  streaming: {
    ghWatch: HookFixtureBuilder.bash('gh pr checks 682 --watch'),
    ghRunWatch: HookFixtureBuilder.bash('gh run watch 12345'),
    gcloudStream: HookFixtureBuilder.bash('gcloud builds log 12345 --stream --region=us-central1'),
  },

  // Coverage command patterns (should be BLOCKED by validate-coverage-commands.sh)
  coverageBad: {
    grepCoverage: HookFixtureBuilder.bash('pnpm test:coverage | grep -E "Lines|Branches"'),
    tailCoverage: HookFixtureBuilder.bash('pnpm coverage 2>&1 | tail -20'),
  },

  // Correct coverage query (should be ALLOWED)
  coverageGood: {
    jqSummary: HookFixtureBuilder.bash('jq .total.branches.pct coverage/coverage-summary.json'),
  },

  // CI output capture bad patterns
  ciCaptureBad: {
    headOutput: HookFixtureBuilder.bash('pnpm ci | head -50'),
    tailOutput: HookFixtureBuilder.bash('pnpm ci 2>&1 | tail -20'),
  },

  // Good CI output capture
  ciCaptureGood: {
    teeOutput: HookFixtureBuilder.bash('pnpm ci 2>&1 | tee /tmp/ci-output.txt'),
  },

  // Bad vitest flags
  vitestBad: {
    coverageReporter: HookFixtureBuilder.bash('vitest run --coverage.reporter=text'),
    doubleDashCoverage: HookFixtureBuilder.bash('pnpm test -- --coverage'),
  },

  // Good vitest usage
  vitestGood: {
    coverageScript: HookFixtureBuilder.bash('pnpm test:coverage'),
  },

  // TypeScript code patterns with common mistakes
  codePatterns: {
    // Missing .js extension in ESM imports
    missingJsExtension: `import { foo } from "./local"
import { bar } from '../utils/helper'

export const test = foo`,

    // Good imports with .js extension
    goodImports: `import { foo } from "./local.js"
import { bar } from '../utils/helper.js'

export const test = foo`,

    // Bad | undefined type annotation
    badUndefined: `interface User {
  name: string
  age: number | undefined
  email: string | undefined
}`,

    // Good optional properties
    goodOptional: `interface User {
  name: string
  age?: number
  email?: string
}`,

    // Result.value access without .ok check
    resultValueWithoutOk: `const result = await repo.find(id)
return result.value
`,

    // Good Result access with narrowing
    resultValueWithOk: `const result = await repo.find(id)
if (!result.ok) return result
return result.value
`,

    // Ownership-violating language
    ownershipViolations: `I found that this was a pre-existing issue.
The code was already broken when I got here.
This is a legacy issue that we can ignore.
CI should now pass after my changes.`,

    // Good ownership language
    ownershipGood: `CI failed with type errors. Fixing them now.
Found 3 coverage gaps. Writing tests to resolve.
The build is failing due to missing dependencies.`,
  },
} as const;
