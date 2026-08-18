# User Service

The identity and credential vault for IntexuraOS — encrypts your secrets, validates your credentials, and ensures every agent in the system can act on your behalf without ever seeing your keys in the clear.

## The Problem

An AI platform needs to protect every credential with spending authority. User-service provides one active LLM credential surface: OpenRouter. It validates and encrypts the user's key, while callers can fall back to the platform OpenRouter key when no personal key is configured.

Then there is authentication itself. A platform that works across a web dashboard, a command-line tool, and a mobile app needs login flows that work in all three contexts — including the awkward case where there is no browser available.

And then there are the integrations. Connecting Google Calendar requires OAuth tokens that expire and must be refreshed silently. Connecting GitHub for code automation requires storing tokens that never expire but can be revoked at any time. Each provider has its own rules, and the user should never have to think about any of them.

## Use Case: Setting Up for the First Time

You have just signed up and opened Settings.

1. You add an OpenRouter key. The service validates it with OpenRouter's lightweight `/api/v1/key` endpoint before encrypting it.
2. You select an `or:` default model and optional OpenRouter fallback. If you have no personal key, the platform key supplies access automatically.
6. You connect your Google account for calendar access. One OAuth flow, and the calendar-agent can read your schedule indefinitely — tokens refresh automatically in the background.
7. You connect your GitHub account for code automation. Another OAuth flow, and the code-agent can create pull requests on your behalf. GitHub tokens do not expire unless revoked, so there is no refresh logic.
8. You set Speechmatics as your preferred transcription provider. Voice notes from WhatsApp are now processed through your chosen engine.
9. You set your timezone to Europe/Berlin. All time-aware features across the platform now display and process dates in your local timezone.

Nine settings, configured once. From this point on, you never think about credentials again.

## How It Helps

### One Vault for Every Provider

Store an OpenRouter API key in an encrypted vault. It is encrypted with AES-256-GCM immediately, decrypted only in memory, and never written to disk by a requesting service. Retired provider fields can remain in existing records for compatibility but are not active credential options.

Direct Google LLM keys are retired. Google-family language models remain available only through OpenRouter identifiers such as `or:google/...`. This is separate from Google OAuth, which remains available for Calendar access.

What you see in the dashboard is a masked preview: the first four and last four characters, enough to recognize which key is which, never enough to reconstruct it.

### OpenRouter: One Key, Many Providers

OpenRouter acts as a unified gateway to frontier models from multiple providers — Qwen, MiniMax, xAI, Moonshot, Anthropic, Google, OpenAI, Xiaomi, and Z.ai — through a single API key. The service validates OpenRouter keys using a lightweight key-check endpoint that costs zero tokens.

### Validation Before Trust

Every configurable OpenRouter key is checked with `/api/v1/key` before it is accepted. If it is invalid, expired, or out of credits, the service reports that immediately.

You can also re-test stored keys at any time. Test results — pass or fail, with a specific message and timestamp — are stored alongside each key so you always know the last verified state.

### Error Messages You Can Act On

When a provider returns an error, the raw response is often opaque — a cryptic error code with an organization ID and token math that means nothing to a human. The service parses errors from each provider individually and translates them into plain language. A rate limit message becomes "tokens: 85,000/90,000 used, need 10,000 more." A billing error becomes "Insufficient credits — add funds at the provider console." Critically, the parser checks for rate limits before checking for key errors, which prevents a common misdiagnosis where a temporary rate limit looks like a broken key.

### Primary and Fallback Model Selection

Choose an executable OpenRouter default model. The service verifies that OpenRouter access comes from either the user's key or the platform fallback.

Set an optional OpenRouter fallback model. It must differ from the primary and be executable through the same resolved OpenRouter access.

### Authentication Everywhere

Login works across every surface the platform supports. The web dashboard uses Auth0 Universal Login. No browser available? The command-line tool and mobile apps show you a short code on screen. You visit a URL on any device, enter the code, and you are authenticated — no redirect, no pop-up. Token refresh happens silently. A separate OAuth2-compatible endpoint exists for third-party integrations like ChatGPT Actions.

### Connect Your Accounts

Google OAuth connects your Google account for calendar access. Tokens are encrypted with the same AES-256-GCM encryption used for API keys, and the service refreshes them automatically within five minutes of expiry. Connect once, and the calendar-agent handles the rest.

GitHub OAuth connects your GitHub account for code automation. The code-agent uses your GitHub token to create branches, push commits, and open pull requests on your behalf. GitHub tokens do not expire unless revoked, so there is no refresh logic — but if you revoke access at GitHub, the service detects it on the next request and surfaces the issue clearly.

### Personalized Preferences

Set your preferred transcription provider for voice note processing. When you send a voice message via WhatsApp, the platform uses your chosen provider instead of the system default.

Set your timezone so all time-aware features display and process dates correctly for your location.

## Key Benefits

- **Encrypted at rest, decrypted only in memory** — Keys never exist in plaintext outside of a single request lifecycle
- **One LLM key surface** — OpenRouter is the only configurable LLM credential
- **Validated before stored** — A zero-cost OpenRouter key check catches problems at configuration time
- **Explicit access source** — Settings report whether access comes from the user key, platform fallback, or is unavailable
- **Primary + fallback model resilience** — Automatic retry with a secondary model when the primary is unavailable
- **Cascading cleanup** — Deleting an API key automatically clears any dependent primary or fallback model preferences
- **Automatic token refresh** — Google OAuth tokens refresh before expiry with no user interaction
- **Works without a browser** — Device code flow supports CLI and mobile authentication
- **Multi-provider OAuth** — Google and GitHub accounts connect with a single flow each
- **Timezone-aware** — Set once, used across the entire platform

## Limitations

- **Auth0 dependency** — All authentication routes through Auth0; there is no built-in username and password option
- **Two OAuth providers** — Google and GitHub are the only connected OAuth providers today; Microsoft and Notion are not yet supported
- **Validation has a cost** — Testing a key makes a real API call to the provider (except OpenRouter, which uses a free endpoint), incurring a small charge mitigated by always using the cheapest model
- **No user-side rate limits** — Rate limiting is enforced by the providers themselves, not configurable per user
- **Re-authentication on revocation** — If you revoke OAuth access at the provider, you must reconnect manually
- **One transcription provider** — Only Speechmatics is currently supported as a transcription provider

---

_Part of [IntexuraOS](../overview.md) — The trust layer that keeps your keys encrypted, your tokens fresh, and your agents authorized._
