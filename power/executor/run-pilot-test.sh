#!/bin/sh
# Fixed test runner — embedded in executor image.
# Never executes model-supplied commands.
# Workspace mounted read-only at /mnt/session/workspace.
# Writes TEST_OUTPUT.txt and PILOT_VERIFICATION.json to /mnt/session/outputs.
set -u

cd /mnt/session/workspace

# Run node --test and capture output and exit code
node --test > /mnt/session/outputs/TEST_OUTPUT.txt 2>&1
TEST_EXIT=$?

if [ "$TEST_EXIT" = "0" ]; then
  PASSED=true
else
  PASSED=false
fi

cat > /mnt/session/outputs/PILOT_VERIFICATION.json << PROOF
{
  "checkId": "test",
  "fixedAction": "node --test",
  "exitCode": $TEST_EXIT,
  "passed": $PASSED
}
PROOF

cat /mnt/session/outputs/TEST_OUTPUT.txt
echo "exit=$TEST_EXIT"
