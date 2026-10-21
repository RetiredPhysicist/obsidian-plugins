import { KeyedCache } from "./keyed-cache";

export interface ScoreEntry {
  filePath: string;
  contentFingerprint: string;
  /** Changing the candidate vocabulary changes every answer for that file. */
  tagsHash: string;
  tags: Record<string, number>;
  modelId: string;
  bodyScope: string;
  firstN?: number;
  promptVersion: string;
  judgedAt: number;
}

export function scoreKey(parts: {
  filePath: string;
  contentFingerprint: string;
  tagsHash: string;
  modelId: string;
  promptVersion: string;
  bodyScope: string;
  firstN?: number;
}): string {
  return [
    parts.filePath,
    parts.contentFingerprint,
    parts.tagsHash,
    parts.modelId,
    parts.promptVersion,
    parts.bodyScope,
    parts.bodyScope === "first_n" ? (parts.firstN ?? "") : "",
  ].join("\0");
}

export class ScoreCache {
  private store: KeyedCache<ScoreEntry>;

  constructor(maxEntries?: number) {
    this.store = new KeyedCache((e) => scoreKey(e), (e) => e.filePath, maxEntries);
  }

  load(entries: ScoreEntry[]): void {
    this.store.load(entries);
  }

  dump(): ScoreEntry[] {
    return this.store.dump();
  }

  get(parts: Parameters<typeof scoreKey>[0]): ScoreEntry | undefined {
    return this.store.get(scoreKey(parts));
  }

  set(entry: ScoreEntry): void {
    this.store.set(entry);
  }
}
