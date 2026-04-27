# Runbook — Internal Service-to-Service Auth Token Rotation

## Purpose

IntexuraOS services authenticate to each other via the shared
`INTEXURAOS_INTERNAL_AUTH_TOKEN` (sent in the `x-internal-auth` header).
Rotating this secret on a regular cadence limits the blast radius of a
leaked token.

`validateInternalAuth` (`@intexuraos/common-http`) supports a **dual-token
rotation window**: while both `INTEXURAOS_INTERNAL_AUTH_TOKEN` (current)
and `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` (previous) are configured,
either is accepted. This lets services be redeployed in any order without
a coordinated cut-over.

## Rotation Procedure

### 1. Generate a new token

```bash
openssl rand -hex 32
```

The output is the **new current** token. Keep the **old current** value
on hand — it becomes the **previous** token in the next step.

### 2. Set `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` = old token

In Secret Manager (or the equivalent for the target environment), for
**every** service that calls `validateInternalAuth` or sends
`x-internal-auth`, add the secret:

- Name: `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS`
- Value: the **old** `INTEXURAOS_INTERNAL_AUTH_TOKEN`

Do not touch `INTEXURAOS_INTERNAL_AUTH_TOKEN` yet.

### 3. Set `INTEXURAOS_INTERNAL_AUTH_TOKEN` = new token

For the **same** services, update:

- Name: `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- Value: the **new** token from step 1

### 4. Deploy ALL services

Redeploy every service. Order does not matter — during the rotation
window, both tokens are accepted, so a caller running with the new
token can still reach a callee that hasn't redeployed yet (and vice
versa).

### 5. Wait 24h and verify rotation traffic has stopped

Every time the previous token is accepted, services emit a
warn-level log:

```
Internal auth: PREVIOUS token accepted (rotation window active)
```

After 24 hours, query logs (Cloud Logging in prod, PM2 logs in dev) for
that exact phrase. **Zero hits over a 1h sample = safe to remove the
previous token.** Non-zero hits = a service is still running the old
deployment; investigate before proceeding.

### 6. Remove `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS`

Delete the `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` secret from every
service and redeploy. Once removed, presenting the old token returns
`401 UNAUTHORIZED`.

## Cadence

Rotate **quarterly** at minimum. Also rotate on demand if a token leak
is suspected.

## Rollback

If the new token causes incidents (e.g. bad value, deploy regression):

1. Leave `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` in place.
2. Revert `INTEXURAOS_INTERNAL_AUTH_TOKEN` to the **old** value.
3. Redeploy all services.

The dual-token window means rollback also tolerates partial deploys.

## Reference

- Implementation: `packages/common-http/src/auth/internalAuth.ts`
- Tests: `packages/common-http/src/__tests__/internalAuth.dualToken.test.ts`
- Header: `x-internal-auth`
- Env vars:
  - `INTEXURAOS_INTERNAL_AUTH_TOKEN` (current, required)
  - `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` (previous, optional —
    only set during a rotation window)
