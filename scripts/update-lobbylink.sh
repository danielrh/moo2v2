#!/usr/bin/env bash
# Rebuilds the lobbylink TS client from its checkout and re-vendors it into
# vendor/lobbylink/. See vendor/lobbylink/README.md for provenance details.
set -euo pipefail

LOBBYLINK_DIR="${LOBBYLINK_DIR:-$HOME/dev/lobbylink}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

make -C "$LOBBYLINK_DIR/clients/ts"
mkdir -p "$REPO_DIR/vendor/lobbylink"
cp "$LOBBYLINK_DIR/clients/ts/dist/index.js" "$REPO_DIR/vendor/lobbylink/index.js"
cp "$LOBBYLINK_DIR/clients/ts/dist/index.d.ts" "$REPO_DIR/vendor/lobbylink/index.d.ts"
git -C "$LOBBYLINK_DIR" rev-parse HEAD > "$REPO_DIR/vendor/lobbylink/SOURCE_COMMIT"
echo "Vendored lobbylink client @ $(cat "$REPO_DIR/vendor/lobbylink/SOURCE_COMMIT")"
