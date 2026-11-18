# Share Worker deployment

Use an already installed Wrangler 4 on `PATH`, Node 24 or later, and the
`FUNCTION_ORIGIN` value from the agent-shares Terraform `function_origin`
output. The deployment wrapper validates that the value is a root HTTPS
`run.app` endpoint and passes it as a plaintext Worker variable. The URL is
public. [Wrangler deploy options](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy) ·
[Cloud Run service URLs](https://docs.cloud.google.com/run/docs/triggering/https-request#service-url)

During the authorized rollout, select the Cloudflare account that owns the
active `intexuraos.cloud` zone with `CLOUDFLARE_ACCOUNT_ID`. Supply an existing
approved operator token in `CLOUDFLARE_API_TOKEN` with access to deploy this
Worker and attach its Custom Domain. Confirm `share.intexuraos.cloud` is
available. Wrangler configures that hostname and Cloudflare manages its DNS
and certificate. The config disables the Worker's `workers.dev` and preview
URLs. [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) ·
[Wrangler environment](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)

From the repository root, check the bundle and then deploy the same config.

```bash
: "${CLOUDFLARE_ACCOUNT_ID:?Set the approved Cloudflare account ID}"
: "${CLOUDFLARE_API_TOKEN:?Supply the approved operator token in the environment}"
export CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN
node terraform/agent-shares/worker/deploy.mjs "${FUNCTION_ORIGIN:?Set from Terraform output}" --dry-run
node terraform/agent-shares/worker/deploy.mjs "${FUNCTION_ORIGIN:?Set from Terraform output}"
unset CLOUDFLARE_API_TOKEN
```

The public host serves raw Markdown as `text/markdown` with
`Content-Disposition: attachment`. The Worker accepts only a canonical share
path as Cloudflare delivers it and discards the query. Cloudflare can
normalize the incoming path before the
Worker sees it. In the authorized smoke test, use `curl --path-as-is` and a
known share to check that aliases such as `/folder/../<slug>.html` and an
encoded character in the slug cannot serve the share. If a normalized alias
succeeds and the rollout requires rejecting it at the edge, review a
hostname-scoped block rule before enabling the service for use.
[Incoming URL normalization](https://developers.cloudflare.com/rules/normalization/settings/) ·
[Cloudflare dynamic field comparisons](https://developers.cloudflare.com/ruleset-engine/rules-language/operators/#compare-dynamic-values)

```text
(http.host eq "share.intexuraos.cloud" and http.request.uri.path ne raw.http.request.uri.path)
```

Run the offline checks from the repository root. These tests replace fetch and
Wrangler with local test doubles.

```bash
node --test terraform/agent-shares/worker/*.test.mjs
```
