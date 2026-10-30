# obsidian-plugins

Monorepo for Obsidian plugins. One directory per plugin under `packages/`;
each keeps its own npm name, `manifest.json`, and version.

## Release a package

Preferred: Changesets from the repo root (`npm ci --workspaces=false`, then
`npx changeset`). Merging to `main` lets `.github/workflows/changeset-release.yml`
open a Version Packages PR (also syncs `manifest.json` / `versions.json`).
After that PR merges, tag `auto-<plugin>-v<version>` and push — Obsidian ships
from GitHub Releases, not npm.

Fallback (unchanged): bump the three version files yourself, then:

```bash
git tag auto-move-v0.1.0   # or auto-tag-v0.1.0
git push origin auto-move-v0.1.0
```

The tag triggers `.github/workflows/release.yml`, which builds and attaches
`main.js` / `manifest.json` / `styles.css` (and a zip).

## Checks

```bash
cd packages/<pkg>
npm ci
npm run build
node test/run-tests.mjs
```

CI runs the same commands per plugin. The committed `main.js` must match the build.
