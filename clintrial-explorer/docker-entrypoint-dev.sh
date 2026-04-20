#!/bin/sh
# Dev entrypoint for wip-deploy --app-source.
#
# Handles two concerns that the named-volume + bind-mount shape creates:
#
# 1. Tarball resolution. The host's package.json references
#    `file:../libs/wip-*.tgz`, which from /app resolves to /libs/*.tgz in
#    the container — a path that doesn't exist. We bundle the tarballs
#    into /tmp/libs at image build, then create symlinks at /libs/<name>
#    matching whatever versioned filenames the host's package.json refers
#    to. Container-local, never touches the bind mount.
#
# 2. node_modules bootstrap + staleness. The named volume at
#    /app/node_modules starts empty. On first start we run `npm ci`.
#    On later starts, we compare the host's package-lock.json hash
#    against the one recorded at last install; if they differ, we
#    re-install. Self-healing across host dep changes.
set -e

NODE_MODULES=/app/node_modules
LOCKFILE=/app/package-lock.json
HASH_MARKER="$NODE_MODULES/.wip-lock-hash"

link_tarballs() {
  [ -f /app/package.json ] || return 0
  grep -oE '"file:\.\./libs/[^"]+\.tgz"' /app/package.json 2>/dev/null \
    | sed 's|^"file:\.\./libs/||; s|"$||' \
    | sort -u \
    | while IFS= read -r expected; do
        [ -e "/libs/$expected" ] && continue
        prefix=$(echo "$expected" | sed -E 's/^(wip-[a-z]+)-.*$/\1/')
        actual=$(ls "/tmp/libs/${prefix}-"*.tgz 2>/dev/null | head -1)
        if [ -n "$actual" ]; then
          mkdir -p /libs
          ln -sf "$actual" "/libs/$expected"
        fi
      done
}

current_hash() {
  [ -f "$LOCKFILE" ] && sha256sum "$LOCKFILE" 2>/dev/null | cut -c1-64
}

run_install() {
  echo "[dev-entrypoint] $1"
  (cd /app && npm ci --prefer-offline)
  current_hash > "$HASH_MARKER"
}

link_tarballs

if [ ! -f "$NODE_MODULES/.package-lock.json" ]; then
  run_install "node_modules empty — running npm ci (first run, expect 30-60s)"
elif [ "$(current_hash)" != "$(cat "$HASH_MARKER" 2>/dev/null)" ]; then
  run_install "package-lock.json changed — re-running npm ci"
fi

exec "$@"
