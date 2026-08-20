# Firestore Access

## Mandatory Identity Boundary

Firestore investigations use an explicitly selected, read-only or
least-privilege investigator identity. Prefer short-lived operator ADC with
service-account impersonation. Do not use:

- the Hetzner provisioner/bootstrap identity;
- the production runtime JSON rendered from the PROD package;
- an orchestrator or code-worker credential;
- an unverified ambient ADC identity.

The command must identify the retained project and clear Firestore/Storage
emulator variables. Verify the active principal and project before gathering
evidence:

```bash
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gcloud config get-value project
```

For a transitional file-backed credential, use a dedicated external path,
mode `0600`, outside the repository and both secret packages. Set
`GOOGLE_APPLICATION_CREDENTIALS` explicitly for the command. Validate only
`type`, `client_email`, `project_id`, and `private_key_id`; never print the
private key or whole JSON. A missing, unreadable, overly permissive, or
unexpected credential is a stop condition.

The service-account JSON contained in PROD is a Hetzner runtime projection,
not an operator bootstrap mechanism. DEV intentionally contains no GCP
credential; local/home-dev use a separately managed least-privilege or
short-lived identity. A credential can never be used to open the package
containing itself.

The home-dev package renderer identity `ixos-home-secret-renderer-dev` has only
DEV package accessor and is not a Firestore investigator identity. Its external
bootstrap file must not be reused for queries or passed to workers.

## Evidence Safety

Firestore investigation commands are read-only unless the user explicitly
asks for a write, migration, or repair.

Do not print private message bodies, phone numbers, tokens, API keys,
service-account private keys, OAuth tokens, complete runtime environments, or
encrypted secret values. Prefer event types, document IDs, timestamps, counts,
text lengths, and short non-reversible identifiers when reporting evidence.

Never fetch or render a secret package merely to investigate Firestore. If an
approved runtime-equivalence test requires a rendered credential, use the exact
numeric package version already selected for that environment, keep the file
mode `0600`, validate metadata only, and destroy the temporary projection after
the test.

## Query Pattern

Use collection names from `firestore-collections.json` before querying. Do not
assume subcollection shape. If a multi-field query requires a missing composite
index, simplify the read and sort/filter locally for investigation rather than
creating an index unless the user explicitly asked for schema changes.

Record the principal, project, timestamp, query scope, counts, and redacted
result. Do not record access tokens, credential paths that reveal private host
layout, or document contents.
