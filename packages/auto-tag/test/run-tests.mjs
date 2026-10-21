#!/usr/bin/env node
/**
 * Unit tests for the pure parts of the plugin: bucketing, the score cache and
 * the tag helpers. Bundles the TypeScript with esbuild, stubbing `obsidian` so
 * the modules load outside the app.
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
// Under the project, not in tmp: the bundled modules import js-yaml by bare
// name, and Node resolves that from the importer's directory upwards.
const outdir = mkdtempSync(join(root, "node_modules", ".s1at-test-"));

const obsidianStub = {
  name: "obsidian-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
    // Resolved at run time from this project, not from the stub's namespace.
    build.onResolve({ filter: /^js-yaml$/ }, () => ({ path: "js-yaml", external: true }));
    // Real js-yaml, the parser Obsidian itself ships: a forgiving stub hides
    // exactly the cases where a YAML round-trip eats a user's frontmatter.
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        import { load, dump } from "js-yaml";
        export const parseYaml = (s) => load(s);
        export const stringifyYaml = (o) => dump(o);
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
      join(root, "src/judge/bucket.ts"),
      join(root, "src/judge/tag-run.ts"),
      join(root, "src/cache/score-cache.ts"),
      join(root, "src/cache/fingerprint.ts"),
      join(root, "src/vault/tags.ts"),
      join(root, "src/llm/systemone.ts"),
    ],
    bundle: true,
    format: "esm",
    outdir,
    outbase: join(root, "src"),
    plugins: [obsidianStub],
    logLevel: "silent",
  });

  const bucketMod = await import(join(outdir, "judge/bucket.js"));
  const runMod = await import(join(outdir, "judge/tag-run.js"));
  const cacheMod = await import(join(outdir, "cache/score-cache.js"));
  const fpMod = await import(join(outdir, "cache/fingerprint.js"));
  const tagsMod = await import(join(outdir, "vault/tags.js"));
  const llmMod = await import(join(outdir, "llm/systemone.js"));

  // —— bucketing ——
  check("p=.89 τ=.90 is human", bucketMod.bucket(0.89, 0.9), "h");
  check("p=.93 τ=.90 is write", bucketMod.bucket(0.93, 0.9), "w");
  check("p=.41 τ=.90 is ignore", bucketMod.bucket(0.41, 0.9), "n");
  check("p=.80 τ=.80 is write", bucketMod.bucket(0.8, 0.8), "w");
  check("band lower bound p=.60 τ=.80 is human", bucketMod.bucket(0.6, 0.8), "h");
  check("below band p=.599 τ=.80 is ignore", bucketMod.bucket(0.599, 0.8), "n");
  check("band is fixed at 0.20", bucketMod.HUMAN_BAND, 0.2);
  check(
    "writeSet keeps above-threshold tags, strongest first",
    bucketMod.writeSet(["b", "a", "c"], { a: 0.9, b: 0.85, c: 0.2 }, 0.8, [], 0),
    ["a", "b"]
  );
  check(
    "writeSet exclusion is case-insensitive",
    bucketMod.writeSet(["a", "b"], { a: 0.9, b: 0.9 }, 0.8, ["A"], 0),
    ["b"]
  );
  check(
    "writeSet cap keeps the strongest tags",
    bucketMod.writeSet(["c", "b", "a"], { a: 0.99, b: 0.95, c: 0.9 }, 0.8, [], 2),
    ["a", "b"]
  );
  check("writeSet ignores unscored tags", bucketMod.writeSet(["a", "b"], { a: 0.9 }, 0.8, [], 0), ["a"]);
  check("writeSet with no scores writes nothing", bucketMod.writeSet(["a"], {}, 0.8, [], 0), []);

  // —— tag row state ——
  const run = runMod.newTagRun({
    scopeFolder: "inbox",
    tags: [],
    maxTagsPerNote: 8,
  });
  check("a new run starts in standby", run.status, "standby");
  check("a new run has no scores", Object.keys(run.scores).length, 0);
  check("a new run has nothing applied", Object.keys(run.applied).length, 0);

  run.tags = ["alpha", "beta", "gamma"];
  check("an unjudged file has no row state", runMod.tagRowState(run, "n.md", []).scored.length, 0);

  run.scores["n.md"] = { alpha: 0.95, beta: 0.85, gamma: 0.3 };
  const row = runMod.tagRowState(run, "n.md", []);
  check("row lists every scored tag in plan order", row.scored.map((t) => t.tag), ["alpha", "beta", "gamma"]);
  check("row buckets against the run threshold", row.scored.map((t) => t.bucket), ["w", "w", "n"]);
  check("write set keeps only tags above τ", row.writeTags.sort(), ["alpha", "beta"]);

  const withExisting = runMod.tagRowState(run, "n.md", ["Alpha"]);
  check("tags already on the note are not proposed", withExisting.writeTags, ["beta"]);
  check(
    "an existing tag still shows in the scored list",
    withExisting.scored.find((t) => t.tag === "alpha")?.bucket,
    "w"
  );

  check("the write threshold is fixed, not per run", runMod.WRITE_THRESHOLD, 0.8);
  check(
    "a near-miss stays visible but unwritten",
    runMod.tagRowState(run, "n.md", []).scored.find((t) => t.tag === "beta")?.bucket,
    "w"
  );

  run.maxTagsPerNote = 1;
  check("the per-note cap keeps the strongest tag", runMod.tagRowState(run, "n.md", []).writeTags, ["alpha"]);
  run.maxTagsPerNote = 0;
  check("a zero cap means no limit", runMod.tagRowState(run, "n.md", []).writeTags.sort(), ["alpha", "beta"]);

  run.scores["partial.md"] = { alpha: 0.9 };
  check(
    "an unanswered tag is absent, never zero",
    runMod.tagRowState(run, "partial.md", []).scored.map((t) => t.tag),
    ["alpha"]
  );

  // —— score cache ——
  const cache = new cacheMod.ScoreCache(3);
  const entry = (over) => ({
    filePath: "n",
    contentFingerprint: "fp1",
    tagsHash: "t1",
    tags: { alpha: 0.9 },
    modelId: "m",
    bodyScope: "first_n",
    firstN: 800,
    promptVersion: "v",
    judgedAt: 1,
    ...over,
  });
  const partsOf = (over) => {
    const e = entry(over);
    const { filePath, contentFingerprint, tagsHash, modelId, promptVersion, bodyScope, firstN } = e;
    return { filePath, contentFingerprint, tagsHash, modelId, promptVersion, bodyScope, firstN };
  };
  cache.set(entry({}));
  cache.set(entry({ contentFingerprint: "fp2", judgedAt: 2 }));
  check("one entry per file", cache.dump().length, 1);
  check("the stale fingerprint is dropped", cache.get(partsOf({ contentFingerprint: "fp1" })), undefined);
  check("the current fingerprint is served", cache.get(partsOf({ contentFingerprint: "fp2" }))?.tags.alpha, 0.9);
  cache.set(entry({ filePath: "n2", judgedAt: 3 }));
  cache.set(entry({ filePath: "n3", judgedAt: 4 }));
  cache.set(entry({ filePath: "n4", judgedAt: 5 }));
  check("cache evicts past its cap", cache.dump().length, 3);
  check(
    "changing the tag list invalidates",
    cacheMod.scoreKey(partsOf({ tagsHash: "t2" })) === cacheMod.scoreKey(partsOf({})),
    false
  );
  check(
    "first_n keys on the char count",
    cacheMod.scoreKey(partsOf({ firstN: 400 })) === cacheMod.scoreKey(partsOf({})),
    false
  );
  check(
    "full scope ignores the char count",
    cacheMod.scoreKey(partsOf({ bodyScope: "full", firstN: 400 })) ===
      cacheMod.scoreKey(partsOf({ bodyScope: "full", firstN: 800 })),
    true
  );

  // —— fingerprint ——
  check("the same text fingerprints the same", fpMod.contentFingerprint("abc"), fpMod.contentFingerprint("abc"));
  check("different text fingerprints differently", fpMod.contentFingerprint("abc") === fpMod.contentFingerprint("abd"), false);

  // —— tag helpers ——
  check("normalizeTag strips the leading hash", tagsMod.normalizeTag("#a/b"), "a/b");
  check(
    "frontmatterTags reads tags: and the singular tag:",
    tagsMod.frontmatterTags({ tags: ["a"], tag: "b c" }).sort(),
    ["a", "b", "c"]
  );
  check(
    "stripFrontmatter handles CRLF",
    tagsMod.stripFrontmatter("---\r\ntags:\r\n  - a\r\n---\r\nbody").frontmatter,
    "tags:\r\n  - a"
  );
  check(
    "stripFrontmatter tolerates a BOM",
    tagsMod.stripFrontmatter("﻿---\ntags: [a]\n---\nbody").frontmatter,
    "tags: [a]"
  );
  check(
    "stripFrontmatter leaves unterminated YAML alone",
    tagsMod.stripFrontmatter("---\ntags: [a]\n\nbody").frontmatter,
    null
  );
  check(
    "inlineTagsFromContent skips link anchors",
    tagsMod.inlineTagsFromContent("See [j](#jump) and #real").sort(),
    ["real"]
  );
  check(
    "inlineTagsFromContent keeps nested and CJK tags whole",
    tagsMod.inlineTagsFromContent("#a/b #a-b #中文 #x_1").sort(),
    ["a-b", "a/b", "x_1", "中文"]
  );
  check(
    "inlineTagsFromContent stops at punctuation",
    tagsMod.inlineTagsFromContent("#tag. and #tag2, and #tag3!").sort(),
    ["tag", "tag2", "tag3"]
  );
  check(
    "inlineTagsFromContent needs a word boundary before #",
    tagsMod.inlineTagsFromContent("中文#紧贴 (#paren)").length,
    0
  );
  check(
    "prepareBodyForJudge strips inline tags before sending",
    tagsMod.prepareBodyForJudge("body text #noise here", "full", 800, "t").body.includes("#noise"),
    false
  );
  check(
    "prepareBodyForJudge honours the title scope",
    tagsMod.prepareBodyForJudge("body", "title", 800, "T").body,
    ""
  );
  check(
    "prepareBodyForJudge truncates to first_n",
    tagsMod.prepareBodyForJudge("x".repeat(50), "first_n", 10, "T").body.length,
    10
  );

  // —— writing and removing tags ——
  // These are the only functions that touch a user's note, so they run against
  // a fake vault whose process() applies the real callback to a string.
  const fakeApp = (content, extension = "md") => {
    const file = { path: `n.${extension}`, extension };
    const vault = {
      process: async (_file, fn) => {
        vault.__content = fn(vault.__content);
        return vault.__content;
      },
      __content: content,
    };
    // The cache reports nothing: these tests are about the file bytes, and a
    // cached tag list would be the app's view, not the text being edited.
    return {
      app: { vault, metadataCache: { getFileCache: () => null } },
      file,
      read: () => vault.__content,
    };
  };

  const write = async (content, tags, mode) => {
    const f = fakeApp(content);
    const added = await tagsMod.addTagsToNote(f.app, f.file, tags, mode);
    return { added, content: f.read() };
  };
  const strip = async (content, tags, mode) => {
    const f = fakeApp(content);
    const removed = await tagsMod.removeTagsFromNote(f.app, f.file, tags, mode);
    return { removed, content: f.read() };
  };

  const plain = "# Title\n\nbody\n";
  const w1 = await write(plain, ["a", "b"], "frontmatter");
  check("frontmatter write reports what landed", w1.added, ["a", "b"]);
  check("frontmatter write adds a tags key", w1.content.startsWith("---\ntags:\n  - a\n  - b\n---\n"), true);
  check("frontmatter write keeps the body", w1.content.endsWith(plain), true);

  const r1 = await strip(w1.content, ["a", "b"], "frontmatter");
  check("frontmatter removal reports what it removed", r1.removed.sort(), ["a", "b"]);
  check("removing the only tags restores the original bytes", r1.content, plain);

  const kept = await write("---\ntags: [keep]\n---\nbody\n", ["new"], "frontmatter");
  check("an existing tag survives a write", kept.content.includes("keep"), true);
  check("the new tag is added next to it", kept.content.includes("new"), true);
  const afterPartial = await strip(kept.content, ["new"], "frontmatter");
  check("removing one tag leaves the other", afterPartial.content, "---\ntags:\n  - keep\n---\nbody\n");

  const singular = await write("---\ntag: old\nother: 1\n---\nbody\n", ["new"], "frontmatter");
  check("the singular tag key is folded into tags:", singular.content.includes("tag: old"), false);
  check("its value is kept as a tag", singular.content.includes("old"), true);
  check("unrelated frontmatter keys survive", singular.content.includes("other: 1"), true);

  const crlf = await write("---\r\ntags: [x]\r\n---\r\nbody\r\n", ["y"], "frontmatter");
  check("CRLF notes keep CRLF", crlf.content.includes("\r\n") && !/[^\r]\n/.test(crlf.content), true);

  const inline = await write(plain, ["a", "b"], "inline_top");
  check("inline write reports what landed", inline.added, ["a", "b"]);
  check("inline write prepends one tag line", inline.content, "#a #b\n" + plain);
  const inlineBack = await strip(inline.content, ["a", "b"], "inline_top");
  check("inline removal restores the original bytes", inlineBack.content, plain);
  check("inline removal reports what it removed", inlineBack.removed.sort(), ["a", "b"]);

  const partialInline = await strip("#a #b\nbody\n", ["a"], "inline_top");
  check("removing one inline tag keeps the other", partialInline.content, "#b\nbody\n");

  const linked = "See [j](#jump) and #real\n";
  check(
    "inline removal leaves link anchors alone",
    (await strip(linked, ["jump"], "inline_top")).content,
    linked
  );
  check(
    "inline removal leaves body tags alone",
    (await strip("#a\nbody with #a inside\n", ["a"], "inline_top")).content,
    "body with #a inside\n"
  );

  const absent = await strip("#a\nbody\n", ["zzz"], "inline_top");
  check("removing a tag that is not there reports nothing", absent.removed, []);
  check("removing a tag that is not there changes nothing", absent.content, "#a\nbody\n");

  const alreadyOn = await write("---\ntags: [a]\n---\nbody\n", ["a"], "frontmatter");
  check("a tag already on the note is not reported as added", alreadyOn.added, []);
  check("a tag already on the note is not duplicated", (alreadyOn.content.match(/a/g) ?? []).length, 2);

  const bothMode = await write(plain, ["a"], "both");
  check("both mode writes frontmatter and inline", bothMode.content.startsWith("---\ntags:\n  - a\n---\n#a\n"), true);
  const bothBack = await strip(bothMode.content, ["a"], "both");
  check("both mode removal restores the original bytes", bothBack.content, plain);

  // —— frontmatter the plugin does not own stays byte-identical ——
  // A round-trip through a YAML serialiser rewrites every key it touches, so
  // these check the bytes, not the parsed shape.
  const dupKeys = "---\ntitle: x\ntitle: y\nfoo: bar\n---\nbody\n";
  const dupOut = await write(dupKeys, ["a"], "frontmatter");
  check("duplicate YAML keys survive a tag write", dupOut.content.includes("title: x\ntitle: y"), true);
  check("an unrelated key survives a tag write", dupOut.content.includes("foo: bar"), true);
  check("the tag still lands", dupOut.content.includes("- a"), true);

  const typed = "---\ndate: 2024-01-01\nflag: yes\nnum: 0x1F\n---\nbody\n";
  const typedOut = await write(typed, ["a"], "frontmatter");
  check("a date value is not rewritten", /^date: 2024-01-01$/m.test(typedOut.content), true);
  check("a hex number is not rewritten", typedOut.content.includes("num: 0x1F"), true);
  check("a yes/no value is not quoted", typedOut.content.includes("flag: yes"), true);

  const commented = "---\n# important context\ntitle: T\n---\nbody\n";
  check(
    "a YAML comment survives a tag write",
    (await write(commented, ["a"], "frontmatter")).content.includes("# important context"),
    true
  );

  const rule = "---\nintro paragraph\n---\n\nrest of note\n";
  const ruleOut = await write(rule, ["a"], "frontmatter");
  check("a leading horizontal rule is not treated as frontmatter", ruleOut.content.includes("intro paragraph"), true);

  const blockScalar = "---\ntitle: T\ndesc: |\n  line one\n---\n  line two\n---\nbody\n";
  const blockOut = await write(blockScalar, ["a"], "frontmatter");
  // "line two" must stay inside the block scalar, i.e. before the closing rule.
  check(
    "a block scalar containing --- is not cut short",
    blockOut.content.indexOf("line two") < blockOut.content.lastIndexOf("\n---"),
    true
  );
  check("the block is not broken into two", (blockOut.content.match(/\n---\n/g) ?? []).length, 2);

  // —— line-start inline tags past line 1 ——
  check(
    "line-start tags are found on every line",
    tagsMod.inlineTagsFromContent("intro\n#alpha line-start\nend #beta inline\n#gamma").sort(),
    ["alpha", "beta", "gamma"]
  );
  const lineStart = "first line\n#a at line start\nbody\n";
  const lineStartOut = await write(lineStart, ["a"], "inline_top");
  check("a tag already at a line start is not duplicated", lineStartOut.added, []);
  check("nothing is prepended in that case", lineStartOut.content, lineStart);
  check(
    "prepareBodyForJudge strips line-start tags too",
    tagsMod.prepareBodyForJudge("intro\n#keep out\nbody\n", "full", 800, "t").body.includes("#keep out"),
    false
  );

  // —— a null noul is unanswered, not zero ——
  check("a null noul is unanswered", llmMod.parseNoul({ noul: null }), null);
  check("a false noul is unanswered", llmMod.parseNoul({ noul: false }), null);
  check("an empty-string noul is unanswered", llmMod.parseNoul({ noul: "" }), null);
  check("a real zero is still zero", llmMod.parseNoul({ noul: 0 }), 0);

  const binaryFile = fakeApp("%PDF-1.4\n", "pdf");
  const binaryAdded = await tagsMod.addTagsToNote(binaryFile.app, binaryFile.file, ["a"], "frontmatter");
  check("a non-markdown file is never written to", binaryFile.read(), "%PDF-1.4\n");
  check("a non-markdown file reports nothing added", binaryAdded, []);

  // —— system one client ——
  check("PROMPT_VERSION is derived", typeof llmMod.PROMPT_VERSION, "string");
  check("PROMPT_VERSION is not a placeholder", llmMod.PROMPT_VERSION === "v1", false);
  check("tag questions use positional ids", Object.keys(llmMod.tagQuestions(["a", "b"])).sort(), ["t0", "t1"]);
  check("tag questions are noul", llmMod.tagQuestions(["a"]).t0.type, "noul");
  check(
    "tag question criteria name the tag",
    llmMod.tagQuestions(["alpha"]).t0.criteria.true.includes("alpha"),
    true
  );
  check("theme questions use positional ids", Object.keys(llmMod.themeQuestions(["a"])).sort(), ["t0"]);
  check("theme questions are noul", llmMod.themeQuestions(["a"]).t0.type, "noul");
  check(
    "theme questions ask about the set, not one note",
    llmMod.themeQuestions(["alpha"]).t0.instructions.includes("at least one of these notes"),
    true
  );
  check("parseNoul reads a probability", llmMod.parseNoul({ type: "noul", noul: 0.83 }), 0.83);
  check("parseNoul clamps above one", llmMod.parseNoul({ noul: 1.7 }), 1);
  check("parseNoul clamps below zero", llmMod.parseNoul({ noul: -3 }), 0);
  check("parseNoul rejects a missing answer", llmMod.parseNoul(undefined), null);
  check("parseNoul rejects a non-numeric answer", llmMod.parseNoul({ noul: "bad" }), null);
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
