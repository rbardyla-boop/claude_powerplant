#!/bin/sh
set -e

# Set umask 000 so all files/dirs created by this container are world-writable.
# The workspace is a disposable temp dir — the host needs to clean it up after
# Docker exits, including any subdirectories vitest creates (e.g. .vite/vitest/).
umask 000

WS_NM="/workspace/node_modules"
CAPSULE_NM="/opt/powerplant-tools/node_modules"

# Populate the workspace node_modules with capsule package symlinks.
# The host pre-creates node_modules/ and .vite/ so they stay host-owned.
# We add symlinks for each capsule package so TypeScript and vitest can resolve them.
if [ ! -e "$WS_NM/.bin" ]; then
  find "$CAPSULE_NM" -mindepth 1 -maxdepth 1 \
    ! -name '.vite' ! -name '.cache' \
    -exec ln -s '{}' "$WS_NM/" ';'
fi

exec "$@"
