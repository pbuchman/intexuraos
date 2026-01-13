# User Service

Central authentication and settings management for IntexuraOS. Handles Auth0 device flow, API key storage with AES-256 encryption, and OAuth token management.

## The Problem

Building a production AI assistant requires:

1. **Secure authentication** - User login that works across web and mobile
2. **API key management** - Store Claude, OpenAI, Google, Perplexity keys securely
3. **OAuth integration** - Connect to Google, Microsoft for additional data
4. **Token refresh** - Keep sessions alive without forcing re-authentication

## How It Helps

User-service provides a unified auth and settings layer:

1. **Auth0 device flow** - Headless authentication for CLI/mobile apps
2. **Encrypted API keys** - AES-256-GCM encryption for all LLM provider keys
3. **OAuth token management** - Automatic refresh for Google/Microsoft connections
4. **Internal key sharing** - Secure service-to-service key distribution

## Use Cases

### Web App Authentication

The web app uses Auth0's Universal Login:

1. User clicks "Login"
2. Redirected to Auth0 hosted login page
3. After authentication, redirected back with authorization code
4. Service exchanges code for tokens

### CLI/Mobile Authentication

Headless devices use the device code flow:

1. User initiates login from CLI
2. Service requests device code from Auth0
3. User shown a verification URL and code
4. User visits URL, enters code on a browser
5. CLI polls for token until authentication completes

### API Key Management

Users configure their LLM provider keys:

1. Keys submitted via web UI
2. Immediately encrypted with AES-256-GCM
3. Stored in Firestore encrypted at rest
4. Retrieved by internal services when needed
5. Other services never see raw keys

### OAuth Token Management

Connect Google/Microsoft accounts:

1. User initiates OAuth flow
2. Redirected to provider's consent page
3. Authorization code exchanged for access/refresh tokens
4. Refresh tokens stored (AES-256 encrypted)
5. Access tokens refreshed automatically when expired

## Key Benefits

**Zero-knowledge architecture** - Services receive decrypted keys but never store them

**Provider flexibility** - Users can switch LLM providers without code changes

**Automatic token refresh** - OAuth tokens refreshed seamlessly before expiry

**Service-to-service auth** - Internal endpoints use shared secret for secure inter-service communication

**Audit logging** - All LLM API calls logged for cost tracking

## Limitations

**Auth0 dependency** - Service requires Auth0 tenant configuration

**No username/password login** - Only OAuth/device code flows supported

**Single OAuth provider** - Only Google OAuth is currently implemented

**No key validation** - API keys are stored but not validated until use

**No key usage limits** - No per-user or per-key rate limiting enforced

**No backup codes** - If OAuth tokens are lost, user must re-authenticate
