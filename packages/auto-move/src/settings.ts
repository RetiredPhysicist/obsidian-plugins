import { App, PluginSettingTab, Setting } from "obsidian";
import type SystemOneAutoMovePlugin from "./main";

export interface PluginSettings {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Start folder for a run; remembered between sessions. */
  lastFolder: string;
  /** How many characters of a note body the model sees. */
  bodyChars: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  baseUrl: "https://api.typesafe.ai",
  apiKey: "",
  modelId: "jev-1.14.0",
  lastFolder: "",
  bodyChars: 800,
};

export class SystemOneAutoMoveSettingTab extends PluginSettingTab {
  plugin: SystemOneAutoMovePlugin;

  constructor(app: App, plugin: SystemOneAutoMovePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "System One Auto Move" });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Bearer token for System One. Stored in plugin data only.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("ts_…")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Default: jev-1.14.0")
      .addText((t) =>
        t
          .setPlaceholder("jev-1.14.0")
          .setValue(this.plugin.settings.modelId)
          .onChange(async (v) => {
            this.plugin.settings.modelId = v.trim() || "jev-1.14.0";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Requests go to {base}/v1/systemone")
      .addText((t) =>
        t
          .setPlaceholder("https://api.typesafe.ai")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.baseUrl = v.trim().replace(/\/+$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Body chars")
      .setDesc("How much of each note is sent with the folder question")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.bodyChars)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 50) return;
          this.plugin.settings.bodyChars = n;
          await this.plugin.saveSettings();
        })
      );
  }
}
