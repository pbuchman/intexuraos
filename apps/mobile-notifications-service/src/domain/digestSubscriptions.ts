/**
 * Hard-coded digest subscriptions for v1 (single user / single group).
 * To migrate to a Firestore-backed registry: write each entry to a new
 * `notification_digest_subscriptions` collection and replace this file
 * with a repository. See INT-1382 for context.
 */
export interface DigestSubscription {
  readonly userId: string;
  readonly groupKey: string;
  readonly groupTitlePrefix: string;
}

export const DIGEST_SUBSCRIPTIONS: readonly DigestSubscription[] = [
  {
    userId: 'google-oauth2|113131655542389277022',
    groupKey: 'grupa-wedkarska-skool',
    groupTitlePrefix: 'Grupa Wędkarska Skool',
  },
] as const;
