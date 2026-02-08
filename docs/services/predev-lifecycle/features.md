# Pre-Dev Lifecycle Worker

Cloud Functions that manage the pre-dev environment: a scale-to-zero GCP Spot VM for cloud-based development.

## The Problem

Local development requires a powerful machine and manual environment setup. Teams need:

1. **Shared preview environments** - See running code on any branch without local setup
2. **Cost efficiency** - Cloud VMs are expensive when running 24/7
3. **Automatic branch tracking** - The environment should follow the active branch without manual intervention
4. **Zero-effort startup** - Visiting a URL should boot the environment if it is not running

## How It Helps

Predev-lifecycle provides four Cloud Functions that coordinate a single GCP Spot VM running the full IntexuraOS development stack:

1. **Gateway** - Proxies HTTP requests to the VM, or shows a "Starting..." page and boots the VM if it is stopped
2. **Webhook** - Receives GitHub push events to track branch changes and trigger hot code reloads
3. **Idle Check** - Shuts down the VM after 30 minutes of inactivity to save costs
4. **Report Ready** - Receives a callback from the VM when it finishes booting

## Key Features

**On-demand startup:**

- First request to the gateway starts the VM automatically
- Users see a branded "Starting..." page with a live status poller
- Page auto-redirects to the app when the VM reports ready

**Branch tracking:**

- GitHub webhook updates Firestore state with the current branch and commit
- Running VMs receive a Pub/Sub notification to pull new code
- Branch switches on a running VM trigger a full service restart

**Branch locking:**

- Users can lock the environment to a specific branch
- Pushes to other branches are ignored while the lock is active
- Lock state persists in Firestore and survives VM restarts

**Scale-to-zero idle shutdown:**

- Cloud Scheduler triggers the idle-check function every 5 minutes
- If no gateway request has arrived in 30 minutes, the VM shuts down
- The MIG (Managed Instance Group) resizes to 0 instances

**SSE proxy:**

- The gateway proxies Server-Sent Events for the DevBar (logs and events streams)
- SSE connections forward to the VM's internal DevBar ports (8105, 8106)

**Request proxying:**

- All HTTP methods (GET, POST, PATCH, DELETE) proxy to the VM
- Binary content (images, fonts) handled via `arrayBuffer()` to avoid corruption
- Request headers forwarded (except `Host`)

## Use Cases

### Developer visits the pre-dev URL

**User Goal:** See the running application on the current branch.

**Steps:**
1. User navigates to the pre-dev URL
2. Gateway checks Firestore state
3. If VM is running, gateway proxies the request to the VM
4. If VM is stopped, gateway sends a MIG resize command and shows the "Starting..." page
5. The "Starting..." page polls `/internal/branch-lock` every 3 seconds
6. When the VM boots and calls report-ready, state transitions to "running"
7. The page detects the running state and reloads, now proxied to the VM

### Developer pushes a commit

**User Goal:** See the latest code reflected in the pre-dev environment.

**Steps:**
1. Developer pushes to a branch on GitHub
2. GitHub sends a push webhook to the webhook function
3. Webhook verifies the HMAC signature
4. If branch is locked to a different branch, the push is ignored
5. Webhook updates Firestore state with the new branch, commit SHA, and commit message
6. If the VM is running, webhook publishes a Pub/Sub message for hot code reload
7. The VM pulls the latest code and restarts services (or uses tsx watch for same-branch pushes)

### Lock a branch for a demo

**User Goal:** Prevent the environment from switching branches during a demo.

**Steps:**
1. Send `POST /internal/branch-lock` with `{ "locked": true }`
2. Gateway updates Firestore with the lock state
3. All subsequent pushes to different branches are silently ignored
4. Unlock by sending `POST /internal/branch-lock` with `{ "locked": false }`

## Key Benefits

**Zero local setup** - Access a full development environment via a URL

**Cost-efficient** - VM runs only when actively used; 30-minute idle timeout prevents waste

**Always current** - GitHub webhook keeps the environment in sync with the latest push

**Branch-safe** - Branch locking prevents disruption during demos or reviews

## Limitations

**Single VM** - Only one pre-dev environment exists at a time. Multiple users share it.

**Cold start delay** - Starting the VM from stopped takes 1-3 minutes depending on GCP.

**No persistent state** - The VM is a Spot instance. GCP can preempt it at any time. Application data resets on restart.

**Public gateway** - The gateway Cloud Function is publicly accessible (no authentication). Access control relies on obscurity of the URL.
