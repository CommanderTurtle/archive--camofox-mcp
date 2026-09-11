#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$root"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  printf 'Refusing to update a dirty CamoFox MCP checkout:\n' >&2
  git status --short >&2
  exit 1
fi

git pull --ff-only
exec "$root/integrate.sh" "$@"
