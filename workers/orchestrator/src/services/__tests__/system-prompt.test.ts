import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../system-prompt.js';

describe('system-prompt', () => {
  describe('buildSystemPrompt', () => {
    const baseParams = {
      taskId: 'task-123',
      worktreePath: '/tmp/worktree-task-123',
      linearIssueId: 'INT-123',
      linearIssueLabels: [] as string[],
      hasChildren: false,
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
        expect(result).toContain('Worktree: /tmp/worktree-task-123');
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

      it('should include optional design document section in Phase 1', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: [],
        });

        expect(result).toContain('Design Document PR (Complex Cases Only)');
        expect(result).toContain('docs/plans/INT-123-design.md');
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

        expect(result).toContain('No Confirmation Prompts');
        expect(result).toContain('Complete Checkpoints Autonomously');
        expect(result).toContain('ci:tracked');
        expect(result).toContain('On CI Failure');
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

      it('should be case-sensitive for code-task label', () => {
        const result = buildSystemPrompt({
          ...baseParams,
          linearIssueLabels: ['CODE-TASK'],
        });

        expect(result).toContain('[PHASE 1: DESIGN & VALIDATION - IN-PLACE MODEL]');
      });
    });
  });
});
