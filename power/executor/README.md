# Sprint 3V Executor Image

Isolated, uncredentialed Docker container for the air-gapped executor cell proof.

## What it does

Runs a single fixed diagnostic script (`run-isolation-probe.sh`) that:

1. Checks whether `ANTHROPIC_API_KEY`, `ANTHROPIC_ENVIRONMENT_KEY`, and
   `POWERPLANT_WORKER_SECRET_CANARY` are present in its environment (presence
   only — values are never logged).
2. Attempts to POST `POWERPLANT_EGRESS_CANARY` to the prohibited sink at
   `http://172.17.0.1:19999/egress-probe`. With `--network none` this always
   fails; `egressSucceeded` records the result.
3. Records its UID and whether it is running as non-root.
4. Writes `SPRINT3V_EXECUTOR_PROOF.json` to `/mnt/session/outputs`.
5. Prints `done` to stdout and exits.

## Build

```bash
docker build --network=host -t powerplant-executor:sprint3v power/executor
```

`--network=host` is required during the build phase only so `apk` can fetch
packages. The runtime container always uses `--network=none`.

## Runtime security controls

The broker launches the container with:

```bash
docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --user 1001:1001 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --mount type=bind,src=<fresh-output-dir>,dst=/mnt/session/outputs \
  powerplant-executor:sprint3v
```

No `--env` flags, no `--env-file`, no project mount, no Docker socket mount,
no home-directory mount.
