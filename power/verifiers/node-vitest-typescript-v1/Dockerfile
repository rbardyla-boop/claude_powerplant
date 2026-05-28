# Powerplant Verification Runtime Capsule: node-vitest-typescript-v1
#
# Purpose:
#   Provides an immutable, offline, executor-only QA toolchain for projects
#   whose approved checks require Vitest and TypeScript.
#
# Safety invariants:
#   - Execution runs with --network none (no internet access)
#   - Runs as a non-root user (ppverify, uid 1001)
#   - Contains only reviewed, pinned QA tooling — not project source
#   - The sanitized project workspace is mounted at /workspace at execution time
#   - Project node_modules are NOT mounted; only this capsule provides tooling
#
# Build-time network:
#   npm install runs at image build time only. Execution is always --network none.
#
# Pinned tool versions:
#   vitest    2.1.9
#   vite      5.4.21 (vitest peer dependency)
#   typescript 5.9.3

FROM node:20-slim

LABEL org.powerplant.profile="node-vitest-typescript-v1"
LABEL org.powerplant.vitest="2.1.9"
LABEL org.powerplant.vite="5.4.21"
LABEL org.powerplant.typescript="5.9.3"
LABEL org.powerplant.node-base="node:20-slim"

# Create non-root user
RUN groupadd -r ppverify --gid 1001 && \
    useradd -r -g ppverify --uid 1001 ppverify

WORKDIR /opt/powerplant-tools

# Install pinned QA tooling (build-time network only).
# --ignore-scripts prevents any postinstall scripts from running.
COPY package.json ./
RUN npm install --ignore-scripts && \
    npm cache clean --force

# Workspace mount point for the sanitized project snapshot.
# The entrypoint will create a node_modules symlink here at run time.
RUN mkdir -p /workspace && chown ppverify:ppverify /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER ppverify

# Prepend capsule tools to PATH so npm scripts find vitest and tsc.
ENV PATH="/opt/powerplant-tools/node_modules/.bin:${PATH}"

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
