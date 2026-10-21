import { App, TFile, TFolder } from "obsidian";

/** Plugin data and trash are never part of a scan. */
function isIgnored(path: string, configDir: string): boolean {
  return [".obsidian", ".trash", ".git", configDir]
    .filter(Boolean)
    .some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Markdown files under `folderPath`, descending into subfolders. An empty path
 * means the whole workspace, which is what the folder picker's blank option
 * promises.
 */
export function notesInScope(app: App, folderPath: string): TFile[] {
  return walk(app, folderPath, (f) => f.extension === "md");
}

/** Every file under `folderPath`, descending. Empty path means the whole workspace. */
export function filesInScope(app: App, folderPath: string): TFile[] {
  return walk(app, folderPath, () => true);
}

/** Every folder a scan may target, for the picker. Never the plugin's own data. */
export function folderPaths(app: App): string[] {
  const out: string[] = [];
  const visit = (folder: TFolder): void => {
    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;
      if (isIgnored(child.path, app.vault.configDir)) continue;
      out.push(child.path);
      visit(child);
    }
  };
  visit(app.vault.getRoot());
  return out.sort((a, b) => a.localeCompare(b));
}

function walk(app: App, folderPath: string, accept: (f: TFile) => boolean): TFile[] {
  const root =
    folderPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);
  if (!(root instanceof TFolder)) return [];
  const out: TFile[] = [];
  const visit = (folder: TFolder): void => {
    for (const child of folder.children) {
      if (child instanceof TFile) {
        if (accept(child)) out.push(child);
      } else if (child instanceof TFolder && !isIgnored(child.path, app.vault.configDir)) {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
}
