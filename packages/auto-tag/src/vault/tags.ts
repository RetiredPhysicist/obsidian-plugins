import { App, TFile } from "obsidian";

// Measured against Obsidian 1.14: `#` starts a tag only at line start or after a
// space, and the tag runs until whitespace or any of .,;:!?'"()[]{}|<>\`~*+=@$%^&.
// `/`, `-`, `_` and letters/digits continue it, so `#a/b`, `#a-b` and `#中文` stay whole.
// Deliberately narrower than the parser in a few markdown-emphasis corners: a false
// negative only risks one duplicate inline tag, a false positive deletes real text.
//
// `m` matters: without it `^` only matches offset 0 and every tag that starts a
// line past the first is invisible.
const INLINE_TAG_RE =
  /(^| )#((?:[^\s.,;:!?'"()[\]{}<>|`~*+=@$%^&/#]|\/(?![\s#]))+)/gmu;

export type WriteMode = "frontmatter" | "inline_top" | "both";

export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").trim();
}

/** Reads both `tags:` and the legacy singular `tag:` — notes in the wild use either. */
export function frontmatterTags(fm: Record<string, unknown> | undefined | null): string[] {
  if (!fm) return [];
  const out: string[] = [];
  for (const raw of [fm.tags, fm.tag]) {
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "string") {
      out.push(...raw.split(/[,\s]+/).map(normalizeTag).filter(Boolean));
    } else if (Array.isArray(raw)) {
      out.push(...raw.map((x) => normalizeTag(String(x))).filter(Boolean));
    }
  }
  return [...new Set(out)];
}

/**
 * Tags written as `#tag` inline. Frontmatter is excluded: a `#` there is a YAML
 * comment or part of a value, not a tag.
 */
export function inlineTagsFromContent(content: string): string[] {
  const body = stripFrontmatter(content).body;
  const out = new Set<string>();
  const re = new RegExp(INLINE_TAG_RE.source, "gmu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.add(normalizeTag(m[2]));
  return [...out];
}

export function noteTags(app: App, file: TFile, content?: string): string[] {
  const fileCache = app.metadataCache.getFileCache(file);
  const fromFm = frontmatterTags(fileCache?.frontmatter);
  const fromCache = fileCache?.tags?.map((t) => normalizeTag(t.tag)) ?? [];
  const fromInline = content !== undefined ? inlineTagsFromContent(content) : [];
  const out = new Set<string>();
  for (const t of [...fromFm, ...fromCache, ...fromInline]) {
    out.add(t.toLowerCase());
  }
  return [...out];
}

/**
 * Splits the leading `---` block from the body. The block ends at the first line
 * that is exactly `---` (optionally indented), which is where Obsidian's own
 * parser puts it; a `---` inside a block scalar is indented further and is not
 * a terminator unless the author meant it to be.
 */
export function stripFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
  /** Offsets of the block, so a caller can splice rather than re-serialise. */
  start: number;
  end: number;
} {
  const open = /^﻿?---[ \t]*(\r?\n)/.exec(content);
  if (!open) return { frontmatter: null, body: content, start: 0, end: 0 };
  const afterOpen = open[0].length;
  const rest = content.slice(afterOpen);
  const close = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/.exec(rest);
  if (!close) return { frontmatter: null, body: content, start: 0, end: 0 };
  const fmRaw = rest.slice(0, close.index);
  const end = afterOpen + close.index + close[0].length;
  return { frontmatter: fmRaw, body: content.slice(end), start: 0, end };
}

function eolOf(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Rewrites only the `tags:` entry inside an existing block, leaving every other
 * byte — comments, key order, quoting, dates the parser would normalise — as the
 * author wrote it. Returns the new block text.
 *
 * `tags`, when non-null, replaces the tag list; `null` deletes the key. A block
 * that never had the key gets it appended.
 */
function withTagsBlock(
  frontmatter: string,
  tags: string[] | null,
  eol: string
): string {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((l) => /^(tags|tag)\s*:/.test(l));
  if (start < 0) {
    if (tags === null || tags.length === 0) return frontmatter;
    return frontmatter + eol + renderTags(tags, eol);
  }
  // A block entry owns the lines indented under it, plus any item lines.
  let stop = start + 1;
  while (stop < lines.length && (/^[ \t]/.test(lines[stop]) || /^\s*-/.test(lines[stop]))) stop++;
  const inline = lines[start].slice(lines[start].indexOf(":") + 1).trim();
  // A multi-line `tags:` key can be written as a comma list on one line; the
  // continuation rule above would swallow the next key only if indented, so a
  // non-indented follow-up is correctly left alone.
  const wasInline = inline.length > 0 && !/^\[/.test(inline);
  if (wasInline && !/^\[/.test(inline)) {
    // `tags: a, b` is one line; do not eat what follows.
    stop = start + 1;
  }
  const replacement = tags === null || tags.length === 0 ? [] : renderTags(tags, eol).split(eol);
  return [...lines.slice(0, start), ...replacement, ...lines.slice(stop)].join(eol);
}

function renderTags(tags: string[], eol: string): string {
  // Block sequences match what Obsidian writes and what a human would type.
  return ["tags:", ...tags.map((t) => `  - ${quoteIfNeeded(t)}`)].join(eol);
}

function quoteIfNeeded(tag: string): string {
  return /^[\w一-龥][\w一-龥 /_-]*$/.test(tag) ? tag : JSON.stringify(tag);
}

/**
 * Returns the tags actually committed to the file. The caller stores this list and
 * hands it back to removeTagsFromNote on reset, so it must not over-report.
 */
export async function addTagsToNote(
  app: App,
  file: TFile,
  tags: string[],
  mode: WriteMode
): Promise<string[]> {
  // A PDF or an image is not a note: prepending YAML to it corrupts the file.
  if (file.extension !== "md") return [];
  const toAdd: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    toAdd.push(t);
  }
  if (toAdd.length === 0) return [];

  const existing = new Set(noteTags(app, file));
  const novel = toAdd.filter((t) => !existing.has(t.toLowerCase()));
  if (novel.length === 0) return [];

  const written: string[] = [];
  // One write per accepted note: a half-applied note would leave the suggestion
  // marked pending with tags already in the file and no record to undo them.
  await app.vault.process(file, (data) => {
    const eol = eolOf(data);
    const { frontmatter, body } = stripFrontmatter(data);
    let out = data;

    if (mode === "frontmatter" || mode === "both") {
      const before = frontmatterTags(frontmatter === null ? null : parseTagsBlock(frontmatter));
      const merged = dedupe([...before, ...novel]);
      const block =
        frontmatter === null
          ? renderTags(merged, eol)
          : withTagsBlock(frontmatter, merged, eol);
      out = `---${eol}${block}${eol}---${eol}${body}`;
      // Only report what this call added: undo must never remove a tag the note already had.
      for (const t of novel) if (!before.some((b) => b.toLowerCase() === t.toLowerCase())) written.push(t);
    }

    if (mode === "inline_top" || mode === "both") {
      // Read the tags from the text being written, not from the pre-write copy:
      // a note already carrying a line-start tag past line 1 would otherwise get
      // a duplicate prepended.
      const have = new Set(inlineTagsFromContent(out).map((t) => t.toLowerCase()));
      const missing = novel.filter((t) => !have.has(t.toLowerCase()));
      if (missing.length > 0) {
        const { body: currentBody, end: currentEnd } = stripFrontmatter(out);
        const head = out.slice(0, currentEnd);
        out = head + missing.map((t) => `#${t}`).join(" ") + eol + currentBody;
        for (const t of missing) if (!written.some((w) => w.toLowerCase() === t.toLowerCase())) written.push(t);
      }
    }

    return out === data ? data : out;
  });

  return written;
}

/**
 * Removes `tags` from wherever `mode` wrote them. Returns what was actually
 * removed: a tag the note no longer carries is not reported, so undo cannot
 * claim success having changed nothing.
 */
export async function removeTagsFromNote(
  app: App,
  file: TFile,
  tags: string[],
  mode: WriteMode
): Promise<string[]> {
  const remove = new Set(tags.map((t) => t.toLowerCase()).filter(Boolean));
  if (remove.size === 0) return [];

  const removed: string[] = [];
  await app.vault.process(file, (data) => {
    const eol = eolOf(data);
    const { frontmatter, body } = stripFrontmatter(data);
    let out = data;

    if ((mode === "frontmatter" || mode === "both") && frontmatter !== null) {
      const had = frontmatterTags(parseTagsBlock(frontmatter));
      const kept = had.filter((t) => !remove.has(t.toLowerCase()));
      for (const t of had) if (remove.has(t.toLowerCase())) removed.push(t);
      // Nothing to take out: leave the block byte-for-byte alone rather than
      // re-serialising a user's YAML to say the same thing.
      let block = frontmatter;
      if (kept.length !== had.length) {
        block = withTagsBlock(frontmatter, kept.length > 0 ? kept : null, eol);
      }
      // A block left with no keys is a block the note never had.
      const empty = block.split(/\r?\n/).every((l) => !l.trim());
      out = empty
        ? body
        : `---${eol}${block}${eol}---${eol}${body}`;
    }

    if (mode === "inline_top" || mode === "both") {
      const { body: currentBody, end } = stripFrontmatter(out);
      const head = out.slice(0, end);
      // Only the leading tag-only line that addTagsToNote injected is ours to undo;
      // scanning the body would also strip link anchors and code samples.
      const nextBody = currentBody.replace(
        /^[ \t]*((?:#[^\s#]+[ \t]*)+)\r?\n/,
        (_match, line: string) => {
          const tokens = line.trim().split(/[ \t]+/);
          const gone = tokens.filter((t) => remove.has(normalizeTag(t).toLowerCase()));
          for (const t of gone) {
            const name = normalizeTag(t);
            if (!removed.some((r) => r.toLowerCase() === name.toLowerCase())) removed.push(name);
          }
          const kept = tokens.filter((t) => !remove.has(normalizeTag(t).toLowerCase()));
          return kept.length > 0 ? `${kept.join(" ")}${eol}` : "";
        }
      );
      out = head + nextBody;
    }

    return out === data ? data : out;
  });
  return removed;
}

function dedupe(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Minimal read of a block's `tags:`/`tag:` value. */
function parseTagsBlock(frontmatter: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(tags|tag)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[2].trim();
    if (inline.startsWith("[") && inline.endsWith("]")) {
      out[m[1]] = inline
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }
    if (inline.length > 0) {
      out[m[1]] = inline;
      continue;
    }
    const items: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s+(.*)$/.exec(lines[j]);
      if (!item) break;
      items.push(item[1].trim().replace(/^["']|["']$/g, ""));
    }
    out[m[1]] = items;
  }
  return out;
}

/** Body sent to model: strip existing tags to reduce copy bias */
export function prepareBodyForJudge(
  content: string,
  scope: "full" | "first_n" | "title",
  firstN: number,
  title: string
): { title: string; body: string } {
  if (scope === "title") return { title, body: "" };
  const { body } = stripFrontmatter(content);
  const cleaned = body
    .replace(INLINE_TAG_RE, (_m, lead: string) => lead)
    .trim();
  return { title, body: scope === "first_n" ? cleaned.slice(0, firstN) : cleaned };
}
