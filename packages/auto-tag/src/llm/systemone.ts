/** Generic System One client (TypeSafe Jev-compatible). */

import { requestUrl } from "obsidian";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface SystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, NoulQuestion>;
}

export interface SystemOneResponse {
  model?: string;
  answers: Record<string, { type: string; noul?: number; [k: string]: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

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

const instruction = (tag: string) =>
  `Should this note be tagged with "#${tag}"? Answer yes only if the note's topic clearly fits that tag.`;
const criteriaTrue = (tag: string) =>
  `The note's content is clearly about or strongly related to "${tag}", so applying the tag would help retrieval.`;
const criteriaFalse = (tag: string) =>
  `The note is unrelated or only tangentially related to "${tag}"; the tag would be noise.`;

/**
 * Cache salt for tag scores. Deriving it from the prompt text means editing a
 * template invalidates cached probabilities; a hand-bumped constant gets forgotten.
 */
export const PROMPT_VERSION = hashShort(
  [instruction("{}"), criteriaTrue("{}"), criteriaFalse("{}")].join("\u0000")
);

/** Positional ids: `t0`, `t1`, … The caller keeps the same tag order to resolve them. */
export function tagQuestions(tags: string[]): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  tags.forEach((tag, i) => {
    questions[`t${i}`] = {
      type: "noul",
      instructions: instruction(tag),
      criteria: { true: criteriaTrue(tag), false: criteriaFalse(tag) },
    };
  });
  return questions;
}

/**
 * Which of these themes occur anywhere in the scanned notes. Asked per-vocabulary
 * word rather than per note: a candidate list is a property of the set. "At least
 * two notes" was tried and drops themes that are plainly present — a folder of
 * six notes is one of each thing, not two.
 */
export function themeQuestions(tags: string[]): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  tags.forEach((tag, i) => {
    questions[`t${i}`] = {
      type: "noul",
      instructions: `Is "${tag}" a useful tag for at least one of these notes?`,
      criteria: {
        true: `The notes contain material that fits "${tag}".`,
        false: `Nothing in the notes fits "${tag}".`,
      },
    };
  });
  return questions;
}

/**
 * A noul answer in [0, 1], or null when the endpoint did not answer that id.
 * `null`, `false` and `""` are answers-shaped absences, and `Number` would turn
 * each into a confident 0 — the one verdict that means "definitely not".
 */
export function parseNoul(answer: unknown): number | null {
  if (!answer || typeof answer !== "object") return null;
  const raw = (answer as { noul?: unknown }).noul;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Waits before retrying, three attempts in total. A run of a hundred notes
 * crosses enough of a network to see a transient failure, and losing one note
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
