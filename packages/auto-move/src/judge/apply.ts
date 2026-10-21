import type { App } from "obsidian";
import { TFile } from "obsidian";
import { joinPath, pathTaken } from "../vault/folders";

export interface ApplyOutcome {
  movedTo?: string;
  error?: string;
}

/** Moves one file. `fileManager.renameFile` updates links and records history. */
export async function moveFile(
  app: App,
  filePath: string,
  targetFolder: string
): Promise<ApplyOutcome> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return { error: "文件已不存在" };
  const target = joinPath(targetFolder, file.name);
  if (target === filePath) return {};
  if (pathTaken(app, target, file)) return { error: "目标已存在同名文件" };
  try {
    await app.fileManager.renameFile(file, target);
    return { movedTo: target };
  } catch (e) {
    return { error: `移动失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Moves one file back to where it came from. */
export async function moveBack(
  app: App,
  currentPath: string,
  originalPath: string
): Promise<string | undefined> {
  if (currentPath === originalPath) return undefined;
  const file = app.vault.getAbstractFileByPath(currentPath);
  if (!(file instanceof TFile)) return "文件已不在预期位置";
  if (pathTaken(app, originalPath, file)) return "原位置已被占用";
  try {
    await app.fileManager.renameFile(file, originalPath);
    return undefined;
  } catch (e) {
    return `移回失败：${e instanceof Error ? e.message : String(e)}`;
  }
}
