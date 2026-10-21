import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  SystemOneAutoTagSettingTab,
  type PluginSettings,
} from "./settings";
import { TagView, VIEW_TYPE_TAGS } from "./ui/tag-view";
import { ScoreCache, type ScoreEntry } from "./cache/score-cache";
import type { TagRun } from "./judge/tag-run";

interface PersistedData {
  settings: PluginSettings;
  scoreCache?: ScoreEntry[];
  currentRun?: TagRun | null;
}

export default class SystemOneAutoTagPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  cache = new ScoreCache();
  currentRun: TagRun | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.registerView(VIEW_TYPE_TAGS, (leaf) => new TagView(leaf, this));
    this.addSettingTab(new SystemOneAutoTagSettingTab(this.app, this));

    const open = (): void => void this.activateView();
    this.addCommand({ id: "open-tags", name: "Open System One Tags", callback: open });
    this.addCommand({
      id: "tag-this-folder",
      name: "Tag the active folder",
      callback: async () => {
        // Dropping the run mid-judgement would orphan the running loop: it keeps
        // spending on a run nothing points at, Stop can no longer find it, and
        // the next scan overwrites the undo history it was still collecting.
        if (this.currentRun?.status === "judging") {
          new Notice("判定进行中，先停止再切换文件夹");
          return;
        }
        const active = this.app.workspace.getActiveFile();
        const folder = active?.parent?.path ?? "";
        this.settings.lastFolder = folder === "/" ? "" : folder;
        await this.saveSettings();
        await this.activateView();
        // Point the current run at the new folder without dropping it: `applied`
        // is the only record of what was written, and discarding it here would
        // leave completed tags permanently un-undoable.
        if (this.currentRun) {
          this.currentRun.scopeFolder = this.settings.lastFolder;
          await this.persist();
        }
        this.getView()?.refresh();
      },
    });
    this.addCommand({
      id: "stop-run",
      name: "Stop the current run",
      callback: () => {
        if (this.currentRun?.status === "judging") {
          this.currentRun.stopRequested = true;
          new Notice("正在停止…");
        } else {
          new Notice("当前没有进行中的判定");
        }
      },
    });

    this.addRibbonIcon("tags", "System One Auto Tag", open);

    // A run persisted mid-flight belongs to a session that is gone: its loop
    // cannot resume, and leaving it "judging" would strand the Stop button.
    if (this.currentRun?.status === "judging") {
      this.currentRun.status = "stopped";
      this.currentRun.activePath = undefined;
      await this.persist();
    }
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TAGS);
  }

  private getView(): TagView | null {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TAGS)[0]?.view;
    return view instanceof TagView ? view : null;
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_TAGS)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_TAGS, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as PersistedData | null;
    const saved = (raw?.settings ?? {}) as Partial<PluginSettings>;
    const settings = { ...DEFAULT_SETTINGS };
    // Copy only keys that still exist: data.json outlives setting removals.
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof PluginSettings)[]) {
      if (saved[key] !== undefined) (settings[key] as unknown) = saved[key];
    }
    this.settings = settings;
    if (raw?.scoreCache) this.cache.load(raw.scoreCache);
    this.currentRun = raw?.currentRun ?? null;
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  async persist(): Promise<void> {
    const data: PersistedData = {
      settings: this.settings,
      scoreCache: this.cache.dump(),
      currentRun: this.currentRun,
    };
    await this.saveData(data);
  }
}
