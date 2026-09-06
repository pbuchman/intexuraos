# WhatsApp Message Digests — Legacy Route Parameter Remediation

**Status:** Complete

**Observed behavior:** The public legacy-alias route test expected every malformed path value to
reach JSON Schema and return `400`. Fastify rejects a 129-character path parameter at the router's
shorter built-in parameter boundary, so the request never matches the route and returns `404`.

**Decision:** Preserve the stricter router boundary. Accept `404` for an overlong alias, retain
`400` for malformed values that reach route validation, and prove that neither case reaches the
Message Digest store. No runtime configuration or public data behavior changes.

**Verification:** Re-run `legacyAliasRoutes.test.ts`, then the complete Task 1 focused gate and both
affected package typechecks.
