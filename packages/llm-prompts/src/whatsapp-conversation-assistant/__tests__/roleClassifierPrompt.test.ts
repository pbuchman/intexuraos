import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT,
  CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_REPAIR_PROMPT,
  buildConversationAssistantRoleClassifierPrompt,
  buildConversationAssistantRoleClassifierRepairPrompt,
  conversationAssistantRoleClassificationSchema,
} from '../roleClassifierPrompt.js';

describe('conversation assistant role classifier prompt', () => {
  it('exposes semver prompt metadata and a dedicated prompt type', () => {
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.version).toBe('1.0.0');
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.name).toBe(
      'whatsapp-conversation-assistant-role-classifier'
    );
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.description).toContain('role label');
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_REPAIR_PROMPT.version).toBe('1.0.0');
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_REPAIR_PROMPT.name).toBe(
      'whatsapp-conversation-assistant-role-classifier-repair'
    );
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_REPAIR_PROMPT.description).toContain('Repairs');
  });

  it('asks for an unrestricted professional role label as strict JSON', () => {
    const prompt = buildConversationAssistantRoleClassifierPrompt({
      initialQuestion: 'My employer is threatening me. What are my options?',
    });

    expect(prompt).toContain('Return only JSON');
    expect(prompt).toContain('roleLabel');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('not a fixed enum');
    expect(prompt).toContain('Assistant');
    expect(prompt).toContain('lawyer');
    expect(prompt).not.toContain('Transcript follows');
  });

  it('validates the expected schema and rejects extra fields', () => {
    const valid = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Employment Lawyer',
      confidence: 0.91,
      rationale: 'The user asks about employment legal options.',
    });
    const invalid = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Employment Lawyer',
      confidence: 0.91,
      rationale: 'The user asks about employment legal options.',
      extra: true,
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('rejects unsafe role labels while allowing unrestricted professions', () => {
    const baseClassification = {
      confidence: 0.91,
      rationale: 'The user asks a profession-specific question.',
    };

    expect(
      conversationAssistantRoleClassificationSchema.safeParse({
        ...baseClassification,
        roleLabel: 'Marine Surveyor',
      }).success
    ).toBe(true);
    expect(
      conversationAssistantRoleClassificationSchema.safeParse({
        ...baseClassification,
        roleLabel: 'Assistant',
      }).success
    ).toBe(true);

    for (const roleLabel of [
      'Alice Smith',
      'Dr. Alice Smith',
      'David Chen',
      'Priya Patel',
      'Acme Legal Group',
      'Licensed Psychologist',
      'Certified Tax Advisor',
      'Jane Doe, PhD',
      '**Lawyer**',
      'Lawyer!!!',
      'Coach/Advisor-Consultant',
      '123',
    ]) {
      expect(
        conversationAssistantRoleClassificationSchema.safeParse({
          ...baseClassification,
          roleLabel,
        }).success
      ).toBe(false);
    }
  });

  it('builds a repair prompt from invalid raw output and schema details', () => {
    const parsed = conversationAssistantRoleClassificationSchema.safeParse({ roleLabel: '' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const repair = buildConversationAssistantRoleClassifierRepairPrompt('not json', parsed.error, {
      initialQuestion: 'Can I sue my employer?',
    });

    expect(repair).toContain('not json');
    expect(repair).toContain('Return only valid JSON');
    expect(repair).toContain('roleLabel');
    expect(repair).toContain('Use only the initial user question');
    expect(repair).toContain('Can I sue my employer?');
  });
});
