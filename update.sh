#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$root"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  printf 'Refusing to update a dirty CamoFox MCP checkout:\n' >&2
  git status --short >&2
  exit 1
fi

source_remote="${CAMOFOX_MCP_SOURCE_REMOTE:-upstream}"
source_branch="${CAMOFOX_MCP_SOURCE_BRANCH:-main}"
git remote get-url "$source_remote" >/dev/null 2>&1 || {
  printf 'CamoFox MCP source remote is unavailable: %s\n' \
    "$source_remote" >&2
  exit 1
}
git fetch --prune "$source_remote"
remote_ref="refs/remotes/$source_remote/$source_branch"
git show-ref --verify --quiet "$remote_ref" || {
  printf 'CamoFox MCP source branch is unavailable: %s/%s\n' \
    "$source_remote" "$source_branch" >&2
  exit 1
}

if git merge-base --is-ancestor "$remote_ref" HEAD; then
  printf 'CamoFox MCP already contains %s/%s.\n' \
    "$source_remote" "$source_branch"
elif git merge-base --is-ancestor HEAD "$remote_ref"; then
  git merge --ff-only "$remote_ref"
elif git merge-tree --write-tree HEAD "$remote_ref" >/dev/null; then
  git merge --no-ff --no-edit "$remote_ref"
else
  printf 'Local and upstream CamoFox MCP changes conflict; review is required.\n' >&2
  exit 1
fi
exec "$root/integrate.sh" "$@"
