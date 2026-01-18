# Claude Code Dev Service Account

Terraform module for managing the `claude-code-dev` service account used for local development with Claude Code CLI.

## Purpose

This service account provides admin access for development workflows:

- **Terraform operations** - plan, apply, destroy
- **Firestore access** - queries, document manipulation
- **GCS access** - bucket operations, signed URLs
- **Secret Manager** - reading secrets for local development
- **IAM operations** - service account management
- **Cloud Build** - trigger management
- **Cloud Run** - service deployment

## Usage

```hcl
module "claude_code_dev" {
  source = "../../modules/claude-code-dev"

  project_id = var.project_id
}
```

## Importing Existing Resources

If the service account already exists (e.g., was created manually), import it into Terraform state before applying:

```bash
cd terraform/environments/dev

# Import service account
terraform import module.claude_code_dev.google_service_account.claude_code_dev \
  projects/intexuraos-dev-pbuchman/serviceAccounts/claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com

# Import each role binding (repeat for each role)
terraform import 'module.claude_code_dev.google_project_iam_member.claude_code_dev_roles["roles/artifactregistry.admin"]' \
  "intexuraos-dev-pbuchman roles/artifactregistry.admin serviceAccount:claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"
```

## Recovery Procedure

If the environment needs to be recreated (e.g., new GCP project), follow these steps:

### 1. Apply Terraform

```bash
cd terraform/environments/dev
GOOGLE_APPLICATION_CREDENTIALS=<existing-owner-key> terraform apply
```

### 2. Generate Service Account Key

```bash
gcloud iam service-accounts keys create ~/personal/gcloud-claude-code-dev.json \
  --iam-account=claude-code-dev@<project-id>.iam.gserviceaccount.com
```

### 3. Activate Service Account

```bash
gcloud auth activate-service-account --key-file=~/personal/gcloud-claude-code-dev.json
```

### 4. Verify Access

```bash
gcloud auth list
gcloud projects describe <project-id>
```

## Key Management

**IMPORTANT:** Service account keys are NOT managed by Terraform.

| Item            | Location                                 |
| --------------- | ---------------------------------------- |
| Key file        | `~/personal/gcloud-claude-code-dev.json` |
| Version control | **NEVER** commit keys to the repository  |
| Rotation        | Manually rotate keys via `gcloud` CLI    |

### Key Rotation

```bash
# List existing keys
gcloud iam service-accounts keys list \
  --iam-account=claude-code-dev@<project-id>.iam.gserviceaccount.com

# Create new key
gcloud iam service-accounts keys create ~/personal/gcloud-claude-code-dev-new.json \
  --iam-account=claude-code-dev@<project-id>.iam.gserviceaccount.com

# After verifying new key works, delete old key
gcloud iam service-accounts keys delete <key-id> \
  --iam-account=claude-code-dev@<project-id>.iam.gserviceaccount.com
```

## Permissions Granted

| Role                                   | Purpose                               |
| -------------------------------------- | ------------------------------------- |
| `roles/artifactregistry.admin`         | Docker image repository management    |
| `roles/cloudbuild.connectionAdmin`     | Cloud Build GitHub connections        |
| `roles/cloudscheduler.admin`           | Scheduled job management              |
| `roles/compute.admin`                  | Load balancer, SSL certs, networking  |
| `roles/firebase.admin`                 | Firebase/Identity Platform            |
| `roles/iam.serviceAccountAdmin`        | Service account CRUD                  |
| `roles/iam.workloadIdentityPoolAdmin`  | Workload Identity Federation          |
| `roles/logging.admin`                  | Cloud Logging configuration           |
| `roles/monitoring.admin`               | Monitoring dashboards and alerts      |
| `roles/pubsub.admin`                   | Pub/Sub topics and subscriptions      |
| `roles/resourcemanager.projectIamAdmin`| Project IAM policy management         |
| `roles/run.admin`                      | Cloud Run service deployment          |
| `roles/secretmanager.admin`            | Secret creation and access            |
| `roles/serviceusage.serviceUsageAdmin` | API enablement                        |
| `roles/storage.objectAdmin`            | GCS bucket and object management      |

## Security Considerations

1. **Key storage**: Store keys in a secure location outside the repository
2. **Least privilege**: Uses specific admin roles instead of `roles/owner`
3. **Audit logging**: All API calls are logged in Cloud Audit Logs
4. **Key expiration**: GCP keys don't expire automatically; implement manual rotation

## Outputs

| Output                  | Description                            |
| ----------------------- | -------------------------------------- |
| `service_account_email` | Full email for the service account     |
| `service_account_id`    | Unique ID of the service account       |
| `service_account_name`  | Resource name for IAM bindings         |
| `granted_roles`         | List of IAM roles granted              |
