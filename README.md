# obsidian-plugins

Two [Obsidian](https://obsidian.md) plugins that use [System One](https://systemone.ai) to judge files in a vault. Each lives in its own package with its own manifest, so they install and update independently.

| Package | Plugin id | What it does |
| --- | --- | --- |
| [packages/auto-move](packages/auto-move) | `systemone-auto-move` | Suggests a destination folder per note and moves it once you approve |
| [packages/auto-tag](packages/auto-tag) | `systemone-auto-tag` | Suggests frontmatter tags per note and writes them once you approve |

## Install

Download `main.js`, `manifest.json` and `styles.css` from the plugin's release, put them in `.obsidian/plugins/<plugin-id>/`, and enable the plugin in **Settings → Community plugins**. Each release also carries a zip of the three files for the same manual install.

Releases are tagged per plugin — `auto-move-v0.1.0`, `auto-tag-v0.1.0` — so one plugin's version never implies the other's.

## Release

Obsidian loads a plugin only when its tag, `package.json`, `manifest.json`, and `versions.json` entry agree. `script/version-packages.mjs` writes all four files at once, then you push the tag:

```bash
node script/version-packages.mjs auto-move 0.1.1   # or auto-tag
git add packages/auto-move && git commit -m "release(auto-move): 0.1.1"
git tag auto-move-v0.1.1
git push origin auto-move-v0.1.1
```

The existing `.github/workflows/release.yml` builds from source and fails when the committed bundle, the three version files and the tag disagree, so a tag cannot ship a stale or mislabelled build.

## Develop

Each package is self-contained; run commands inside it.

```bash
cd packages/auto-move     # or packages/auto-tag
npm ci
npm run dev               # rebuild on change
npm run build             # typecheck, then the production bundle
node test/run-tests.mjs   # unit tests
```

`main.js` is committed because Obsidian loads it directly. The build is expected to leave the working tree clean — CI fails if rebuilding changes the committed bundle.

## License

Each package carries its own `LICENSE`: both are GPL-3.0.
