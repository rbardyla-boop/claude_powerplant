FROM node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5

# Create non-root evaluator user
RUN groupadd -r ppeval && useradd -r -g ppeval -d /home/ppeval -m ppeval

USER ppeval
WORKDIR /workspace

# Metadata labels for identity tracking
LABEL org.powerplant.evaluator.profile="node-test-js-v1" \
      org.powerplant.evaluator.node="20" \
      org.powerplant.evaluator.runner="node --test (built-in)"
