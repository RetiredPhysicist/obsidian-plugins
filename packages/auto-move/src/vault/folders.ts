import { App, TAbstractFile, TFolder } from "obsidian";
import type { FolderHint } from "../llm/systemone";

/** How many existing file names per folder are shown to the model. */
const EXAMPLES_PER_FOLDER = 8;

/** Anything but `.obsidian`, `.trash` and `.git` — plugin data is never a target. */
export function isIgnoredFolder(path: string, configDir: string): boolean {
  const prefixes = [".obsidian", ".trash", ".git", configDir].filter(Boolean);
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Folders that already hold at least one file, each with the names of what is
 * inside. Empty folders are dropped: a folder nobody files into is not evidence
 * of where things belong, and every extra option costs tokens on every request.
 *
 * The vault root is dropped too. Obsidian reports it as `/`, while every path
 * this plugin builds writes the root as `""`, so offering it would put both
 * `keep` and `/` on the table — the probability split that makes the model
 * answer for nothing — and `joinPath("/", name)` produces `//name`.
 */
export function collectFolderOptions(app: App): FolderHint[] {
  const names = new Map<string, string[]>();
  for (const file of app.vault.getFiles()) {
    const parent = file.parent?.path ?? "";
    if (parent === "" || parent === "/") continue;
    if (isIgnoredFolder(parent, app.vault.configDir)) continue;
    const list = names.get(parent) ?? [];
    if (list.length < EXAMPLES_PER_FOLDER) list.push(file.basename);
    names.set(parent, list);
  }
  return [...names.entries()]
    .map(([path, examples]) => ({ path, examples }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** True when something else already sits at that exact path. */
export function pathTaken(app: App, path: string, moving: TAbstractFile): boolean {
  const existing = app.vault.getAbstractFileByPath(path);
  return existing !== null && existing !== moving;
}

/** `a/b/c.md` → `a/b`; a root-level file → `""`. */
export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function joinPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

export function folderExists(app: App, path: string): boolean {
  return app.vault.getAbstractFileByPath(path) instanceof TFolder;
}
