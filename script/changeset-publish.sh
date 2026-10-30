#!/usr/bin/env bash
# Obsidian plugins ship via GitHub Releases (tag workflow), not npm.
# Build packages that have a build script; do not run `changeset publish`.
# Tag-based .github/workflows/release.yml remains the ship path and is unchanged.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

for dir in "$root"/packages/*/; do
  [ -f "$dir/package.json" ] || continue
  if node -e "const s=require(process.argv[1]).scripts||{}; process.exit(s.build?0:1)" "$dir/package.json"; then
    echo "Building $(basename "$dir")…"
    (cd "$dir" && npm ci --workspaces=false --no-audit --no-fund && npm run build)
  fi
done

echo "Obsidian packages are not published to npm."
echo "After the Version Packages PR merges, tag auto-<plugin>-v<version> and push;"
echo "existing .github/workflows/release.yml builds and attaches the release assets."
