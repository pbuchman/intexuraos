# User Service

The trust layer beneath IntexuraOS — the service that encrypts your secrets, validates your credentials, and makes sure every agent in the system can act on your behalf without ever seeing your keys in the clear.

## The Problem

An AI platform that connects to five different providers needs five different API keys. Each key is a credential with real spending authority — an OpenAI key with a $500 monthly limit, an Anthropic key tied to a corporate account, a Google key with access to production models. Storing them correctly is table stakes. The harder problem is everything that surrounds storage: validating that a key actually works before you trust it, distributing it to a dozen services that need it without writing it to disk, catching an expired key before it causes a confusing failure three layers deep, and translating a cryptic provider error into something a human can act on.

Then there is authentication itself. A platform that works across a web dashboard, a command-line tool, and a mobile app needs login flows that work in all three contexts — including the awkward case where there is no browser available.

And then there are the integrations. Connecting Google Calendar requires OAuth tokens that expire and must be refreshed silently. Connecting GitHub for code automation requires storing tokens that never expire but can be revoked at any time. Each provider has its own rules, and the user should never have to think about any of them.

## Use Case: Setting Up for the First Time

You have just signed up and opened Settings.

1. You paste your OpenAI API key. Before storing it, the service makes a real call to OpenAI using the cheapest available model. Two seconds later: a green checkmark. The key works.
2. You add an Anthropic key, but this one has expired billing. Instead of accepting it silently and failing later when you submit a research query, the service tells you now: "Insufficient Anthropic API credits."
3. You select "Claude Haiku 3.5" as your default fast model. The service verifies you have an Anthropic API key configured before accepting — you cannot select a model for a provider you have not set up. Every agent across the platform now uses it for quick generation tasks.
4. You connect your Google account for calendar access. One OAuth flow, and the calendar-agent can read your schedule indefinitely — tokens refresh automatically in the background.
5. You connect your GitHub account for code automation. Another OAuth flow, and the code-agent can create pull requests on your behalf. GitHub tokens do not expire, so there is nothing to refresh.
6. You set Speechmatics as your preferred transcription provider. Voice notes from WhatsApp are now processed through your chosen engine.

Six settings, configured once. From this point on, you never think about credentials again.

## How It Helps

### One Vault for Every Provider

Store API keys for Google (Gemini), OpenAI (GPT), Anthropic (Claude), and Perplexity in a single encrypted vault. Keys are encrypted with AES-256-GCM the moment they arrive and never exist in plaintext at rest. When another service — the research-agent querying multiple models in parallel, or the image-service generating a cover — needs your key, it requests it through a secure internal channel. The key is decrypted in memory, used, and never written to disk by the requesting service.

What you see in the dashboard is a masked preview: the first four and last four characters, enough to recognize which key is which, never enough to reconstruct it.

### Validation Before Trust

Every key is tested against its provider's actual API before it is accepted. The service picks the cheapest model for each provider — Gemini 2.0 Flash for Google, GPT-4o Mini for OpenAI, Haiku 3.5 for Anthropic — and makes a real call. If the key is invalid, expired, or out of credits, you find out immediately, not three hours later when a research query silently fails.

You can also re-test stored keys at any time. Test results — pass or fail, with a specific message and timestamp — are stored alongside each key so you always know the last verified state.

### Error Messages You Can Act On

When a provider returns an error, the raw response is often opaque — a cryptic error code with an organization ID and token math that means nothing to a human. The service parses errors from each provider individually and translates them into plain language. A rate limit message becomes "tokens: 85,000/90,000 used, need 10,000 more." A billing error becomes "Insufficient credits — add funds at the provider console." Critically, the parser checks for rate limits before checking for key errors, which prevents a common misdiagnosis where a temporary rate limit looks like a broken key.

### Authentication Everywhere

Login works across every surface the platform supports. The web dashboard uses Auth0 Universal Login. No browser available? The command-line tool and mobile apps show you a short code on screen. You visit a URL on any device, enter the code, and you are authenticated — no redirect, no pop-up. Token refresh happens silently. A separate OAuth2-compatible endpoint exists for third-party integrations like ChatGPT Actions.

### Connect Your Accounts

Google OAuth connects your Google account for calendar access. Tokens are encrypted with the same AES-256-GCM encryption used for API keys, and the service refreshes them automatically within five minutes of expiry. Connect once, and the calendar-agent handles the rest.

GitHub OAuth connects your GitHub account for code automation. The code-agent uses your GitHub token to create branches, push commits, and open pull requests on your behalf. GitHub tokens do not expire unless revoked, so there is no refresh logic — but if you revoke access at GitHub, the service detects it on the next request and surfaces the issue clearly.

### Personalized AI Preferences

Choose your default fast model — the model every agent uses for quick generation tasks. The service validates that you have a working API key for the model's provider before accepting your choice, preventing configuration errors that would only surface at runtime. If you delete an API key, any default model that depends on that provider is automatically cleared.

Set your preferred transcription provider for voice note processing. When you send a voice message via WhatsApp, the platform uses your chosen provider instead of the system default.

## Key Benefits

- **Encrypted at rest, decrypted only in memory** — Keys never exist in plaintext outside of a single request lifecycle
- **Validated before stored** — Real API calls catch problems at configuration time, not at runtime
- **Provider-aware error translation** — Cryptic responses become actionable messages across all four providers
- **One default model, every agent** — Set your preferred fast model once and all agents inherit it
- **Automatic token refresh** — Google OAuth tokens refresh before expiry with no user interaction
- **Works without a browser** — Device code flow supports CLI and mobile authentication
- **Multi-provider OAuth** — Google and GitHub accounts connect with a single flow each
- **Cascading cleanup** — Deleting an API key automatically clears any dependent preferences

## Limitations

- **Auth0 dependency** — All authentication routes through Auth0; there is no built-in username and password option
- **Two OAuth providers** — Google and GitHub are the only connected OAuth providers today; Microsoft and Notion are not yet supported
- **Validation has a cost** — Testing a key makes a real API call to the provider, which incurs a small charge (mitigated by always using the cheapest model)
- **No user-side rate limits** — Rate limiting is enforced by the providers themselves, not configurable per user
- **Re-authentication on revocation** — If you revoke OAuth access at the provider, you must reconnect manually
- **One transcription provider** — Only Speechmatics is currently supported as a transcription provider

---

_Part of [IntexuraOS](../overview.md) — The trust layer that keeps your keys encrypted, your tokens fresh, and your agents authorized._
