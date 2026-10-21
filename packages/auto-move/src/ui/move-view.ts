import { ItemView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import type SystemOneAutoMovePlugin from "../main";
import { moveRowState, newMoveRun, runMoves, type MoveRun } from "../judge/move-run";
import { moveBack, moveFile } from "../judge/apply";
import { collectFolderOptions, folderExists, parentOf } from "../vault/folders";
import { filesInScope, folderPaths } from "../vault/scope";
import { OFFERABLE_FOLDERS, SystemOneCreditError } from "../llm/systemone";

export const VIEW_TYPE_MOVE = "systemone-move-view";

const REASON_TEXT: Record<string, string> = {
  "low-confidence": "不够确定",
  collision: "目标已有同名文件",
  "unknown-option": "目录不在候选里",
  "no-answer": "模型没答",
};

export class MoveView extends ItemView {
  plugin: SystemOneAutoMovePlugin;
  private rootEl!: HTMLElement;
  private refreshTimer: number | null = null;
  /**
   * Guards the async entry points. The buttons are only disabled while a run is
   * judging, which leaves the whole first `await` of scan and apply exposed: a
   * second click would start a second pass over the same rows.
   */
  private busy = false;
  /**
   * Text typed but not yet committed. Rendering rebuilds the controls, and a
   * judging run re-renders every 90ms, so without this a half-typed folder path
   * is wiped mid-keystroke.
   */
  private draft = { folder: "" };
  /** The footer button whose label counts the rows the next apply would move. */
  private applyBtn: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SystemOneAutoMovePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_MOVE;
  }

  getDisplayText(): string {
    return "System One Move";
  }

  getIcon(): string {
    return "folder-input";
  }

  async onOpen(): Promise<void> {
    this.rootEl = this.contentEl;
    this.rootEl.empty();
    this.rootEl.addClass("s1am-root");
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

  private get run(): MoveRun | null {
    return this.plugin.currentRun;
  }

  private scopeFolder(): string {
    return this.run?.scopeFolder ?? this.plugin.settings.lastFolder;
  }

  private scopeFiles(): TFile[] {
    return filesInScope(this.app, this.scopeFolder());
  }

  /** Recount without a full render: a render would rebuild the inputs above. */
  private updateApplyCount(run: MoveRun): void {
    if (this.applyBtn) this.applyBtn.setText(`应用 ${this.moveTargets(run).length} 行`);
  }

  // —— step 1: scan destinations ——

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
    const files = this.scopeFiles();
    if (files.length === 0) {
      new Notice("这个文件夹里没有文件");
      return;
    }
    const folders = collectFolderOptions(this.app);
    if (folders.length === 0) {
      new Notice("vault 里还没有装着文件的目录，先建几个再扫描");
      return;
    }
    const run = this.run ?? newMoveRun({ scopeFolder: this.scopeFolder(), folders: [] });
    run.scopeFolder = this.scopeFolder();
    run.folders = folders;
    this.clearRows(run);
    // Everything starts checked: the user prunes rather than assembles.
    run.include = Object.fromEntries(files.map((f) => [f.path, true]));
    this.plugin.currentRun = run;
    await this.plugin.persist();
    this.render();
  }

  // —— step 2: judge and apply ——

  private async start(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const files = this.scopeFiles().filter((f) => run.include[f.path] !== false);
    if (files.length === 0) {
      new Notice("没有勾选任何文件");
      return;
    }
    if (run.folders.length === 0) {
      new Notice("候选目录为空：先点「扫描」或手动加几个");
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

  /**
   * Drops rows judged in a folder the run no longer points at. `applied` stays:
   * those moves really happened and must remain undoable.
   */
  private clearRows(run: MoveRun): void {
    run.order = [];
    run.answers = {};
    run.status = "standby";
    run.lastError = undefined;
    run.abortedAfter = undefined;
    run.stats = { filesTotal: 0, judged: 0, failed: 0, elapsedMs: 0 };
  }

  private moveTargets(run: MoveRun): string[] {
    return run.order.filter((path) => {
      if (run.include[path] === false || run.applied[path]) return false;
      return moveRowState(this.app, run, path).bucket === "move";
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
    const targets = this.moveTargets(run);
    if (targets.length === 0) {
      new Notice("没有待移动的行");
      return;
    }
    if (!confirm(`移动 ${targets.length} 个文件。确认？`)) return;

    let moved = 0;
    const failures: string[] = [];
    for (const path of targets) {
      const state = moveRowState(this.app, run, path);
      if (!state.toFolder) continue;
      const outcome = await moveFile(this.app, path, state.toFolder);
      if (outcome.movedTo) {
        run.applied[path] = outcome.movedTo;
        moved++;
      }
      if (outcome.error) failures.push(`${path.split("/").pop()}：${outcome.error}`);
    }
    await this.plugin.persist();
    this.render();
    if (moved > 0) new Notice(`已移动 ${moved} 个文件`);
    if (failures.length > 0) new Notice(`失败 ${failures.length} 个：\n${failures.join("\n")}`, 12000);
  }

  private async undoAll(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const rows = Object.entries(run.applied);
    if (rows.length === 0) return;
    if (!confirm(`把 ${rows.length} 个文件移回原位，确认？`)) return;

    const failures: string[] = [];
    for (const [original, current] of rows) {
      const error = await moveBack(this.app, current, original);
      // A file that cannot go back stays where this run put it; say so, or the
      // user is left looking for it at the path the notice named.
      if (error) failures.push(`${original.split("/").pop()}：${error}，仍在 ${current}`);
      else delete run.applied[original];
    }
    await this.plugin.persist();
    this.render();
    if (failures.length === 0) new Notice("已把本次移动的文件全部移回");
    else new Notice(`部分撤销失败：\n${failures.join("\n")}`, 12000);
  }

  private async confirmOne(run: MoveRun, path: string, folder: string): Promise<void> {
    const outcome = await moveFile(this.app, path, folder);
    if (outcome.error) {
      new Notice(outcome.error);
      return;
    }
    if (outcome.movedTo) run.applied[path] = outcome.movedTo;
    await this.plugin.persist();
    this.render();
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
        cls: "s1am-empty",
        text: "选一个文件夹，点「扫描」自动列出目的地候选，改完点「开工」。",
      });
    }
    el.scrollTop = prevTop;
  }

  private renderHeader(el: HTMLElement, run: MoveRun | null): void {
    const status = run?.status ?? "standby";
    const bar = el.createDiv({ cls: "s1am-toolbar" });
    bar.createSpan({
      cls: "s1am-status" + (status === "judging" ? " is-live" : ""),
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
        cls: "s1am-stats-line",
        text:
          `  ${done}/${run.stats.filesTotal}  ·  ${(run.stats.elapsedMs / 1000).toFixed(1)}s` +
          (run.stats.failed > 0 ? `  · 失败 ${run.stats.failed}` : ""),
      });
      if (status === "judging" || status === "done" || status === "partial" || status === "stopped") {
        const wrap = el.createDiv({ cls: "s1am-progress" });
        const fill = wrap.createDiv({ cls: "s1am-progress-fill" });
        fill.style.width = `${pct}%`;
        if (status === "judging") fill.addClass("is-live");
        el.createDiv({
          cls: "s1am-progress-label",
          text:
            status === "judging" && run.activePath
              ? `${pct}% · 正在判定 ${run.activePath.split("/").pop()}`
              : `${pct}%`,
        });
      }
    }
    if (run?.lastError && (status === "partial" || status === "failed")) {
      const why = run.abortedAfter ? `连续 ${run.abortedAfter} 个失败，已停下` : "上一次失败";
      el.createDiv({ cls: "s1am-error", text: `${why}：${run.lastError}` });
    }

    const actions = bar.createDiv({ cls: "s1am-toolbar-actions" });
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

    const row = el.createDiv({ cls: "s1am-controls" });
    row.createSpan({ text: "范围  ", cls: "s1am-label" });
    const select = row.createEl("select", { cls: "dropdown s1am-scope-select" });
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
        // here would move files outside the folder now on screen.
        this.clearRows(this.run);
      }
      void this.plugin.saveSettings();
      this.render();
    };

    const scan = row.createEl("button", { text: "扫描" });
    scan.disabled = status === "judging";
    scan.onclick = () => void this.scan();

    const startBtn = row.createEl("button", { text: "开工", cls: "mod-cta s1am-batch" });
    startBtn.disabled = status === "judging" || !run;
    startBtn.onclick = () => void this.start();

    row.createSpan({ cls: "s1am-muted", text: `  ${this.scopeFiles().length} 个文件` });
  }

  private renderCandidates(el: HTMLElement, run: MoveRun): void {
    const box = el.createDiv({ cls: "s1am-candidates" });
    box.createDiv({ cls: "s1am-cand-label", text: `目的地（${run.folders.length}）` });
    const wrap = box.createDiv({ cls: "s1am-chips" });
    for (const folder of run.folders) {
      const chip = wrap.createSpan({ cls: "s1am-chip-in", text: folder.path });
      const x = chip.createSpan({ cls: "s1am-chip-x", text: "×" });
      x.onclick = () => {
        run.folders = run.folders.filter((f) => f.path !== folder.path);
        void this.plugin.persist();
        this.render();
      };
    }
    const input = wrap.createEl("input", {
      type: "text",
      cls: "s1am-chip-input",
      attr: { placeholder: "+ 目录" },
    }) as HTMLInputElement;
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
        new Notice(`目录不存在：${path}`);
        return;
      }
      run.folders.push({ path, examples: [] });
      void this.plugin.persist();
      this.render();
    };

    if (run.folders.length > OFFERABLE_FOLDERS) {
      // The question silently drops whatever does not fit; saying so beats a
      // destination list that quietly stops at a cutoff.
      box.createDiv({
        cls: "s1am-warn",
        text: `目录太多：单次请求最多 ${OFFERABLE_FOLDERS} 个，排在后面的不会被模型看到`,
      });
    }
  }

  private renderTable(el: HTMLElement, run: MoveRun): void {
    const wrap = el.createDiv({ cls: "s1am-table-wrap" });
    const table = wrap.createEl("table", { cls: "s1am-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["", "文件", "目的地", ""]) head.createEl("th", { text: label });
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
        attr: { title: path },
      });

      const destCell = tr.createEl("td", { cls: "s1am-target" });
      if (applied) {
        destCell.setText(`✓ ${parentOf(applied) || "/"}`);
      } else if (!run.answers[path]) {
        destCell.setText(run.activePath === path ? "判定中…" : "—");
      } else if (state.bucket === "stay") {
        destCell.setText("保持原位");
      } else if (!state.toFolder) {
        // The answer named a folder the run no longer offers. Saying "stays put"
        // would claim a decision the model never made.
        destCell.setText("答案作废");
      } else {
        destCell.setText(
          `${state.fromFolder || "/"} → ${state.toFolder}${state.bucket === "confirm" ? " ?" : ""}`
        );
        const why = state.reason ? REASON_TEXT[state.reason] : undefined;
        if (state.bucket === "confirm" && why) {
          destCell.createSpan({ cls: "s1am-reason", text: `（${why}）` });
        }
      }

      const actionCell = tr.createEl("td");
      if (applied) {
        actionCell.createSpan({ cls: "s1am-done", text: "✓ 已移动" });
      } else if (run.answers[path] && state.bucket === "confirm" && state.toFolder) {
        const ok = actionCell.createEl("button", { text: "确认", cls: "s1am-confirm" });
        ok.onclick = () => void this.confirmOne(run, path, state.toFolder as string);
      }
    }

    // Follow the file being judged. Without it a long run looks stuck: the
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

    const footer = el.createDiv({ cls: "s1am-controls" });
    const apply = footer.createEl("button", {
      text: `应用 ${this.moveTargets(run).length} 行`,
      cls: "mod-cta s1am-batch",
    });
    this.applyBtn = apply;
    apply.disabled = run.status === "judging";
    apply.onclick = () => void this.applyAll();
  }
}
