import { describe, it, expect } from 'vitest';
import { linearIssueTitlePrompt } from '../linearIssueTitlePrompt.js';

describe('linearIssueTitlePrompt', () => {
  describe('build', () => {
    it('includes the description in the prompt', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Add dark mode to settings page',
      });

      expect(prompt).toContain('Add dark mode to settings page');
    });

    it('includes Senior Product Owner persona', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Any task',
      });

      expect(prompt).toContain('Senior Product Owner');
      expect(prompt).toContain('20 years of experience');
      expect(prompt).toContain('VALUE');
    });

    it('uses default maxLength of 80 characters', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Test',
      });

      expect(prompt).toContain('max 80 characters');
    });

    it('respects custom maxLength', () => {
      const prompt = linearIssueTitlePrompt.build({ description: 'Test' }, { maxLength: 60 });

      expect(prompt).toContain('max 60 characters');
      expect(prompt).not.toContain('max 80 characters');
    });
  });

  describe('JSON response format', () => {
    it('includes JSON response format instructions', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Fix login bug',
      });

      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"issueType"');
    });

    it('includes all valid issue types', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Any task',
      });

      expect(prompt).toContain('"feature"');
      expect(prompt).toContain('"bug"');
      expect(prompt).toContain('"refactor"');
      expect(prompt).toContain('"research"');
    });

    it('instructs to return only JSON without markdown', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Test',
      });

      expect(prompt).toContain('ONLY the JSON object');
      expect(prompt).toContain('no markdown');
    });
  });

  describe('issue type examples', () => {
    it('includes feature title guidance', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Any task',
      });

      expect(prompt).toContain('For NEW FEATURES');
      expect(prompt).toContain('VALUE delivered to users');
      expect(prompt).toContain('Enable');
      expect(prompt).toContain('Allow');
    });

    it('includes bug fix title guidance', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Any task',
      });

      expect(prompt).toContain('For BUG FIXES');
      expect(prompt).toContain('PROBLEM is eliminated');
      expect(prompt).toContain('Fix');
    });

    it('includes refactoring title guidance', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Any task',
      });

      expect(prompt).toContain('REFACTORING');
      expect(prompt).toContain('BENEFIT to the product/team');
      expect(prompt).toContain('Improve');
    });

    it('includes research title guidance', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Any task',
      });

      expect(prompt).toContain('For RESEARCH');
      expect(prompt).toContain('DECISION or KNOWLEDGE outcome');
      expect(prompt).toContain('Evaluate');
    });
  });

  describe('formatting rules', () => {
    it('includes imperative mood instruction', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Test',
      });

      expect(prompt).toContain('Imperative mood');
      expect(prompt).toContain('start with verb');
    });

    it('includes no trailing period instruction', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Test',
      });

      expect(prompt).toContain('No trailing period');
    });

    it('includes no prefix instruction', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Test',
      });

      expect(prompt).toContain('No prefixes');
      expect(prompt).toContain('"Feature:"');
      expect(prompt).toContain('"Bug:"');
    });

    it('includes language matching instruction', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Test',
      });

      expect(prompt).toContain('Match language of the description');
      expect(prompt).toContain('English');
      expect(prompt).toContain('Polish');
    });
  });

  describe('good/bad examples', () => {
    it('includes contrasting good and bad examples for features', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Test',
      });

      expect(prompt).toContain('BAD:');
      expect(prompt).toContain('GOOD:');
      expect(prompt).toContain('implementation detail');
      expect(prompt).toContain('value delivered');
    });

    it('includes contrasting good and bad examples for bugs', () => {
      const prompt = linearIssueTitlePrompt.build({
        description: 'Test',
      });

      expect(prompt).toContain('technical cause');
      expect(prompt).toContain('user-visible problem');
    });
  });

  describe('prompt metadata', () => {
    it('has correct name', () => {
      expect(linearIssueTitlePrompt.name).toBe('linear-issue-title');
    });

    it('has description', () => {
      expect(linearIssueTitlePrompt.description).toContain('value-focused');
      expect(linearIssueTitlePrompt.description).toContain('Linear issue titles');
    });

    it('has valid semver version', () => {
      expect(linearIssueTitlePrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
