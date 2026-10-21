import { App, PluginSettingTab, Setting } from "obsidian";
import type SystemOneAutoTagPlugin from "./main";
import type { WriteMode } from "./vault/tags";

export type { WriteMode };

export type BodyScope = "full" | "first_n" | "title";

export interface PluginSettings {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Start folder for a run; remembered between sessions. */
  lastFolder: string;
  maxTagsPerNote: number;
  bodyScope: BodyScope;
  bodyChars: number;
  writeMode: WriteMode;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  baseUrl: "https://api.typesafe.ai",
  apiKey: "",
  modelId: "jev-1.14.0",
  lastFolder: "",
  maxTagsPerNote: 8,
  bodyScope: "first_n",
  bodyChars: 800,
  writeMode: "frontmatter",
};

export class SystemOneAutoTagSettingTab extends PluginSettingTab {
  plugin: SystemOneAutoTagPlugin;

  constructor(app: App, plugin: SystemOneAutoTagPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "System One Auto Tag" });

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
      .setName("Write mode")
      .setDesc("How accepted tags land in the note")
      .addDropdown((d) =>
        d
          .addOptions({
            frontmatter: "YAML frontmatter tags:",
            inline_top: "Inline #tag at top",
            both: "Both",
          })
          .setValue(this.plugin.settings.writeMode)
          .onChange(async (v) => {
            this.plugin.settings.writeMode = v as WriteMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Body sent to the model")
      .addDropdown((d) =>
        d
          .addOptions({ first_n: "First N chars", full: "Full note", title: "Title only" })
          .setValue(this.plugin.settings.bodyScope)
          .onChange(async (v) => {
            this.plugin.settings.bodyScope = v as BodyScope;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Body chars")
      .setDesc("Used when the scope above is First N chars")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.bodyChars)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 50) return;
          this.plugin.settings.bodyChars = n;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Max tags per note")
      .setDesc("0 = no limit")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.maxTagsPerNote)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 0) return;
          this.plugin.settings.maxTagsPerNote = n;
          await this.plugin.saveSettings();
        })
      );
  }
}
