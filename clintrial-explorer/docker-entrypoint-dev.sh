#!/bin/sh
# Dev entrypoint for wip-deploy --app-source.
#
# Handles the one concern the named-volume + bind-mount shape creates:
# node_modules bootstrap + staleness. The named volume at
# /app/node_modules starts empty. On first start we run `npm ci`.
# On later starts, we compare the host's package-lock.json hash
# against the one recorded at last install; if they differ, we
# re-install. Self-healing across host dep changes.
#
# Tarball resolution needs no shim: package.json pins
# `file:libs/wip-*.tgz`, which resolves inside the /app bind mount
# (CASE-442 consolidated the tarballs into the app's libs/).
set -e

NODE_MODULES=/app/node_modules
LOCKFILE=/app/package-lock.json
HASH_MARKER="$NODE_MODULES/.wip-lock-hash"

current_hash() {
  [ -f "$LOCKFILE" ] && sha256sum "$LOCKFILE" 2>/dev/null | cut -c1-64
}

run_install() {
  echo "[dev-entrypoint] $1"
  (cd /app && npm ci --prefer-offline)
  current_hash > "$HASH_MARKER"
}

if [ ! -f "$NODE_MODULES/.package-lock.json" ]; then
  run_install "node_modules empty — running npm ci (first run, expect 30-60s)"
elif [ "$(current_hash)" != "$(cat "$HASH_MARKER" 2>/dev/null)" ]; then
  run_install "package-lock.json changed — re-running npm ci"
fi

exec "$@"
