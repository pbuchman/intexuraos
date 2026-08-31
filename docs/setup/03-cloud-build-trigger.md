# 03 - Retained Cloud Build Triggers

This document describes the current, deliberately narrow Cloud Build surface.
Cloud Build retains the GCP repository connection and three build targets. It is
not the deployment mechanism for the application runtime.

> Pushing or merging `development` does not deploy Home Dev and does not start
> Home Dev. It also does not deploy the production application. The retained DEV application
> profile is normally hibernated and can be resumed only through the explicit
> Home Dev mode controller and its runbook.

## Current Ownership

| Target          | Purpose                                     | Invocation                         |
| --------------- | ------------------------------------------- | ---------------------------------- |
| `firestore`     | Deploy retained Firestore rules and indexes | Manual GitHub Actions dispatch     |
| `transcription` | Deploy the retained Cloud Function worker   | Manual GitHub Actions dispatch     |
| `code-worker`   | Build and push the code-worker image        | Manual dispatch or daily scheduler |

All three Terraform triggers use `ignored_files = ["**"]`; they are not
push-driven application deployments. The `code-worker` daily scheduler is a
separate, intentional rebuild path. There are no retained app-service, web, or
monolithic Cloud Build triggers and no `cloudbuild/cloudbuild.yaml` application
pipeline.

Production application deployment is manual exact-SHA deployment to Hetzner.
Use [the production runbook](../operations/hetzner-prod-runbook.md) or the
`hetzner-prod` target in `.github/workflows/deploy.yml`.

## Architecture

The retained setup consists of:

1. a Cloud Build 2nd Gen GitHub connection created through the GCP Console OAuth
   flow and imported into Terraform;
2. a linked repository resource;
3. the `firestore`, `transcription`, and `code-worker` triggers;
4. a dedicated Cloud Build service account and the minimum roles needed by those
   retained targets;
5. GitHub Workload Identity Federation for the manual deploy workflow; and
6. the daily `code-worker` Cloud Scheduler job.

The source of truth is `terraform/modules/cloud-build/main.tf`. The operator
entry point is `.github/workflows/deploy.yml`.

## Initial Connection Setup

This section applies only if the retained GitHub connection must be recreated.
It is not part of ordinary deployment or DEV resume.

1. Open [Cloud Build Repositories (2nd gen)](https://console.cloud.google.com/cloud-build/repositories/2nd-gen)
   in the intended GCP project and region (`europe-central2`).
2. Create a GitHub host connection and complete the GitHub OAuth flow.
3. Grant it access to the IntexuraOS repository.
4. Verify the connection:

   ```bash
   gcloud builds connections list --region=europe-central2
   ```

5. Set the exact connection name through `github_connection_name` and import the
   existing connection before any Terraform apply:

   ```bash
   cd terraform/environments/dev
   terraform init
   terraform import \
     module.cloud_build.google_cloudbuildv2_connection.github \
     projects/intexuraos-dev-pbuchman/locations/europe-central2/connections/CONNECTION_NAME
   ```

Never create a second connection to work around an import or authentication
problem. Reconcile the existing object and Terraform state first.

## Running a Retained Target

Preferred path:

1. Open the GitHub Actions `Deploy` workflow.
2. Select exactly one of `firestore`, `transcription`, or `code-worker`.
3. Dispatch it from the reviewed commit.
4. Preserve the workflow URL, Cloud Build ID, and resolved source SHA as evidence.

The workflow invokes the target with `--sha="$GITHUB_SHA"` and fails if Cloud
Build provenance resolves to a different commit. A direct `gcloud builds
triggers run` is an exceptional diagnostic path, not the routine deployment
procedure.

## Verification

```bash
# Inspect retained triggers.
gcloud builds triggers list --region=europe-central2

# Inspect recent builds.
gcloud builds list --limit=5 --region=europe-central2

# Inspect one build and its source provenance.
gcloud builds describe BUILD_ID --region=europe-central2
```

Verify all of the following:

- only the intended retained target ran;
- the resolved source revision equals the approved commit SHA;
- no app-service or web trigger exists;
- no push to `development` caused an application deployment; and
- the Home Dev runtime mode remains unchanged.

## Troubleshooting

### Connection not found

Confirm the project, region, and exact imported connection name. Check:

```bash
gcloud builds connections list --region=europe-central2
```

If the installation state is pending, complete the existing connection's OAuth
flow in the GCP Console. Do not create a replacement connection implicitly.

### Permission denied

Compare the retained service-account grants in
`terraform/modules/cloud-build/main.tf`. Do not restore historical application
deployment roles or triggers as a shortcut.

### Unexpected build after a push

Treat this as configuration drift. Capture the build and trigger metadata, stop
before changing state, and reconcile the live trigger with Terraform. A normal
push must not deploy or start Home Dev.

## References

- [Cloud Build 2nd Gen GitHub connection](https://cloud.google.com/build/docs/automating-builds/github/connect-repo-github)
- [Cloud Build trigger schema](https://cloud.google.com/build/docs/api/reference/rest/v1/projects.locations.triggers)
- [Hetzner production runbook](../operations/hetzner-prod-runbook.md)
