export interface MessageDigestCandidateInput {
  phase: 'staged' | 'active';
  ports: {
    whatsapp: number;
    mobileNotifications: number;
    fishingAssistant: number;
    messageDigest: number;
  };
  internalAuthToken: string;
  ownerUserId: string;
  migrationId: string;
  webRoot: string;
  reports: {
    dryRun: string;
    apply: string;
    verify: string;
    activation?: string;
  };
}

export interface MessageDigestCandidateResult {
  ok: true;
  phase: 'staged' | 'active';
  checkedServices: 4;
  checkedAssets: number;
}

export function verifyMessageDigestCandidate(
  input: MessageDigestCandidateInput,
  dependencies?: { fetchImplementation?: typeof fetch }
): Promise<MessageDigestCandidateResult>;
