FROM debian:bookworm-slim

ARG ANT_VERSION=1.9.1

# Install runtime deps: bash (required by ant worker), ca-certs for TLS
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install the ant CLI for the architecture of the build host
RUN ARCH=$(dpkg --print-architecture) \
    && curl -fsSL \
       "https://github.com/anthropics/anthropic-cli/releases/download/v${ANT_VERSION}/ant_${ANT_VERSION}_linux_${ARCH}.tar.gz" \
       | tar -xz -C /usr/local/bin ant \
    && chmod +x /usr/local/bin/ant

# Non-root user — tools are confined to /workspace by ant worker
RUN groupadd -r worker && useradd -r -g worker -m worker

USER worker

# /workspace is the workdir; the host mounts a per-session directory here
WORKDIR /workspace

# ant beta:worker run reads ANTHROPIC_SESSION_ID / ANTHROPIC_WORK_ID /
# ANTHROPIC_ENVIRONMENT_ID / ANTHROPIC_ENVIRONMENT_KEY from env, handles
# the full session (tool calls + heartbeats + work.stop), then exits.
ENTRYPOINT ["ant", "beta:worker", "run"]
