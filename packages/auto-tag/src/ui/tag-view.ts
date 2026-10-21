import { ItemView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import type SystemOneAutoTagPlugin from "../main";
import { newTagRun, runTagging, tagRowState, type TagRun } from "../judge/tag-run";
import { folderPaths, notesInScope } from "../vault/scope";
import { scanVaultTags, scopeSummary, SEED_TAGS } from "../vault/candidates";
import { addTagsToNote, normalizeTag, noteTags, removeTagsFromNote } from "../vault/tags";
import {
  SystemOneCreditError,
  callSystemOne,
  parseNoul,
  themeQuestions,
} from "../llm/systemone";

export const VIEW_TYPE_TAGS = "systemone-tags-view";

/**
 * A seed tag has to be plainly present in the scanned notes. Measured on a
 * six-note inbox, 0.70 admits 26 of 48 words and 0.90 keeps 14 — the point of
 * the list is that it is short enough to prune.
 */
const SEED_THRESHOLD = 0.9;

export class TagView extends ItemView {
  plugin: SystemOneAutoTagPlugin;
  private rootEl!: HTMLElement;
  private refreshTimer: number | null = null;
  /**
   * Guards the async entry points. The buttons are only disabled while a run is
   * judging, which leaves the whole first `await` of scan and apply exposed: a
   * second click would start a second pass over the same rows.
   */
  private busy = false;

  constructor(leaf: WorkspaceLeaf, plugin: SystemOneAutoTagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TAGS;
  }

  getDisplayText(): string {
    return "System One Tags";
  }

  getIcon(): string {
    return "tags";
  }

  async onOpen(): Promise<void> {
    this.rootEl = this.contentEl;
    this.rootEl.empty();
    this.rootEl.addClass("s1at-root");
    this.render();
  }

  async onClose(): Promise<void> {
    // A debounced render queued while judging would otherwise fire after the
    // view is gone and rebuild DOM in a detached element.
    if (this.refreshTimer != null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.rootEl?.empty();
  }

  refresh(): void {
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

  private get run(): TagRun | null {
    return this.plugin.currentRun;
  }

  private scopeFolder(): string {
    return this.run?.scopeFolder ?? this.plugin.settings.lastFolder;
  }

  private filesInScope(): TFile[] {
    return notesInScope(this.app, this.scopeFolder());
  }

  // —— step 1: scan candidates ——

  /**
   * The endpoint answers in typed values, so it cannot invent tags. The closest
   * honest equivalent of "generate a tag list" is grading a seed vocabulary
   * against the scanned notes; the user then prunes it like any other list.
   */
  private async tagCandidates(files: TFile[]): Promise<string[]> {
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
        questions: themeQuestions(SEED_TAGS),
      });
      const picked = Object.entries(resp.answers ?? {})
        .map(([id, value]) => ({ tag: SEED_TAGS[Number(id.slice(1))], p: parseNoul(value) }))
        .filter((x) => x.tag && x.p !== null && x.p >= SEED_THRESHOLD)
        .map((x) => x.tag as string);
      return picked.length > 0 ? picked : SEED_TAGS;
    } catch (e) {
      console.error("[systemone-auto-tag] seed grading failed", e);
      return SEED_TAGS;
    }
  }

  private async scan(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      return await this.scanOnce();
    } finally {
      this.busy = false;
    }
  }

  private async scanOnce(): Promise<void> {
    if (!this.plugin.settings.apiKey) {
      new Notice("先到设置里填 System One API key");
      return;
    }
    const files = this.filesInScope();
    if (files.length === 0) {
      new Notice("这个文件夹里没有笔记");
      return;
    }
    const notice = new Notice("正在扫描候选…", 0);
    try {
      const tags = await this.tagCandidates(files);
      const run =
        this.run ??
        newTagRun({
          scopeFolder: this.scopeFolder(),
          tags: [],
          maxTagsPerNote: this.plugin.settings.maxTagsPerNote,
        });
      run.scopeFolder = this.scopeFolder();
      run.tags = tags;
      this.clearRows(run);
      // Everything starts checked: the user prunes rather than assembles.
      run.include = Object.fromEntries(files.map((f) => [f.path, true]));
      this.plugin.currentRun = run;
      await this.plugin.persist();
    } finally {
      notice.hide();
    }
    this.render();
  }

  // —— step 2: judge and apply ——

  private async start(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const files = this.filesInScope().filter((f) => run.include[f.path] !== false);
    if (files.length === 0) {
      new Notice("没有勾选任何笔记");
      return;
    }
    if (run.tags.length === 0) {
      new Notice("候选标签为空：先点「扫描」或手动加几个");
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
        onCreditGone: (err: SystemOneCreditError) => new Notice(err.message, 15000),
      });
    } catch (e) {
      run.status = "failed";
      new Notice(`判定失败：${e instanceof Error ? e.message : String(e)}`, 15000);
    } finally {
      await this.plugin.persist();
      this.refresh();
    }
  }

  private rowFor(run: TagRun, path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    const existing = file instanceof TFile ? noteTags(this.app, file) : [];
    return { state: tagRowState(run, path, existing), existing };
  }

  private fileAt(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  /**
   * Drops rows judged in a folder the run no longer points at. `applied` stays:
   * those writes really happened and must remain undoable.
   */
  private clearRows(run: TagRun): void {
    run.order = [];
    run.scores = {};
    run.status = "standby";
    run.lastError = undefined;
    run.abortedAfter = undefined;
    run.stats = { filesTotal: 0, judged: 0, failed: 0, elapsedMs: 0 };
  }

  private applyTargets(run: TagRun): string[] {
    return run.order.filter((path) => {
      if (run.include[path] === false || run.applied[path]) return false;
      return this.rowFor(run, path).state.writeTags.length > 0;
    });
  }

  private async applyAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      return await this.applyAllOnce();
    } finally {
      this.busy = false;
    }
  }

  private async applyAllOnce(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const targets = this.applyTargets(run);
    if (targets.length === 0) {
      new Notice("没有待写入的笔记");
      return;
    }
    const total = targets.reduce((n, p) => n + this.rowFor(run, p).state.writeTags.length, 0);
    if (!confirm(`给 ${targets.length} 篇笔记写入 ${total} 个标签。确认？`)) return;

    let written = 0;
    const failures: string[] = [];
    for (const path of targets) {
      const file = this.fileAt(path);
      if (!file) {
        failures.push(`${path.split("/").pop()}：文件已不存在`);
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
        failures.push(`${path.split("/").pop()}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.plugin.persist();
    this.render();
    if (written > 0) new Notice(`已写入 ${written} 个标签`);
    if (failures.length > 0) new Notice(`失败 ${failures.length} 个：\n${failures.join("\n")}`, 12000);
  }

  private async undoAll(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const rows = Object.entries(run.applied);
    if (rows.length === 0) return;
    if (!confirm(`撤销本次对 ${rows.length} 篇笔记的标签，确认？`)) return;

    const failures: string[] = [];
    const missing: string[] = [];
    for (const [path, applied] of rows) {
      const file = this.fileAt(path);
      if (!file) {
        failures.push(`${path.split("/").pop()}：文件已不在原处`);
        continue;
      }
      try {
        const removed = await removeTagsFromNote(this.app, file, applied.tags, applied.writeMode);
        const gone = new Set(removed.map((t) => t.toLowerCase()));
        const left = applied.tags.filter((t) => !gone.has(t.toLowerCase()));
        if (left.length > 0) {
          // Keep what is still there recorded, so a second undo can retry it.
          run.applied[path] = { tags: left, writeMode: applied.writeMode };
          missing.push(`${path.split("/").pop()}：${left.join(" ")}`);
        } else {
          delete run.applied[path];
        }
      } catch (e) {
        failures.push(`${path.split("/").pop()}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.plugin.persist();
    this.render();
    if (failures.length === 0 && missing.length === 0) new Notice("已撤销本次全部标签");
    if (missing.length > 0) {
      new Notice(`这些标签在笔记里已找不到：\n${missing.join("\n")}`, 12000);
    }
    if (failures.length > 0) {
      new Notice(`部分撤销失败：\n${failures.join("\n")}`, 12000);
    }
  }

  // —— rendering ——

  private render(): void {
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
        text: "选一个文件夹，点「扫描」自动列出标签候选，改完点「开工」。",
      });
    }
    el.scrollTop = prevTop;
  }

  private renderHeader(el: HTMLElement, run: TagRun | null): void {
    const status = run?.status ?? "standby";
    const bar = el.createDiv({ cls: "s1at-toolbar" });
    bar.createSpan({
      cls: "s1at-status" + (status === "judging" ? " is-live" : ""),
      text:
        status === "judging"
          ? "判定中"
          : status === "done"
            ? "已判定"
            : status === "partial"
              ? "部分失败"
              : status === "stopped"
                ? "已停止"
                : status === "failed"
                  ? "失败"
                  : "待开始",
    });
    if (run && run.stats.filesTotal > 0) {
      const done = run.stats.judged + run.stats.failed;
      const pct = Math.round((done / run.stats.filesTotal) * 100);
      bar.createSpan({
        cls: "s1at-stats-line",
        text:
          `  ${done}/${run.stats.filesTotal}  ·  ${(run.stats.elapsedMs / 1000).toFixed(0)}s` +
          (run.stats.failed > 0 ? `  · 失败 ${run.stats.failed}` : ""),
      });
      if (status === "judging" || status === "done" || status === "partial" || status === "stopped") {
        const wrap = el.createDiv({ cls: "s1at-progress" });
        const fill = wrap.createDiv({ cls: "s1at-progress-fill" });
        fill.style.width = `${pct}%`;
        if (status === "judging") fill.addClass("is-live");
        el.createDiv({
          cls: "s1at-progress-label",
          text:
            status === "judging" && run.activePath
              ? `${pct}% · 正在判定 ${run.activePath.split("/").pop()}`
              : `${pct}%`,
        });
      }
    }
    if (run?.lastError && (status === "partial" || status === "failed")) {
      const why = run.abortedAfter
        ? `连续 ${run.abortedAfter} 篇失败，已停下`
        : "上一次失败";
      el.createDiv({ cls: "s1at-error", text: `${why}：${run.lastError}` });
    }

    const actions = bar.createDiv({ cls: "s1at-toolbar-actions" });
    if (run && status === "judging") {
      const stop = actions.createEl("button", { text: "停止" });
      stop.onclick = () => {
        run.stopRequested = true;
        void this.plugin.persist();
        this.render();
      };
    }
    if (run && Object.keys(run.applied).length > 0) {
      const undo = actions.createEl("button", { text: "撤销" });
      undo.onclick = () => void this.undoAll();
    }

    const row = el.createDiv({ cls: "s1at-controls" });
    row.createSpan({ text: "范围  ", cls: "s1at-label" });
    const select = row.createEl("select", { cls: "dropdown s1at-scope-select" });
    select.createEl("option", { text: "整个工作区", value: "" });
    for (const folder of folderPaths(this.app)) {
      select.createEl("option", { text: folder, value: folder });
    }
    select.value = this.scopeFolder();
    select.onchange = () => {
      const folder = select.value;
      this.plugin.settings.lastFolder = folder;
      if (this.run && this.run.scopeFolder !== folder) {
        this.run.scopeFolder = folder;
        // The rows belong to the folder they were judged in; acting on them from
        // here would write tags to notes outside the folder now on screen.
        this.clearRows(this.run);
      }
      void this.plugin.saveSettings();
      this.render();
    };

    const scan = row.createEl("button", { text: "扫描" });
    scan.disabled = status === "judging";
    scan.onclick = () => void this.scan();

    const startBtn = row.createEl("button", { text: "开工", cls: "mod-cta s1at-batch" });
    startBtn.disabled = status === "judging" || !run;
    startBtn.onclick = () => void this.start();

    row.createSpan({ cls: "s1at-muted", text: `  ${this.filesInScope().length} 篇笔记` });
  }

  private renderCandidates(el: HTMLElement, run: TagRun): void {
    const box = el.createDiv({ cls: "s1at-candidates" });
    box.createDiv({ cls: "s1at-cand-label", text: `标签（${run.tags.length}）` });
    const wrap = box.createDiv({ cls: "s1at-chips" });
    for (const tag of run.tags) {
      const chip = wrap.createSpan({ cls: "s1at-chip-in", text: tag });
      const x = chip.createSpan({ cls: "s1at-chip-x", text: "×" });
      x.onclick = () => {
        run.tags = run.tags.filter((t) => t !== tag);
        void this.plugin.persist();
        this.render();
      };
    }
    const input = wrap.createEl("input", {
      type: "text",
      cls: "s1at-chip-input",
      attr: { placeholder: "+ 标签" },
    }) as HTMLInputElement;
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

  private renderTable(el: HTMLElement, run: TagRun): void {
    const wrap = el.createDiv({ cls: "s1at-tag-table-wrap" });
    const table = wrap.createEl("table", { cls: "s1at-tag-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["", "笔记", "标签", ""]) head.createEl("th", { text: label });
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
        attr: { title: path },
      });

      const tagCell = tr.createEl("td", { cls: "s1at-tagcell" });
      const shown = state.scored.filter((t) => t.bucket !== "n");
      if (shown.length === 0) {
        tagCell.createSpan({ cls: "s1at-muted", text: run.scores[path] ? "无" : "—" });
      }
      const had = new Set(existing.map((t) => t.toLowerCase()));
      for (const t of shown) {
        const chip = tagCell.createSpan({
          cls: `s1at-mini-chip is-${t.bucket}`,
          text: `${t.tag} ${t.p.toFixed(2)}`,
        });
        if (had.has(t.tag.toLowerCase())) chip.addClass("is-existing");
      }

      const actionCell = tr.createEl("td");
      if (applied) {
        actionCell.createSpan({ cls: "s1at-done", text: "✓ 已写入" });
      }
    }

    // Follow the note being judged. Without it a long run looks stuck: the
    // active row is below the fold and nothing on screen moves.
    if (run.status === "judging" && run.activePath) {
      const active = tbody.querySelector("tr.is-active") as HTMLElement | null;
      if (active) {
        const top = active.offsetTop - wrap.offsetTop;
        if (top < wrap.scrollTop || top > wrap.scrollTop + wrap.clientHeight - 80) {
          wrap.scrollTop = Math.max(0, top - wrap.clientHeight / 2);
        }
      }
    }

    const footer = el.createDiv({ cls: "s1at-controls" });
    const apply = footer.createEl("button", {
      text: `应用 ${this.applyTargets(run).length} 篇`,
      cls: "mod-cta s1at-batch",
    });
    apply.disabled = run.status === "judging";
    apply.onclick = () => void this.applyAll();
  }
}
