# 1-0 OAuth in user-service

**Tier:** 1 (Independent Deliverable)

## Context

user-service already handles Auth0 OAuth and encrypted token storage. We're extending it with Google OAuth connections for calendar access. This follows the existing pattern in `authTokenRepository.ts`.

## Problem Statement

Users need to connect their Google Calendar accounts via OAuth. The user-service must:

1. Initiate OAuth flow with correct scopes
2. Exchange authorization codes for tokens
3. Store encrypted refresh/access tokens in Firestore
4. Auto-refresh expired tokens
5. Expose internal endpoint for other services to get valid tokens

## Scope

**In scope:**

- Domain layer: models, ports, use cases for OAuth
- Infrastructure: Firestore repository with encryption, Google OAuth client
- Public routes: initiate, callback, status, disconnect
- Internal route: get valid token for uid

**Not in scope:**

- Google Cloud Console setup (Tier 0)
- Terraform changes (Tier 2)
- Calendar operations (calendar-agent task)

## Required Approach

1. Create domain models following existing patterns
2. Create use cases with Result types
3. Implement Firestore repository using `encryptToken`/`decryptToken`
4. Implement Google OAuth client for token exchange/refresh
5. Create routes with proper auth middleware
6. Write comprehensive tests (95% coverage)

## Step Checklist

- [ ] Create `apps/user-service/src/domain/oauth/models.ts` (OAuthProvider, OAuthConnection, OAuthTokens)
- [ ] Create `apps/user-service/src/domain/oauth/errors.ts` (OAuthErrorCode)
- [ ] Create `apps/user-service/src/domain/oauth/ports.ts` (OAuthConnectionRepository, GoogleOAuthClient interfaces)
- [ ] Create `apps/user-service/src/domain/oauth/useCases/initiateOAuthFlow.ts`
- [ ] Create `apps/user-service/src/domain/oauth/useCases/exchangeOAuthCode.ts`
- [ ] Create `apps/user-service/src/domain/oauth/useCases/getValidAccessToken.ts`
- [ ] Create `apps/user-service/src/domain/oauth/useCases/disconnectProvider.ts`
- [ ] Create `apps/user-service/src/domain/oauth/index.ts`
- [ ] Create `apps/user-service/src/infra/firestore/oauthConnectionRepository.ts`
- [ ] Create `apps/user-service/src/infra/google/googleOAuthClient.ts`
- [ ] Create `apps/user-service/src/routes/oauthConnectionRoutes.ts`
- [ ] Add internal endpoint to `apps/user-service/src/routes/internalRoutes.ts`
- [ ] Update `apps/user-service/src/services.ts` with new dependencies
- [ ] Update `apps/user-service/src/config.ts` with Google OAuth config
- [ ] Add INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID and INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET to REQUIRED_ENV
- [ ] Write domain tests (use cases)
- [ ] Write infrastructure tests (repository, OAuth client)
- [ ] Write route integration tests
- [ ] Run `npm run ci`

## Definition of Done

- [ ] All domain models and use cases implemented with Result types
- [ ] Repository stores encrypted tokens in `oauth_connections` collection
- [ ] OAuth client handles token exchange and refresh
- [ ] Routes: POST /oauth/connections/google/initiate, GET /callback, GET /status, DELETE /
- [ ] Internal route: GET /internal/users/:uid/oauth/google/token
- [ ] 95% test coverage
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test -w @intexuraos/user-service
npm run typecheck -w @intexuraos/user-service
npm run ci
```

## Rollback Plan

1. Revert all changes to `apps/user-service/`
2. No infrastructure changes to roll back

## Critical Files Reference

| Purpose                   | File                                                           |
| ------------------------- | -------------------------------------------------------------- |
| Token encryption pattern  | `apps/user-service/src/infra/firestore/authTokenRepository.ts` |
| Internal endpoint pattern | `apps/user-service/src/routes/internalRoutes.ts`               |
| Existing encryption utils | `apps/user-service/src/infra/firestore/encryption.js`          |

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
