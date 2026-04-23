# GCP Remote Compute E2E

This runbook exercises the new remote-compute architecture against a real Google Cloud VM and GCS bucket with minimal cost:

- one `e2-micro` runner VM
- one GCS bucket in a free-tier region
- one cloud-native streaming dataset (`Zarr`)
- one staged read/write mount

The harness lives in [`scripts/testing/gcp-remote-compute-e2e.ts`](/Users/xf2217/Repos/astro/scripts/testing/gcp-remote-compute-e2e.ts).

## Scope

This validates:

- remote runner registration through the existing relay
- object storage credential scoping
- `storageMounts.access = "streaming"` for cloud-native reads
- `storageMounts.access = "staged"` with sync-down and sync-back
- end-to-end task execution and result upload

This does not validate Ray-on-Kubernetes. Keep that as a separate credits-backed smoke test.

## Prerequisites

- `gcloud` installed locally
- active GCP account with billing/project access
- Astro backend/relay reachable from the VM
- a team/user in Astro with:
  - `remote-compute-sandboxes` enabled
  - a GCP connected account configured

If you are using local Astro dev servers, expose them over a public tunnel before creating the VM.

## Startup modes

| Mode | How | Cold-start time | When to use |
|------|-----|----------------|-------------|
| `binary` (default) | Debian 12 + `curl` prebuilt binary from GitHub Releases | ~30-60s | Normal use — no runtime needed |
| `docker` | Container-Optimized OS + `docker run` | ~2-3 min | When binary isn't yet published |
| `npm` | Debian 12 + `apt-get` + `npm install -g` | ~5-8 min | Debugging/last resort |

Binary mode curls `astro-agent-linux-x64` from the GitHub Release for `@astroanywhere/agent`. No Node.js or Docker needed on the VM. The binary is a self-contained executable built by the release workflow via `@yao-pkg/pkg`.

Docker mode pulls `ghcr.io/astro-anywhere/agent:latest` on a COS VM (Docker pre-installed). Build and push that image once with the generated `docker-build-push.sh` script before creating VMs.

## 1. Check local GCP state

```bash
tsx scripts/testing/gcp-remote-compute-e2e.ts check
```

That reports whether `gcloud` is installed, the active project, and active account.

## 2. Generate fixtures and launch plan

```bash
# Binary mode (default — fastest, ~30-60s cold start)
tsx scripts/testing/gcp-remote-compute-e2e.ts prepare \
  --project=my-gcp-project \
  --bucket=my-astro-gcp-e2e-bucket \
  --instance=astro-gcp-e2e-runner \
  --region=us-central1 \
  --zone=us-central1-a

# Docker mode (if binary not yet published)
tsx scripts/testing/gcp-remote-compute-e2e.ts prepare \
  --mode=docker \
  --project=my-gcp-project \
  --bucket=my-astro-gcp-e2e-bucket

# npm mode (no pre-built anything needed, slowest)
tsx scripts/testing/gcp-remote-compute-e2e.ts prepare \
  --mode=npm \
  --project=my-gcp-project \
  --bucket=my-astro-gcp-e2e-bucket
```

The script writes a timestamped bundle under:

```text
.tmp/gcp-remote-compute-e2e/<timestamp>/
```

Contents:

- `fixtures/`
- `startup-script.sh`
- `Dockerfile` + `docker-build-push.sh` (docker mode only)
- `dispatch/streaming-zarr.json`
- `dispatch/staged-readwrite.json`
- `PLAN.txt`

The fixture set includes:

- `sample.zarr/` - tiny Zarr v2 array for streaming reads
- `staged-input/numbers.txt` - tiny staged input

## 3. Apply the generated GCP plan

Run the commands from `PLAN.txt`:

1. Enable Compute Engine and Cloud Storage APIs
2. Create the bucket
3. Upload fixtures
4. **(Docker mode only)** Build and push the Docker image once: `bash docker-build-push.sh`
5. Create the VM

**Docker mode:** Creates a Container-Optimized OS VM. Docker is pre-installed; startup script does a `docker pull` + `docker run`.

**npm mode:** Creates a Debian 12 VM. Startup script installs Node.js and `@astroanywhere/agent` via npm.

## 4. Wait for the runner to register

Poll until the machine appears as connected (uses `astro-cli env list`):

```bash
tsx scripts/testing/gcp-remote-compute-e2e.ts wait \
  --instance=astro-gcp-e2e-runner \
  --astro-server-url=https://api.astroanywhere.com \
  --timeout=300
```

You can also check manually:

```bash
astro-cli env list
```

## 5. Create the two smoke-test tasks

Use the generated JSON files as the body shape for Astro task dispatch or as the source material for tasks created in the UI.

### Streaming task

`dispatch/streaming-zarr.json`

Purpose:

- use `gs://.../sample.zarr/` directly
- verify that the runner does not sync the whole prefix locally
- confirm the agent can read a cloud-native layout from GCS

### Staged task

`dispatch/staged-readwrite.json`

Purpose:

- sync staged input down from GCS
- write results locally
- sync outputs back to `gs://.../outputs/`

## 6. Validate results

Checks:

1. Astro shows the task as completed.
2. Streaming task output mentions direct cloud URI usage.
3. GCS contains uploaded staged outputs:

```bash
gcloud storage ls gs://my-astro-gcp-e2e-bucket/outputs/
```

4. VM service is healthy:

```bash
gcloud compute ssh astro-gcp-e2e-runner --zone us-central1-a --project my-gcp-project --command \
  "systemctl status astro-agent --no-pager"
```

## Cleanup

Generate and optionally run the cleanup commands:

```bash
# Print the commands (dry run)
tsx scripts/testing/gcp-remote-compute-e2e.ts cleanup \
  --project=my-gcp-project \
  --zone=us-central1-a \
  --instance=astro-gcp-e2e-runner \
  --bucket=my-astro-gcp-e2e-bucket

# Execute immediately
tsx scripts/testing/gcp-remote-compute-e2e.ts cleanup \
  --project=my-gcp-project \
  --zone=us-central1-a \
  --instance=astro-gcp-e2e-runner \
  --bucket=my-astro-gcp-e2e-bucket \
  --execute
```

Or run manually:

```bash
gcloud compute instances delete astro-gcp-e2e-runner --zone us-central1-a --project my-gcp-project --quiet
gcloud storage rm --recursive gs://my-astro-gcp-e2e-bucket
```

## Cost Notes

Use:

- `us-central1`
- `e2-micro`
- a tiny bucket
- tiny fixtures only

That keeps the first pass aligned with current Google Cloud free-tier regions and limits. See:

- [Google Cloud Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features)
- [Compute free-tier details](https://cloud.google.com/free/docs/compute-getting-started)
- [Cloud Storage always-free limits](https://cloud.google.com/storage/pricing?hl=en)
