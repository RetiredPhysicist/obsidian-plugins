# Changesets

This folder stores [Changesets](https://github.com/changesets/changesets) entries for this monorepo.

## Preferred release path

1. In a feature PR, run `npx changeset` (from the repo root) and commit the generated markdown under `.changeset/`.
2. After merge to `main`, `.github/workflows/changeset-release.yml` opens a **Version Packages** PR (version bumps + changelogs; also syncs each package's `manifest.json` / `versions.json`).
3. Merge that PR, then ship with the existing tag path below (Obsidian installs from GitHub Releases, not npm).

## Tag-based release (still supported)

The existing `.github/workflows/release.yml` path still works: after versions agree in `package.json` / `manifest.json` / `versions.json`, tag `auto-move-vX.Y.Z` or `auto-tag-vX.Y.Z` and push. Prefer Changesets to prepare the version bump; tags still create the Obsidian release assets.

Do not add secrets here. See the root README **Release** section.
