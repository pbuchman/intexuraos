import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../system-prompt.js';

describe('system-prompt', () => {
  describe('buildSystemPrompt', () => {
    const baseParams = {
      taskId: 'task-123',
      linearIssueId: 'INT-123',
      linearIssueLabels: [] as string[],
      hasChildren: false,
      workerType: 'auto' as const,
    };

    describe('Phase 1: Design & Validation', () => {
      it('should return Phase 1 prompt when code-task label is absent', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['bug', 'high-priority'],
        });

        expect(result).toContain('[PHASE 1: DESIGN & VALIDATION - IN-PLACE MODEL]');
        expect(result).toContain('Design Agent');
        expect(result).toContain('DO NOT EXECUTE CODE');
      });

      it('should include system context in Phase 1', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('Task ID: task-123');
        expect(result).toContain('Worktree: /repo');
        expect(result).toContain('Linear Issue: INT-123');
      });

      it('should include mandatory outputs in Phase 1', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('Enrich Linear Issue Description');
        expect(result).toContain('Unified Issue Template');
        expect(result).toContain('Create Subissues (if complex)');
        expect(result).toContain('code-task');
      });

      it('should include design documentation section in Phase 1', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('Design Documentation (Non-Trivial Designs)');
        expect(result).toContain('docs/plans/INT-123-design.md');
        expect(result).toContain('/share');
      });

      it('should include completion criteria in Phase 1', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('After enriching the issue and adding EITHER');
        expect(result).toContain('PHASE1_FINAL:');
        expect(result).toContain('- Linear label set: <code-task|unclear>');
        expect(result).toContain('- Phase 2 ready: <yes|no>');
      });

      it('should include WORKER-MODE marker in Phase 1', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('[WORKER-MODE]');
      });

      it('should include PHASE:1 marker in Phase 1', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('[PHASE:1]');
      });

      it('should mention both code-task and unclear labels in Phase 1', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('code-task');
        expect(result).toContain('unclear');
      });

      it('should not include user supplemental instructions section', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).not.toContain('[USER SUPPLEMENTAL INSTRUCTIONS]');
      });

      it('should handle missing Linear issue ID in Phase 1', () => {
        // Omit linearIssueId entirely (exactOptionalPropertyTypes doesn't allow explicit undefined)
        const { linearIssueId: _, ...paramsWithoutIssueId } = baseParams;
        void _;
        const result = buildSystemPrompt({
          ...paramsWithoutIssueId,
          linearIssueLabels: [],
        });

        expect(result).toContain('[PHASE 1: DESIGN & VALIDATION - IN-PLACE MODEL]');
        expect(result).not.toContain('\nLinear Issue: ');
        expect(result).toContain('INT-UNKNOWN');
      });
    });

    describe('Phase 2: Strict Execution', () => {
      it('should return Phase 2 prompt when code-task label is present', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('[PHASE 2: STRICT EXECUTION]');
        expect(result).toContain('NON-INTERACTIVE MODE');
      });

      it('should include mandatory first action in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('/linear INT-123');
      });

      it('should include execution rules in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('MANDATORY First Action');
        expect(result).toContain('Execution Checkpoints');
        expect(result).toContain('ci:tracked');
        expect(result).toContain('On CI Failure');
      });

      it('should include mandatory planning skill in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('MANDATORY Planning');
        expect(result).toContain('superpowers:writing-plans');
      });

      it('should include mandatory implementation skill in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('MANDATORY Implementation');
        expect(result).toContain('superpowers:executing-plans');
      });

      it('should include parent execution mode when hasChildren is true', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
          hasChildren: true,
        });

        expect(result).toContain('[PARENT EXECUTION MODE]');
        expect(result).toContain('must execute ALL children continuously');
        expect(result).toContain('Use single branch for all children');
        expect(result).toContain('PR description MUST list all children');
      });

      it('should not include parent execution mode when hasChildren is false', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
          hasChildren: false,
        });

        expect(result).not.toContain('[PARENT EXECUTION MODE]');
        expect(result).not.toContain('child issue');
      });

      it('should not include user supplemental instructions section in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).not.toContain('[USER SUPPLEMENTAL INSTRUCTIONS]');
      });

      it('should include WORKER-MODE marker in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('[WORKER-MODE]');
      });

      it('should include PHASE:2 marker in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('[PHASE:2]');
      });

      it('should include code review loop in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('MANDATORY Code Review');
        expect(result).toContain('superpowers:requesting-code-review');
      });

      it('should include review loop iteration rules in Phase 2', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        // Iteration rules are now delegated to superpowers:requesting-code-review skill
        expect(result).toContain('superpowers:requesting-code-review');
        expect(result).toContain("Follow that skill's process");
      });

      it('should include review iterations and turn summary in PHASE2_FINAL', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('- Review iterations: <number>');
        expect(result).toContain('- Turn summary:');
      });

      it('should require worker type in Phase 2 PR description format', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });

        expect(result).toContain('3. **Worker type**');
        expect(result).toContain('- Worker Type: `auto`');
      });
    });

    describe('PR Comment Execution Mode', () => {
      it('should return PR comment prompt when pr-comment label is present', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task', 'pr-comment'],
        });

        expect(result).toContain('[PR COMMENT EXECUTION MODE]');
        expect(result).toContain('[PHASE:PR-COMMENT]');
        expect(result).not.toContain('[PHASE 1: DESIGN & VALIDATION');
        expect(result).not.toContain('[PHASE 2: STRICT EXECUTION]');
      });

      it('should prioritize pr-comment over code-task', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task', 'pr-comment'],
        });

        expect(result).toContain('[PR COMMENT EXECUTION MODE]');
        expect(result).not.toContain('[PHASE 2: STRICT EXECUTION]');
      });

      it('should include PR_COMMENT_FINAL completion block', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['pr-comment'],
        });

        expect(result).toContain('PR_COMMENT_FINAL:');
        expect(result).toContain('- Comment replied: <yes|no>');
      });

      it('should include mandatory first actions for PR investigation', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['pr-comment'],
        });

        expect(result).toContain('gh pr view');
        expect(result).toContain('gh pr diff');
        expect(result).toContain('Push to the existing PR branch');
      });

      it('should include Linear issue reference when provided', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueId: 'INT-500',
          linearIssueLabels: ['pr-comment'],
        });

        expect(result).toContain('Linear Issue: INT-500');
      });

      it('should include NON-INTERACTIVE MODE instruction', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['pr-comment'],
        });

        expect(result).toContain('NON-INTERACTIVE MODE');
        expect(result).toContain('No Confirmation Prompts');
      });

      it('should require worker type in PR description updates', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['pr-comment'],
        });

        expect(result).toContain('3. **Worker type:**');
        expect(result).toContain('`auto`');
      });
    });

    describe('Label Detection', () => {
      it('should detect Phase 1 when labels array is empty', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('[PHASE 1: DESIGN & VALIDATION - IN-PLACE MODEL]');
      });

      it('should detect Phase 1 when code-task label is not present', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['bug', 'enhancement'],
        });

        expect(result).toContain('[PHASE 1: DESIGN & VALIDATION - IN-PLACE MODEL]');
      });

      it('should detect Phase 2 when code-task label is present among others', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['bug', 'code-task', 'high-priority'],
        });

        expect(result).toContain('[PHASE 2: STRICT EXECUTION]');
      });

      it('should normalize case for code-task label', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['CODE-TASK'],
        });

        expect(result).toContain('[PHASE 2: STRICT EXECUTION]');
      });
    });

    describe('executionPhase priority', () => {
      it('uses executionPhase=execution over missing code-task label', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['bug'],
          executionPhase: 'execution',
        });

        expect(result).toContain('[PHASE 2: STRICT EXECUTION]');
        expect(result).not.toContain('[PHASE 1: DESIGN & VALIDATION');
      });

      it('uses executionPhase=design over present code-task label', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
          executionPhase: 'design',
        });

        expect(result).toContain('[PHASE 1: DESIGN & VALIDATION - IN-PLACE MODEL]');
        expect(result).not.toContain('[PHASE 2: STRICT EXECUTION]');
      });

      it('falls back to label detection when executionPhase is undefined', () => {
        const withCodeTask = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['code-task'],
        });
        expect(withCodeTask).toContain('[PHASE 2: STRICT EXECUTION]');

        const withoutCodeTask = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['bug'],
        });
        expect(withoutCodeTask).toContain('[PHASE 1: DESIGN & VALIDATION - IN-PLACE MODEL]');
      });

      it('pr-comment label still takes priority over executionPhase', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['pr-comment'],
          executionPhase: 'design',
        });

        expect(result).toContain('PR_COMMENT_FINAL');
        expect(result).not.toContain('[PHASE 1: DESIGN & VALIDATION');
        expect(result).not.toContain('[PHASE 2: STRICT EXECUTION]');
      });
    });
  });
});
