# obsidian-plugins

Two [Obsidian](https://obsidian.md) plugins that use [System One](https://systemone.ai) to judge files in a vault. Each lives in its own package with its own manifest, so they install and update independently.

| Package | Plugin id | What it does |
| --- | --- | --- |
| [packages/auto-move](packages/auto-move) | `systemone-auto-move` | Suggests a destination folder per note and moves it once you approve |
| [packages/auto-tag](packages/auto-tag) | `systemone-auto-tag` | Suggests frontmatter tags per note and writes them once you approve |

## Install

Install from the community plugin browser, or copy a package's `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/<plugin-id>/` and enable it in **Settings → Community plugins**.

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
