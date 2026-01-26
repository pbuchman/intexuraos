# Notion Authorization Pattern Analysis

## Status

**Decision:** Keep current manual token pattern (Option A)

**Date:** 2025-01-26

**Related Issues:** INT-341, INT-353, INT-357, INT-358

---

## Current State: Manual Token Pattern

The IntexuraOS platform currently uses a manual token entry pattern for Notion integration:

### How It Works

1. **User obtains integration token:**
   - User goes to Notion's My Integrations page
   - Creates or selects an internal integration
   - Copies the "Internal Integration Token"

2. **User connects via notion-service:**
   - User sends token to `POST /notion/connect`
   - Token is stored in `notion_connections` collection (owned by notion-service)
   - Token never expires (internal integration tokens)

3. **Token storage:**
   - Collection: `notion_connections`
   - Owner: `notion-service`
   - Field: `notionToken` (stored as-is)

4. **Token refresh/expiry:**
   - Not applicable for internal integrations
   - Internal integration tokens do not expire

### Token Permissions

Internal integration tokens have access to:

- Any pages explicitly shared with the integration
- User must manually share each page/database via Notion UI
- Granular per-page access control

### Architecture Separation

Each service that uses Notion owns its own configuration:

| Service             | Collection                 | Purpose                             |
| ------------------- | -------------------------- | ----------------------------------- |
| notion-service      | `notion_connections`       | Notion API token + connection state |
| promptvault-service | `promptvault_settings`     | PromptVault page ID                 |
| research-agent      | `research_export_settings` | Research export page ID             |

This follows the "each service owns its settings" pattern - no single shared settings entity.

---

## Notion OAuth Capabilities

### Available: OAuth 2.0 for Public Integrations

Notion **does** support OAuth 2.0, but only for **public integrations**:

#### OAuth Flow Summary

1. Redirect user to `https://api.notion.com/v1/oauth/authorize`
2. User selects pages to share (via Notion's page picker UI)
3. Notion redirects back with authorization `code`
4. Exchange `code` for `access_token` + `refresh_token`
5. Store tokens for API calls

#### Key Differences: Internal vs Public

| Aspect         | Internal (current)              | Public (OAuth)                                |
| -------------- | ------------------------------- | --------------------------------------------- |
| User base      | Single workspace                | Any Notion user                               |
| Token type     | Integration secret (no expiry)  | Access token (expires) + Refresh token        |
| Access control | Manual page sharing             | OAuth consent with page picker                |
| Setup          | Create integration in Notion UI | Create public integration in developer portal |
| Distribution   | Manual installation             | Public distribution via authorization URL     |

#### Limitations of Notion OAuth

1. **Public integration requirement:**
   - Must apply for and be approved as a "public integration"
   - Requires company website, redirect URI setup
   - Not suitable for internal/personal tools

2. **User-level installation:**
   - Each user must individually authorize
   - No workspace-level token (unlike internal integrations)
   - Multi-user workspaces require each user to authorize separately

3. **Token lifecycle complexity:**
   - Access tokens expire (short-lived)
   - Requires refresh token management
   - Need token rotation and error handling

4. **No significant UX improvement for personal use:**
   - Manual token entry is one-time
   - OAuth also requires user action (authorize page access)
   - For personal tools, manual token is actually simpler

---

## Comparison with Calendar/Linear Integrations

### Google Calendar (OAuth)

**Why OAuth makes sense:**

- Google is a major public service with established OAuth
- Users already have Google accounts
- Standard OAuth flow with well-known scopes
- Permissions model is complex (read-only, events, calendars, etc.)
- Token refresh is well-documented and standard

**Implementation:**

- `oauth_connections` collection stores access + refresh tokens
- Automatic token refresh via `getValidAccessToken` use case
- Scopes: `https://www.googleapis.com/auth/calendar.events`

### Linear (API Key Pattern)

**Why manual API key makes sense:**

- Linear is a developer tool (power users expected)
- API keys don't expire
- Personal access tokens are standard for developer tools
- User-level access (no workspace concept like Notion)

**Implementation:**

- `linear_connections` collection stores API key
- Team selection during connection
- No token refresh needed

### Notion (Internal Integration)

**Why manual token is appropriate:**

- Internal integrations are designed for single-workspace use
- Tokens don't expire
- Manual page sharing is a security feature, not a bug
- Target users are workspace owners, not end consumers
- Similar to Linear: power user tool, not consumer service

---

## Recommendation: Keep Current Pattern (Option A)

**Decision:** Do **not** migrate to Notion OAuth. Keep the current manual token pattern.

### Rationale

1. **Notion OAuth is designed for public distribution:**
   - IntexuraOS is an internal personal tool, not a public SaaS
   - Becoming a "public integration" requires Notion approval
   - The overhead isn't justified for personal use

2. **Current UX is acceptable for target users:**
   - Users setting up IntexuraOS are comfortable with developer tools
   - One-time token entry is simpler than OAuth flow for personal tools
   - Manual page sharing is a security feature (explicit access control)

3. **Technical complexity without benefit:**
   - OAuth adds token refresh logic, expiry handling, error recovery
   - Internal integration tokens don't expire - simpler is better
   - No compelling UX improvement for personal use case

4. **Consistent with similar integrations:**
   - Linear uses API keys (manual)
   - Notion internal integration tokens are similar pattern
   - Calendar OAuth is an outlier (major public service)

### Improvements to Current Pattern

Rather than OAuth, improve the existing experience:

1. **Better onboarding copy:**
   - Clear instructions with screenshots for obtaining token
   - Explain the security model (token never leaves our servers)
   - Show which pages need to be shared

2. **Connection testing:**
   - Verify token works during connection
   - List pages accessible with current token
   - Warn if required pages aren't shared

3. **Status indicators:**
   - Show connection status in UI
   - Last successful sync timestamp
   - Clear error messages if token is invalid

---

## Migration Plan: N/A

No migration recommended. The current pattern is appropriate for the use case.

### If Requirements Change

If IntexuraOS becomes a public SaaS product targeting non-technical users:

1. Apply for Notion public integration status
2. Implement OAuth flow similar to Google Calendar
3. Support both patterns during transition period
4. Create follow-up issue for implementation

---

## References

- [Notion Authorization Documentation](https://developers.notion.com/docs/authorization)
- [Notion Public Integration Requirements](https://developers.notion.com/docs/authorization#public-integration-auth-flow-set-up)
- Current implementation: `apps/notion-service/src/infra/firestore/notionConnectionRepository.ts`
- Calendar OAuth: `apps/user-service/src/infra/google/googleOAuthClient.ts`
- Linear API keys: `apps/linear-agent/src/infra/firestore/linearConnectionRepository.ts`
