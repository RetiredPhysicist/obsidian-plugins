import { KeyedCache } from "./keyed-cache";

export interface MoveEntry {
  filePath: string;
  contentFingerprint: string;
  /** Changing the folder list or its examples changes every answer. */
  foldersHash: string;
  /** How much of the body the model saw; the answer depends on it. */
  bodyChars: number;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  modelId: string;
  promptVersion: string;
  judgedAt: number;
}

export function moveKey(parts: {
  filePath: string;
  contentFingerprint: string;
  foldersHash: string;
  bodyChars: number;
  modelId: string;
  promptVersion: string;
}): string {
  return [
    parts.filePath,
    parts.contentFingerprint,
    parts.foldersHash,
    parts.bodyChars,
    parts.modelId,
    parts.promptVersion,
  ].join("\0");
}

export class MoveCache {
  private store: KeyedCache<MoveEntry>;

  constructor(maxEntries?: number) {
    this.store = new KeyedCache((e) => moveKey(e), (e) => e.filePath, maxEntries);
  }

  load(entries: MoveEntry[]): void {
    this.store.load(entries);
  }

  dump(): MoveEntry[] {
    return this.store.dump();
  }

  get(parts: Parameters<typeof moveKey>[0]): MoveEntry | undefined {
    return this.store.get(moveKey(parts));
  }

  set(entry: MoveEntry): void {
    this.store.set(entry);
  }
}
