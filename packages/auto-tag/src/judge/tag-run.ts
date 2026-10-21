import type { App, TFile } from "obsidian";
import type { PluginSettings } from "../settings";
import type { ScoreCache } from "../cache/score-cache";
import { contentFingerprint } from "../cache/fingerprint";
import { prepareBodyForJudge } from "../vault/tags";
import {
  PROMPT_VERSION,
  SystemOneCreditError,
  callSystemOne,
  parseNoul,
  tagQuestions,
} from "../llm/systemone";
import { bucket, writeSet } from "./bucket";

export type RunStatus = "standby" | "judging" | "done" | "partial" | "stopped" | "failed";

/**
 * A tag is written when the model is at least this sure. Not a setting: the
 * number is only meaningful next to the band below it, and asking the user to
 * tune a probability they cannot calibrate makes the tool harder, not better.
 */
export const WRITE_THRESHOLD = 0.8;

/** Stop the run this many failures in a row: the cause is not per-note. */
const MAX_CONSECUTIVE_FAILURES = 5;

export interface TagRun {
  status: RunStatus;
  /** The folder the user points at; files come from it, one level deep. */
  scopeFolder: string;
  /** The candidate vocabulary this run scores against. Editable during review. */
  tags: string[];
  maxTagsPerNote: number;
  /** filePath → tag → probability. Absent tags were never answered. */
  scores: Record<string, Record<string, number>>;
  /** Files kept for this run; absent means checked. */
  include: Record<string, boolean>;
  /**
   * What was written, for undo. The write mode is captured per note: switching
   * the setting between apply and undo would otherwise remove the tags from a
   * place they were never written to, and report success having removed nothing.
   */
  applied: Record<string, { tags: string[]; writeMode: PluginSettings["writeMode"] }>;
  /** Judged order; the table renders in this order. */
  order: string[];
  activePath?: string;
  /** What went wrong on the last failed note, for the status line. */
  lastError?: string;
  /** Set when the run stopped early because failures kept coming. */
  abortedAfter?: number;
  stats: { filesTotal: number; judged: number; failed: number; elapsedMs: number };
  stopRequested: boolean;
}

export function newTagRun(opts: {
  scopeFolder: string;
  tags: string[];
  maxTagsPerNote: number;
}): TagRun {
  return {
    status: "standby",
    ...opts,
    scores: {},
    include: {},
    applied: {},
    order: [],
    stats: { filesTotal: 0, judged: 0, failed: 0, elapsedMs: 0 },
    stopRequested: false,
  };
}

async function judgeFile(opts: {
  app: App;
  settings: PluginSettings;
  file: TFile;
  tags: string[];
  modelId: string;
  bodyScope: PluginSettings["bodyScope"];
  bodyChars: number;
}): Promise<Record<string, number>> {
  const { app, settings, file, tags, modelId, bodyScope, bodyChars } = opts;
  const content = await app.vault.cachedRead(file);
  const prepared = prepareBodyForJudge(
    content,
    settings.bodyScope,
    settings.bodyChars,
    file.basename
  );
  const resp = await callSystemOne(settings.baseUrl, settings.apiKey, {
    model: settings.modelId,
    state: { note_title: prepared.title, note_body: prepared.body },
    questions: tagQuestions(tags),
  });
  const scored: Record<string, number> = {};
  tags.forEach((tag, i) => {
    const p = parseNoul(resp.answers?.[`t${i}`]);
    // Unanswered is not zero: leaving it out keeps it out of the write set
    // instead of recording a verdict the model never gave.
    if (p !== null) scored[tag] = p;
  });
  return scored;
}

export type ProgressCb = (run: TagRun, message?: string) => void;

export async function runTagging(opts: {
  app: App;
  settings: PluginSettings;
  run: TagRun;
  files: TFile[];
  cache: ScoreCache;
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
  const tagsHash = contentFingerprint([...run.tags].sort().join("\u0000"));
  onProgress(run, "开始判定…");

  let creditGone = false;
  let consecutive = 0;
  for (const file of files) {
    if (run.stopRequested || creditGone) break;
    run.activePath = file.path;
    onProgress(run, `判定中：${file.name}`);
    try {
      const content = await app.vault.cachedRead(file);
      const cacheParts = {
        filePath: file.path,
        contentFingerprint: contentFingerprint(content),
        tagsHash,
        modelId: settings.modelId,
        promptVersion: PROMPT_VERSION,
        bodyScope: settings.bodyScope,
        firstN: settings.bodyChars,
      };
      const hit = cache.get(cacheParts);
      const scores =
        hit?.tags ??
        (await judgeFile({
          app,
          settings,
          file,
          tags: run.tags,
          modelId: settings.modelId,
          bodyScope: settings.bodyScope,
          bodyChars: settings.bodyChars,
        }));
      // Cache only a complete answer. A partial one cached here would be served
      // again on every later run with the same vocabulary, so a single transient
      // omission would read as "this tag does not apply" for good.
      if (!hit && Object.keys(scores).length === run.tags.length) {
        cache.set({ ...cacheParts, tags: scores, judgedAt: Date.now() });
      }
      run.scores[file.path] = scores;
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
        console.error("[systemone-auto-tag] tag judging failed", file.path, e);
        // Every note is judged the same way, so a run of consecutive failures is
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
  /** Every scored tag, in plan order. */
  scored: { tag: string; p: number; bucket: "w" | "h" | "n" }[];
  /** Tags that would be written: above τ, not already on the note, capped. */
  writeTags: string[];
}

/** Derived row state — recomputed on every render, never persisted. */
export function tagRowState(run: TagRun, filePath: string, existing: string[]): RowState {
  const scores = run.scores[filePath];
  if (!scores) return { scored: [], writeTags: [] };
  const scored = run.tags
    .filter((t) => scores[t] !== undefined)
    .map((t) => ({ tag: t, p: scores[t], bucket: bucket(scores[t], WRITE_THRESHOLD) }));
  return {
    scored,
    writeTags: writeSet(run.tags, scores, WRITE_THRESHOLD, existing, run.maxTagsPerNote),
  };
}
