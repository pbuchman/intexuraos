# WhatsApp Message Digests — Public Route Mount Remediation

> Status: complete — canonical Web/proxy/Fastify paths, public route/OpenAPI tests, documentation,
> verifiers, typechecks, lint, format, and diff checks are green.

## Goal

Expose Message Digest public endpoints once beneath the canonical `/api/message-digests` mount,
without the accidental `/api/message-digests/message-digests` duplication.

## Evidence and root cause

- `pnpm run verify:route-resource-names` is RED for all 16 new public service routes.
- `apps/web/service-manifest.json` owns `/api/message-digests`; both Vite and production nginx strip
  that mount before proxying to port `8135`.
- The Web API client then appends `/message-digests`, and Fastify registers the same segment again.
  The currently working local requests therefore use a doubled browser URL rather than the
  repository's canonical mount convention.
- Internal `/internal/message-digests/**` routes are separately mounted and must not change.
- SPA URLs under `#/whatsapp/message-digests/**` are user navigation routes and must not change.

## Constraints

- Keep `/api/message-digests` as the only public infrastructure mount.
- Preserve endpoint semantics, auth, idempotency, OpenAPI schemas, and internal routes.
- Preserve all WhatsApp SPA deep links and notification URL suffixes.
- Do not add an alias or verifier exemption for the doubled path.
- Use focused TDD and do not run full CI.

## Implementation

1. Change Web API contract expectations to service-relative paths (`/`, `/:definitionId`,
   `/delivery-readiness`, and so on) and capture the focused RED result.
2. Change only the Web Message Digest API client paths to those relative paths.
3. Change only Message Digest public Fastify routes and their direct-service/OpenAPI tests to `/`
   and relative subresources; retain all `/internal/message-digests/**` paths.
4. Update service documentation so its route tables are explicitly relative to the public mount.
5. Run the Web API suite, public Message Digest route/legacy suites, service and Web typechecks,
   lint, format, documentation tests, route-resource verifier, endpoint/envelope verifiers, and
   `git diff --check`.

## Completion gate

Browser requests resolve as `/api/message-digests[/…]`, Fastify receives `/[/…]`, OpenAPI exposes
only relative public paths, all focused behavior remains green, and the duplicate-resource verifier
passes. No full CI run is allowed here.
