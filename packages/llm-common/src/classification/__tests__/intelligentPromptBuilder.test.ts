import { describe, it, expect } from 'vitest';
import {
  intelligentClassifierPrompt,
  toClassificationExample,
  toClassificationCorrection,
  type ClassificationExample,
  type ClassificationCorrection,
  type CommandExampleSource,
  type TransitionSource,
} from '../intelligentPromptBuilder.js';

describe('intelligentClassifierPrompt', () => {
  describe('build', () => {
    it('builds prompt with message only when no examples or corrections provided', () => {
      const prompt = intelligentClassifierPrompt.build({
        message: 'buy groceries',
      });

      expect(prompt).toContain('buy groceries');
      expect(prompt).toContain('Classify the message into exactly one category');
      expect(prompt).toContain('Return ONLY valid JSON');
      expect(prompt).not.toContain('REAL EXAMPLES FROM HISTORY');
      expect(prompt).not.toContain('CRITICAL: LEARNED CORRECTIONS');
    });

    it('includes examples section when examples are provided', () => {
      const examples: ClassificationExample[] = [
        { text: 'buy milk', type: 'todo', confidence: 0.9 },
        { text: 'what is OAuth', type: 'research', confidence: 0.85 },
      ];

      const prompt = intelligentClassifierPrompt.build({ message: 'test message' }, { examples });

      expect(prompt).toContain('REAL EXAMPLES FROM HISTORY');
      expect(prompt).toContain('buy milk');
      expect(prompt).toContain('→ todo');
      expect(prompt).toContain('what is OAuth');
      expect(prompt).toContain('→ research');
    });

    it('includes corrections section when corrections are provided', () => {
      const corrections: ClassificationCorrection[] = [
        { text: 'meeting tomorrow', originalType: 'todo', correctedType: 'calendar' },
        { text: 'remind me about X', originalType: 'note', correctedType: 'reminder' },
      ];

      const prompt = intelligentClassifierPrompt.build(
        { message: 'test message' },
        { corrections }
      );

      expect(prompt).toContain('CRITICAL: LEARNED CORRECTIONS');
      expect(prompt).toContain('meeting tomorrow');
      expect(prompt).toContain('→ calendar (NOT todo)');
      expect(prompt).toContain('remind me about X');
      expect(prompt).toContain('→ reminder (NOT note)');
    });

    it('balances examples per category using maxExamplesPerCategory', () => {
      const examples: ClassificationExample[] = [
        { text: 'todo 1', type: 'todo', confidence: 0.9 },
        { text: 'todo 2', type: 'todo', confidence: 0.8 },
        { text: 'todo 3', type: 'todo', confidence: 0.7 },
        { text: 'todo 4', type: 'todo', confidence: 0.6 },
        { text: 'research 1', type: 'research', confidence: 0.95 },
        { text: 'research 2', type: 'research', confidence: 0.85 },
      ];

      const prompt = intelligentClassifierPrompt.build(
        { message: 'test message' },
        { examples, maxExamplesPerCategory: 2 }
      );

      expect(prompt).toContain('todo 1');
      expect(prompt).toContain('todo 2');
      expect(prompt).not.toContain('todo 3');
      expect(prompt).not.toContain('todo 4');
      expect(prompt).toContain('research 1');
      expect(prompt).toContain('research 2');
    });

    it('limits corrections using maxCorrections', () => {
      const corrections: ClassificationCorrection[] = [
        { text: 'correction 1', originalType: 'todo', correctedType: 'calendar' },
        { text: 'correction 2', originalType: 'note', correctedType: 'research' },
        { text: 'correction 3', originalType: 'link', correctedType: 'note' },
      ];

      const prompt = intelligentClassifierPrompt.build(
        { message: 'test message' },
        { corrections, maxCorrections: 2 }
      );

      expect(prompt).toContain('correction 1');
      expect(prompt).toContain('correction 2');
      expect(prompt).not.toContain('correction 3');
    });

    it('truncates long example text with ellipsis', () => {
      const longText = 'a'.repeat(100);
      const examples: ClassificationExample[] = [{ text: longText, type: 'note' }];

      const prompt = intelligentClassifierPrompt.build({ message: 'test' }, { examples });

      expect(prompt).toContain('a'.repeat(77) + '...');
      expect(prompt).not.toContain('a'.repeat(81));
    });

    it('replaces newlines in example text', () => {
      const textWithNewlines = 'line one\nline two\r\nline three';
      const examples: ClassificationExample[] = [{ text: textWithNewlines, type: 'note' }];

      const prompt = intelligentClassifierPrompt.build({ message: 'test' }, { examples });

      expect(prompt).toContain('line one line two line three');
      expect(prompt).toContain('"line one line two line three" → note');
    });

    it('sorts examples by confidence (descending) before selection', () => {
      const examples: ClassificationExample[] = [
        { text: 'low confidence', type: 'todo', confidence: 0.5 },
        { text: 'high confidence', type: 'todo', confidence: 0.95 },
        { text: 'medium confidence', type: 'todo', confidence: 0.7 },
      ];

      const prompt = intelligentClassifierPrompt.build(
        { message: 'test' },
        { examples, maxExamplesPerCategory: 2 }
      );

      expect(prompt).toContain('high confidence');
      expect(prompt).toContain('medium confidence');
      expect(prompt).not.toContain('low confidence');
    });

    it('uses default confidence of 0.5 for examples without confidence', () => {
      const examples: ClassificationExample[] = [
        { text: 'no confidence', type: 'todo' },
        { text: 'high confidence', type: 'todo', confidence: 0.9 },
        { text: 'low confidence', type: 'todo', confidence: 0.3 },
      ];

      const prompt = intelligentClassifierPrompt.build(
        { message: 'test' },
        { examples, maxExamplesPerCategory: 2 }
      );

      expect(prompt).toContain('high confidence');
      expect(prompt).toContain('no confidence');
      expect(prompt).not.toContain('low confidence');
    });

    it('handles all category types', () => {
      const examples: ClassificationExample[] = [
        { text: 'todo item', type: 'todo' },
        { text: 'research topic', type: 'research' },
        { text: 'note text', type: 'note' },
        { text: 'http://link.com', type: 'link' },
        { text: 'meeting at 3', type: 'calendar' },
        { text: 'remind me', type: 'reminder' },
        { text: 'bug fix', type: 'linear' },
      ];

      const prompt = intelligentClassifierPrompt.build({ message: 'test' }, { examples });

      expect(prompt).toContain('→ todo');
      expect(prompt).toContain('→ research');
      expect(prompt).toContain('→ note');
      expect(prompt).toContain('→ link');
      expect(prompt).toContain('→ calendar');
      expect(prompt).toContain('→ reminder');
      expect(prompt).toContain('→ linear');
    });

    it('uses default maxExamplesPerCategory of 5', () => {
      const examples: ClassificationExample[] = Array.from({ length: 10 }, (_, i) => ({
        text: `todo ${String(i + 1)}`,
        type: 'todo' as const,
        confidence: 1 - i * 0.05,
      }));

      const prompt = intelligentClassifierPrompt.build({ message: 'test' }, { examples });

      expect(prompt).toContain('todo 1');
      expect(prompt).toContain('todo 5');
      expect(prompt).not.toContain('todo 6');
    });

    it('uses default maxCorrections of 20', () => {
      const corrections: ClassificationCorrection[] = Array.from({ length: 25 }, (_, i) => ({
        text: `correction ${String(i + 1)}`,
        originalType: 'todo' as const,
        correctedType: 'note' as const,
      }));

      const prompt = intelligentClassifierPrompt.build({ message: 'test' }, { corrections });

      expect(prompt).toContain('correction 1');
      expect(prompt).toContain('correction 20');
      expect(prompt).not.toContain('correction 21');
    });
  });

  describe('metadata', () => {
    it('has correct name and description', () => {
      expect(intelligentClassifierPrompt.name).toBe('intelligent-command-classification');
      expect(intelligentClassifierPrompt.description).toContain(
        'Classifies user messages using historical examples'
      );
    });
  });
});

describe('toClassificationExample', () => {
  it('converts valid source to ClassificationExample', () => {
    const source: CommandExampleSource = {
      text: 'buy groceries',
      classificationType: 'todo',
      classificationConfidence: 0.9,
    };

    const result = toClassificationExample(source);

    expect(result).toEqual({
      text: 'buy groceries',
      type: 'todo',
      confidence: 0.9,
    });
  });

  it('omits confidence when not provided', () => {
    const source: CommandExampleSource = {
      text: 'research AI',
      classificationType: 'research',
    };

    const result = toClassificationExample(source);

    expect(result).toEqual({
      text: 'research AI',
      type: 'research',
    });
    expect(result).not.toHaveProperty('confidence');
  });

  it('returns null for invalid classification type', () => {
    const source: CommandExampleSource = {
      text: 'some text',
      classificationType: 'invalid_type',
    };

    const result = toClassificationExample(source);

    expect(result).toBeNull();
  });

  it('accepts all valid category types', () => {
    const validTypes = ['todo', 'research', 'note', 'link', 'calendar', 'reminder', 'linear'];

    for (const type of validTypes) {
      const source: CommandExampleSource = {
        text: 'test',
        classificationType: type,
      };
      const result = toClassificationExample(source);
      expect(result).not.toBeNull();
      expect(result?.type).toBe(type);
    }
  });
});

describe('toClassificationCorrection', () => {
  it('converts valid source to ClassificationCorrection', () => {
    const source: TransitionSource = {
      commandText: 'meeting tomorrow',
      originalType: 'todo',
      newType: 'calendar',
      originalConfidence: 0.8,
    };

    const result = toClassificationCorrection(source);

    expect(result).toEqual({
      text: 'meeting tomorrow',
      originalType: 'todo',
      correctedType: 'calendar',
      originalConfidence: 0.8,
    });
  });

  it('omits originalConfidence when not provided', () => {
    const source: TransitionSource = {
      commandText: 'remind me',
      originalType: 'note',
      newType: 'reminder',
    };

    const result = toClassificationCorrection(source);

    expect(result).toEqual({
      text: 'remind me',
      originalType: 'note',
      correctedType: 'reminder',
    });
    expect(result).not.toHaveProperty('originalConfidence');
  });

  it('returns null when originalType is invalid', () => {
    const source: TransitionSource = {
      commandText: 'test',
      originalType: 'invalid',
      newType: 'todo',
    };

    const result = toClassificationCorrection(source);

    expect(result).toBeNull();
  });

  it('returns null when newType is invalid', () => {
    const source: TransitionSource = {
      commandText: 'test',
      originalType: 'todo',
      newType: 'invalid',
    };

    const result = toClassificationCorrection(source);

    expect(result).toBeNull();
  });

  it('returns null when both types are invalid', () => {
    const source: TransitionSource = {
      commandText: 'test',
      originalType: 'bad',
      newType: 'worse',
    };

    const result = toClassificationCorrection(source);

    expect(result).toBeNull();
  });

  it('accepts all valid category type combinations', () => {
    const validTypes = ['todo', 'research', 'note', 'link', 'calendar', 'reminder', 'linear'];

    const source: TransitionSource = {
      commandText: 'test',
      originalType: validTypes[0] ?? '',
      newType: validTypes[1] ?? '',
    };

    const result = toClassificationCorrection(source);
    expect(result).not.toBeNull();
    expect(result?.originalType).toBe('todo');
    expect(result?.correctedType).toBe('research');
  });
});
