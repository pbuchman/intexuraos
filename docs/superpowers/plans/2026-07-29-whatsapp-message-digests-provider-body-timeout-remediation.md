# WhatsApp Message Digests — Provider Body Timeout Remediation

> **Execution:** Primary agent only. Follow `superpowers:systematic-debugging`,
> `superpowers:test-driven-development`, and `superpowers:executing-plans`. Review agents remain
> read-only.

## Goal

Make the exported 30-second WhatsApp send timeout truthful for the complete provider operation,
including response-body consumption. This is required for the Message Digest pre-send authorization
lease to cover every possible external-send path.

## Root cause and contract

`WhatsAppCloudApiSender.sendRequest` currently clears its abort timer immediately after response
headers resolve, before awaiting an error `response.text()` or success `response.json()`. Either body
read can stall indefinitely while the route's renewed authorization expires.

The timeout must remain armed from request start through complete response-body parsing. Every exit
clears it exactly once in `finally`. If body parsing is still pending when the deadline fires, the
AbortSignal is triggered and the sender returns the same safe timeout error; no provider identifiers
or response content enter logs. The 30-second exported constant remains the single timeout source.

## Files in scope

- `apps/whatsapp-service/src/infra/whatsapp/sender.ts`
- `apps/whatsapp-service/src/__tests__/infra/sender.test.ts`
- this plan and active GOAL evidence

No API, receipt, lease duration, feature flag, or deployment change is in scope.

## RED → GREEN

1. Add a fake-timer digest-template test whose fetch resolves headers immediately but whose
   `json()` remains blocked until abort. Assert the signal is not aborted at 29,999 ms, is aborted at
   30,000 ms, and the send settles as the existing timeout error without a WAMID.
2. Add the equivalent blocked error-body assertion if the existing test helpers make it concise;
   at minimum, code structure must keep one timer through both `text()` and `json()` paths.
3. Observe RED because the current timer is cleared after headers.
4. Move timer cleanup to `finally`; remove early clear calls. Preserve response classification,
   privacy-safe logs, and return envelopes.
5. Run the sender suite, WhatsApp typecheck, scoped ESLint, and `git diff --check`, then request a
   fresh read-only test/backend review. Do not start migration/full CI while this finding is open.
