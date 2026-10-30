#!/usr/bin/env bash
# Run Changesets version, then keep Obsidian manifest/versions.json in sync.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
npx changeset version

for dir in "$root"/packages/*/; do
  [ -f "$dir/package.json" ] || continue
  [ -f "$dir/manifest.json" ] || continue
  node - "$dir" <<'JS'
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
const manifestPath = path.join(dir, "manifest.json");
const versionsPath = path.join(dir, "versions.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const versions = fs.existsSync(versionsPath)
  ? JSON.parse(fs.readFileSync(versionsPath, "utf8"))
  : {};
let changed = false;
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("synced manifest.json →", pkg.version, "(" + path.basename(dir) + ")");
  changed = true;
}
if (versions[pkg.version] !== manifest.minAppVersion) {
  versions[pkg.version] = manifest.minAppVersion;
  fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + "\n");
  console.log("synced versions.json →", pkg.version, "(" + path.basename(dir) + ")");
  changed = true;
}
if (!changed) console.log("already in sync:", path.basename(dir), pkg.version);
JS
done
