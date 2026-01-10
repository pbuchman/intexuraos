# Verify Deployment

Run the deployment verification script and interpret results after pushing to development branch.

## Usage

Run this command after pushing to the development branch to verify deployment health.

## Steps

1. Run the verification script:

```bash
./scripts/verify-deployment.sh
```

2. If the script is not executable, make it so:

```bash
chmod +x scripts/verify-deployment.sh
```

3. Interpret results:

- Green checkmarks = healthy
- Yellow warnings = in progress or potential issue
- Red X = failure requiring attention

## Troubleshooting Failures

### Cloud Build Failures

View build logs:

```bash
gcloud builds log <BUILD_ID> --project=intexuraos-dev-pbuchman --region=europe-central2
```

List recent builds:

```bash
gcloud builds list --project=intexuraos-dev-pbuchman --region=europe-central2 --limit=5
```

### Service Failures

View service logs:

```bash
gcloud logging read "resource.labels.service_name=intexuraos-<service>" --project=intexuraos-dev-pbuchman --limit=20
```

View service details:

```bash
gcloud run services describe intexuraos-<service> --project=intexuraos-dev-pbuchman --region=europe-central2
```

### Common Issues

| Error                   | Cause                               | Fix                                                |
| ----------------------- | ----------------------------------- | -------------------------------------------------- |
| "Dynamic require"       | CommonJS package bundled by esbuild | Add package to service's package.json dependencies |
| Health check failure    | Service crashed on startup          | Check startup logs for error                       |
| Build failure at npm ci | Missing/mismatched dependencies     | Run `npm install` locally and commit lock file     |
| Docker build failure    | Invalid Dockerfile or missing files | Check Dockerfile and build context                 |

## Services Monitored

| Service                      | Cloud Run Name                          |
| ---------------------------- | --------------------------------------- |
| user-service                 | intexuraos-user-service                 |
| promptvault-service          | intexuraos-promptvault-service          |
| notion-service               | intexuraos-notion-service               |
| whatsapp-service             | intexuraos-whatsapp-service             |
| mobile-notifications-service | intexuraos-mobile-notifications-service |
| api-docs-hub                 | intexuraos-api-docs-hub                 |
| research-agent               | intexuraos-research-agent               |
