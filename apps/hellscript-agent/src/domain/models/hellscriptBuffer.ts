export interface HellscriptBuffer {
  id: string;
  userId: string;
  title: string;
  eventCount: number;
  latestDraftVersionNumber: number | null;
  latestDraftVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}
