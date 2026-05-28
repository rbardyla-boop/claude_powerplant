#!/bin/sh
# Fixed diagnostic program — embedded in executor image.
# Never executes model-supplied commands.
# Writes SPRINT3V_EXECUTOR_PROOF.json to /mnt/session/outputs.
set -u

# --- credential presence (presence only, never values) ---

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_API_KEY_PRESENT=true
else
  ANTHROPIC_API_KEY_PRESENT=false
fi

if [ -n "${ANTHROPIC_ENVIRONMENT_KEY:-}" ]; then
  ANTHROPIC_ENVIRONMENT_KEY_PRESENT=true
else
  ANTHROPIC_ENVIRONMENT_KEY_PRESENT=false
fi

if [ -n "${POWERPLANT_WORKER_SECRET_CANARY:-}" ]; then
  WORKER_SECRET_CANARY_PRESENT=true
else
  WORKER_SECRET_CANARY_PRESENT=false
fi

# --- egress probe ---
# Target is the conventional Docker bridge gateway on the prohibited sink port.
# With --network none this will always fail; the result is recorded.
EGRESS_TARGET="http://172.17.0.1:19999/egress-probe"
EGRESS_SUCCEEDED=false
if curl -s --max-time 3 --connect-timeout 2 \
     -X POST \
     --data "POWERPLANT_EGRESS_CANARY" \
     "$EGRESS_TARGET" \
     > /dev/null 2>&1; then
  EGRESS_SUCCEEDED=true
fi

# --- executor identity ---
EXECUTOR_UID=$(id -u)
if [ "$EXECUTOR_UID" = "0" ]; then
  EXECUTOR_IS_NON_ROOT=false
else
  EXECUTOR_IS_NON_ROOT=true
fi

# --- write proof artifact ---
cat > /mnt/session/outputs/SPRINT3V_EXECUTOR_PROOF.json << PROOF
{
  "anthropicApiKeyPresent": $ANTHROPIC_API_KEY_PRESENT,
  "anthropicEnvironmentKeyPresent": $ANTHROPIC_ENVIRONMENT_KEY_PRESENT,
  "workerSecretCanaryPresent": $WORKER_SECRET_CANARY_PRESENT,
  "egressAttempted": true,
  "egressSucceeded": $EGRESS_SUCCEEDED,
  "outputPathOperational": true,
  "executorUid": $EXECUTOR_UID,
  "executorIsNonRoot": $EXECUTOR_IS_NON_ROOT
}
PROOF

echo "done"
