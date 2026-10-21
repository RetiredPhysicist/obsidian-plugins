var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SystemOneAutoTagPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  baseUrl: "https://api.typesafe.ai",
  apiKey: "",
  modelId: "jev-1.14.0",
  lastFolder: "",
  maxTagsPerNote: 8,
  bodyScope: "first_n",
  bodyChars: 800,
  writeMode: "frontmatter"
};
var SystemOneAutoTagSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "System One Auto Tag" });
    new import_obsidian.Setting(containerEl).setName("API key").setDesc("Bearer token for System One. Stored in plugin data only.").addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("ts_\u2026").setValue(this.plugin.settings.apiKey).onChange(async (v) => {
        this.plugin.settings.apiKey = v.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Model").setDesc("Default: jev-1.14.0").addText(
      (t) => t.setPlaceholder("jev-1.14.0").setValue(this.plugin.settings.modelId).onChange(async (v) => {
        this.plugin.settings.modelId = v.trim() || "jev-1.14.0";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Base URL").setDesc("Requests go to {base}/v1/systemone").addText(
      (t) => t.setPlaceholder("https://api.typesafe.ai").setValue(this.plugin.settings.baseUrl).onChange(async (v) => {
        this.plugin.settings.baseUrl = v.trim().replace(/\/+$/, "");
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Write mode").setDesc("How accepted tags land in the note").addDropdown(
      (d) => d.addOptions({
        frontmatter: "YAML frontmatter tags:",
        inline_top: "Inline #tag at top",
        both: "Both"
      }).setValue(this.plugin.settings.writeMode).onChange(async (v) => {
        this.plugin.settings.writeMode = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Body sent to the model").addDropdown(
      (d) => d.addOptions({ first_n: "First N chars", full: "Full note", title: "Title only" }).setValue(this.plugin.settings.bodyScope).onChange(async (v) => {
        this.plugin.settings.bodyScope = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Body chars").setDesc("Used when the scope above is First N chars").addText(
      (t) => t.setValue(String(this.plugin.settings.bodyChars)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 50) return;
        this.plugin.settings.bodyChars = n;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Max tags per note").setDesc("0 = no limit").addText(
      (t) => t.setValue(String(this.plugin.settings.maxTagsPerNote)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 0) return;
        this.plugin.settings.maxTagsPerNote = n;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/ui/tag-view.ts
var import_obsidian4 = require("obsidian");

// src/cache/fingerprint.ts
function contentFingerprint(content) {
  let h = 2166136261;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

// src/vault/tags.ts
var INLINE_TAG_RE = /(^| )#((?:[^\s.,;:!?'"()[\]{}<>|`~*+=@$%^&/#]|\/(?![\s#]))+)/gmu;
function normalizeTag(tag) {
  return tag.replace(/^#/, "").trim();
}
function frontmatterTags(fm) {
  if (!fm) return [];
  const out = [];
  for (const raw of [fm.tags, fm.tag]) {
    if (raw === void 0 || raw === null) continue;
    if (typeof raw === "string") {
      out.push(...raw.split(/[,\s]+/).map(normalizeTag).filter(Boolean));
    } else if (Array.isArray(raw)) {
      out.push(...raw.map((x) => normalizeTag(String(x))).filter(Boolean));
    }
  }
  return [...new Set(out)];
}
function inlineTagsFromContent(content) {
  const body = stripFrontmatter(content).body;
  const out = /* @__PURE__ */ new Set();
  const re = new RegExp(INLINE_TAG_RE.source, "gmu");
  let m;
  while ((m = re.exec(body)) !== null) out.add(normalizeTag(m[2]));
  return [...out];
}
function noteTags(app, file, content) {
  const fileCache = app.metadataCache.getFileCache(file);
  const fromFm = frontmatterTags(fileCache?.frontmatter);
  const fromCache = fileCache?.tags?.map((t) => normalizeTag(t.tag)) ?? [];
  const fromInline = content !== void 0 ? inlineTagsFromContent(content) : [];
  const out = /* @__PURE__ */ new Set();
  for (const t of [...fromFm, ...fromCache, ...fromInline]) {
    out.add(t.toLowerCase());
  }
  return [...out];
}
function stripFrontmatter(content) {
  const open = /^﻿?---[ \t]*(\r?\n)/.exec(content);
  if (!open) return { frontmatter: null, body: content, start: 0, end: 0 };
  const afterOpen = open[0].length;
  const rest = content.slice(afterOpen);
  const close = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/.exec(rest);
  if (!close) return { frontmatter: null, body: content, start: 0, end: 0 };
  const fmRaw = rest.slice(0, close.index);
  const end = afterOpen + close.index + close[0].length;
  return { frontmatter: fmRaw, body: content.slice(end), start: 0, end };
}
function eolOf(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}
function withTagsBlock(frontmatter, tags, eol) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((l) => /^(tags|tag)\s*:/.test(l));
  if (start < 0) {
    if (tags === null || tags.length === 0) return frontmatter;
    return frontmatter + eol + renderTags(tags, eol);
  }
  let stop = start + 1;
  while (stop < lines.length && (/^[ \t]/.test(lines[stop]) || /^\s*-/.test(lines[stop]))) stop++;
  const inline = lines[start].slice(lines[start].indexOf(":") + 1).trim();
  const wasInline = inline.length > 0 && !/^\[/.test(inline);
  if (wasInline && !/^\[/.test(inline)) {
    stop = start + 1;
  }
  const replacement = tags === null || tags.length === 0 ? [] : renderTags(tags, eol).split(eol);
  return [...lines.slice(0, start), ...replacement, ...lines.slice(stop)].join(eol);
}
function renderTags(tags, eol) {
  return ["tags:", ...tags.map((t) => `  - ${quoteIfNeeded(t)}`)].join(eol);
}
function quoteIfNeeded(tag) {
  return /^[\w一-龥][\w一-龥 /_-]*$/.test(tag) ? tag : JSON.stringify(tag);
}
async function addTagsToNote(app, file, tags, mode) {
  if (file.extension !== "md") return [];
  const toAdd = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    toAdd.push(t);
  }
  if (toAdd.length === 0) return [];
  const existing = new Set(noteTags(app, file));
  const novel = toAdd.filter((t) => !existing.has(t.toLowerCase()));
  if (novel.length === 0) return [];
  const written = [];
  await app.vault.process(file, (data) => {
    const eol = eolOf(data);
    const { frontmatter, body } = stripFrontmatter(data);
    let out = data;
    if (mode === "frontmatter" || mode === "both") {
      const before = frontmatterTags(frontmatter === null ? null : parseTagsBlock(frontmatter));
      const merged = dedupe([...before, ...novel]);
      const block = frontmatter === null ? renderTags(merged, eol) : withTagsBlock(frontmatter, merged, eol);
      out = `---${eol}${block}${eol}---${eol}${body}`;
      for (const t of novel) if (!before.some((b) => b.toLowerCase() === t.toLowerCase())) written.push(t);
    }
    if (mode === "inline_top" || mode === "both") {
      const have = new Set(inlineTagsFromContent(out).map((t) => t.toLowerCase()));
      const missing = novel.filter((t) => !have.has(t.toLowerCase()));
      if (missing.length > 0) {
        const { body: currentBody, end: currentEnd } = stripFrontmatter(out);
        const head = out.slice(0, currentEnd);
        out = head + missing.map((t) => `#${t}`).join(" ") + eol + currentBody;
        for (const t of missing) if (!written.some((w) => w.toLowerCase() === t.toLowerCase())) written.push(t);
      }
    }
    return out === data ? data : out;
  });
  return written;
}
async function removeTagsFromNote(app, file, tags, mode) {
  const remove = new Set(tags.map((t) => t.toLowerCase()).filter(Boolean));
  if (remove.size === 0) return [];
  const removed = [];
  await app.vault.process(file, (data) => {
    const eol = eolOf(data);
    const { frontmatter, body } = stripFrontmatter(data);
    let out = data;
    if ((mode === "frontmatter" || mode === "both") && frontmatter !== null) {
      const had = frontmatterTags(parseTagsBlock(frontmatter));
      const kept = had.filter((t) => !remove.has(t.toLowerCase()));
      for (const t of had) if (remove.has(t.toLowerCase())) removed.push(t);
      let block = frontmatter;
      if (kept.length !== had.length) {
        block = withTagsBlock(frontmatter, kept.length > 0 ? kept : null, eol);
      }
      const empty = block.split(/\r?\n/).every((l) => !l.trim());
      out = empty ? body : `---${eol}${block}${eol}---${eol}${body}`;
    }
    if (mode === "inline_top" || mode === "both") {
      const { body: currentBody, end } = stripFrontmatter(out);
      const head = out.slice(0, end);
      const nextBody = currentBody.replace(
        /^[ \t]*((?:#[^\s#]+[ \t]*)+)\r?\n/,
        (_match, line) => {
          const tokens = line.trim().split(/[ \t]+/);
          const gone = tokens.filter((t) => remove.has(normalizeTag(t).toLowerCase()));
          for (const t of gone) {
            const name = normalizeTag(t);
            if (!removed.some((r) => r.toLowerCase() === name.toLowerCase())) removed.push(name);
          }
          const kept = tokens.filter((t) => !remove.has(normalizeTag(t).toLowerCase()));
          return kept.length > 0 ? `${kept.join(" ")}${eol}` : "";
        }
      );
      out = head + nextBody;
    }
    return out === data ? data : out;
  });
  return removed;
}
function dedupe(tags) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const t of tags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
function parseTagsBlock(frontmatter) {
  const out = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(tags|tag)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[2].trim();
    if (inline.startsWith("[") && inline.endsWith("]")) {
      out[m[1]] = inline.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      continue;
    }
    if (inline.length > 0) {
      out[m[1]] = inline;
      continue;
    }
    const items = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s+(.*)$/.exec(lines[j]);
      if (!item) break;
      items.push(item[1].trim().replace(/^["']|["']$/g, ""));
    }
    out[m[1]] = items;
  }
  return out;
}
function prepareBodyForJudge(content, scope, firstN, title) {
  if (scope === "title") return { title, body: "" };
  const { body } = stripFrontmatter(content);
  const cleaned = body.replace(INLINE_TAG_RE, (_m, lead) => lead).trim();
  return { title, body: scope === "first_n" ? cleaned.slice(0, firstN) : cleaned };
}

// src/llm/systemone.ts
var import_obsidian2 = require("obsidian");
var SystemOneCreditError = class extends Error {
  constructor(status, body) {
    super(
      status === 402 ? "System One \u989D\u5EA6\u5DF2\u7528\u5C3D\uFF08HTTP 402\uFF09\u3002\u8BF7\u5145\u503C\u6216\u66F4\u6362 API key \u540E\u518D\u8BD5\u3002" : `System One \u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${status}\uFF09\uFF1A\u989D\u5EA6\u6216\u914D\u989D\u95EE\u9898\u3002${body.slice(0, 200)}`
    );
    this.name = "SystemOneCreditError";
    this.status = status;
  }
};
var SystemOneError = class extends Error {
  constructor(status, body) {
    super(`System One HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "SystemOneError";
    this.status = status;
    this.body = body;
  }
};
function normalizeBaseUrl(baseUrl) {
  let u = baseUrl.trim().replace(/\/+$/, "");
  u = u.replace(/\/v1\/systemone$/i, "");
  u = u.replace(/\/v1$/i, "");
  return u;
}
function systemOneEndpoint(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/v1/systemone`;
}
function hashShort(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
var instruction = (tag) => `Should this note be tagged with "#${tag}"? Answer yes only if the note's topic clearly fits that tag.`;
var criteriaTrue = (tag) => `The note's content is clearly about or strongly related to "${tag}", so applying the tag would help retrieval.`;
var criteriaFalse = (tag) => `The note is unrelated or only tangentially related to "${tag}"; the tag would be noise.`;
var PROMPT_VERSION = hashShort(
  [instruction("{}"), criteriaTrue("{}"), criteriaFalse("{}")].join("\0")
);
function tagQuestions(tags) {
  const questions = {};
  tags.forEach((tag, i) => {
    questions[`t${i}`] = {
      type: "noul",
      instructions: instruction(tag),
      criteria: { true: criteriaTrue(tag), false: criteriaFalse(tag) }
    };
  });
  return questions;
}
function themeQuestions(tags) {
  const questions = {};
  tags.forEach((tag, i) => {
    questions[`t${i}`] = {
      type: "noul",
      instructions: `Is "${tag}" a useful tag for at least one of these notes?`,
      criteria: {
        true: `The notes contain material that fits "${tag}".`,
        false: `Nothing in the notes fits "${tag}".`
      }
    };
  });
  return questions;
}
function parseNoul(answer) {
  if (!answer || typeof answer !== "object") return null;
  const raw = answer.noul;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(1, Math.max(0, raw));
}
var RETRY_DELAYS_MS = [600, 1800];
var RETRIES = RETRY_DELAYS_MS.length;
function isRetryable(err) {
  if (err instanceof SystemOneCreditError) return false;
  if (!(err instanceof SystemOneError)) return true;
  return err.status === 429 || err.status >= 500;
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function callSystemOne(baseUrl, apiKey, req) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(baseUrl, apiKey, req);
    } catch (e) {
      if (attempt >= RETRIES || !isRetryable(e)) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}
async function callOnce(baseUrl, apiKey, req) {
  if (!apiKey) throw new SystemOneError(401, "Missing API key");
  let res;
  try {
    res = await (0, import_obsidian2.requestUrl)({
      url: systemOneEndpoint(baseUrl),
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(req),
      throw: false
    });
  } catch (e) {
    throw new SystemOneError(0, `Network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = res.text ?? "";
  if (res.status < 200 || res.status >= 300) {
    if (res.status === 402 || /insufficient|credit|quota|billing|out of credit/i.test(text)) {
      throw new SystemOneCreditError(res.status, text);
    }
    throw new SystemOneError(res.status, text);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SystemOneError(res.status, `Invalid JSON: ${text.slice(0, 200)}`);
  }
}

// src/judge/bucket.ts
var HUMAN_BAND = 0.2;
var EPS = 1e-9;
function bucket(p, threshold) {
  if (p >= threshold) return "w";
  if (p >= threshold - HUMAN_BAND - EPS) return "h";
  return "n";
}
function writeSet(tags, scores, threshold, exclude, maxTags) {
  const excl = new Set(exclude.map((t) => t.toLowerCase()));
  const auto = tags.filter((tag) => {
    if (excl.has(tag.toLowerCase())) return false;
    const p = scores[tag];
    if (p === void 0) return false;
    return bucket(p, threshold) === "w";
  });
  auto.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  return maxTags > 0 ? auto.slice(0, maxTags) : auto;
}

// src/judge/tag-run.ts
var WRITE_THRESHOLD = 0.8;
var MAX_CONSECUTIVE_FAILURES = 5;
function newTagRun(opts) {
  return {
    status: "standby",
    ...opts,
    scores: {},
    include: {},
    applied: {},
    order: [],
    stats: { filesTotal: 0, judged: 0, failed: 0, elapsedMs: 0 },
    stopRequested: false
  };
}
async function judgeFile(opts) {
  const { app, settings, file, tags, modelId, bodyScope, bodyChars } = opts;
  const content = await app.vault.cachedRead(file);
  const prepared = prepareBodyForJudge(
    content,
    settings.bodyScope,
    settings.bodyChars,
    file.basename
  );
  const resp = await callSystemOne(settings.baseUrl, settings.apiKey, {
    model: settings.modelId,
    state: { note_title: prepared.title, note_body: prepared.body },
    questions: tagQuestions(tags)
  });
  const scored = {};
  tags.forEach((tag, i) => {
    const p = parseNoul(resp.answers?.[`t${i}`]);
    if (p !== null) scored[tag] = p;
  });
  return scored;
}
async function runTagging(opts) {
  const { app, settings, run, files, cache, onProgress, onCreditGone } = opts;
  const started = Date.now();
  run.status = "judging";
  run.stopRequested = false;
  run.stats = { filesTotal: files.length, judged: 0, failed: 0, elapsedMs: 0 };
  run.lastError = void 0;
  run.abortedAfter = void 0;
  run.order = files.map((f) => f.path);
  const tagsHash = contentFingerprint([...run.tags].sort().join("\0"));
  onProgress(run, "\u5F00\u59CB\u5224\u5B9A\u2026");
  let creditGone = false;
  let consecutive = 0;
  for (const file of files) {
    if (run.stopRequested || creditGone) break;
    run.activePath = file.path;
    onProgress(run, `\u5224\u5B9A\u4E2D\uFF1A${file.name}`);
    try {
      const content = await app.vault.cachedRead(file);
      const cacheParts = {
        filePath: file.path,
        contentFingerprint: contentFingerprint(content),
        tagsHash,
        modelId: settings.modelId,
        promptVersion: PROMPT_VERSION,
        bodyScope: settings.bodyScope,
        firstN: settings.bodyChars
      };
      const hit = cache.get(cacheParts);
      const scores = hit?.tags ?? await judgeFile({
        app,
        settings,
        file,
        tags: run.tags,
        modelId: settings.modelId,
        bodyScope: settings.bodyScope,
        bodyChars: settings.bodyChars
      });
      if (!hit && Object.keys(scores).length === run.tags.length) {
        cache.set({ ...cacheParts, tags: scores, judgedAt: Date.now() });
      }
      run.scores[file.path] = scores;
      run.stats.judged++;
      consecutive = 0;
    } catch (e) {
      if (e instanceof SystemOneCreditError) {
        creditGone = true;
        onCreditGone(e);
      } else {
        run.stats.failed++;
        run.lastError = `${file.name}\uFF1A${e instanceof Error ? e.message : String(e)}`;
        console.error("[systemone-auto-tag] tag judging failed", file.path, e);
        if (++consecutive >= MAX_CONSECUTIVE_FAILURES) {
          run.abortedAfter = run.stats.failed;
          break;
        }
      }
    } finally {
      run.activePath = void 0;
      run.stats.elapsedMs = Date.now() - started;
      onProgress(run);
    }
  }
  run.stats.elapsedMs = Date.now() - started;
  run.activePath = void 0;
  if (creditGone) run.status = "failed";
  else if (run.stopRequested) run.status = "stopped";
  else if (run.stats.failed > 0) run.status = "partial";
  else run.status = "done";
  onProgress(run, run.status);
}
function tagRowState(run, filePath, existing) {
  const scores = run.scores[filePath];
  if (!scores) return { scored: [], writeTags: [] };
  const scored = run.tags.filter((t) => scores[t] !== void 0).map((t) => ({ tag: t, p: scores[t], bucket: bucket(scores[t], WRITE_THRESHOLD) }));
  return {
    scored,
    writeTags: writeSet(run.tags, scores, WRITE_THRESHOLD, existing, run.maxTagsPerNote)
  };
}

// src/vault/scope.ts
var import_obsidian3 = require("obsidian");
function isIgnored(path, configDir) {
  return [".obsidian", ".trash", ".git", configDir].filter(Boolean).some((p) => path === p || path.startsWith(`${p}/`));
}
function notesInScope(app, folderPath) {
  return walk(app, folderPath, (f) => f.extension === "md");
}
function folderPaths(app) {
  const out = [];
  const visit = (folder) => {
    for (const child of folder.children) {
      if (!(child instanceof import_obsidian3.TFolder)) continue;
      if (isIgnored(child.path, app.vault.configDir)) continue;
      out.push(child.path);
      visit(child);
    }
  };
  visit(app.vault.getRoot());
  return out.sort((a, b) => a.localeCompare(b));
}
function walk(app, folderPath, accept) {
  const root = folderPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);
  if (!(root instanceof import_obsidian3.TFolder)) return [];
  const out = [];
  const visit = (folder) => {
    for (const child of folder.children) {
      if (child instanceof import_obsidian3.TFile) {
        if (accept(child)) out.push(child);
      } else if (child instanceof import_obsidian3.TFolder && !isIgnored(child.path, app.vault.configDir)) {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
}

// src/vault/candidates.ts
function scanVaultTags(app) {
  const counts = /* @__PURE__ */ new Map();
  const cache = app.metadataCache.getTags?.() ?? {};
  for (const [raw, count] of Object.entries(cache)) {
    const tag = normalizeTag(raw);
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + count);
  }
  for (const file of app.vault.getMarkdownFiles()) {
    for (const tag of frontmatterTags(app.metadataCache.getFileCache(file)?.frontmatter)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}
var SEED_TAGS = [
  "\u4F1A\u8BAE",
  "\u590D\u76D8",
  "\u8BFB\u4E66\u7B14\u8BB0",
  "\u65E5\u8BB0",
  "\u9879\u76EE",
  "\u8BBE\u8BA1",
  "\u8425\u9500",
  "\u4EA7\u54C1",
  "\u6280\u672F",
  "\u5199\u4F5C",
  "\u7814\u7A76",
  "\u8D22\u52A1",
  "\u62DB\u8058",
  "\u5065\u5EB7",
  "\u65C5\u884C",
  "\u5B66\u4E60",
  "\u7075\u611F",
  "\u5F85\u529E",
  "\u8D44\u6599",
  "\u5F52\u6863",
  "\u524D\u7AEF",
  "\u540E\u7AEF",
  "\u6570\u636E\u5E93",
  "\u67B6\u6784",
  "\u6D4B\u8BD5",
  "\u90E8\u7F72",
  "\u5B89\u5168",
  "\u6027\u80FD",
  "\u6587\u6863",
  "\u6559\u7A0B",
  "\u8BBA\u6587",
  "\u5DE5\u5177",
  "\u6548\u7387",
  "\u56E2\u961F",
  "\u5BA2\u6237",
  "\u9500\u552E",
  "\u8FD0\u8425",
  "\u6570\u636E",
  "\u62A5\u544A",
  "\u60F3\u6CD5",
  "\u8BA1\u5212",
  "\u603B\u7ED3",
  "\u6A21\u677F",
  "\u6E05\u5355",
  "\u53C2\u8003",
  "\u91CD\u8981",
  "\u957F\u671F",
  "\u5B9E\u9A8C"
];
async function scopeSummary(app, files, limit = 60) {
  const lines = [];
  for (const file of files.slice(0, limit)) {
    const content = await app.vault.cachedRead(file);
    const body = content.replace(/^---[\s\S]*?---/, "").replace(/\s+/g, " ").trim();
    lines.push(`${file.basename} | ${body.slice(0, 100)}`);
  }
  return lines.join("\n");
}

// src/ui/tag-view.ts
var VIEW_TYPE_TAGS = "systemone-tags-view";
var SEED_THRESHOLD = 0.9;
var TagView = class extends import_obsidian4.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.refreshTimer = null;
    /**
     * Guards the async entry points. The buttons are only disabled while a run is
     * judging, which leaves the whole first `await` of scan and apply exposed: a
     * second click would start a second pass over the same rows.
     */
    this.busy = false;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_TAGS;
  }
  getDisplayText() {
    return "System One Tags";
  }
  getIcon() {
    return "tags";
  }
  async onOpen() {
    this.rootEl = this.contentEl;
    this.rootEl.empty();
    this.rootEl.addClass("s1at-root");
    this.render();
  }
  async onClose() {
    if (this.refreshTimer != null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.rootEl?.empty();
  }
  refresh() {
    if (!this.rootEl) return;
    if (this.run?.status === "judging") {
      if (this.refreshTimer != null) return;
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = null;
        this.render();
      }, 90);
      return;
    }
    this.render();
  }
  get run() {
    return this.plugin.currentRun;
  }
  scopeFolder() {
    return this.run?.scopeFolder ?? this.plugin.settings.lastFolder;
  }
  filesInScope() {
    return notesInScope(this.app, this.scopeFolder());
  }
  // —— step 1: scan candidates ——
  /**
   * The endpoint answers in typed values, so it cannot invent tags. The closest
   * honest equivalent of "generate a tag list" is grading a seed vocabulary
   * against the scanned notes; the user then prunes it like any other list.
   */
  async tagCandidates(files) {
    const vaultTags = scanVaultTags(this.app);
    if (vaultTags.length >= 3) return vaultTags;
    const settings = this.plugin.settings;
    if (!settings.apiKey) return SEED_TAGS;
    const summary = await scopeSummary(this.app, files);
    if (!summary) return SEED_TAGS;
    try {
      const resp = await callSystemOne(settings.baseUrl, settings.apiKey, {
        model: settings.modelId,
        state: { notes: summary },
        questions: themeQuestions(SEED_TAGS)
      });
      const picked = Object.entries(resp.answers ?? {}).map(([id, value]) => ({ tag: SEED_TAGS[Number(id.slice(1))], p: parseNoul(value) })).filter((x) => x.tag && x.p !== null && x.p >= SEED_THRESHOLD).map((x) => x.tag);
      return picked.length > 0 ? picked : SEED_TAGS;
    } catch (e) {
      console.error("[systemone-auto-tag] seed grading failed", e);
      return SEED_TAGS;
    }
  }
  async scan() {
    if (this.busy) return;
    this.busy = true;
    try {
      return await this.scanOnce();
    } finally {
      this.busy = false;
    }
  }
  async scanOnce() {
    if (!this.plugin.settings.apiKey) {
      new import_obsidian4.Notice("\u5148\u5230\u8BBE\u7F6E\u91CC\u586B System One API key");
      return;
    }
    const files = this.filesInScope();
    if (files.length === 0) {
      new import_obsidian4.Notice("\u8FD9\u4E2A\u6587\u4EF6\u5939\u91CC\u6CA1\u6709\u7B14\u8BB0");
      return;
    }
    const notice = new import_obsidian4.Notice("\u6B63\u5728\u626B\u63CF\u5019\u9009\u2026", 0);
    try {
      const tags = await this.tagCandidates(files);
      const run = this.run ?? newTagRun({
        scopeFolder: this.scopeFolder(),
        tags: [],
        maxTagsPerNote: this.plugin.settings.maxTagsPerNote
      });
      run.scopeFolder = this.scopeFolder();
      run.tags = tags;
      this.clearRows(run);
      run.include = Object.fromEntries(files.map((f) => [f.path, true]));
      this.plugin.currentRun = run;
      await this.plugin.persist();
    } finally {
      notice.hide();
    }
    this.render();
  }
  // —— step 2: judge and apply ——
  async start() {
    const run = this.run;
    if (!run) return;
    const files = this.filesInScope().filter((f) => run.include[f.path] !== false);
    if (files.length === 0) {
      new import_obsidian4.Notice("\u6CA1\u6709\u52FE\u9009\u4EFB\u4F55\u7B14\u8BB0");
      return;
    }
    if (run.tags.length === 0) {
      new import_obsidian4.Notice("\u5019\u9009\u6807\u7B7E\u4E3A\u7A7A\uFF1A\u5148\u70B9\u300C\u626B\u63CF\u300D\u6216\u624B\u52A8\u52A0\u51E0\u4E2A");
      return;
    }
    run.scopeFolder = this.scopeFolder();
    this.plugin.settings.lastFolder = run.scopeFolder;
    await this.plugin.saveSettings();
    run.scores = {};
    this.render();
    try {
      await runTagging({
        app: this.app,
        settings: this.plugin.settings,
        run,
        files,
        cache: this.plugin.cache,
        onProgress: () => {
          void this.plugin.persist();
          this.refresh();
        },
        onCreditGone: (err) => new import_obsidian4.Notice(err.message, 15e3)
      });
    } catch (e) {
      run.status = "failed";
      new import_obsidian4.Notice(`\u5224\u5B9A\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`, 15e3);
    } finally {
      await this.plugin.persist();
      this.refresh();
    }
  }
  rowFor(run, path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    const existing = file instanceof import_obsidian4.TFile ? noteTags(this.app, file) : [];
    return { state: tagRowState(run, path, existing), existing };
  }
  fileAt(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof import_obsidian4.TFile ? file : null;
  }
  /**
   * Drops rows judged in a folder the run no longer points at. `applied` stays:
   * those writes really happened and must remain undoable.
   */
  clearRows(run) {
    run.order = [];
    run.scores = {};
    run.status = "standby";
    run.lastError = void 0;
    run.abortedAfter = void 0;
    run.stats = { filesTotal: 0, judged: 0, failed: 0, elapsedMs: 0 };
  }
  applyTargets(run) {
    return run.order.filter((path) => {
      if (run.include[path] === false || run.applied[path]) return false;
      return this.rowFor(run, path).state.writeTags.length > 0;
    });
  }
  async applyAll() {
    if (this.busy) return;
    this.busy = true;
    try {
      return await this.applyAllOnce();
    } finally {
      this.busy = false;
    }
  }
  async applyAllOnce() {
    const run = this.run;
    if (!run) return;
    const targets = this.applyTargets(run);
    if (targets.length === 0) {
      new import_obsidian4.Notice("\u6CA1\u6709\u5F85\u5199\u5165\u7684\u7B14\u8BB0");
      return;
    }
    const total = targets.reduce((n, p) => n + this.rowFor(run, p).state.writeTags.length, 0);
    if (!confirm(`\u7ED9 ${targets.length} \u7BC7\u7B14\u8BB0\u5199\u5165 ${total} \u4E2A\u6807\u7B7E\u3002\u786E\u8BA4\uFF1F`)) return;
    let written = 0;
    const failures = [];
    for (const path of targets) {
      const file = this.fileAt(path);
      if (!file) {
        failures.push(`${path.split("/").pop()}\uFF1A\u6587\u4EF6\u5DF2\u4E0D\u5B58\u5728`);
        continue;
      }
      try {
        const added = await addTagsToNote(
          this.app,
          file,
          this.rowFor(run, path).state.writeTags,
          this.plugin.settings.writeMode
        );
        if (added.length > 0) {
          run.applied[path] = { tags: added, writeMode: this.plugin.settings.writeMode };
          written += added.length;
        }
      } catch (e) {
        failures.push(`${path.split("/").pop()}\uFF1A${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.plugin.persist();
    this.render();
    if (written > 0) new import_obsidian4.Notice(`\u5DF2\u5199\u5165 ${written} \u4E2A\u6807\u7B7E`);
    if (failures.length > 0) new import_obsidian4.Notice(`\u5931\u8D25 ${failures.length} \u4E2A\uFF1A
${failures.join("\n")}`, 12e3);
  }
  async undoAll() {
    const run = this.run;
    if (!run) return;
    const rows = Object.entries(run.applied);
    if (rows.length === 0) return;
    if (!confirm(`\u64A4\u9500\u672C\u6B21\u5BF9 ${rows.length} \u7BC7\u7B14\u8BB0\u7684\u6807\u7B7E\uFF0C\u786E\u8BA4\uFF1F`)) return;
    const failures = [];
    const missing = [];
    for (const [path, applied] of rows) {
      const file = this.fileAt(path);
      if (!file) {
        failures.push(`${path.split("/").pop()}\uFF1A\u6587\u4EF6\u5DF2\u4E0D\u5728\u539F\u5904`);
        continue;
      }
      try {
        const removed = await removeTagsFromNote(this.app, file, applied.tags, applied.writeMode);
        const gone = new Set(removed.map((t) => t.toLowerCase()));
        const left = applied.tags.filter((t) => !gone.has(t.toLowerCase()));
        if (left.length > 0) {
          run.applied[path] = { tags: left, writeMode: applied.writeMode };
          missing.push(`${path.split("/").pop()}\uFF1A${left.join(" ")}`);
        } else {
          delete run.applied[path];
        }
      } catch (e) {
        failures.push(`${path.split("/").pop()}\uFF1A${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.plugin.persist();
    this.render();
    if (failures.length === 0 && missing.length === 0) new import_obsidian4.Notice("\u5DF2\u64A4\u9500\u672C\u6B21\u5168\u90E8\u6807\u7B7E");
    if (missing.length > 0) {
      new import_obsidian4.Notice(`\u8FD9\u4E9B\u6807\u7B7E\u5728\u7B14\u8BB0\u91CC\u5DF2\u627E\u4E0D\u5230\uFF1A
${missing.join("\n")}`, 12e3);
    }
    if (failures.length > 0) {
      new import_obsidian4.Notice(`\u90E8\u5206\u64A4\u9500\u5931\u8D25\uFF1A
${failures.join("\n")}`, 12e3);
    }
  }
  // —— rendering ——
  render() {
    const el = this.rootEl;
    const prevTop = el.scrollTop;
    el.empty();
    const run = this.run;
    this.renderHeader(el, run);
    if (run) {
      this.renderCandidates(el, run);
      if (run.order.length > 0) this.renderTable(el, run);
    } else {
      el.createDiv({
        cls: "s1at-empty",
        text: "\u9009\u4E00\u4E2A\u6587\u4EF6\u5939\uFF0C\u70B9\u300C\u626B\u63CF\u300D\u81EA\u52A8\u5217\u51FA\u6807\u7B7E\u5019\u9009\uFF0C\u6539\u5B8C\u70B9\u300C\u5F00\u5DE5\u300D\u3002"
      });
    }
    el.scrollTop = prevTop;
  }
  renderHeader(el, run) {
    const status = run?.status ?? "standby";
    const bar = el.createDiv({ cls: "s1at-toolbar" });
    bar.createSpan({
      cls: "s1at-status" + (status === "judging" ? " is-live" : ""),
      text: status === "judging" ? "\u5224\u5B9A\u4E2D" : status === "done" ? "\u5DF2\u5224\u5B9A" : status === "partial" ? "\u90E8\u5206\u5931\u8D25" : status === "stopped" ? "\u5DF2\u505C\u6B62" : status === "failed" ? "\u5931\u8D25" : "\u5F85\u5F00\u59CB"
    });
    if (run && run.stats.filesTotal > 0) {
      const done = run.stats.judged + run.stats.failed;
      const pct = Math.round(done / run.stats.filesTotal * 100);
      bar.createSpan({
        cls: "s1at-stats-line",
        text: `  ${done}/${run.stats.filesTotal}  \xB7  ${(run.stats.elapsedMs / 1e3).toFixed(0)}s` + (run.stats.failed > 0 ? `  \xB7 \u5931\u8D25 ${run.stats.failed}` : "")
      });
      if (status === "judging" || status === "done" || status === "partial" || status === "stopped") {
        const wrap = el.createDiv({ cls: "s1at-progress" });
        const fill = wrap.createDiv({ cls: "s1at-progress-fill" });
        fill.style.width = `${pct}%`;
        if (status === "judging") fill.addClass("is-live");
        el.createDiv({
          cls: "s1at-progress-label",
          text: status === "judging" && run.activePath ? `${pct}% \xB7 \u6B63\u5728\u5224\u5B9A ${run.activePath.split("/").pop()}` : `${pct}%`
        });
      }
    }
    if (run?.lastError && (status === "partial" || status === "failed")) {
      const why = run.abortedAfter ? `\u8FDE\u7EED ${run.abortedAfter} \u7BC7\u5931\u8D25\uFF0C\u5DF2\u505C\u4E0B` : "\u4E0A\u4E00\u6B21\u5931\u8D25";
      el.createDiv({ cls: "s1at-error", text: `${why}\uFF1A${run.lastError}` });
    }
    const actions = bar.createDiv({ cls: "s1at-toolbar-actions" });
    if (run && status === "judging") {
      const stop = actions.createEl("button", { text: "\u505C\u6B62" });
      stop.onclick = () => {
        run.stopRequested = true;
        void this.plugin.persist();
        this.render();
      };
    }
    if (run && Object.keys(run.applied).length > 0) {
      const undo = actions.createEl("button", { text: "\u64A4\u9500" });
      undo.onclick = () => void this.undoAll();
    }
    const row = el.createDiv({ cls: "s1at-controls" });
    row.createSpan({ text: "\u8303\u56F4  ", cls: "s1at-label" });
    const select = row.createEl("select", { cls: "dropdown s1at-scope-select" });
    select.createEl("option", { text: "\u6574\u4E2A\u5DE5\u4F5C\u533A", value: "" });
    for (const folder of folderPaths(this.app)) {
      select.createEl("option", { text: folder, value: folder });
    }
    select.value = this.scopeFolder();
    select.onchange = () => {
      const folder = select.value;
      this.plugin.settings.lastFolder = folder;
      if (this.run && this.run.scopeFolder !== folder) {
        this.run.scopeFolder = folder;
        this.clearRows(this.run);
      }
      void this.plugin.saveSettings();
      this.render();
    };
    const scan = row.createEl("button", { text: "\u626B\u63CF" });
    scan.disabled = status === "judging";
    scan.onclick = () => void this.scan();
    const startBtn = row.createEl("button", { text: "\u5F00\u5DE5", cls: "mod-cta s1at-batch" });
    startBtn.disabled = status === "judging" || !run;
    startBtn.onclick = () => void this.start();
    row.createSpan({ cls: "s1at-muted", text: `  ${this.filesInScope().length} \u7BC7\u7B14\u8BB0` });
  }
  renderCandidates(el, run) {
    const box = el.createDiv({ cls: "s1at-candidates" });
    box.createDiv({ cls: "s1at-cand-label", text: `\u6807\u7B7E\uFF08${run.tags.length}\uFF09` });
    const wrap = box.createDiv({ cls: "s1at-chips" });
    for (const tag of run.tags) {
      const chip = wrap.createSpan({ cls: "s1at-chip-in", text: tag });
      const x = chip.createSpan({ cls: "s1at-chip-x", text: "\xD7" });
      x.onclick = () => {
        run.tags = run.tags.filter((t) => t !== tag);
        void this.plugin.persist();
        this.render();
      };
    }
    const input = wrap.createEl("input", {
      type: "text",
      cls: "s1at-chip-input",
      attr: { placeholder: "+ \u6807\u7B7E" }
    });
    input.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const tag = normalizeTag(input.value);
      input.value = "";
      if (!tag || run.tags.includes(tag)) return;
      run.tags.push(tag);
      void this.plugin.persist();
      this.render();
    };
  }
  renderTable(el, run) {
    const wrap = el.createDiv({ cls: "s1at-tag-table-wrap" });
    const table = wrap.createEl("table", { cls: "s1at-tag-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["", "\u7B14\u8BB0", "\u6807\u7B7E", ""]) head.createEl("th", { text: label });
    const tbody = table.createEl("tbody");
    for (const path of run.order) {
      const { state, existing } = this.rowFor(run, path);
      const applied = run.applied[path];
      const tr = tbody.createEl("tr");
      if (run.activePath === path) tr.addClass("is-active");
      if (applied) tr.addClass("is-applied");
      const check = tr.createEl("td").createEl("input", { type: "checkbox" });
      check.checked = run.include[path] !== false;
      check.disabled = Boolean(applied);
      check.onchange = () => {
        run.include[path] = check.checked;
        void this.plugin.persist();
      };
      tr.createEl("td", {
        cls: "s1at-note-cell",
        text: path.split("/").pop() ?? path,
        attr: { title: path }
      });
      const tagCell = tr.createEl("td", { cls: "s1at-tagcell" });
      const shown = state.scored.filter((t) => t.bucket !== "n");
      if (shown.length === 0) {
        tagCell.createSpan({ cls: "s1at-muted", text: run.scores[path] ? "\u65E0" : "\u2014" });
      }
      const had = new Set(existing.map((t) => t.toLowerCase()));
      for (const t of shown) {
        const chip = tagCell.createSpan({
          cls: `s1at-mini-chip is-${t.bucket}`,
          text: `${t.tag} ${t.p.toFixed(2)}`
        });
        if (had.has(t.tag.toLowerCase())) chip.addClass("is-existing");
      }
      const actionCell = tr.createEl("td");
      if (applied) {
        actionCell.createSpan({ cls: "s1at-done", text: "\u2713 \u5DF2\u5199\u5165" });
      }
    }
    if (run.status === "judging" && run.activePath) {
      const active = tbody.querySelector("tr.is-active");
      if (active) {
        const top = active.offsetTop - wrap.offsetTop;
        if (top < wrap.scrollTop || top > wrap.scrollTop + wrap.clientHeight - 80) {
          wrap.scrollTop = Math.max(0, top - wrap.clientHeight / 2);
        }
      }
    }
    const footer = el.createDiv({ cls: "s1at-controls" });
    const apply = footer.createEl("button", {
      text: `\u5E94\u7528 ${this.applyTargets(run).length} \u7BC7`,
      cls: "mod-cta s1at-batch"
    });
    apply.disabled = run.status === "judging";
    apply.onclick = () => void this.applyAll();
  }
};

// src/cache/keyed-cache.ts
var KeyedCache = class {
  constructor(keyOf, groupOf, maxEntries = 2e4) {
    this.keyOf = keyOf;
    this.groupOf = groupOf;
    this.map = /* @__PURE__ */ new Map();
    this.groups = /* @__PURE__ */ new Map();
    this.maxEntries = maxEntries;
  }
  load(entries) {
    this.map.clear();
    this.groups.clear();
    for (const e of entries) this.set(e);
  }
  dump() {
    return [...this.map.values()];
  }
  get(key) {
    return this.map.get(key);
  }
  get size() {
    return this.map.size;
  }
  set(value) {
    const key = this.keyOf(value);
    const group = this.groupOf(value);
    const prev = this.groups.get(group);
    if (prev !== void 0 && prev !== key) this.map.delete(prev);
    this.groups.set(group, key);
    this.map.set(key, value);
    this.evict();
  }
  evict() {
    while (this.map.size > this.maxEntries) {
      let oldestKey;
      let oldest = Infinity;
      for (const [k, v] of this.map) {
        if (v.judgedAt < oldest) {
          oldest = v.judgedAt;
          oldestKey = k;
        }
      }
      if (oldestKey === void 0) return;
      const victim = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (victim) {
        const group = this.groupOf(victim);
        if (this.groups.get(group) === oldestKey) this.groups.delete(group);
      }
    }
  }
};

// src/cache/score-cache.ts
function scoreKey(parts) {
  return [
    parts.filePath,
    parts.contentFingerprint,
    parts.tagsHash,
    parts.modelId,
    parts.promptVersion,
    parts.bodyScope,
    parts.bodyScope === "first_n" ? parts.firstN ?? "" : ""
  ].join("\0");
}
var ScoreCache = class {
  constructor(maxEntries) {
    this.store = new KeyedCache((e) => scoreKey(e), (e) => e.filePath, maxEntries);
  }
  load(entries) {
    this.store.load(entries);
  }
  dump() {
    return this.store.dump();
  }
  get(parts) {
    return this.store.get(scoreKey(parts));
  }
  set(entry) {
    this.store.set(entry);
  }
};

// src/main.ts
var SystemOneAutoTagPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.cache = new ScoreCache();
    this.currentRun = null;
  }
  async onload() {
    await this.loadPluginData();
    this.registerView(VIEW_TYPE_TAGS, (leaf) => new TagView(leaf, this));
    this.addSettingTab(new SystemOneAutoTagSettingTab(this.app, this));
    const open = () => void this.activateView();
    this.addCommand({ id: "open-tags", name: "Open System One Tags", callback: open });
    this.addCommand({
      id: "tag-this-folder",
      name: "Tag the active folder",
      callback: async () => {
        if (this.currentRun?.status === "judging") {
          new import_obsidian5.Notice("\u5224\u5B9A\u8FDB\u884C\u4E2D\uFF0C\u5148\u505C\u6B62\u518D\u5207\u6362\u6587\u4EF6\u5939");
          return;
        }
        const active = this.app.workspace.getActiveFile();
        const folder = active?.parent?.path ?? "";
        this.settings.lastFolder = folder === "/" ? "" : folder;
        await this.saveSettings();
        await this.activateView();
        if (this.currentRun) {
          this.currentRun.scopeFolder = this.settings.lastFolder;
          await this.persist();
        }
        this.getView()?.refresh();
      }
    });
    this.addCommand({
      id: "stop-run",
      name: "Stop the current run",
      callback: () => {
        if (this.currentRun?.status === "judging") {
          this.currentRun.stopRequested = true;
          new import_obsidian5.Notice("\u6B63\u5728\u505C\u6B62\u2026");
        } else {
          new import_obsidian5.Notice("\u5F53\u524D\u6CA1\u6709\u8FDB\u884C\u4E2D\u7684\u5224\u5B9A");
        }
      }
    });
    this.addRibbonIcon("tags", "System One Auto Tag", open);
    if (this.currentRun?.status === "judging") {
      this.currentRun.status = "stopped";
      this.currentRun.activePath = void 0;
      await this.persist();
    }
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TAGS);
  }
  getView() {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TAGS)[0]?.view;
    return view instanceof TagView ? view : null;
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TAGS)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_TAGS, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
  async loadPluginData() {
    const raw = await this.loadData();
    const saved = raw?.settings ?? {};
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (saved[key] !== void 0) settings[key] = saved[key];
    }
    this.settings = settings;
    if (raw?.scoreCache) this.cache.load(raw.scoreCache);
    this.currentRun = raw?.currentRun ?? null;
  }
  async saveSettings() {
    await this.persist();
  }
  async persist() {
    const data = {
      settings: this.settings,
      scoreCache: this.cache.dump(),
      currentRun: this.currentRun
    };
    await this.saveData(data);
  }
};
