import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { PluginSettings } from "../settings";
import type { MoveCache } from "../cache/move-cache";
import { contentFingerprint } from "../cache/fingerprint";
import { joinPath, parentOf, pathTaken } from "../vault/folders";
import {
  PROMPT_VERSION,
  SystemOneCreditError,
  buildMoveQuestion,
  callSystemOne,
  parseMoveAnswer,
  type FolderHint,
  type MoveAnswer,
} from "../llm/systemone";
import { classifyMove, type MoveBucket, type MoveReason } from "./move";

export type RunStatus = "standby" | "judging" | "done" | "partial" | "stopped" | "failed";

/**
 * A file moves only when the model is at least this sure; anything below lands
 * in the manual-confirm column. Not a setting: the number is only meaningful
 * next to the option list it is measured against, and asking the user to tune a
 * probability they cannot calibrate makes the tool harder, not better.
 */
export const MOVE_THRESHOLD = 0.7;

/** Stop the run this many failures in a row: the cause is not per-file. */
const MAX_CONSECUTIVE_FAILURES = 5;

export interface MoveRun {
  id: string;
  createdAt: number;
  status: RunStatus;
  /** The folder the user points at; files come from it, recursively. */
  scopeFolder: string;
  /** Candidate destinations, editable during review. */
  folders: FolderHint[];
  /** filePath → the model's answer. */
  answers: Record<string, MoveAnswer>;
  /** Files kept for this run; absent means checked. */
  include: Record<string, boolean>;
  /** originalPath → the path the file now lives at. Only moved files appear. */
  applied: Record<string, string>;
  /** Judged order; the table renders in this order. */
  order: string[];
  activePath?: string;
  /** What went wrong on the last failed file, for the status line. */
  lastError?: string;
  /** Set when the run stopped early because failures kept coming. */
  abortedAfter?: number;
  stats: { filesTotal: number; judged: number; failed: number; elapsedMs: number };
  stopRequested: boolean;
}

export function newMoveRun(opts: {
  scopeFolder: string;
  folders: FolderHint[];
}): MoveRun {
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
    stopRequested: false,
  };
}

/** One request per file asking only where it belongs. */
async function judgeFile(opts: {
  app: App;
  settings: PluginSettings;
  file: TFile;
  folders: FolderHint[];
  modelId: string;
}): Promise<MoveAnswer | null> {
  const { app, settings, file, folders, modelId } = opts;
  let state: Record<string, string>;
  if (file.extension === "md") {
    const content = await app.vault.cachedRead(file);
    state = { note_title: file.basename, note_body: content.slice(0, settings.bodyChars) };
  } else {
    // A binary is judged by its name: sending bytes is not something to do unasked.
    state = { file_name: file.basename, file_type: file.extension };
  }
  const resp = await callSystemOne(settings.baseUrl, settings.apiKey, {
    model: modelId,
    state,
    questions: { dest: buildMoveQuestion(folders, parentOf(file.path)) },
  });
  return parseMoveAnswer(resp.answers?.dest);
}

export type ProgressCb = (run: MoveRun, message?: string) => void;

export async function runMoves(opts: {
  app: App;
  settings: PluginSettings;
  run: MoveRun;
  files: TFile[];
  cache: MoveCache;
  onProgress: ProgressCb;
  onCreditGone: (err: SystemOneCreditError) => void;
}): Promise<void> {
  const { app, settings, run, files, cache, onProgress, onCreditGone } = opts;
  const started = Date.now();
  run.status = "judging";
  run.stopRequested = false;
  run.stats = { filesTotal: files.length, judged: 0, failed: 0, elapsedMs: 0 };
  run.lastError = undefined;
  run.abortedAfter = undefined;
  run.order = files.map((f) => f.path);
  const foldersHash = contentFingerprint(
    run.folders
      .map((f) => `${f.path}\u0001${[...f.examples].sort().join("\u0002")}`)
      .sort()
      .join("\u0000")
  );
  onProgress(run, "开始判定…");

  let creditGone = false;
  let consecutive = 0;
  for (const file of files) {
    if (run.stopRequested || creditGone) break;
    run.activePath = file.path;
    onProgress(run, `判定中：${file.name}`);
    try {
      const content = file.extension === "md" ? await app.vault.cachedRead(file) : "";
      const cacheParts = {
        filePath: file.path,
        contentFingerprint: contentFingerprint(
          file.extension === "md"
            ? content
            : `${file.name}\u0000${file.stat.size}\u0000${file.stat.mtime}`
        ),
        foldersHash,
        bodyChars: settings.bodyChars,
        modelId: settings.modelId,
        promptVersion: PROMPT_VERSION,
      };
      const hit = cache.get(cacheParts);
      const answer = hit
        ? { choice: hit.choice, confidence: hit.confidence, probabilities: hit.probabilities }
        : await judgeFile({
            app,
            settings,
            file,
            folders: run.folders,
            modelId: settings.modelId,
          });
      if (!answer) {
        run.stats.failed++;
        run.lastError = `${file.name}：模型没有给出可用的选择`;
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
        // Kept on the run: a run that stops answering has to say why, and the
        // console is not where the user is looking.
        run.lastError = `${file.name}：${e instanceof Error ? e.message : String(e)}`;
        console.error("[systemone-auto-move] move judging failed", file.path, e);
        // Every file is judged the same way, so a run of consecutive failures is
        // one broken condition, not bad luck. Grinding through the rest spends
        // the user's time to produce the same error N more times.
        if (++consecutive >= MAX_CONSECUTIVE_FAILURES) {
          run.abortedAfter = run.stats.failed;
          break;
        }
      }
    } finally {
      run.activePath = undefined;
      run.stats.elapsedMs = Date.now() - started;
      onProgress(run);
    }
  }

  run.stats.elapsedMs = Date.now() - started;
  run.activePath = undefined;
  if (creditGone) run.status = "failed";
  else if (run.stopRequested) run.status = "stopped";
  else if (run.stats.failed > 0) run.status = "partial";
  else run.status = "done";
  onProgress(run, run.status);
}

export interface RowState {
  fromFolder: string;
  toFolder?: string;
  bucket: MoveBucket;
  reason?: MoveReason;
}

/** Derived row state — recomputed on every render, never persisted. */
export function moveRowState(app: App, run: MoveRun, filePath: string): RowState {
  const answer = run.answers[filePath] ?? null;
  const abstract = app.vault.getAbstractFileByPath(filePath);
  const file = abstract instanceof TFile ? abstract : null;
  const known = answer !== null && run.folders.some((f) => f.path === answer.choice);
  const collision =
    file !== null &&
    answer !== null &&
    answer.choice !== "keep" &&
    known &&
    pathTaken(app, joinPath(answer.choice, file.name), file);
  const verdict = classifyMove({
    answer,
    allowedFolders: run.folders.map((f) => f.path),
    threshold: MOVE_THRESHOLD,
    collision,
    alreadyThere: answer !== null && answer.choice === parentOf(filePath),
  });
  return {
    fromFolder: parentOf(filePath),
    toFolder: verdict.toFolder,
    bucket: verdict.bucket,
    reason: verdict.reason,
  };
}
