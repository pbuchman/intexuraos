import { describe, it, expect } from 'vitest';
import { commandClassifierPrompt } from '../commandClassifierPrompt.js';

describe('commandClassifierPrompt', () => {
  describe('build', () => {
    it('builds prompt with message', () => {
      const prompt = commandClassifierPrompt.build({ message: 'buy groceries' });

      expect(prompt).toContain('buy groceries');
      expect(prompt).toContain('Classify the message into exactly one category');
      expect(prompt).toContain('Return ONLY valid JSON');
    });

    it('includes URL keyword isolation guidance', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('CRITICAL: URL Keyword Isolation');
      expect(prompt).toContain('Keywords inside URLs must be IGNORED');
      expect(prompt).toContain('https://research-world.com');
      expect(prompt).toContain('The word "research" is part of the URL, NOT a command');
    });

    it('includes explicit intent command detection step', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('STEP 2: Explicit Intent Command Detection (HIGH PRIORITY)');
      expect(prompt).toContain('explicit command phrases');
      expect(prompt).toContain('OVERRIDE category signals from URL content');
    });

    it('includes explicit command phrases for all categories', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"save bookmark"');
      expect(prompt).toContain('"create todo"');
      expect(prompt).toContain('"perform research"');
      expect(prompt).toContain('"create note"');
      expect(prompt).toContain('"set reminder"');
      expect(prompt).toContain('"add to calendar"');
    });

    it('includes examples of explicit intent overriding URL keywords', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain(
        'save bookmark https://research-world.com" → link (explicit "save bookmark" overrides "research" in URL)'
      );
      expect(prompt).toContain(
        'create todo to research competitors" → todo (explicit "create todo" overrides "research" keyword)'
      );
      expect(prompt).toContain(
        'perform research on todo apps" → research (explicit "perform research" overrides "todo" keyword)'
      );
    });

    it('includes URL presence check step before category detection', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('STEP 4: URL Presence Check (BEFORE other category signals)');
      expect(prompt).toContain('If message contains a URL');
      expect(prompt).toContain('strongly prefer "link" classification');
    });

    it('includes examples showing URL presence triggers link classification', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('https://research-tools.com" → link');
      expect(prompt).toContain('"research" is in URL');
      expect(prompt).toContain('https://todo-tracker.io');
      expect(prompt).toContain('"todo" is in URL');
    });

    it('includes Polish command phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('zapisz link');
      expect(prompt).toContain('dodaj zakładkę');
      expect(prompt).toContain('stwórz zadanie');
      expect(prompt).toContain('zbadaj');
      expect(prompt).toContain('stwórz notatkę');
      expect(prompt).toContain('przypomnij mi');
      expect(prompt).toContain('dodaj do kalendarza');
    });

    it('maintains category detection as step 5', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('STEP 5: Category Detection');
      expect(prompt).toContain('if no URL and no explicit intent');
    });

    it('maintains all original category signals in step 5', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('**calendar**');
      expect(prompt).toContain('**reminder**');
      expect(prompt).toContain('**research**');
      expect(prompt).toContain('**note**');
      expect(prompt).toContain('**todo**');
    });

    it('maintains confidence semantics', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('CONFIDENCE SEMANTICS');
      expect(prompt).toContain('0.90+: Clear match');
      expect(prompt).toContain('0.70-0.90: Strong match');
      expect(prompt).toContain('0.50-0.70: Choosing between');
      expect(prompt).toContain('<0.50: Genuinely uncertain');
    });

    it('maintains output format section', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('OUTPUT FORMAT');
      expect(prompt).toContain('"type": "<category>"');
      expect(prompt).toContain('"confidence": <0.0-1.0>');
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"reasoning"');
    });

    it('mentions confidence 0.90+ for explicit command phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('Explicit command phrases (confidence 0.90+)');
    });

    it('includes Linear vs Code distinction guidance', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('CRITICAL: Linear vs Code Distinction');
      expect(prompt).toContain('linear** = DOCUMENT/TRACK/CREATE an issue');
      expect(prompt).toContain('code** = EXECUTE/IMPLEMENT/DO the work NOW');
      expect(prompt).toContain('prefer "linear" (documenting) unless');
    });

    it('includes Linear document intent phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"linear issue"');
      expect(prompt).toContain('"linear task"');
      expect(prompt).toContain('"create linear"');
      expect(prompt).toContain('"create linear issue"');
      expect(prompt).toContain('"track this"');
      expect(prompt).toContain('"document this"');
    });

    it('includes Code execute intent phrases requiring explicit action', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"execute this"');
      expect(prompt).toContain('"implement this now"');
      expect(prompt).toContain('"start working on"');
      expect(prompt).toContain('"execute linear issue"');
    });

    it('shows that engineering terms without execute default to linear', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"fix the login bug" → linear');
      expect(prompt).toContain('"implement dark mode" → linear');
      expect(prompt).toContain('no explicit execution = documenting');
    });

    it('shows explicit execution commands classify as code', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"execute: fix the login bug" → code');
      expect(prompt).toContain('"start working on dark mode" → code');
      expect(prompt).toContain('explicit "execute"');
    });
  });

  describe('metadata', () => {
    it('has correct name and description', () => {
      expect(commandClassifierPrompt.name).toBe('command-classification');
      expect(commandClassifierPrompt.description).toContain(
        'Classifies user messages into command categories'
      );
    });
  });
});
