/** Generic System One client (TypeSafe Jev-compatible). */

import { requestUrl } from "obsidian";

/** Picks one of at most 255 named options — the API rejects a 256th. */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface SystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, ChoiceQuestion>;
}

export interface SystemOneChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface SystemOneResponse {
  model?: string;
  answers: Record<string, { type: string; [k: string]: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export const MAX_CHOICES = 255;

/** The model's way of saying the file is already where it belongs. */
export const KEEP = "keep";

export class SystemOneCreditError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(
      status === 402
        ? "System One 额度已用尽（HTTP 402）。请充值或更换 API key 后再试。"
        : `System One 请求失败（HTTP ${status}）：额度或配额问题。${body.slice(0, 200)}`
    );
    this.name = "SystemOneCreditError";
    this.status = status;
  }
}

export class SystemOneError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`System One HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "SystemOneError";
    this.status = status;
    this.body = body;
  }
}

export function normalizeBaseUrl(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, "");
  u = u.replace(/\/v1\/systemone$/i, "");
  u = u.replace(/\/v1$/i, "");
  return u;
}

export function systemOneEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/systemone`;
}

function hashShort(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const destInstruction =
  "Which of these existing folders should this file be filed into? " +
  "Each option lists files already in it, which is the evidence for what belongs there. " +
  'Answer "keep" only when the file is already in the folder it belongs to.';

/**
 * Folder names alone say little (`notes/`, `misc/`). Listing what is already
 * inside is the only local evidence of what a folder means, and it costs a
 * handful of tokens per option.
 */
function destCriteria(folder: string, examples: string[]): string {
  if (examples.length === 0) return `A folder named ${folder}/.`;
  return `${folder}/ already contains: ${examples.join(", ")}.`;
}

function keepCriteria(currentFolder: string): string {
  return `Leave it in ${currentFolder === "" ? "the vault root" : `${currentFolder}/`}.`;
}

/**
 * Cache salt for a destination answer. Folded in: both criteria wordings and the
 * `keep` option, since reworded criteria or a changed keep option change what the
 * model is answering even though the folders are the same.
 */
export const PROMPT_VERSION = hashShort(
  [
    destInstruction,
    destCriteria("{}", ["{}"]),
    keepCriteria("{}"),
  ].join("\u0000")
);

export interface FolderHint {
  path: string;
  /** Names of files already in that folder, used as evidence of its purpose. */
  examples: string[];
}

/** How many folders a choice question can actually offer, `keep` included. */
export const OFFERABLE_FOLDERS = MAX_CHOICES - 1;

/**
 * One choice question per file. The file's current folder is left out and `keep`
 * stands for it: offering both splits the probability mass between two ways of
 * saying "do not move this", which is what drags confidence below the threshold
 * and pushes every file into manual confirmation.
 */
export function buildMoveQuestion(
  folders: FolderHint[],
  currentFolder: string
): ChoiceQuestion {
  const criteria: Record<string, string | null> = {};
  const options = folders.filter((f) => f.path !== currentFolder);
  for (const folder of options.slice(0, OFFERABLE_FOLDERS)) {
    criteria[folder.path] = destCriteria(folder.path, folder.examples);
  }
  // A folder literally named `keep` cannot be offered: the option would collide.
  criteria[KEEP] = keepCriteria(currentFolder);
  return { type: "choice", instructions: destInstruction, criteria };
}

export interface MoveAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export function parseMoveAnswer(answer: unknown): MoveAnswer | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as Partial<SystemOneChoiceAnswer>;
  if (a.type !== "choice" || typeof a.choice !== "string") return null;
  const confidence = Number(a.confidence);
  return {
    choice: a.choice,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    probabilities: a.probabilities ?? {},
  };
}

/**
 * Waits before retrying, three attempts in total. A run of a hundred files
 * crosses enough of a network to see a transient failure, and losing one file
 * to it silently is worse than waiting two seconds.
 */
const RETRY_DELAYS_MS = [600, 1800];
const RETRIES = RETRY_DELAYS_MS.length;

/**
 * Worth trying again: the endpoint was busy, or the connection dropped mid-flight.
 * A wrong base URL or a blocked port fails the same way every time, so retrying
 * only makes the user wait longer for the same answer.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof SystemOneCreditError) return false;
  if (!(err instanceof SystemOneError)) return true;
  return err.status === 429 || err.status >= 500;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function callSystemOne(
  baseUrl: string,
  apiKey: string,
  req: SystemOneRequest
): Promise<SystemOneResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(baseUrl, apiKey, req);
    } catch (e) {
      if (attempt >= RETRIES || !isRetryable(e)) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function callOnce(
  baseUrl: string,
  apiKey: string,
  req: SystemOneRequest
): Promise<SystemOneResponse> {
  if (!apiKey) throw new SystemOneError(401, "Missing API key");
  // requestUrl proxies through the main process: the renderer's fetch() is
  // blocked by CORS for every non-allowlisted origin.
  let res;
  try {
    res = await requestUrl({
      url: systemOneEndpoint(baseUrl),
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(req),
      throw: false,
    });
  } catch (e) {
    throw new SystemOneError(0, `Network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = res.text ?? "";
  if (res.status < 200 || res.status >= 300) {
    // Only a failing response can be about credits: a success body echoes the
    // chosen option names, so a folder called `credit-cards` would otherwise
    // abort a run that was going fine.
    if (res.status === 402 || /insufficient|credit|quota|billing|out of credit/i.test(text)) {
      throw new SystemOneCreditError(res.status, text);
    }
    throw new SystemOneError(res.status, text);
  }
  try {
    return JSON.parse(text) as SystemOneResponse;
  } catch {
    throw new SystemOneError(res.status, `Invalid JSON: ${text.slice(0, 200)}`);
  }
}
