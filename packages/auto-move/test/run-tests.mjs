#!/usr/bin/env node
/**
 * Unit tests for the pure parts of the plugin: the move classifier, the
 * question builder, the cache and the path helpers. Bundles the TypeScript with
 * esbuild, stubbing `obsidian` so the modules load outside the app.
 *
 * Usage: node test/run-tests.mjs [--verbose]
 * Exit code 0 = all pass, 1 = failures.
 */
import esbuild from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const verbose = process.argv.includes("--verbose");
const outdir = mkdtempSync(join(tmpdir(), "s1am-test-"));

const obsidianStub = {
  name: "obsidian-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        export const requestUrl = async () => ({ status: 200, text: "{}", json: {} });
        export class TFile {}
        export class TFolder {}
        export class TAbstractFile {}
      `,
      loader: "js",
    }));
  },
};

const failures = [];
let checks = 0;
function check(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    got:  ${a}\n    want: ${e}`);
  else if (verbose) console.log(`  ok  ${name}`);
}

try {
  await esbuild.build({
    entryPoints: [
      join(root, "src/judge/move.ts"),
      join(root, "src/judge/move-run.ts"),
      join(root, "src/cache/move-cache.ts"),
      join(root, "src/cache/fingerprint.ts"),
      join(root, "src/vault/folders.ts"),
      join(root, "src/llm/systemone.ts"),
    ],
    bundle: true,
    format: "esm",
    outdir,
    outbase: join(root, "src"),
    plugins: [obsidianStub],
    logLevel: "silent",
  });

  const moveMod = await import(join(outdir, "judge/move.js"));
  const runMod = await import(join(outdir, "judge/move-run.js"));
  const cacheMod = await import(join(outdir, "cache/move-cache.js"));
  const fpMod = await import(join(outdir, "cache/fingerprint.js"));
  const foldersMod = await import(join(outdir, "vault/folders.js"));
  const llmMod = await import(join(outdir, "llm/systemone.js"));

  // —— move classifier ——
  const mv = (over) =>
    moveMod.classifyMove({
      answer: { choice: "a", confidence: 0.9, probabilities: { a: 0.9 } },
      allowedFolders: ["a", "b"],
      threshold: 0.7,
      collision: false,
      alreadyThere: false,
      ...over,
    });
  check("above threshold moves", mv({}).bucket, "move");
  check("above threshold names the folder", mv({}).toFolder, "a");
  check(
    "just under threshold asks",
    mv({ answer: { choice: "a", confidence: 0.65, probabilities: { a: 0.65 } } }).bucket,
    "confirm"
  );
  check(
    "just under threshold reports why",
    mv({ answer: { choice: "a", confidence: 0.65, probabilities: { a: 0.65 } } }).reason,
    "low-confidence"
  );
  check("keep never moves", mv({ answer: { choice: "keep", confidence: 1, probabilities: { keep: 1 } } }).bucket, "stay");
  check(
    "keep names no destination",
    mv({ answer: { choice: "keep", confidence: 1, probabilities: { keep: 1 } } }).toFolder,
    undefined
  );
  check(
    "an option outside the list is never chosen",
    mv({ answer: { choice: "zzz", confidence: 1, probabilities: { zzz: 1 } } }).reason,
    "unknown-option"
  );
  check(
    "an option outside the list names no destination",
    mv({ answer: { choice: "zzz", confidence: 1, probabilities: { zzz: 1 } } }).toFolder,
    undefined
  );
  check("a collision needs confirmation", mv({ collision: true }).bucket, "confirm");
  check("a collision is named", mv({ collision: true }).reason, "collision");
  check("a collision still shows the intended folder", mv({ collision: true }).toFolder, "a");
  check("already in the target folder stays", mv({ alreadyThere: true }).bucket, "stay");
  check("no answer asks", mv({ answer: null }).bucket, "confirm");
  check("no answer is reported as such", mv({ answer: null }).reason, "no-answer");
  check("no answer names no destination", mv({ answer: null }).toFolder, undefined);
  check(
    "a flat distribution never auto-moves, however confident",
    mv({ answer: { choice: "a", confidence: 0.95, probabilities: { a: 0.55, b: 0.45 } } }).bucket,
    "confirm"
  );
  check(
    "a missing probability falls back to confidence",
    mv({ answer: { choice: "a", confidence: 0.9, probabilities: {} } }).bucket,
    "move"
  );
  check("the threshold is inclusive", mv({ answer: { choice: "a", confidence: 0.7, probabilities: { a: 0.7 } } }).bucket, "move");

  // —— question builder ——
  const hints = [
    { path: "inbox", examples: ["x"] },
    { path: "a", examples: ["y", "z"] },
    { path: "b", examples: [] },
  ];
  const q = llmMod.buildMoveQuestion(hints, "inbox");
  check("the file's own folder is not an option", "inbox" in q.criteria, false);
  check("keep is always an option", "keep" in q.criteria, true);
  check("keep names the current folder", String(q.criteria.keep).includes("inbox/"), true);
  check("keep names the vault root when there is no folder", String(llmMod.buildMoveQuestion(hints, "").criteria.keep).includes("vault root"), true);
  check("folder examples reach the criteria", String(q.criteria.a).includes("y, z"), true);
  check("an empty folder gets a plain description", String(q.criteria.b).includes("named b/"), true);
  check("the question is a choice", q.type, "choice");
  check(
    "options are capped at the API limit",
    Object.keys(llmMod.buildMoveQuestion(
      Array.from({ length: 300 }, (_, i) => ({ path: `f${i}`, examples: [] })),
      ""
    ).criteria).length,
    llmMod.MAX_CHOICES
  );
  check("MAX_CHOICES matches the API", llmMod.MAX_CHOICES, 255);
  check(
    "the current folder is dropped before the cap is applied",
    Object.keys(llmMod.buildMoveQuestion(
      Array.from({ length: 300 }, (_, i) => ({ path: `f${i}`, examples: [] })),
      "f0"
    ).criteria).includes("f0"),
    false
  );

  check("a choice answer parses", llmMod.parseMoveAnswer({ type: "choice", choice: "a", confidence: 0.8 })?.choice, "a");
  check("a noul answer is not a move answer", llmMod.parseMoveAnswer({ type: "noul", noul: 0.9 }), null);
  check("a missing choice is rejected", llmMod.parseMoveAnswer({ type: "choice" }), null);
  check("a missing confidence does not become NaN", llmMod.parseMoveAnswer({ type: "choice", choice: "a" })?.confidence, 0);
  check(
    "missing probabilities default to an empty map",
    llmMod.parseMoveAnswer({ type: "choice", choice: "a", confidence: 1 })?.probabilities,
    {}
  );

  // —— the vault root is never a destination ——
  // Obsidian reports the root as "/" while every path this plugin builds writes
  // it as "". Offering it would give the model both `keep` and `/`.
  const rootApp = {
    vault: {
      configDir: ".obsidian",
      getRoot: () => ({ path: "/" }),
      getFile: (p) => ({ path: p }),
      getFiles: () => [
        { basename: "rootnote", parent: { path: "/" } },
        { basename: "filed", parent: { path: "notes" } },
      ],
      getAbstractFileByPath: (p) => (p === "notes" ? { path: "notes", children: [] } : null),
    },
  };
  const opts = foldersMod.collectFolderOptions(rootApp);
  check("the vault root is not offered as a folder", opts.map((f) => f.path), ["notes"]);
  check("a normal folder keeps its examples", opts[0].examples, ["filed"]);

  // —— answer parsing ——
  check("parent of a nested path", foldersMod.parentOf("a/b/c.md"), "a/b");
  check("parent of a root file is empty", foldersMod.parentOf("c.md"), "");
  check("joinPath with a folder", foldersMod.joinPath("a", "x.md"), "a/x.md");
  check("joinPath at root", foldersMod.joinPath("", "x.md"), "x.md");
  check("ignored folders include the config dir", foldersMod.isIgnoredFolder(".obsidian/plugins", ".obsidian"), true);
  check("ignored folders include trash", foldersMod.isIgnoredFolder(".trash/x", ".obsidian"), true);
  check("ordinary folders are not ignored", foldersMod.isIgnoredFolder("dev/notes", ".obsidian"), false);
  check("a prefix match must be a path boundary", foldersMod.isIgnoredFolder(".observations", ".obsidian"), false);

  // —— fingerprints and cache ——
  check("the same text fingerprints the same", fpMod.contentFingerprint("abc"), fpMod.contentFingerprint("abc"));
  check("different text fingerprints differently", fpMod.contentFingerprint("abc") === fpMod.contentFingerprint("abd"), false);

  const cache = new cacheMod.MoveCache(3);
  const entry = (over) => ({
    filePath: "n",
    contentFingerprint: "fp1",
    foldersHash: "f1",
    bodyChars: 800,
    choice: "a",
    confidence: 0.8,
    probabilities: { a: 0.8 },
    modelId: "m",
    promptVersion: "v",
    judgedAt: 1,
    ...over,
  });
  const partsOf = (over) => {
    const e = entry(over);
    const { filePath, contentFingerprint, foldersHash, bodyChars, modelId, promptVersion } = e;
    return { filePath, contentFingerprint, foldersHash, bodyChars, modelId, promptVersion };
  };
  cache.set(entry({}));
  cache.set(entry({ contentFingerprint: "fp2", judgedAt: 2 }));
  check("one entry per file", cache.dump().length, 1);
  check("the stale fingerprint is dropped", cache.get(partsOf({ contentFingerprint: "fp1" })), undefined);
  check("the current fingerprint is served", cache.get(partsOf({ contentFingerprint: "fp2" }))?.choice, "a");
  cache.set(entry({ filePath: "n2", judgedAt: 3 }));
  cache.set(entry({ filePath: "n3", judgedAt: 4 }));
  cache.set(entry({ filePath: "n4", judgedAt: 5 }));
  check("cache evicts past its cap", cache.dump().length, 3);
  check(
    "changing the folder list invalidates",
    cacheMod.moveKey(partsOf({ foldersHash: "f2" })) === cacheMod.moveKey(partsOf({})),
    false
  );
  check(
    "changing the model invalidates",
    cacheMod.moveKey(partsOf({ modelId: "m2" })) === cacheMod.moveKey(partsOf({})),
    false
  );
  check(
    "changing how much body the model sees invalidates",
    cacheMod.moveKey(partsOf({ bodyChars: 100 })) === cacheMod.moveKey(partsOf({})),
    false
  );

  // —— run model ——
  const run = runMod.newMoveRun({ scopeFolder: "inbox", folders: hints });
  check("the move threshold is fixed, not per run", runMod.MOVE_THRESHOLD, 0.7);
  check("a new run has no threshold of its own", run.threshold, undefined);
  check("a new run starts in standby", run.status, "standby");
  check("a new run has no answers", Object.keys(run.answers).length, 0);
  check("a new run has nothing applied", Object.keys(run.applied).length, 0);
  check("a new run keeps its folder hints", run.folders.length, 3);

  // —— system one client ——
  check("PROMPT_VERSION is derived", typeof llmMod.PROMPT_VERSION, "string");
  check("PROMPT_VERSION is not a placeholder", llmMod.PROMPT_VERSION === "v1", false);
  check(
    "normalizeBaseUrl accepts a full endpoint",
    llmMod.normalizeBaseUrl("https://api.typesafe.ai/v1/systemone/"),
    "https://api.typesafe.ai"
  );
  check(
    "normalizeBaseUrl accepts a v1 base",
    llmMod.normalizeBaseUrl("https://api.typesafe.ai/v1"),
    "https://api.typesafe.ai"
  );
  check(
    "systemOneEndpoint rebuilds one path",
    llmMod.systemOneEndpoint("https://api.typesafe.ai/v1"),
    "https://api.typesafe.ai/v1/systemone"
  );
} finally {
  rmSync(outdir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`${failures.length}/${checks} checks failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${checks} checks passed`);
