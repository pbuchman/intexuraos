/**
 * @vitest-environment node
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const webSourceRoot = resolve(__dirname, '..');

const retiredPaths = [
  'components/notification-digests',
  'components/fishing/FishingDigestList.tsx',
  'hooks/useDigestList.ts',
  'hooks/useDigestView.ts',
  'hooks/useBackfillRun.ts',
  'pages/NotificationDigestsPage.tsx',
  'pages/NotificationDigestViewPage.tsx',
  'pages/NotificationDigestBackfillPage.tsx',
  'pages/fishing/FishingDigestsPage.tsx',
  'pages/fishing/FishingDigestViewPage.tsx',
  'services/notificationDigestsApi.ts',
  'types/notificationDigests.ts',
];

describe('legacy Message Digest Web removal', () => {
  it('keeps duplicate Mobile and Fishing digest implementations deleted', () => {
    for (const relativePath of retiredPaths) {
      expect(existsSync(resolve(webSourceRoot, relativePath)), relativePath).toBe(false);
    }
  });

  it('keeps retired digest APIs and hooks out of active barrel exports', () => {
    const activeSources = [
      'hooks/index.ts',
      'types/index.ts',
      'types/fishingAssistant.ts',
      'services/fishingAssistantApi.ts',
      'components/fishing/index.ts',
      'pages/fishing/index.ts',
    ].map((relativePath) => readFileSync(resolve(webSourceRoot, relativePath), 'utf-8'));
    const joinedSource = activeSources.join('\n');

    for (const retiredIdentifier of [
      'notificationDigestsApi',
      'useDigestList',
      'useDigestView',
      'useBackfillRun',
      'FishingDigestList',
      'FishingDigestsPage',
      'FishingDigestViewPage',
      'FishingDigestGroup',
      'FishingDigestItem',
      'FishingDigestListResponse',
      'FishingDigestDetail',
      'ListFishingDigestsOptions',
      'listFishingDigestGroups',
      'listFishingDigests',
      'getFishingDigestDetail',
    ]) {
      expect(joinedSource).not.toContain(retiredIdentifier);
    }
  });
});
