# 0-0 Initial Setup

**Tier:** 0 (Setup/Diagnostics)

## Context

This task prepares the foundation for Google Calendar integration:

- Firestore collection registration
- Documentation of Google Cloud Console requirements
- Validation that existing patterns are understood

## Problem Statement

Before implementing OAuth and calendar features, we need:

1. A registered Firestore collection for OAuth tokens
2. Clear documentation of manual Google Cloud Console steps
3. Understanding of existing encryption and OAuth patterns

## Scope

**In scope:**

- Add `oauth_connections` collection to `firestore-collections.json`
- Document Google Cloud Console setup requirements
- Review existing encryption patterns in user-service

**Not in scope:**

- Actual Google Cloud Console configuration (manual step)
- Secret Manager updates (Terraform task)
- Code implementation (later tiers)

## Required Approach

1. Read existing `firestore-collections.json` to understand format
2. Add `oauth_connections` collection owned by `user-service`
3. Read `apps/user-service/src/infra/firestore/authTokenRepository.ts` for encryption patterns
4. Document Google Cloud Console requirements

## Step Checklist

- [x] Read `firestore-collections.json` and understand structure
- [x] Add `oauth_connections` collection entry
- [x] Read existing encryption implementation in authTokenRepository.ts
- [x] Document Google OAuth scopes needed
- [x] Run `npm run verify:firestore` to validate collection registration
- [ ] Run `npm run ci` to ensure no regressions

## Definition of Done

- [x] `oauth_connections` appears in `firestore-collections.json` with owner `user-service`
- [x] Google Cloud Console requirements documented
- [x] `npm run verify:firestore` passes
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run verify:firestore
npm run ci
```

## Rollback Plan

If issues arise:

1. Revert changes to `firestore-collections.json`
2. No infrastructure changes to roll back

---

## Google Cloud Console Setup Requirements

### 1. Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth client ID**
5. Application type: **Web application**
6. Name: `IntexuraOS Calendar Integration`
7. Authorized redirect URIs:
   - Production: `https://<user-service-url>/oauth/connections/google/callback`
   - Local dev: `http://localhost:8100/oauth/connections/google/callback`
8. Click **Create**
9. Save the **Client ID** and **Client Secret**

### 2. Enable Google Calendar API

1. Navigate to **APIs & Services > Library**
2. Search for "Google Calendar API"
3. Click **Enable**

### 3. Configure OAuth Consent Screen

1. Navigate to **APIs & Services > OAuth consent screen**
2. User Type: **External** (or Internal for Google Workspace)
3. App name: `IntexuraOS`
4. User support email: your email
5. Scopes: Add the following:
   - `https://www.googleapis.com/auth/calendar` (full calendar access)
   - `https://www.googleapis.com/auth/calendar.events` (events only)
   - `https://www.googleapis.com/auth/userinfo.email` (get user's email)
6. Test users: Add test accounts while in development mode

### 4. Required OAuth Scopes

```
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/userinfo.email
```

The `calendar.events` scope allows:

- Read/write access to calendar events
- Free/busy queries

The `userinfo.email` scope allows:

- Displaying the connected Google account email in the UI

### 5. Secret Manager Values (for Terraform)

After creating credentials, add to Secret Manager:

- `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`: The OAuth client ID
- `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET`: The OAuth client secret

---

## Encryption Pattern Reference

The existing `encryption.ts` module provides:

- `encryptToken(token: string): string` - AES-256-GCM encryption
- `decryptToken(encryptedData: string): string` - Decryption
- Format: `iv:authTag:ciphertext` (all base64)
- Uses `INTEXURAOS_TOKEN_ENCRYPTION_KEY` env var (has dev fallback)

OAuth connections will use the same encryption for:

- `refreshToken` - Long-lived token for getting new access tokens
- `accessToken` - Short-lived token for API calls (stored for caching)

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
