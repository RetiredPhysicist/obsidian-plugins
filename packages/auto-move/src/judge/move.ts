import { KEEP, type MoveAnswer } from "../llm/systemone";

export type MoveBucket = "move" | "confirm" | "stay";

export type MoveReason = "low-confidence" | "collision" | "no-answer" | "unknown-option";

export interface MoveVerdict {
  /** Absent when the model picked `keep`, answered badly, or nothing was asked. */
  toFolder?: string;
  bucket: MoveBucket;
  /** Why this needs a human, when it does. */
  reason?: MoveReason;
}

export function classifyMove(opts: {
  answer: MoveAnswer | null;
  /** Folder paths that are legitimate destinations. */
  allowedFolders: string[];
  threshold: number;
  /** A same-named file already occupies the destination. */
  collision: boolean;
  alreadyThere: boolean;
}): MoveVerdict {
  const { answer, allowedFolders, threshold, collision, alreadyThere } = opts;
  if (!answer) return { bucket: "confirm", reason: "no-answer" };
  if (answer.choice === KEEP) return { bucket: "stay" };
  if (!allowedFolders.includes(answer.choice)) {
    return { bucket: "confirm", reason: "unknown-option" };
  }
  if (alreadyThere) return { bucket: "stay", toFolder: answer.choice };
  if (collision) return { toFolder: answer.choice, bucket: "confirm", reason: "collision" };
  // Confidence alone can be high while the distribution is flat; the weaker of
  // the two is what a single move should be trusted with.
  const top = answer.probabilities[answer.choice];
  const score = Math.min(answer.confidence, Number.isFinite(top) ? top : answer.confidence);
  if (score >= threshold) return { toFolder: answer.choice, bucket: "move" };
  return { toFolder: answer.choice, bucket: "confirm", reason: "low-confidence" };
}
