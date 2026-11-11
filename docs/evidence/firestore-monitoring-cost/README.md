# Firestore monitoring cost evidence

Production project: `intexuraos-dev-pbuchman`, database `(default)`, location `eur3`. The database serves production despite its project name.

## Baseline measured 2026-11-10

Live Home PROD code pointer resolved to `60c022386fa147f9c5b93aafd488a6c0d5144654.aiN3AN`, profile `full`. Successful deployment workflow: https://github.com/pbuchman/intexuraos/actions/runs/42844066086. The host timer was active with `OnUnitActiveUSec=1min`. Its installed Python probes the five application monitoring endpoints. Direct authenticated endpoint checks returned HTTP 200; all three delivery summaries had zero pending and failed notifications.

The read-only measurement harness reproduces the inspected monitoring queries of that exact revision, using the production runtime's existing ADC and explicit project selection. It does not write data or print identifiers/content. Three actual database reads, at 17:16:35Z, 17:17:40Z and 17:18:47Z, returned identical counts and sizes:

| Collection(s) | Returned documents per cycle | Protobuf document bytes per cycle |
| --- | ---: | ---: |
| Message Digest history | 231 | 1,586,654 |
| Active digest definitions | 1 | 3,238 |
| Active calendar schedules | 1 | 1,477 |
| Calendar runs (7 days) | 7 | 5,459 |
| Unexpired WhatsApp intents | 14 | 12,574 |
| Unexpired WhatsApp markers | 7 | 5,381 |
| Five heartbeat collections | 14 | 5,870 |
| **Total** | **275** | **1,620,653** |

Each cycle made six queries and fourteen point reads, with no empty query or missing document. These are separate controlled executions of the same queries as production, not billing attribution inferred from a dashboard. Persisted heartbeat start/finish transaction reads and writes are additional and not included in this GET baseline.

At unchanged cardinality, 1,440 cycles/day would mean 396,000 returned documents and 2,333,740,320 protobuf document bytes/day. This is an extrapolation from the measured cycle, not a measured daily invoice.

## Metric definitions and limitations

`protobufDocumentBytes` is the byte length of `google.firestore.v1.Document` encoded from each SDK snapshot, using the installed SDK protobuf descriptor. It includes the document envelope and fields, and excludes RPC response framing, TLS/network traffic and index scans. It is **not** the billing system's transfer-byte metric or a measurement of index-scanned bytes.

`estimatedMinimumDocumentReads` adds the documented minimum for empty queries/missing point reads to returned documents; it excludes retries, index-entry reads and rules. The baseline's queries returned documents, so this minimum equals the returned-document count.

Firestore charges document listeners on document additions/updates and applicable removals. Initial attachment and reconnects can incur reads. A listener is not generally free; the target is no recurring document reads from unchanged monitoring polls. Sources: [Firestore pricing](https://cloud.google.com/firestore/pricing), [Firestore Node Query reference](https://cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/query).

The earlier Usage Insights, Query Insights and PLN billing figures supplied by the user have different ranges and are retained as context only. No exact collection-specific invoice is derived from them.

## After deployment

Pending: merged commit, exact release validation, one-time backfill, initialization counts, deployed idle window, controlled failure/delivery checks, and actual subsequent delivery observation. No production savings claim yet.

## Native stream smoke before deployment

The new cache was also exercised against the actual production Firestore SDK
connection in a separate read-only process (not by restarting or disrupting an
application). One active definition cost 1 returned document / 3,238 document
bytes / 3,321 ListenResponse protobuf bytes. One hundred further cache reads added
zero queries, documents or bytes. Injecting an `end` event into that process's
real SDK watch caused its next read to fail closed. The SDK/server resume
restored readiness with zero
additional documents and 119 additional ListenResponse protobuf bytes.

This validates injected-disconnect handling on the installed SDK connection,
not an actual network outage or the deployed application's
post-change costs. It also shows why protocol/control traffic must be distinguished
from document transfer. See `watch-live-proof.json`.

## Other monitoring evaluated

Calendar's old monitor rereads active schedules plus seven days of runs;
WhatsApp rereads unexpired intents and markers. Those scans are bounded by time
but repeated without changes. They are included in this change and baseline.
Linear and Code monitoring read only fixed heartbeat keys; all five services'
heartbeat probes and monitoring-only start/finish transactions are addressed.

The installed host collector calls `/internal/monitoring/status` for those five
services, not their `/health` endpoints. Separate Firestore health checks in
other application routes still read `_health_check/ping` once per health request.
That is a bounded one-document operation, not a historical scan, and is outside
this timer's baseline. The collector's remaining checks use Cloud Scheduler,
Pub/Sub metrics, and local Matrix/bridge/adapter endpoints; the inspected probe
implementations do not query Firestore. No claim of zero total application/database reads is made.

## Index deployment

Terraform applied the reviewed saved plan as the explicitly selected operator:
**4 added, 0 changed, 0 destroyed**. All four new indexes were independently
listed as `READY` afterward. Addresses are
`module.firestore.google_firestore_index.digest_monitoring` with keys
`current_cursor`, `delivered_at`, `delivered_boundary`, and `unresolved`.
This is infrastructure readiness; application code is not yet deployed.

Before cutover, no development listeners existed on ports 8113/8125/8135; the
only Cloud Run service in europe-central2 was the retained transcription service.
The saved old development PM2 dump was not treated as evidence of a live writer.
All live digest writers still need the new application release before backfill.

Cloud Monitoring's independent whole-database `document/read_ops_count` for
17:00–17:10Z before this change reports 2,541 QUERY, 426 LOOKUP and 17 NOT_FOUND
operations (2,984 total). These include normal product traffic and are not
collection- or monitor-attributed. They supplement rather than replace the
controlled baseline. See `cloud-baseline-read-ops.json`.

## Repeating the deployed measurement

Run `scripts/monitoring/sample-monitoring-status.ts` with `--token-file` pointing
to a protected raw internal-auth token file owned by the process user. The
default observation lasts 1,200 seconds and polls all five loopback endpoints
every 15 seconds; `--output` creates a new mode-0600 JSONL file. It reports only
allowlisted aggregate counters and functional state, never response bodies,
identifiers or credentials. Verify the active release and process uptimes before
and after the window.

`queryStarts` counts logical cache attachments; `transportStreamStarts` also
exposes native SDK reconnects. `receivedDocuments`/`documentReads` count received
document bodies. `documentRemoveEvents` and `documentDeleteEvents` are separate:
a field change that removes a document from a query can incur a read without
returning its old body, while document deletion has different billing semantics.
Check all these counters when classifying a window as unchanged.
`listenResponseBytes` already includes watch document bodies; do not add it to
`protobufDocumentBytes` and call the sum network transfer.

## Persistent metadata tradeoff

Recurring probes and startup reads no longer scale with completed digest history.
The compact projection collection and its indexes still grow with eligible
historical runs, and semantic state changes add projection writes. This is not
a claim of history-independent total storage cost. Quantify projection row count
and encoded payload bytes after backfill separately from billed document/index
storage.

A fixed TTL or last-N retention is not used: delivery-boundary and effective
delivery-time maxima are independent, pre-resume delivery evidence remains
relevant, and a timestamp correction may require an older runner-up. Keeping
compact evidence preserves those semantics without scanning source history.
The measured acceptance target is at least 99% lower monitoring reads and
returned bytes; a strict requirement to bound all additional historical storage
would require further aggregate/retention design.

## Read-only backfill rehearsal

Before application deployment, the exact backfill implementation was invoked
through a restricted source-read facade against the live database. Destination
references were inert local tokens, and transaction callbacks performed source
GETs with simulated writes only. All 793 source records passed validation; the
plan contained 90 compact projection sets and 703 removals of ineligible derived
records. Native writes and native transactions were both zero.

This one-time validation used one count aggregation, four page queries returning
793 documents, and 793 point reads: 1,586 document reads excluding aggregation
billing. It is separate from recurring monitoring and migration costs. It does
not prove real transaction concurrency/retries or exclude later source changes.
See `backfill-preflight.json`.
