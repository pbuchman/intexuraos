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
      expect(prompt).toContain(
        'linear** = ONLY when user EXPLICITLY wants to create/track a Linear issue'
      );
      expect(prompt).toContain('code** = ANY engineering task describing work to do');
      expect(prompt).toContain('prefer "code"');
    });

    it('includes Linear explicit tracking intent phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"linear issue"');
      expect(prompt).toContain('"linear task"');
      expect(prompt).toContain('"create linear"');
      expect(prompt).toContain('"create linear issue"');
      expect(prompt).toContain('"track this"');
      expect(prompt).toContain('"document this"');
    });

    it('includes Code as default for engineering tasks', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"fix X"');
      expect(prompt).toContain('"implement X"');
      expect(prompt).toContain('"start working on"');
      expect(prompt).toContain('"execute this"');
    });

    it('shows that engineering terms default to code', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"fix the login bug" → code');
      expect(prompt).toContain('"implement dark mode" → code');
      expect(prompt).toContain('engineering task');
    });

    it('shows explicit linear intent classifies as linear', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"linear issue: fix the login bug" → linear');
      expect(prompt).toContain('"create issue for auth bug" → linear');
      expect(prompt).toContain('"track this: mobile menu broken" → linear');
    });

    it('includes calendar event definition requiring time slot', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('occupies a time slot');
    });

    it('includes calendar vs todo tiebreaker guidance', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('action verb');
      expect(prompt).toMatch(/todo.*unless.*named event|todo.*unless.*event to attend/i);
    });

    it('lists todo before calendar in Step 5 priority', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      const step5Start = prompt.indexOf('STEP 5: Category Detection');
      expect(step5Start).toBeGreaterThan(-1);

      const afterStep5 = prompt.slice(step5Start);
      const todoPos = afterStep5.indexOf('**todo**');
      const calendarPos = afterStep5.indexOf('**calendar**');

      expect(todoPos).toBeGreaterThan(-1);
      expect(calendarPos).toBeGreaterThan(-1);
      expect(todoPos).toBeLessThan(calendarPos);
    });

    it('includes example: todo with deadline stays todo', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toMatch(/Send contract.*→ todo|contract.*by Friday.*→ todo/i);
    });

    it('includes example: named event is calendar', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toMatch(/[Bb]oard meeting.*→ calendar|[Mm]eeting.*Thursday.*→ calendar/i);
    });

    it('includes "create code task" in code explicit phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"create code task"');
      expect(prompt).toContain('"create coding task"');
      expect(prompt).toContain('"stwórz code task"');
    });

    it('includes "create calendar event" in calendar explicit phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"create calendar event"');
      expect(prompt).toContain('"create event"');
      expect(prompt).toContain('"stwórz wydarzenie"');
      expect(prompt).toContain('"stwórz event"');
    });

    it('includes "create reminder" in reminder explicit phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"create reminder"');
      expect(prompt).toContain('"stwórz przypomnienie"');
    });

    it('includes "create research" in research explicit phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"create research"');
      expect(prompt).toContain('"create research task"');
    });

    it('includes "create link" and "create bookmark" in link explicit phrases', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"create link"');
      expect(prompt).toContain('"create bookmark"');
    });

    it('includes "create node" as note alias', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain('"create node"');
    });

    it('includes disambiguation example for "create code task"', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain(
        '"create code task to fix the login bug" → code (explicit "create code task")'
      );
    });

    it('includes disambiguation example for "create calendar event"', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toContain(
        '"create calendar event for team standup" → calendar (explicit "create calendar event")'
      );
    });

    it('includes example: action + date = todo', () => {
      const prompt = commandClassifierPrompt.build({ message: 'test' });

      expect(prompt).toMatch(
        /[Ss]ign up.*deadline.*→ todo|[Ss]ign up.*exam.*→ todo|[Pp]repare.*→ todo/i
      );
    });
  });

  describe('metadata', () => {
    it('has correct name and description', () => {
      expect(commandClassifierPrompt.name).toBe('command-classification');
      expect(commandClassifierPrompt.description).toContain(
        'Classifies user messages into command categories'
      );
      expect(commandClassifierPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('has version 2.1.0', () => {
      expect(commandClassifierPrompt.version).toBe('2.1.0');
    });
  });
});
