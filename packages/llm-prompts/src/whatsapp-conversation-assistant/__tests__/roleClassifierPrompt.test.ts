import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT,
  buildConversationAssistantRoleClassifierPrompt,
  buildConversationAssistantRoleClassifierRepairPrompt,
  conversationAssistantRoleClassificationSchema,
} from '../roleClassifierPrompt.js';

describe('conversation assistant role classifier prompt', () => {
  it('exposes semver prompt metadata and a dedicated prompt type', () => {
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.version).toBe('1.0.0');
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.promptType).toBe(
      'whatsapp-conversation-assistant-role-classifier'
    );
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
    expect(prompt).toContain('maximum three words');
    expect(prompt).toContain('personal title');
    expect(prompt).toContain('punctuation-heavy');
    expect(prompt).not.toContain('Transcript follows');
  });

  it('validates the expected schema and rejects extra fields and unsafe labels', () => {
    const valid = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Employment Lawyer',
      confidence: 0.91,
      rationale: 'The user asks about employment legal options.',
    });
    const validClinicRole = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Clinic Psychologist',
      confidence: 0.91,
      rationale: 'The user asks about clinical mental health support.',
    });
    const validGroupRole = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Group Therapist',
      confidence: 0.91,
      rationale: 'The user asks about group therapy.',
    });
    const validSocialWorker = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Social Worker',
      confidence: 0.91,
      rationale: 'The user asks about social support.',
    });
    const validFamilyPhysician = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Family Physician',
      confidence: 0.91,
      rationale: 'The user asks about primary care.',
    });
    const invalid = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Employment Lawyer',
      confidence: 0.91,
      rationale: 'The user asks about employment legal options.',
      extra: true,
    });
    const markdown = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: '**Lawyer**',
      confidence: 0.91,
      rationale: 'The user asks about employment legal options.',
    });
    const personalTitle = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Dr. Alice',
      confidence: 0.91,
      rationale: 'The user asks about a health concern.',
    });
    const credentialClaim = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Certified Tax Advisor',
      confidence: 0.91,
      rationale: 'The user asks about tax filing.',
    });
    const singlePersonName = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Alice',
      confidence: 0.91,
      rationale: 'The user asks about a health concern.',
    });
    const organization = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Acme Legal Group',
      confidence: 0.91,
      rationale: 'The user asks about legal options.',
    });
    const organizationBrand = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Google Support',
      confidence: 0.91,
      rationale: 'The user asks about account access.',
    });
    const reviewerOrganization = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'OpenAI Support',
      confidence: 0.91,
      rationale: 'The user asks about account access.',
    });
    const secondReviewerOrganization = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Microsoft Advisor',
      confidence: 0.91,
      rationale: 'The user asks about account access.',
    });
    const genericBrandSupport = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Stripe Support',
      confidence: 0.91,
      rationale: 'The user asks about account access.',
    });
    const genericOrganizationTeam = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Beta Team',
      confidence: 0.91,
      rationale: 'The user asks about account access.',
    });
    const numericOnly = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: '123',
      confidence: 0.91,
      rationale: 'The user asks a numeric question.',
    });
    const repeatedSlashes = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Lawyer///Coach',
      confidence: 0.91,
      rationale: 'The user asks about legal and coaching support.',
    });
    const repeatedHyphens = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Tax---Advisor',
      confidence: 0.91,
      rationale: 'The user asks about tax filing.',
    });
    const trailingPunctuation = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Lawyer!',
      confidence: 0.91,
      rationale: 'The user asks about legal options.',
    });

    expect(valid.success).toBe(true);
    expect(validClinicRole.success).toBe(true);
    expect(validGroupRole.success).toBe(true);
    expect(validSocialWorker.success).toBe(true);
    expect(validFamilyPhysician.success).toBe(true);
    expect(invalid.success).toBe(false);
    expect(markdown.success).toBe(false);
    expect(personalTitle.success).toBe(false);
    expect(credentialClaim.success).toBe(false);
    expect(singlePersonName.success).toBe(false);
    expect(organization.success).toBe(false);
    expect(organizationBrand.success).toBe(false);
    expect(reviewerOrganization.success).toBe(false);
    expect(secondReviewerOrganization.success).toBe(false);
    expect(genericBrandSupport.success).toBe(false);
    expect(genericOrganizationTeam.success).toBe(false);
    expect(numericOnly.success).toBe(false);
    expect(repeatedSlashes.success).toBe(false);
    expect(repeatedHyphens.success).toBe(false);
    expect(trailingPunctuation.success).toBe(false);
  });

  it('builds a repair prompt from invalid raw output and schema details', () => {
    const parsed = conversationAssistantRoleClassificationSchema.safeParse({ roleLabel: '' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const repair = buildConversationAssistantRoleClassifierRepairPrompt('not json', parsed.error);

    expect(repair).toContain('not json');
    expect(repair).toContain('Return only valid JSON');
    expect(repair).toContain('roleLabel');
  });
});
