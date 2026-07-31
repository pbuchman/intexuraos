export const FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS =
  'Write the digest in Polish. Create one concrete headline and 3–7 concise, high-signal facts from this window. Track active topics and participants, decisions and outcomes, moderator posts, open questions, unusual activity, participant identity/context, moderator events, and open threads. Carry forward only information needed for continuity, keep stable topic identifiers, and remove an open thread only when messages clearly close it. Historical state and the previous three summaries are context only: do not present an old fact as if it happened in this window. Preserve names as written and never invent information.';

export const DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS =
  "Write the digest in Polish. Summarize the other participant's expressed sentiment and how it changed during this window. Identify concrete positive, neutral, negative, uncertain, or mixed signals; important concerns, commitments, unresolved tension, and notable shifts. Use my messages only as conversational context. Distinguish observation from inference, state uncertainty, and do not diagnose mental state, personality, health, or hidden intent. Include the most important factual conversation outcomes alongside the sentiment summary. Never invent information.";

export const MESSAGE_DIGEST_INSTRUCTION_TEMPLATES = {
  fishing_group: {
    id: 'fishing_group',
    label: 'Fishing group',
    chatType: 'group',
    revision: '1.0.0',
    instructions: FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
  },
  direct_sentiment: {
    id: 'direct_sentiment',
    label: 'Sentiment and outcomes',
    chatType: 'direct',
    revision: '1.0.0',
    instructions: DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS,
  },
} as const;

export type MessageDigestInstructionTemplateId = keyof typeof MESSAGE_DIGEST_INSTRUCTION_TEMPLATES;
