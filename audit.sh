#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec sandwich repository audit \
  --root="$root" \
  --source-remote="${CAMOFOX_MCP_SOURCE_REMOTE:-upstream}" \
  --source-url="${CAMOFOX_MCP_SOURCE_URL:-https://github.com/redf0x1/camofox-mcp.git}" \
  --source-branch="${CAMOFOX_MCP_SOURCE_BRANCH:-main}" \
  --fork-remote="${CAMOFOX_MCP_FORK_REMOTE:-fork}" \
  --fork-url="${CAMOFOX_MCP_FORK_URL:-https://github.com/CommanderTurtle/archive--camofox-mcp.git}" \
  --fork-branch="${CAMOFOX_MCP_FORK_BRANCH:-main}" \
  --publish-mode=ff \
  --doctor=doctor.sh \
  -- "$@"
