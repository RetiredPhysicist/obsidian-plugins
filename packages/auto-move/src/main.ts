import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  SystemOneAutoMoveSettingTab,
  type PluginSettings,
} from "./settings";
import { MoveView, VIEW_TYPE_MOVE } from "./ui/move-view";
import { MoveCache, type MoveEntry } from "./cache/move-cache";
import type { MoveRun } from "./judge/move-run";

interface PersistedData {
  settings: PluginSettings;
  moveCache?: MoveEntry[];
  currentRun?: MoveRun | null;
}

export default class SystemOneAutoMovePlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  cache = new MoveCache();
  currentRun: MoveRun | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.registerView(VIEW_TYPE_MOVE, (leaf) => new MoveView(leaf, this));
    this.addSettingTab(new SystemOneAutoMoveSettingTab(this.app, this));

    const open = (): void => void this.activateView();
    this.addCommand({ id: "open-move", name: "Open System One Move", callback: open });
    this.addCommand({
      id: "move-this-folder",
      name: "Organize the active folder",
      callback: async () => {
        // Dropping the run mid-judgement would orphan the running loop: it keeps
        // spending on a run nothing points at, Stop can no longer find it, and
        // the next scan overwrites the undo history it was still collecting.
        if (this.currentRun?.status === "judging") {
          new Notice("判定进行中，先停止再切换文件夹");
          return;
        }
        const active = this.app.workspace.getActiveFile();
        this.settings.lastFolder = active?.parent?.path ?? "";
        await this.saveSettings();
        await this.activateView();
        this.currentRun = null;
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

    this.addRibbonIcon("folder-input", "System One Auto Move", open);

    // A run persisted mid-flight belongs to a session that is gone: its loop
    // cannot resume, and leaving it "judging" would strand the Stop button.
    if (this.currentRun?.status === "judging") {
      this.currentRun.status = "stopped";
      this.currentRun.activePath = undefined;
      await this.persist();
    }
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MOVE);
  }

  private getView(): MoveView | null {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_MOVE)[0]?.view;
    return view instanceof MoveView ? view : null;
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_MOVE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_MOVE, active: true });
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
    if (raw?.moveCache) this.cache.load(raw.moveCache);
    this.currentRun = raw?.currentRun ?? null;
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  async persist(): Promise<void> {
    const data: PersistedData = {
      settings: this.settings,
      moveCache: this.cache.dump(),
      currentRun: this.currentRun,
    };
    await this.saveData(data);
  }
}
