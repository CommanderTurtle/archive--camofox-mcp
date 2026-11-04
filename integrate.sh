#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$root"

usage() {
  cat <<'USAGE'
Usage: ./integrate.sh [--target hermes|omp|all] [--camofox-url URL] [--dry-run]

Builds the stdio entrypoint and registers this checkout as an MCP server for the
selected client. OMP is the default target; --target all configures every client
that is present, and --target hermes requires the Hermes CLI to be on PATH.
USAGE
}

for argument in "$@"; do
  [[ "$argument" == "--help" || "$argument" == "-h" ]] && { usage; exit 0; }
done

bun_bin="$(command -v bun || true)"
[[ -n "$bun_bin" ]] || {
  printf 'CamoFox MCP integration requires Bun or Sandwich.\n' >&2
  exit 1
}

dry_run=0
for argument in "$@"; do
  [[ "$argument" == "--dry-run" ]] && dry_run=1
done

if [[ "$dry_run" == 0 ]]; then
  "$bun_bin" install --frozen-lockfile --ignore-scripts
  "$bun_bin" run build
  chmod +x -- "$root/audit.sh" "$root/integrate.sh" "$root/doctor.sh" "$root/update.sh" \
    "$root/scripts/configure-harnesses.mjs" "$root/scripts/doctor-harnesses.mjs"
fi

"$bun_bin" "$root/scripts/configure-harnesses.mjs" install "$@"

if [[ "$dry_run" == 0 ]]; then
  "$bun_bin" "$root/scripts/doctor-harnesses.mjs" "$@"
fi
