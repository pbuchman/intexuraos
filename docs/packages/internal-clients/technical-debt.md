# internal-clients -- Technical Debt

## Current State

Coverage stands at ~98% branch coverage after INT-396 and INT-427. The package is stable and actively consumed by 11 apps.

---

## Known Issues

### 1. Duplicate HTTP logic between `fetchWithAuth` and `UserServiceClient`

`createUserServiceClient` uses raw `fetch()` calls directly rather than delegating to `fetchWithAuth()`. This means two parallel implementations of the same auth-header and error-handling pattern. Consolidating the user-service client to use `fetchWithAuth` internally would reduce duplication and ensure consistent error handling.

**Impact:** Medium. Changes to auth header logic must be applied in two places.

### 2. `http.ts` is a pass-through re-export of `errors.ts`

`shared/http.ts` re-exports everything from `errors.ts`. The file exists for backward compatibility but adds indirection. The actual HTTP utility (`fetchWithAuth`) and its types live in `errors.ts`, which is a misleading filename for a module that contains both error types and the primary HTTP function.

**Impact:** Low. Naming confusion only.

### 3. Response body parsing assumes `{ success, data }` shape

The user-service client casts response bodies with `as { success: boolean; data: ... }`. If the response contract changes, the client silently misinterprets data. Runtime validation (e.g., zod schemas) would catch mismatches earlier.

**Impact:** Low while the response contract is stable. Risk increases if user-service evolves independently.

### 4. Only one OAuth provider supported

`OAuthProvider` is hardcoded to the literal type `'google'`. When additional OAuth providers are added (e.g., Microsoft, GitHub), both the type and the client method require updates.

**Impact:** Low. Expansion is straightforward.

### 5. `providerToKeyField` returns inferred literal types

The `providerToKeyField` helper uses an eslint-disable for `explicit-function-return-type`. The function relies on TypeScript's control flow narrowing. An explicit return type would make the contract clearer and prevent accidental changes.

**Impact:** Low. Cosmetic.

---

## Future Plans

| Area                     | Description                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Additional clients       | Add clients for other internal services (e.g., notion-service, calendar-agent) following the same pattern                             |
| Response validation      | Add runtime schema validation for API responses                                                                                       |
| Retry logic              | Add configurable retry with exponential backoff to `fetchWithAuth`                                                                    |
| OpenAI/Anthropic support | `getLlmClient` errors for OpenAI and Anthropic providers (no factory support yet). Platform fallback (Gemini/Zai) partially mitigates |

---

## Code Quality Notes

- All user IDs are URL-encoded with `encodeURIComponent()` to handle Auth0 pipe-delimited IDs (`auth0|...`)
- `reportLlmSuccess` is explicitly best-effort with a silent catch block
- Null-to-undefined conversion in `getApiKeys` handles JSON serialization differences
