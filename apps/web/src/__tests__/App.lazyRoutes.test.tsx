import { describe, it, expect } from 'vitest';
// @ts-expect-error vite raw import has no type declaration
import src from '../App.tsx?raw'; // @allow-missing-js -- vite '?raw' query import

describe('App.tsx lazy-loaded routes', () => {
  const source = src as string;

  it('imports every page via React.lazy', () => {
    expect(source).not.toMatch(/from '@\/pages'/);
    const lazyCount = (source.match(/React\.lazy\(/g) ?? []).length;
    expect(lazyCount).toBeGreaterThanOrEqual(30);
  });

  it('wraps routes in <Suspense fallback={<FullPageSpinner', () => {
    expect(source).toMatch(/<Suspense[^>]*fallback={<FullPageSpinner/);
  });

  it('keeps WhatsApp assistant, sessions, and private log routes under the WhatsApp section', () => {
    expect(source).toContain('path="/whatsapp/assistant"');
    expect(source).toContain('path="/intex-agent/sessions"');
    expect(source).toContain('path="/whatsapp/private"');
    expect(source).toMatch(/path="\/whatsapp"\s+element={<Navigate to="\/whatsapp\/assistant" replace \/>}/);
    expect(source).toMatch(/path="\/whatsapp\/sessions"\s+element={<Navigate to="\/intex-agent\/sessions" replace \/>}/);
    expect(source).toMatch(/path="\/notes"\s+element={<Navigate to="\/whatsapp\/assistant" replace \/>}/);
    expect(source).toMatch(/path="\/whatsapp-notes"\s+element={<Navigate to="\/whatsapp\/assistant" replace \/>}/);
  });

  it('lazy-loads every canonical WhatsApp Message Digest route', () => {
    for (const page of [
      'WhatsAppMessageDigestsPage',
      'WhatsAppMessageDigestNewPage',
      'WhatsAppMessageDigestDetailPage',
      'WhatsAppMessageDigestEditPage',
      'WhatsAppMessageDigestHistoryPage',
      'WhatsAppMessageDigestRunPage',
    ]) {
      expect(source).toContain(`const ${page} = React.lazy(`);
    }

    for (const path of [
      '/whatsapp/message-digests',
      '/whatsapp/message-digests/new',
      '/whatsapp/message-digests/:definitionId',
      '/whatsapp/message-digests/:definitionId/edit',
      '/whatsapp/message-digests/:definitionId/history',
      '/whatsapp/message-digests/:definitionId/history/:runId',
    ]) {
      expect(source).toContain(`path="${path}"`);
    }
  });

  it('redirects legacy Mobile digest entry points without rendering the old pages', () => {
    expect(source).not.toContain('const NotificationDigestsPage = React.lazy(');
    expect(source).not.toContain('const NotificationDigestBackfillPage = React.lazy(');
    expect(source).not.toContain('const NotificationDigestViewPage = React.lazy(');
    expect(source).toMatch(
      /path="\/notifications\/digests"\s+element={<Navigate to="\/whatsapp\/message-digests" replace \/>}/
    );
    expect(source).toMatch(
      /path="\/notifications\/digests\/backfill"\s+element={<Navigate to="\/whatsapp\/message-digests" replace \/>}/
    );
    expect(source).toContain('path="/notifications/digests/:groupKey/:date"');
    expect(source).toContain('element={<MessageDigestLegacyRedirectPage />}');
  });

  it('redirects legacy Fishing digest entry points without rendering duplicate pages', () => {
    expect(source).not.toContain('const FishingDigestsPage = React.lazy(');
    expect(source).not.toContain('const FishingDigestViewPage = React.lazy(');
    expect(source).toMatch(
      /path="\/fishing-assistant\/digests"\s+element={<Navigate to="\/whatsapp\/message-digests" replace \/>}/
    );
    expect(source).toMatch(
      /path="\/fishing\/digests"\s+element={<Navigate to="\/whatsapp\/message-digests" replace \/>}/
    );
    expect(source).toContain('path="/fishing-assistant/digests/:groupKey/:date"');
    expect(source).toContain('path="/fishing/digests/:groupKey/:date"');
  });

  it('uses Intex Agent sessions as the authenticated landing page', () => {
    expect(source).toMatch(/<Navigate to="\/intex-agent\/sessions" replace \/>/);
    expect(source).toMatch(/path="\*"\s+element={<Navigate to="\/intex-agent\/sessions" replace \/>}/);
  });
});
