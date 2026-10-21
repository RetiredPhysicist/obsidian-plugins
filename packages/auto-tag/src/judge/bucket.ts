export type Bucket = "w" | "h" | "n";

export const HUMAN_BAND = 0.2;

// Scores are 2-decimal values parsed from JSON, so 0.6 is really 0.5999…97 while
// threshold - band evaluates to 0.6000…01. Without the epsilon an exact band
// boundary lands in "ignore".
const EPS = 1e-9;

export function bucket(p: number, threshold: number): Bucket {
  if (p >= threshold) return "w";
  if (p >= threshold - HUMAN_BAND - EPS) return "h";
  return "n";
}

/**
 * The tags this note would receive: above τ, not already on it, strongest
 * first, capped. `maxTags` 0 means no cap.
 */
export function writeSet(
  tags: string[],
  scores: Record<string, number>,
  threshold: number,
  exclude: string[],
  maxTags: number
): string[] {
  const excl = new Set(exclude.map((t) => t.toLowerCase()));
  const auto = tags.filter((tag) => {
    if (excl.has(tag.toLowerCase())) return false;
    const p = scores[tag];
    if (p === undefined) return false;
    return bucket(p, threshold) === "w";
  });
  auto.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  return maxTags > 0 ? auto.slice(0, maxTags) : auto;
}
