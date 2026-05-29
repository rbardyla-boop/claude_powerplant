FROM node:20-bookworm

# Create non-root evaluator user
RUN groupadd -r ppeval && useradd -r -g ppeval -d /home/ppeval -m ppeval

USER ppeval
WORKDIR /workspace

# Metadata labels for identity tracking
LABEL org.powerplant.evaluator.profile="node-test-js-v1" \
      org.powerplant.evaluator.node="20" \
      org.powerplant.evaluator.runner="node --test (built-in)"
