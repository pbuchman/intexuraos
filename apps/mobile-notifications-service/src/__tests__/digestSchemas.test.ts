import { describe, it, expect } from 'vitest';
import {
  DailySummarySchema,
  GroupStateSchema,
  AggregationOutputSchema,
} from '../domain/schemas/digestSchemas.js';

const validThread = {
  topic: 'Budget planning',
  participants: ['Alice', 'Bob'],
  resolved: false,
  keyFacts: ['Q4 budget finalized'],
};

const validModeratorPost = {
  time: '10:00',
  topic: 'Announcement',
  summary: 'Town hall next week',
};

const validActivityOutlier = {
  sender: 'Alice',
  messageCount: 5,
  note: 'Very active today',
};

const validDailySummary = {
  date: '2024-01-15',
  groupKey: 'group-123',
  messageCount: 42,
  narrative: 'A busy day in the group.',
  threads: [validThread],
  moderatorPosts: [validModeratorPost],
  openQuestions: ['Will the event be postponed?'],
  activityOutliers: [validActivityOutlier],
};

const validIdentityEntry = {
  sender: 'Alice',
  firstSeen: '2024-01-01',
  totalMessages: 100,
  activeDays: 10,
};

const validModeratorEvent = {
  date: '2024-01-10',
  topic: 'Rules update',
  summary: 'New rules posted',
};

const validOpenThread = {
  topic: 'Budget planning',
  openedOn: '2024-01-10',
  lastSignal: 'No resolution yet',
  lastSignalDate: '2024-01-14',
};

const validGroupState = {
  userId: 'user-abc',
  groupKey: 'group-123',
  updatedAt: '2024-01-15T12:00:00Z',
  identityLedger: [validIdentityEntry],
  moderatorEvents: [validModeratorEvent],
  openThreads: [validOpenThread],
  recentSummaryDates: ['2024-01-14', '2024-01-15'],
};

describe('DailySummarySchema', () => {
  it('parses a valid minimal DailySummary with empty arrays', () => {
    const input = {
      date: '2024-01-15',
      groupKey: 'group-123',
      messageCount: 0,
      narrative: 'Quiet day.',
      threads: [],
      moderatorPosts: [],
      openQuestions: [],
      activityOutliers: [],
    };
    const result = DailySummarySchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('parses a valid DailySummary with all fields populated', () => {
    const result = DailySummarySchema.safeParse(validDailySummary);
    expect(result.success).toBe(true);
  });

  it('rejects when date field is missing', () => {
    const { date: _omitted, ...rest } = validDailySummary;
    const result = DailySummarySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid date format using slashes', () => {
    const result = DailySummarySchema.safeParse({
      ...validDailySummary,
      date: '2024/01/15',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-date string in date field', () => {
    const result = DailySummarySchema.safeParse({
      ...validDailySummary,
      date: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('rejects activityOutliers with messageCount=0 (must be positive)', () => {
    const result = DailySummarySchema.safeParse({
      ...validDailySummary,
      activityOutliers: [{ sender: 'Bob', messageCount: 0, note: 'zero' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts activityOutliers with messageCount=1', () => {
    const result = DailySummarySchema.safeParse({
      ...validDailySummary,
      activityOutliers: [{ sender: 'Bob', messageCount: 1, note: 'minimal' }],
    });
    expect(result.success).toBe(true);
  });
});

const minimalGroupState = {
  userId: 'user-abc',
  groupKey: 'group-123',
  updatedAt: '2024-01-15T12:00:00Z',
  identityLedger: [],
  moderatorEvents: [],
  openThreads: [],
  recentSummaryDates: [],
};

describe('GroupStateSchema', () => {
  it('parses a valid minimal GroupState with empty arrays', () => {
    const result = GroupStateSchema.safeParse(minimalGroupState);
    expect(result.success).toBe(true);
  });

  it('parses a valid GroupState with all fields populated', () => {
    const result = GroupStateSchema.safeParse(validGroupState);
    expect(result.success).toBe(true);
  });

  it('rejects when userId field is missing', () => {
    const { userId: _omitted, ...rest } = validGroupState;
    const result = GroupStateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects recentSummaryDates array with 31 items (max is 30)', () => {
    const dates = Array.from({ length: 31 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`);
    const result = GroupStateSchema.safeParse({
      ...validGroupState,
      recentSummaryDates: dates,
    });
    expect(result.success).toBe(false);
  });

  it('accepts recentSummaryDates array with exactly 30 items', () => {
    const dates = Array.from({ length: 30 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`);
    const result = GroupStateSchema.safeParse({
      ...validGroupState,
      recentSummaryDates: dates,
    });
    expect(result.success).toBe(true);
  });

  it('accepts identityLedger entry with optional role and notes both absent', () => {
    const result = GroupStateSchema.safeParse({
      ...validGroupState,
      identityLedger: [validIdentityEntry],
    });
    expect(result.success).toBe(true);
  });

  it("accepts identityLedger entry with role='moderator'", () => {
    const result = GroupStateSchema.safeParse({
      ...validGroupState,
      identityLedger: [{ ...validIdentityEntry, role: 'moderator' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects identityLedger entry with invalid role', () => {
    const result = GroupStateSchema.safeParse({
      ...validGroupState,
      identityLedger: [{ ...validIdentityEntry, role: 'admin' }],
    });
    expect(result.success).toBe(false);
  });

  it('identityLedger entry with notes present parses', () => {
    const result = GroupStateSchema.safeParse({
      ...minimalGroupState,
      identityLedger: [
        {
          sender: 'Piotr',
          firstSeen: '2024-01-01',
          totalMessages: 5,
          activeDays: 3,
          role: 'member',
          notes: 'Frequent contributor',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('identityLedger entry with invalid role rejects', () => {
    const result = GroupStateSchema.safeParse({
      ...minimalGroupState,
      identityLedger: [{ sender: 'Alice', firstSeen: '2024-01-01', totalMessages: 1, activeDays: 1, role: 'admin' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('AggregationOutputSchema', () => {
  it('parses a valid AggregationOutput with both nested schemas', () => {
    const result = AggregationOutputSchema.safeParse({
      dailySummary: validDailySummary,
      stateUpdate: validGroupState,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when dailySummary is missing', () => {
    const result = AggregationOutputSchema.safeParse({
      stateUpdate: validGroupState,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when stateUpdate is missing', () => {
    const result = AggregationOutputSchema.safeParse({
      dailySummary: validDailySummary,
    });
    expect(result.success).toBe(false);
  });
});
