export interface LegacyDigestArchiveDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface LegacyDigestArchiveSnapshot {
  digests: LegacyDigestArchiveDocument[];
  states: LegacyDigestArchiveDocument[];
  locks: LegacyDigestArchiveDocument[];
  backfills: LegacyDigestArchiveDocument[];
}

export interface LegacyDigestArchive {
  readSnapshot(input: {
    userId: string;
    legacyGroupKey: string;
  }): Promise<LegacyDigestArchiveSnapshot>;
}
