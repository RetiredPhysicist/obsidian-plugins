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
  default: () => SystemOneAutoMovePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian8 = require("obsidian");

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  baseUrl: "https://api.typesafe.ai",
  apiKey: "",
  modelId: "jev-1.14.0",
  lastFolder: "",
  bodyChars: 800
};
var SystemOneAutoMoveSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "System One Auto Move" });
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
    new import_obsidian.Setting(containerEl).setName("Body chars").setDesc("How much of each note is sent with the folder question").addText(
      (t) => t.setValue(String(this.plugin.settings.bodyChars)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 50) return;
        this.plugin.settings.bodyChars = n;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/ui/move-view.ts
var import_obsidian7 = require("obsidian");

// src/judge/move-run.ts
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

// src/vault/folders.ts
var import_obsidian2 = require("obsidian");
var EXAMPLES_PER_FOLDER = 8;
function isIgnoredFolder(path, configDir) {
  const prefixes = [".obsidian", ".trash", ".git", configDir].filter(Boolean);
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}
function collectFolderOptions(app) {
  const names = /* @__PURE__ */ new Map();
  for (const file of app.vault.getFiles()) {
    const parent = file.parent?.path ?? "";
    if (parent === "" || parent === "/") continue;
    if (isIgnoredFolder(parent, app.vault.configDir)) continue;
    const list = names.get(parent) ?? [];
    if (list.length < EXAMPLES_PER_FOLDER) list.push(file.basename);
    names.set(parent, list);
  }
  return [...names.entries()].map(([path, examples]) => ({ path, examples })).sort((a, b) => a.path.localeCompare(b.path));
}
function pathTaken(app, path, moving) {
  const existing = app.vault.getAbstractFileByPath(path);
  return existing !== null && existing !== moving;
}
function parentOf(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
function joinPath(folder, name) {
  return folder === "" ? name : `${folder}/${name}`;
}
function folderExists(app, path) {
  return app.vault.getAbstractFileByPath(path) instanceof import_obsidian2.TFolder;
}

// src/llm/systemone.ts
var import_obsidian3 = require("obsidian");
var MAX_CHOICES = 255;
var KEEP = "keep";
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
var destInstruction = 'Which of these existing folders should this file be filed into? Each option lists files already in it, which is the evidence for what belongs there. Answer "keep" only when the file is already in the folder it belongs to.';
function destCriteria(folder, examples) {
  if (examples.length === 0) return `A folder named ${folder}/.`;
  return `${folder}/ already contains: ${examples.join(", ")}.`;
}
function keepCriteria(currentFolder) {
  return `Leave it in ${currentFolder === "" ? "the vault root" : `${currentFolder}/`}.`;
}
var PROMPT_VERSION = hashShort(
  [
    destInstruction,
    destCriteria("{}", ["{}"]),
    keepCriteria("{}")
  ].join("\0")
);
var OFFERABLE_FOLDERS = MAX_CHOICES - 1;
function buildMoveQuestion(folders, currentFolder) {
  const criteria = {};
  const options = folders.filter((f) => f.path !== currentFolder);
  for (const folder of options.slice(0, OFFERABLE_FOLDERS)) {
    criteria[folder.path] = destCriteria(folder.path, folder.examples);
  }
  criteria[KEEP] = keepCriteria(currentFolder);
  return { type: "choice", instructions: destInstruction, criteria };
}
function parseMoveAnswer(answer) {
  if (!answer || typeof answer !== "object") return null;
  const a = answer;
  if (a.type !== "choice" || typeof a.choice !== "string") return null;
  const confidence = Number(a.confidence);
  return {
    choice: a.choice,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    probabilities: a.probabilities ?? {}
  };
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
    res = await (0, import_obsidian3.requestUrl)({
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

// src/judge/move.ts
function classifyMove(opts) {
  const { answer, allowedFolders, threshold, collision, alreadyThere } = opts;
  if (!answer) return { bucket: "confirm", reason: "no-answer" };
  if (answer.choice === KEEP) return { bucket: "stay" };
  if (!allowedFolders.includes(answer.choice)) {
    return { bucket: "confirm", reason: "unknown-option" };
  }
  if (alreadyThere) return { bucket: "stay", toFolder: answer.choice };
  if (collision) return { toFolder: answer.choice, bucket: "confirm", reason: "collision" };
  const top = answer.probabilities[answer.choice];
  const score = Math.min(answer.confidence, Number.isFinite(top) ? top : answer.confidence);
  if (score >= threshold) return { toFolder: answer.choice, bucket: "move" };
  return { toFolder: answer.choice, bucket: "confirm", reason: "low-confidence" };
}

// src/judge/move-run.ts
var MOVE_THRESHOLD = 0.7;
var MAX_CONSECUTIVE_FAILURES = 5;
function newMoveRun(opts) {
  return {
    id: `move_${Date.now().toString(36)}`,
    createdAt: Date.now(),
    status: "standby",
    ...opts,
    answers: {},
    include: {},
    applied: {},
    order: [],
    stats: { filesTotal: 0, judged: 0, failed: 0, elapsedMs: 0 },
    stopRequested: false
  };
}
async function judgeFile(opts) {
  const { app, settings, file, folders, modelId } = opts;
  let state;
  if (file.extension === "md") {
    const content = await app.vault.cachedRead(file);
    state = { note_title: file.basename, note_body: content.slice(0, settings.bodyChars) };
  } else {
    state = { file_name: file.basename, file_type: file.extension };
  }
  const resp = await callSystemOne(settings.baseUrl, settings.apiKey, {
    model: modelId,
    state,
    questions: { dest: buildMoveQuestion(folders, parentOf(file.path)) }
  });
  return parseMoveAnswer(resp.answers?.dest);
}
async function runMoves(opts) {
  const { app, settings, run, files, cache, onProgress, onCreditGone } = opts;
  const started = Date.now();
  run.status = "judging";
  run.stopRequested = false;
  run.stats = { filesTotal: files.length, judged: 0, failed: 0, elapsedMs: 0 };
  run.lastError = void 0;
  run.abortedAfter = void 0;
  run.order = files.map((f) => f.path);
  const foldersHash = contentFingerprint(
    run.folders.map((f) => `${f.path}${[...f.examples].sort().join("")}`).sort().join("\0")
  );
  onProgress(run, "\u5F00\u59CB\u5224\u5B9A\u2026");
  let creditGone = false;
  let consecutive = 0;
  for (const file of files) {
    if (run.stopRequested || creditGone) break;
    run.activePath = file.path;
    onProgress(run, `\u5224\u5B9A\u4E2D\uFF1A${file.name}`);
    try {
      const content = file.extension === "md" ? await app.vault.cachedRead(file) : "";
      const cacheParts = {
        filePath: file.path,
        contentFingerprint: contentFingerprint(
          file.extension === "md" ? content : `${file.name}\0${file.stat.size}\0${file.stat.mtime}`
        ),
        foldersHash,
        bodyChars: settings.bodyChars,
        modelId: settings.modelId,
        promptVersion: PROMPT_VERSION
      };
      const hit = cache.get(cacheParts);
      const answer = hit ? { choice: hit.choice, confidence: hit.confidence, probabilities: hit.probabilities } : await judgeFile({
        app,
        settings,
        file,
        folders: run.folders,
        modelId: settings.modelId
      });
      if (!answer) {
        run.stats.failed++;
        run.lastError = `${file.name}\uFF1A\u6A21\u578B\u6CA1\u6709\u7ED9\u51FA\u53EF\u7528\u7684\u9009\u62E9`;
        if (++consecutive >= MAX_CONSECUTIVE_FAILURES) {
          run.abortedAfter = run.stats.failed;
          break;
        }
        continue;
      }
      if (!hit) cache.set({ ...cacheParts, ...answer, judgedAt: Date.now() });
      run.answers[file.path] = answer;
      run.stats.judged++;
      consecutive = 0;
    } catch (e) {
      if (e instanceof SystemOneCreditError) {
        creditGone = true;
        onCreditGone(e);
      } else {
        run.stats.failed++;
        run.lastError = `${file.name}\uFF1A${e instanceof Error ? e.message : String(e)}`;
        console.error("[systemone-auto-move] move judging failed", file.path, e);
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
function moveRowState(app, run, filePath) {
  const answer = run.answers[filePath] ?? null;
  const abstract = app.vault.getAbstractFileByPath(filePath);
  const file = abstract instanceof import_obsidian4.TFile ? abstract : null;
  const known = answer !== null && run.folders.some((f) => f.path === answer.choice);
  const collision = file !== null && answer !== null && answer.choice !== "keep" && known && pathTaken(app, joinPath(answer.choice, file.name), file);
  const verdict = classifyMove({
    answer,
    allowedFolders: run.folders.map((f) => f.path),
    threshold: MOVE_THRESHOLD,
    collision,
    alreadyThere: answer !== null && answer.choice === parentOf(filePath)
  });
  return {
    fromFolder: parentOf(filePath),
    toFolder: verdict.toFolder,
    bucket: verdict.bucket,
    reason: verdict.reason
  };
}

// src/judge/apply.ts
var import_obsidian5 = require("obsidian");
async function moveFile(app, filePath, targetFolder) {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof import_obsidian5.TFile)) return { error: "\u6587\u4EF6\u5DF2\u4E0D\u5B58\u5728" };
  const target = joinPath(targetFolder, file.name);
  if (target === filePath) return {};
  if (pathTaken(app, target, file)) return { error: "\u76EE\u6807\u5DF2\u5B58\u5728\u540C\u540D\u6587\u4EF6" };
  try {
    await app.fileManager.renameFile(file, target);
    return { movedTo: target };
  } catch (e) {
    return { error: `\u79FB\u52A8\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}` };
  }
}
async function moveBack(app, currentPath, originalPath) {
  if (currentPath === originalPath) return void 0;
  const file = app.vault.getAbstractFileByPath(currentPath);
  if (!(file instanceof import_obsidian5.TFile)) return "\u6587\u4EF6\u5DF2\u4E0D\u5728\u9884\u671F\u4F4D\u7F6E";
  if (pathTaken(app, originalPath, file)) return "\u539F\u4F4D\u7F6E\u5DF2\u88AB\u5360\u7528";
  try {
    await app.fileManager.renameFile(file, originalPath);
    return void 0;
  } catch (e) {
    return `\u79FB\u56DE\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`;
  }
}

// src/vault/scope.ts
var import_obsidian6 = require("obsidian");
function isIgnored(path, configDir) {
  return [".obsidian", ".trash", ".git", configDir].filter(Boolean).some((p) => path === p || path.startsWith(`${p}/`));
}
function filesInScope(app, folderPath) {
  const root = folderPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);
  if (!(root instanceof import_obsidian6.TFolder)) return [];
  const out = [];
  const visit = (folder) => {
    for (const child of folder.children) {
      if (child instanceof import_obsidian6.TFile) out.push(child);
      else if (child instanceof import_obsidian6.TFolder && !isIgnored(child.path, app.vault.configDir)) {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
}
function folderPaths(app) {
  const out = [];
  const visit = (folder) => {
    for (const child of folder.children) {
      if (!(child instanceof import_obsidian6.TFolder)) continue;
      if (isIgnored(child.path, app.vault.configDir)) continue;
      out.push(child.path);
      visit(child);
    }
  };
  visit(app.vault.getRoot());
  return out.sort((a, b) => a.localeCompare(b));
}

// src/ui/move-view.ts
var VIEW_TYPE_MOVE = "systemone-move-view";
var REASON_TEXT = {
  "low-confidence": "\u4E0D\u591F\u786E\u5B9A",
  collision: "\u76EE\u6807\u5DF2\u6709\u540C\u540D\u6587\u4EF6",
  "unknown-option": "\u76EE\u5F55\u4E0D\u5728\u5019\u9009\u91CC",
  "no-answer": "\u6A21\u578B\u6CA1\u7B54"
};
var MoveView = class extends import_obsidian7.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.refreshTimer = null;
    /**
     * Guards the async entry points. The buttons are only disabled while a run is
     * judging, which leaves the whole first `await` of scan and apply exposed: a
     * second click would start a second pass over the same rows.
     */
    this.busy = false;
    /**
     * Text typed but not yet committed. Rendering rebuilds the controls, and a
     * judging run re-renders every 90ms, so without this a half-typed folder path
     * is wiped mid-keystroke.
     */
    this.draft = { folder: "" };
    /** The footer button whose label counts the rows the next apply would move. */
    this.applyBtn = null;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_MOVE;
  }
  getDisplayText() {
    return "System One Move";
  }
  getIcon() {
    return "folder-input";
  }
  async onOpen() {
    this.rootEl = this.contentEl;
    this.rootEl.empty();
    this.rootEl.addClass("s1am-root");
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
  scopeFiles() {
    return filesInScope(this.app, this.scopeFolder());
  }
  /** Recount without a full render: a render would rebuild the inputs above. */
  updateApplyCount(run) {
    if (this.applyBtn) this.applyBtn.setText(`\u5E94\u7528 ${this.moveTargets(run).length} \u884C`);
  }
  // —— step 1: scan destinations ——
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
      new import_obsidian7.Notice("\u5148\u5230\u8BBE\u7F6E\u91CC\u586B System One API key");
      return;
    }
    const files = this.scopeFiles();
    if (files.length === 0) {
      new import_obsidian7.Notice("\u8FD9\u4E2A\u6587\u4EF6\u5939\u91CC\u6CA1\u6709\u6587\u4EF6");
      return;
    }
    const folders = collectFolderOptions(this.app);
    if (folders.length === 0) {
      new import_obsidian7.Notice("vault \u91CC\u8FD8\u6CA1\u6709\u88C5\u7740\u6587\u4EF6\u7684\u76EE\u5F55\uFF0C\u5148\u5EFA\u51E0\u4E2A\u518D\u626B\u63CF");
      return;
    }
    const run = this.run ?? newMoveRun({ scopeFolder: this.scopeFolder(), folders: [] });
    run.scopeFolder = this.scopeFolder();
    run.folders = folders;
    this.clearRows(run);
    run.include = Object.fromEntries(files.map((f) => [f.path, true]));
    this.plugin.currentRun = run;
    await this.plugin.persist();
    this.render();
  }
  // —— step 2: judge and apply ——
  async start() {
    const run = this.run;
    if (!run) return;
    const files = this.scopeFiles().filter((f) => run.include[f.path] !== false);
    if (files.length === 0) {
      new import_obsidian7.Notice("\u6CA1\u6709\u52FE\u9009\u4EFB\u4F55\u6587\u4EF6");
      return;
    }
    if (run.folders.length === 0) {
      new import_obsidian7.Notice("\u5019\u9009\u76EE\u5F55\u4E3A\u7A7A\uFF1A\u5148\u70B9\u300C\u626B\u63CF\u300D\u6216\u624B\u52A8\u52A0\u51E0\u4E2A");
      return;
    }
    run.scopeFolder = this.scopeFolder();
    this.plugin.settings.lastFolder = run.scopeFolder;
    await this.plugin.saveSettings();
    run.answers = {};
    this.render();
    try {
      await runMoves({
        app: this.app,
        settings: this.plugin.settings,
        run,
        files,
        cache: this.plugin.cache,
        onProgress: () => {
          void this.plugin.persist();
          this.refresh();
        },
        onCreditGone: (err) => new import_obsidian7.Notice(err.message, 15e3)
      });
    } catch (e) {
      run.status = "failed";
      new import_obsidian7.Notice(`\u5224\u5B9A\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`, 15e3);
    } finally {
      await this.plugin.persist();
      this.refresh();
    }
  }
  /**
   * Drops rows judged in a folder the run no longer points at. `applied` stays:
   * those moves really happened and must remain undoable.
   */
  clearRows(run) {
    run.order = [];
    run.answers = {};
    run.status = "standby";
    run.lastError = void 0;
    run.abortedAfter = void 0;
    run.stats = { filesTotal: 0, judged: 0, failed: 0, elapsedMs: 0 };
  }
  moveTargets(run) {
    return run.order.filter((path) => {
      if (run.include[path] === false || run.applied[path]) return false;
      return moveRowState(this.app, run, path).bucket === "move";
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
    const targets = this.moveTargets(run);
    if (targets.length === 0) {
      new import_obsidian7.Notice("\u6CA1\u6709\u5F85\u79FB\u52A8\u7684\u884C");
      return;
    }
    if (!confirm(`\u79FB\u52A8 ${targets.length} \u4E2A\u6587\u4EF6\u3002\u786E\u8BA4\uFF1F`)) return;
    let moved = 0;
    const failures = [];
    for (const path of targets) {
      const state = moveRowState(this.app, run, path);
      if (!state.toFolder) continue;
      const outcome = await moveFile(this.app, path, state.toFolder);
      if (outcome.movedTo) {
        run.applied[path] = outcome.movedTo;
        moved++;
      }
      if (outcome.error) failures.push(`${path.split("/").pop()}\uFF1A${outcome.error}`);
    }
    await this.plugin.persist();
    this.render();
    if (moved > 0) new import_obsidian7.Notice(`\u5DF2\u79FB\u52A8 ${moved} \u4E2A\u6587\u4EF6`);
    if (failures.length > 0) new import_obsidian7.Notice(`\u5931\u8D25 ${failures.length} \u4E2A\uFF1A
${failures.join("\n")}`, 12e3);
  }
  async undoAll() {
    const run = this.run;
    if (!run) return;
    const rows = Object.entries(run.applied);
    if (rows.length === 0) return;
    if (!confirm(`\u628A ${rows.length} \u4E2A\u6587\u4EF6\u79FB\u56DE\u539F\u4F4D\uFF0C\u786E\u8BA4\uFF1F`)) return;
    const failures = [];
    for (const [original, current] of rows) {
      const error = await moveBack(this.app, current, original);
      if (error) failures.push(`${original.split("/").pop()}\uFF1A${error}\uFF0C\u4ECD\u5728 ${current}`);
      else delete run.applied[original];
    }
    await this.plugin.persist();
    this.render();
    if (failures.length === 0) new import_obsidian7.Notice("\u5DF2\u628A\u672C\u6B21\u79FB\u52A8\u7684\u6587\u4EF6\u5168\u90E8\u79FB\u56DE");
    else new import_obsidian7.Notice(`\u90E8\u5206\u64A4\u9500\u5931\u8D25\uFF1A
${failures.join("\n")}`, 12e3);
  }
  async confirmOne(run, path, folder) {
    const outcome = await moveFile(this.app, path, folder);
    if (outcome.error) {
      new import_obsidian7.Notice(outcome.error);
      return;
    }
    if (outcome.movedTo) run.applied[path] = outcome.movedTo;
    await this.plugin.persist();
    this.render();
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
        cls: "s1am-empty",
        text: "\u9009\u4E00\u4E2A\u6587\u4EF6\u5939\uFF0C\u70B9\u300C\u626B\u63CF\u300D\u81EA\u52A8\u5217\u51FA\u76EE\u7684\u5730\u5019\u9009\uFF0C\u6539\u5B8C\u70B9\u300C\u5F00\u5DE5\u300D\u3002"
      });
    }
    el.scrollTop = prevTop;
  }
  renderHeader(el, run) {
    const status = run?.status ?? "standby";
    const bar = el.createDiv({ cls: "s1am-toolbar" });
    bar.createSpan({
      cls: "s1am-status" + (status === "judging" ? " is-live" : ""),
      text: status === "judging" ? "\u5224\u5B9A\u4E2D" : status === "done" ? "\u5DF2\u5224\u5B9A" : status === "partial" ? "\u90E8\u5206\u5931\u8D25" : status === "stopped" ? "\u5DF2\u505C\u6B62" : status === "failed" ? "\u5931\u8D25" : "\u5F85\u5F00\u59CB"
    });
    if (run && run.stats.filesTotal > 0) {
      const done = run.stats.judged + run.stats.failed;
      const pct = Math.round(done / run.stats.filesTotal * 100);
      bar.createSpan({
        cls: "s1am-stats-line",
        text: `  ${done}/${run.stats.filesTotal}  \xB7  ${(run.stats.elapsedMs / 1e3).toFixed(1)}s` + (run.stats.failed > 0 ? `  \xB7 \u5931\u8D25 ${run.stats.failed}` : "")
      });
      if (status === "judging" || status === "done" || status === "partial" || status === "stopped") {
        const wrap = el.createDiv({ cls: "s1am-progress" });
        const fill = wrap.createDiv({ cls: "s1am-progress-fill" });
        fill.style.width = `${pct}%`;
        if (status === "judging") fill.addClass("is-live");
        el.createDiv({
          cls: "s1am-progress-label",
          text: status === "judging" && run.activePath ? `${pct}% \xB7 \u6B63\u5728\u5224\u5B9A ${run.activePath.split("/").pop()}` : `${pct}%`
        });
      }
    }
    if (run?.lastError && (status === "partial" || status === "failed")) {
      const why = run.abortedAfter ? `\u8FDE\u7EED ${run.abortedAfter} \u4E2A\u5931\u8D25\uFF0C\u5DF2\u505C\u4E0B` : "\u4E0A\u4E00\u6B21\u5931\u8D25";
      el.createDiv({ cls: "s1am-error", text: `${why}\uFF1A${run.lastError}` });
    }
    const actions = bar.createDiv({ cls: "s1am-toolbar-actions" });
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
    const row = el.createDiv({ cls: "s1am-controls" });
    row.createSpan({ text: "\u8303\u56F4  ", cls: "s1am-label" });
    const select = row.createEl("select", { cls: "dropdown s1am-scope-select" });
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
    const startBtn = row.createEl("button", { text: "\u5F00\u5DE5", cls: "mod-cta s1am-batch" });
    startBtn.disabled = status === "judging" || !run;
    startBtn.onclick = () => void this.start();
    row.createSpan({ cls: "s1am-muted", text: `  ${this.scopeFiles().length} \u4E2A\u6587\u4EF6` });
  }
  renderCandidates(el, run) {
    const box = el.createDiv({ cls: "s1am-candidates" });
    box.createDiv({ cls: "s1am-cand-label", text: `\u76EE\u7684\u5730\uFF08${run.folders.length}\uFF09` });
    const wrap = box.createDiv({ cls: "s1am-chips" });
    for (const folder of run.folders) {
      const chip = wrap.createSpan({ cls: "s1am-chip-in", text: folder.path });
      const x = chip.createSpan({ cls: "s1am-chip-x", text: "\xD7" });
      x.onclick = () => {
        run.folders = run.folders.filter((f) => f.path !== folder.path);
        void this.plugin.persist();
        this.render();
      };
    }
    const input = wrap.createEl("input", {
      type: "text",
      cls: "s1am-chip-input",
      attr: { placeholder: "+ \u76EE\u5F55" }
    });
    input.value = this.draft.folder;
    input.oninput = () => {
      this.draft.folder = input.value;
    };
    if (this.draft.folder) input.focus();
    input.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const path = input.value.trim().replace(/^\/+|\/+$/g, "");
      input.value = "";
      this.draft.folder = "";
      if (!path || run.folders.some((f) => f.path === path)) return;
      if (!folderExists(this.app, path)) {
        new import_obsidian7.Notice(`\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${path}`);
        return;
      }
      run.folders.push({ path, examples: [] });
      void this.plugin.persist();
      this.render();
    };
    if (run.folders.length > OFFERABLE_FOLDERS) {
      box.createDiv({
        cls: "s1am-warn",
        text: `\u76EE\u5F55\u592A\u591A\uFF1A\u5355\u6B21\u8BF7\u6C42\u6700\u591A ${OFFERABLE_FOLDERS} \u4E2A\uFF0C\u6392\u5728\u540E\u9762\u7684\u4E0D\u4F1A\u88AB\u6A21\u578B\u770B\u5230`
      });
    }
  }
  renderTable(el, run) {
    const wrap = el.createDiv({ cls: "s1am-table-wrap" });
    const table = wrap.createEl("table", { cls: "s1am-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["", "\u6587\u4EF6", "\u76EE\u7684\u5730", ""]) head.createEl("th", { text: label });
    const tbody = table.createEl("tbody");
    for (const path of run.order) {
      const state = moveRowState(this.app, run, path);
      const applied = run.applied[path];
      const tr = tbody.createEl("tr");
      if (run.activePath === path) tr.addClass("is-active");
      if (applied) tr.addClass("is-applied");
      const check = tr.createEl("td").createEl("input", { type: "checkbox" });
      check.checked = run.include[path] !== false;
      check.disabled = Boolean(applied);
      check.onchange = () => {
        run.include[path] = check.checked;
        this.updateApplyCount(run);
        void this.plugin.persist();
      };
      tr.createEl("td", {
        cls: "s1am-note-cell",
        text: path.split("/").pop() ?? path,
        attr: { title: path }
      });
      const destCell = tr.createEl("td", { cls: "s1am-target" });
      if (applied) {
        destCell.setText(`\u2713 ${parentOf(applied) || "/"}`);
      } else if (!run.answers[path]) {
        destCell.setText(run.activePath === path ? "\u5224\u5B9A\u4E2D\u2026" : "\u2014");
      } else if (state.bucket === "stay") {
        destCell.setText("\u4FDD\u6301\u539F\u4F4D");
      } else if (!state.toFolder) {
        destCell.setText("\u7B54\u6848\u4F5C\u5E9F");
      } else {
        destCell.setText(
          `${state.fromFolder || "/"} \u2192 ${state.toFolder}${state.bucket === "confirm" ? " ?" : ""}`
        );
        const why = state.reason ? REASON_TEXT[state.reason] : void 0;
        if (state.bucket === "confirm" && why) {
          destCell.createSpan({ cls: "s1am-reason", text: `\uFF08${why}\uFF09` });
        }
      }
      const actionCell = tr.createEl("td");
      if (applied) {
        actionCell.createSpan({ cls: "s1am-done", text: "\u2713 \u5DF2\u79FB\u52A8" });
      } else if (run.answers[path] && state.bucket === "confirm" && state.toFolder) {
        const ok = actionCell.createEl("button", { text: "\u786E\u8BA4", cls: "s1am-confirm" });
        ok.onclick = () => void this.confirmOne(run, path, state.toFolder);
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
    const footer = el.createDiv({ cls: "s1am-controls" });
    const apply = footer.createEl("button", {
      text: `\u5E94\u7528 ${this.moveTargets(run).length} \u884C`,
      cls: "mod-cta s1am-batch"
    });
    this.applyBtn = apply;
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

// src/cache/move-cache.ts
function moveKey(parts) {
  return [
    parts.filePath,
    parts.contentFingerprint,
    parts.foldersHash,
    parts.bodyChars,
    parts.modelId,
    parts.promptVersion
  ].join("\0");
}
var MoveCache = class {
  constructor(maxEntries) {
    this.store = new KeyedCache((e) => moveKey(e), (e) => e.filePath, maxEntries);
  }
  load(entries) {
    this.store.load(entries);
  }
  dump() {
    return this.store.dump();
  }
  get(parts) {
    return this.store.get(moveKey(parts));
  }
  set(entry) {
    this.store.set(entry);
  }
};

// src/main.ts
var SystemOneAutoMovePlugin = class extends import_obsidian8.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.cache = new MoveCache();
    this.currentRun = null;
  }
  async onload() {
    await this.loadPluginData();
    this.registerView(VIEW_TYPE_MOVE, (leaf) => new MoveView(leaf, this));
    this.addSettingTab(new SystemOneAutoMoveSettingTab(this.app, this));
    const open = () => void this.activateView();
    this.addCommand({ id: "open-move", name: "Open System One Move", callback: open });
    this.addCommand({
      id: "move-this-folder",
      name: "Organize the active folder",
      callback: async () => {
        if (this.currentRun?.status === "judging") {
          new import_obsidian8.Notice("\u5224\u5B9A\u8FDB\u884C\u4E2D\uFF0C\u5148\u505C\u6B62\u518D\u5207\u6362\u6587\u4EF6\u5939");
          return;
        }
        const active = this.app.workspace.getActiveFile();
        this.settings.lastFolder = active?.parent?.path ?? "";
        await this.saveSettings();
        await this.activateView();
        this.currentRun = null;
        this.getView()?.refresh();
      }
    });
    this.addCommand({
      id: "stop-run",
      name: "Stop the current run",
      callback: () => {
        if (this.currentRun?.status === "judging") {
          this.currentRun.stopRequested = true;
          new import_obsidian8.Notice("\u6B63\u5728\u505C\u6B62\u2026");
        } else {
          new import_obsidian8.Notice("\u5F53\u524D\u6CA1\u6709\u8FDB\u884C\u4E2D\u7684\u5224\u5B9A");
        }
      }
    });
    this.addRibbonIcon("folder-input", "System One Auto Move", open);
    if (this.currentRun?.status === "judging") {
      this.currentRun.status = "stopped";
      this.currentRun.activePath = void 0;
      await this.persist();
    }
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MOVE);
  }
  getView() {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_MOVE)[0]?.view;
    return view instanceof MoveView ? view : null;
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_MOVE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_MOVE, active: true });
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
    if (raw?.moveCache) this.cache.load(raw.moveCache);
    this.currentRun = raw?.currentRun ?? null;
  }
  async saveSettings() {
    await this.persist();
  }
  async persist() {
    const data = {
      settings: this.settings,
      moveCache: this.cache.dump(),
      currentRun: this.currentRun
    };
    await this.saveData(data);
  }
};
