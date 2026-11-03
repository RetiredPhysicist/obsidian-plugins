# obsidian-plugins

Monorepo for Obsidian plugins. One directory per plugin under `packages/`;
each keeps its own npm name, `manifest.json`, and version.

## Release a package

`script/version-packages.mjs` writes the same version into `package.json`,
`manifest.json`, `versions.json`, and the package lock, so they cannot drift:

```bash
node script/version-packages.mjs auto-move 0.1.1   # or auto-tag
```

Commit that, then tag `auto-<plugin>-v<version>` and push — Obsidian ships
from GitHub Releases, not npm.

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
