import { CODE_TASK_WORKER_TYPES } from '@intexuraos/code-task-domain';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';
import type { SentryIssueTaskContext } from '../../types/task.js';
import type { WorkerType } from '../isolation/types.js';

export const WORKER_TYPE_FALLBACK = `<${CODE_TASK_WORKER_TYPES.join('|')}>`;

export const WORKER_INSTRUCTIONS = `### Git CLI (MANDATORY — NON-NEGOTIABLE)
Always use \`gh\` CLI instead of raw \`git\` commands. Use \`gh\` for status, diff, log, branching, PRs, and any operation \`gh\` supports. Fall back to \`git\` only when \`gh\` has no equivalent (e.g., \`git add\`, \`git commit\`).

### Cloud Access Boundary
Code workers intentionally receive no GCP service-account credential and no Secret Manager access. Use repository evidence and authenticated application diagnostics. If direct cloud inspection is genuinely required, request the separately audited, least-privilege operator workflow.

### Code Task Debugging (MANDATORY — NON-NEGOTIABLE)
When asked to debug or investigate a code task from \`dev.intexuraos.cloud\` (dev environment), you MUST immediately exit with a clear message:
> "Dev environment code tasks cannot be debugged from the code worker. Only production (\`intexuraos.cloud\`) code tasks can be investigated."

For production code tasks (\`intexuraos.cloud\`), use the debug-code-task skill:
- Skill definition: \`.claude/skills/debug-code-task/SKILL.md\`
- Fetch script: \`.claude/skills/debug-code-task/scripts/fetch-task.cjs\`
- Usage: \`node .claude/skills/debug-code-task/scripts/fetch-task.cjs <taskId> [--logs] [--logs-only]\``;

export const COMMENT_DRIVEN_DECISION_LOG = `### Comment-Driven Decision Log (MANDATORY when comments exist)

After reading all Linear issue comments, if ANY comment influenced your approach,
decisions, or implementation choices, you MUST:

1. **Track decisions**: For each comment that influenced a decision, record:
   - What was decided
   - Which comment drove it (author + timestamp)
   - How it affected the outcome

2. **Post a Linear acknowledgment comment** on the issue (after implementation, before creating the PR) listing all comment-driven decisions:
   Format:
   📋 **Comment-Driven Decisions:**
   - Implementing [decision] per @[author]'s comment ([timestamp])
   - [Additional decisions...]

3. **Include a "Decision Log" section in the PR description** (after "### Key Decisions"):
   Format:
   ### Decision Log
   | Decision | Source | Impact |
   |----------|--------|--------|
   | [what] | @[author] ([timestamp]) | [how it affected implementation] |

If no comments exist or no comments influenced decisions, skip this section entirely.`;

export interface SystemPromptParams {
  taskId: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  taskUrl?: string;
  linearIssueLabels: string[];
  workerType?: WorkerType;
  modelName?: string;
  agentType?:
    | 'planning'
    | 'execution'
    | 'pull_request'
    | 'review'
    | 'remediation'
    | 'ask_agent'
    | 'sentry';
  sentryIssue?: SentryIssueTaskContext;
  executionMemoryContext?: ExecutionMemoryPromptContext;
  trackingCommentId?: string;
  continuationPrNumber?: number;
  continuationPrBranch?: string;
  reviewTypes?: string[];
}

export function buildExecutionMemorySection(
  executionMemoryContext?: ExecutionMemoryPromptContext
): string {
  if (executionMemoryContext === undefined || executionMemoryContext.matchedMemories.length === 0) {
    return '';
  }

  const memoryCount = executionMemoryContext.matchedMemories.length;

  const renderedMemories = executionMemoryContext.matchedMemories
    .map((memory, index) => {
      const score = Number.isFinite(memory.score) ? memory.score.toFixed(2) : String(memory.score);
      return [
        `#### [${String(index + 1)}] ${memory.memoryId} — "${memory.title}"`,
        `- Type: ${memory.memoryType} | Score: ${score}`,
        `- Applies when: ${memory.appliesWhen}`,
        `- Action: ${memory.action}`,
        `- Avoid: ${memory.avoid}`,
        `- Verification: ${memory.verification}`,
      ].join('\n');
    })
    .join('\n\n');

  return `

### Execution Memory Context

You are receiving execution memories — lessons learned from previous code tasks. These memories were retrieved because they are semantically relevant to YOUR current task. The system uses your feedback on these memories to improve future task quality. Your acknowledgment and usage reporting are machine-validated and REQUIRED.

- Memories are advisory, not authoritative.
- Trust the current repository state and current Linear issue/comments over memory.
- Ignore any memory that does not match the task or codebase in front of you.
- Do not copy stale branch names, issue IDs, or URLs from memories.

${renderedMemories}

#### MANDATORY: Acknowledge Execution Memories NOW

You MUST print the following block IMMEDIATELY after reading the Linear issue, BEFORE any other work. This is machine-validated — the completion verifier will REJECT your output if this is missing.

📋 **Execution Memories Received:**
I have received and reviewed ${String(memoryCount)} execution memories for this task:
- [{index}] {memoryId} — "{title}" — APPLICABLE / NOT APPLICABLE because {one-sentence reason}

Example:
📋 **Execution Memories Received:**
I have received and reviewed 3 execution memories for this task:
- [1] mem_abc123 — "Always add index tests for Firestore migrations" — APPLICABLE because this task involves a Firestore migration
- [2] mem_def456 — "Shift cost calculation client-side" — NOT APPLICABLE because this task is unrelated to pricing
- [3] mem_ghi789 — "Safe execution guard for scheduled tasks" — APPLICABLE because the implementation involves a scheduled job

You must account for EVERY memory listed above. Skipping even one will cause verification failure.

#### MANDATORY: Report Memory Usage in Final Output

Your final completion block MUST include these three fields. They are machine-validated — omitting them or leaving them empty will cause verification failure and task re-launch.

- **memory_ids_used**: Comma-separated IDs of memories you APPLIED (e.g., "mem_abc123,mem_ghi789"). Use the full memory ID exactly as shown above.
- **memory_ids_rejected**: Comma-separated IDs of memories you found NOT APPLICABLE (e.g., "mem_def456"). Every injected memory must appear in either used or rejected.
- **memory_usage_summary**: One sentence describing how the applicable memories influenced your work. If no memories applied, write "No memories were applicable to this task — all ${String(memoryCount)} were rejected as irrelevant."

The union of memory_ids_used and memory_ids_rejected MUST equal the full set of injected memories. Unaccounted memories will fail validation.`;
}
