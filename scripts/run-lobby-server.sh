#!/usr/bin/env bash
# Runs a local lobbylink signaling server for development and e2e tests.
# Requires Go and a checkout of https://github.com/danielrh/lobbylink
# (default location: ~/dev/lobbylink; override with LOBBYLINK_DIR).
set -euo pipefail

LOBBYLINK_DIR="${LOBBYLINK_DIR:-$HOME/dev/lobbylink}"
if [ ! -d "$LOBBYLINK_DIR/cmd/p2p-lobby-server" ]; then
  echo "lobbylink checkout not found at $LOBBYLINK_DIR (set LOBBYLINK_DIR)" >&2
  exit 1
fi

# Play-by-mail endpoints (/pbm/): dev password "moo2", saves under /tmp.
PBM_CONFIG="${PBM_CONFIG:-$(cd "$(dirname "$0")" && pwd)/pbm-config.dev.json}"

cd "$LOBBYLINK_DIR"
exec go run ./cmd/p2p-lobby-server \
  --listen-http 127.0.0.1:8787 \
  --allowed-origin "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8787,http://127.0.0.1:8787" \
  --public-url http://127.0.0.1:8787 \
  --pbm-config "$PBM_CONFIG" \
  "$@"
