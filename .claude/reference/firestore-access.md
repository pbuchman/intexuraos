# Firestore Access

## Mandatory Local Credential

Firestore investigations MUST use the service-account key explicitly:

```bash
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
INTEXURAOS_GCP_PROJECT_ID=intexuraos-dev-pbuchman \
node path/to/read-only-script.mjs
```

Do not rely on ambient Application Default Credentials. If a command discovers ADC from
`$HOME/.config/gcloud/application_default_credentials.json`, verify it is not being used
for Firestore evidence. Human OAuth ADC files can expire and are not authoritative for
project investigations.

Before any Firestore evidence-gathering command, verify the configured credential file:

```bash
node -e "const fs=require('fs'); const p=process.env.GOOGLE_APPLICATION_CREDENTIALS; if (!p) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is required'); const j=JSON.parse(fs.readFileSync(p,'utf8')); if (j.type !== 'service_account') throw new Error('Firestore access must use a service_account key'); console.log(JSON.stringify({type:j.type,client_email:j.client_email,project_id:j.project_id}))"
```

If `$HOME/.config/gcloud/sa-key.json` is missing, unreadable, or not `type:
service_account`, stop and report the credential problem. Do not run `gcloud auth
application-default login` as a substitute.

## Evidence Safety

Firestore investigation commands are read-only unless the user explicitly asks for a
write, migration, or repair.

Do not print private message bodies, phone numbers, tokens, API keys, service-account
private keys, OAuth tokens, or encrypted secret values. Prefer event types, document ids,
timestamps, counts, text lengths, and short hashes of private text when reporting evidence.

## Query Pattern

Use collection names from `firestore-collections.json` before querying. Do not assume
subcollection shape. If a multi-field query requires a missing composite index, simplify
the read and sort/filter locally for investigation rather than creating an index unless
the user explicitly asked for schema changes.
