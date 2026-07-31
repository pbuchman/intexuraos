# WhatsApp Message Digests Canonical Token Remediation Plan

## Trigger

The focused WhatsApp security matrix intermittently accepted a cursor token whose final base64url character had changed. AES-256-GCM authentication remained intact because Node decoded the alternate non-canonical base64url spelling to the exact same encrypted bytes.

## Root cause

`parseTokenParts()` validates the base64url alphabet and decodes it, but does not require the encoded segment to be the canonical encoding of those bytes. Unused low bits in a final base64url character can therefore admit multiple textual spellings for one authenticated byte sequence. That breaks the token's byte-stable textual identity and makes the tamper test nondeterministic.

## RED/GREEN implementation

1. Make the security test deterministically find a different base64url spelling that decodes to the same bytes, and prove it is rejected.
2. Run only `privateDigestSourceToken.test.ts` and capture RED against the current parser.
3. In `parseTokenParts()`, decode the encrypted segment and require `encrypted.toString('base64url')` to equal the supplied segment before decryption.
4. Rerun the focused token test, then the exact WhatsApp digest matrix that found the issue.

## Acceptance

- Canonical issued tokens still round-trip and key rotation still works.
- Any alternate non-canonical spelling is rejected content-free before decryption.
- Binding, expiry, purpose separation, and GCM tamper tests remain green.
- No token content, secret, source identifier, or private message is logged.
