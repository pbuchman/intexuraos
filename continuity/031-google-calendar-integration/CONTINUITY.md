# Continuity Ledger — 031-google-calendar-integration

## Goal

Add OAuth connections to **user-service**, create **calendar-agent** service for Google Calendar operations, and integrate calendar action handling into **actions-agent** with a two-phase approval flow.

## Success Criteria

1. Users can connect Google Calendar via OAuth in Settings page
2. Calendar-agent can list, create, update, delete events and query free/busy
3. WhatsApp "calendar" actions flow through approval before creating events
4. Token refresh happens automatically when tokens expire
5. 95% test coverage maintained across all services
6. Deployed to dev environment with verified /health endpoints

---

## Status

### Done

- [x] 0-0-setup.md — Initial setup and Google Cloud Console config
  - Added `oauth_connections` to firestore-collections.json
  - Documented Google Cloud Console requirements (OAuth credentials, Calendar API, consent screen)
  - Documented required OAuth scopes: `calendar.events`, `userinfo.email`
  - Verified encryption pattern in user-service

- [x] 1-0-user-service.md — OAuth domain + routes in user-service
  - OAuth domain: models, ports, use cases (initiateOAuthFlow, exchangeOAuthCode, getValidAccessToken, disconnectProvider)
  - Google OAuth client implementation with calendar scopes
  - Firestore repository with encrypted token storage
  - Public routes: /oauth/connections/google/{initiate,callback,status,disconnect}
  - Internal route: /internal/users/:userId/oauth/google/token
  - Comprehensive test coverage with fakes

- [x] 1-1-calendar-agent.md — New calendar-agent service
  - Domain: CalendarEvent, CreateEventInput, UpdateEventInput, FreeBusy models
  - Use cases: listEvents, getEvent, createEvent, updateEvent, deleteEvent, getFreeBusy
  - Infrastructure: GoogleCalendarClientImpl (googleapis), UserServiceClientImpl (token retrieval)
  - Routes: RESTful calendar endpoints with authentication
  - Test coverage: 65 tests covering routes and infrastructure (95.06% branch coverage)

- [x] 1-3-web-ui.md — Connection page + sidebar
  - GoogleCalendarConnectionPage.tsx with OAuth redirect flow
  - googleCalendarApi.ts service functions (status, initiate, disconnect)
  - Sidebar navigation with Calendar icon
  - Route /settings/calendar in App.tsx
  - Type definitions for GoogleCalendarStatus and GoogleCalendarInitiateResponse

- [x] 2-0-terraform.md — Infrastructure deployment
  - Added INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID, INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET, INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI secrets
  - Added INTEXURAOS_CALENDAR_AGENT_URL secret
  - Added calendar_agent to local.services
  - Created calendar-agent Cloud Run module with auth/internal secrets
  - Updated user-service with Google OAuth secrets
  - Updated actions-agent with calendar-agent URL
  - Updated api_docs_hub with calendar-agent OpenAPI URL
  - Added calendar_agent_url output

### Skipped

- [ ] 1-2-actions-agent.md — Calendar handler in actions-agent (to be implemented separately)

- [x] 2-1-integration.md — End-to-end testing
  - Unit tests pass with 95.06% branch coverage (3607 tests)
  - Action flow testing skipped (1-2-actions-agent not implemented)
  - Manual local testing deferred to deployment verification

### Now

- [ ] 2-2-deploy-verify.md — Deploy to dev + verify /health
  - Implementation complete, awaiting deployment with GCP credentials
  - Docker images: user-service, calendar-agent, actions-agent ready to build
  - Terraform configuration validated
  - Calendar action testing pending 1-2-actions-agent implementation

---

## Key Decisions

| Decision                                         | Rationale                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| OAuth in user-service (not separate service)     | Already handles Auth0 OAuth, encrypted tokens, internal endpoints |
| Two-phase approval flow for calendar actions     | User control before creating events in their calendar             |
| calendar-agent gets tokens via internal endpoint | Centralized token management in user-service                      |

---

## Open Questions

(none currently)

---

## Blockers

(none currently)
