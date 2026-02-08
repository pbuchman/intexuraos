# Technical Debt: @intexuraos/infra-whatsapp

## TODOs and FIXMEs

No TODO/FIXME markers found in source code.

## Code Quality Observations

### No Timeout on sendTextMessage

`sendTextMessage` does not use an `AbortController` timeout, unlike `downloadMedia`, `markAsRead`, and `markAsReadWithTyping` which all have 30-second timeouts.

**Impact:** Medium. A slow or hung Facebook Graph API response could block indefinitely.

**Recommendation:** Add a timeout to `sendTextMessage` consistent with the 30-second pattern used by other methods.

### No Timeout on getMediaUrl

`getMediaUrl` also lacks a timeout mechanism.

**Impact:** Medium. Same issue as `sendTextMessage`.

**Recommendation:** Add `AbortController` timeout.

### Duplicated Timeout Cleanup Pattern

Each method with a timeout duplicates the `AbortController` + `clearTimeout` pattern:

```ts
const controller = new AbortController();
const timeoutId = setTimeout(() => { controller.abort(); }, TIMEOUT_MS);
try {
  // ...
  clearTimeout(timeoutId);
} catch (error) {
  clearTimeout(timeoutId);
  // ...
}
```

**Impact:** Low. Functional but verbose.

**Recommendation:** Extract a `fetchWithTimeout` utility (similar to the one in `infra-perplexity`) to reduce repetition.

### Hardcoded API Version

The WhatsApp API version is hardcoded:

```ts
const WHATSAPP_API_VERSION = 'v22.0';
```

**Impact:** Low. WhatsApp API versions are stable, but upgrading requires a code change.

**Recommendation:** Consider making the API version configurable or ensuring a regular update cadence.

### No Retry Logic

None of the methods implement retry logic. Transient failures (network blips, 429 rate limits) are returned as errors.

**Impact:** Medium. Consumers must implement their own retry strategies.

**Recommendation:** Add configurable retry with exponential backoff, especially for `sendTextMessage` and `markAsRead`.

## Future Improvements

- Add `AbortController` timeout to `sendTextMessage` and `getMediaUrl`
- Extract `fetchWithTimeout` utility to eliminate duplication
- Add media upload support (send images, documents, audio)
- Add template message support
- Add interactive message support (buttons, lists)
- Consider adding retry logic for transient failures
